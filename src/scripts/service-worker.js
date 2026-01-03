const ADS_DB_KEY = 'AdsDB';
const STORE_NAME = 'AdsTemplates';
const ADS_THRESHOLD = 0.95; // Confidence threshold for ad detection

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ADS_DB_KEY, 2);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        objectStore.createIndex('host', 'host', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = reject;
  });
};

function base64ToBlob(base64) {
  const [header, data] = base64.split(',');
  const byteString = atob(data);
  const mimeType = header.match(/:(.*?);/)[1];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getHost(url) {
  try {
    return new URL(url).hostname;
  } catch (err) {
    console.error('Invalid URL:', err);
    return null;
  }
}

/**
 * Convert color image to grayscale
 * 
 * @param {ImageBitmap} imageBitmap - Source color image
 * @returns {Object} - Object containing grayscale pixel data and dimensions
 * @private
 */
function convertToGrayscale(imageBitmap) {
  const { width, height } = imageBitmap;

  // Create canvas to draw the image
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Draw the image on canvas
  ctx.drawImage(imageBitmap, 0, 0, width, height);

  // Get image data with RGBA values
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  // Create grayscale Uint8Array
  const grayscaleData = new Uint8Array(width * height);

  // Convert RGBA to grayscale using luminance formula: 0.299R + 0.587G + 0.114B
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    grayscaleData[j] = Math.round(
      0.299 * pixels[i] +      // Red
      0.587 * pixels[i + 1] +  // Green
      0.114 * pixels[i + 2]    // Blue
    );
  }

  return {
    data: grayscaleData,
    width: width,
    height: height
  };
}

function generateHash(grayPixels, avg) {
  let hash = 0n;
  grayPixels.forEach((val, i) => {
    if (val > avg) {
      hash |= 1n << BigInt(63 - i);
    }
  });
  return hash;
}

function hammingDistance(hash1, hash2) {
  const diff = hash1 ^ hash2;
  return diff.toString(2).replace(/0/g, '').length;
}

function calcSimilarity(image1, image2) {
  const distance = hammingDistance(
    generateHash(image1, image1.reduce((a, b) => a + b) / image1.length),
    generateHash(image2, image2.reduce((a, b) => a + b) / image2.length)
  )
  return 1 - (distance / 64);
}

/**
 * Compute a 64-bit perceptual hash (pHash-like) from an ImageBitmap by downscaling to 8x8.
 * Returns a BigInt representing the 64-bit hash.
 * @param {ImageBitmap} imageBitmap
 * @returns {BigInt}
 */
function getPHashFromImageBitmap(imageBitmap) {
  const size = 8;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  // draw and scale down to 8x8
  ctx.drawImage(imageBitmap, 0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size).data;
  const gray = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = imgData[i * 4];
    const g = imgData[i * 4 + 1];
    const b = imgData[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  const avg = gray.reduce((a, b) => a + b, 0) / gray.length;
  return generateHash(gray, avg);
}

/**
 * Compute pHash from stored grayscale data by rebuilding an Image and downscaling to 8x8.
 * @param {Uint8Array} grayscaleData
 * @param {number} width
 * @param {number} height
 * @returns {Promise<BigInt>}
 */
async function getPHashFromGrayscaleData(grayscaleData, width, height) {
  // rebuild a PNG blob from grayscale and compute the pHash from its ImageBitmap
  const blob = await grayscaleToImageData(grayscaleData, width, height);
  const bitmap = await createImageBitmap(blob);
  return getPHashFromImageBitmap(bitmap);
}

async function saveAdsTemplate(templateFrame, templateRegion, tab, duration = 3700) {
  imageBitmap = await createImageBitmap(base64ToBlob(templateFrame));
  const grayscaleImage = convertToGrayscale(imageBitmap);

  // Store the template
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const host = getHost(tab.url);
  if (!host) {
    console.error('Failed to extract host from URL:', tab.url);
    return;
  }

  store.put({
    id: Date.now(),
    imageData: grayscaleImage.data, // Store grayscale data for faster matching
    host,
    width: grayscaleImage.width, // size info will be used for matching
    height: grayscaleImage.height,
    region: templateRegion,
    duration
  });
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (tabs.length === 0) {
        reject(new Error('No active tab found'));
      } else {
        resolve(tabs[0]);
      }
    });
  });
}

function grayscaleToImageData(grayscaleData, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < grayscaleData.length; i++) {
    const value = grayscaleData[i];
    imageData.data[i * 4] = value;     // R
    imageData.data[i * 4 + 1] = value; // G
    imageData.data[i * 4 + 2] = value; // B
    imageData.data[i * 4 + 3] = 255;   // A
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}


chrome.commands.onCommand.addListener((command) => {
  if (command === 'markAds') {
    console.log("Mark Ads command triggered");
    getActiveTab().then(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "markAds",
      });
    })
  }
  else if (command === 'enableAdsCheck') {
    console.log("Check Ads command triggered");
    getActiveTab().then(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "setEnabled"
      });
    }).catch(err => {
      console.error("Error getting active tab:", err);
    });
  }
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'cleanAds') {
    console.log("Clean Ads message received");
    openDB().then(db => {
      getActiveTab().then(activeTab => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const activeHost = getHost(activeTab.url);
        if (!activeHost) {
          sendResponse({ status: 'error', message: 'Invalid active tab URL' });
          return;
        }
        const index = store.index('host');
        const request = index.openCursor(IDBKeyRange.only(activeHost));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            sendResponse({ status: 'success', message: 'Ads templates deleted successfully' });
          }
        };
        request.onerror = () => {
          console.error('Error retrieving ads templates:', request.error);
          sendResponse({ status: 'error', message: 'Failed to retrieve ads templates' });
        };
      }).catch(err => {
        console.error('Database error:', err);
        sendResponse({ status: 'error', message: 'Database error' });
      });
    })
  } else if (message.action === 'markAds') {
    console.log("Mark Ads message received");
    getActiveTab().then(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "markAds",
      });
    })
  }
  else if (message.action === 'checkAds') {
    console.log("Check Ads message received");
    openDB().then(db => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      // get the active tab's host
      const activeTab = sender.tab;
      const activeHost = getHost(activeTab.url);
      if (!activeHost) {
        sendResponse({ status: 'error', message: 'Invalid active tab URL' });
        return;
      }

      // get all ads of the active host
      const index = store.index('host');
      const request = index.getAll(activeHost);

      request.onsuccess = async () => {
        const templates = request.result;
        const searchBitmap = await createImageBitmap(base64ToBlob(message.videoFrame));
        const debugMode = !!message.debug;

        // iterate templates sequentially so we can await blob/image operations
        let templateMatched = null;
        let debugTemplateBase64 = null;
        let debugSearchRegionBase64 = null;

        for (const template of templates) {
          // cut the same region with the template out
          const templateWidth = template.width;
          const templateHeight = template.height;
          const templateRegion = template.region;
          const canvas = new OffscreenCanvas(templateWidth, templateHeight);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(
            searchBitmap,
            templateRegion.x, templateRegion.y, templateRegion.w, templateRegion.h,
            0, 0, templateWidth, templateHeight
          );

          // get the color/png blob of the search region (for debug)
          const searchRegionBlob = await canvas.convertToBlob({ type: 'image/png' });

          // compute robust 8x8 pHash for both template and search region
          let similarity = 0;
          try {
            const templateHash = await getPHashFromGrayscaleData(template.imageData, template.width, template.height);
            const searchBitmapForHash = await createImageBitmap(searchRegionBlob);
            const searchHash = getPHashFromImageBitmap(searchBitmapForHash);
            const distance = hammingDistance(templateHash, searchHash);
            similarity = 1 - (distance / 64);
          } catch (err) {
            console.error('Failed to compute pHash similarity:', err);
            similarity = 0;
          }
          console.log(`Template ${template.id} similarity:`, similarity);

          // build base64 strings for debugging only when requested to avoid heavy processing
          if (debugMode) {
            try {
              const templateBlob = await grayscaleToImageData(template.imageData, template.width, template.height);
              debugTemplateBase64 = await blobToBase64(templateBlob);
            } catch (err) {
              console.error('Failed to rebuild template image base64:', err);
              debugTemplateBase64 = null;
            }

            try {
              debugSearchRegionBase64 = await blobToBase64(searchRegionBlob);
            } catch (err) {
              console.error('Failed to convert search region to base64:', err);
              debugSearchRegionBase64 = null;
            }

            // Print base64 strings for debugging (full strings). Be aware these can be large.
            if (debugTemplateBase64) {
              console.log(`Template ${template.id} base64:`, debugTemplateBase64);
            }
            if (debugSearchRegionBase64) {
              console.log(`Search region for template ${template.id} base64:`, debugSearchRegionBase64);
            }
          }

          if (similarity > ADS_THRESHOLD) {
            templateMatched = template;
            break;
          }
        }

        console.log("Ads found:", templateMatched);
        const responseData = {
          adsFound: !!templateMatched,
          duration: templateMatched?.duration,
          adsId: templateMatched?.id
        };
        if (debugMode) {
          responseData.debug = {
            templateBase64: debugTemplateBase64,
            searchRegionBase64: debugSearchRegionBase64
          };
        }

        sendResponse({ status: 'success', data: responseData });
      };

      request.onerror = () => {
        sendResponse({ status: 'error', message: 'Failed to retrieve ads' });
      };
    }).catch(err => {
      console.error('Database error:', err);
      sendResponse({ status: 'error', message: 'Database error' });
    });
  } else if (message.action === 'saveAdsTemplate') {
    console.log("Save ads message received");
    const templateFrame = message.templateFrame;
    const templateRegion = message.templateRegion;
    const duration = message.duration;

    saveAdsTemplate(templateFrame, templateRegion, sender.tab, duration).then(() => {
      sendResponse({ status: 'success', message: 'Template saved successfully' });
    }).catch(err => {
      console.error('Database error:', err);
      sendResponse({ status: 'error', message: 'Database error' });
    });
  }

  return true; // Keep the message channel open for sendResponse
})

console.log("Service worker loaded and ready to handle commands and messages.");
