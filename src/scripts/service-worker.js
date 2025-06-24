const ADS_DB_KEY = 'AdsDB';
const STORE_NAME = 'AdsTemplates';
const ADS_THRESHOLD = 0.95; // Confidence threshold for ad detection

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ADS_DB_KEY, 1);
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

async function saveAdsTemplate(templateFrame, tab, duration = 3700) {
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
        const searchBitmapGrayscale = convertToGrayscale(searchBitmap);

        const templateMatched = templates.find(template => {
          const similarity = calcSimilarity(template.imageData, searchBitmapGrayscale.data);
          console.log(`Template ${template.id} similarity:`, similarity);

          return similarity > ADS_THRESHOLD;
        });

        console.log("Ads found:", templateMatched);
        sendResponse({
          status: 'success',
          data: { adsFound: !!templateMatched, duration: templateMatched?.duration, adsId: templateMatched?.id }
        });
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
    const duration = message.duration;

    saveAdsTemplate(templateFrame, sender.tab, duration).then(() => {
      sendResponse({ status: 'success', message: 'Template saved successfully' });
    }).catch(err => {
      console.error('Database error:', err);
      sendResponse({ status: 'error', message: 'Database error' });
    });
  }

  return true; // Keep the message channel open for sendResponse
})

console.log("Service worker loaded and ready to handle commands and messages.");
