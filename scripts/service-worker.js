const ADS_DB_KEY = 'AdsDB';
const STORE_NAME = 'AdsTemplates';


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
 * Match template with image using normalized cross-correlation algorithm.
 * 
 * @param {Uint8Array} templateData - Pixel data of the template image (smaller image)
 * @param {Uint8Array} searchData - Pixel data of the image to search in (larger image)
 * @param {number} templateWidth - Width of the template image
 * @param {number} templateHeight - Height of the template image
 * @param {number} searchWidth - Width of the search image
 * @param {number} searchHeight - Height of the search image
 * @returns {Object} - Match result with position (x,y) and confidence (0-1)
 */
function matchTemplate(
  templateData,
  searchData,
  templateWidth,
  templateHeight,
  searchWidth,
  searchHeight
) {
  // Initialize match result variables
  let maxCorrelation = -Infinity;
  let bestMatchX = -1;
  let bestMatchY = -1;

  // Make sure the search image is larger than or equal to the template image
  if (searchWidth < templateWidth || searchHeight < templateHeight) {
    console.error("Search image must be larger than or equal to template image");
    return { x: -1, y: -1, confidence: 0 };
  }

  // Iterate over the search image to find the best match
  for (let searchY = 0; searchY <= searchHeight - templateHeight; searchY += 1) {
    for (let searchX = 0; searchX <= searchWidth - templateWidth; searchX += 1) {

      // Calculate the correlation for the current position
      let correlationSum = 0;
      let templateSquareSum = 0;
      let searchSquareSum = 0;

      // Iterate over the template image pixels
      for (let templateY = 0; templateY < templateHeight; templateY += 1) {
        for (let templateX = 0; templateX < templateWidth; templateX += 1) {
          const templatePixel = templateData[templateY * templateWidth + templateX];
          const searchPixel = searchData[(searchY + templateY) * searchWidth + (searchX + templateX)];

          correlationSum += templatePixel * searchPixel;
          templateSquareSum += templatePixel ** 2;
          searchSquareSum += searchPixel ** 2;
        }
      }

      // Normalize the correlation value
      const denominator = Math.sqrt(templateSquareSum * searchSquareSum);
      const normalizedCorrelation = denominator > 0 ? correlationSum / denominator : -1;

      // Update the best match if the current correlation is higher
      if (maxCorrelation < normalizedCorrelation) {
        maxCorrelation = normalizedCorrelation;
        bestMatchX = searchX;
        bestMatchY = searchY;
      }
    }
  }

  // Normalize the correlation value to a confidence score between 0 and 1
  const confidence = maxCorrelation === -Infinity ? 0 : (maxCorrelation + 1) / 2;

  return {
    x: bestMatchX,
    y: bestMatchY,
    confidence
  };
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

function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        reject(new Error('No active tab found'));
        return;
      }
      const tab = tabs[0];
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png", quality: 60 }, async (image) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          const imageBitmap = await createImageBitmap(base64ToBlob(image));
          resolve({ imageBitmap, host: getHost(tab.url) });
        }
      });
    }
    );
  });
}

function cropImage(imageBitmap, x, y, width, height) {
  return createImageBitmap(
    imageBitmap,
    x, y,
    width, height
  );
}

function grayscaleToImageData(grayscaleData, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);

  // 将灰度值转换为RGBA
  for (let i = 0; i < grayscaleData.length; i++) {
    const value = grayscaleData[i];
    // RGBA格式 - 对于每个像素设置相同的RGB值以保持灰度
    imageData.data[i * 4] = value;     // R
    imageData.data[i * 4 + 1] = value; // G
    imageData.data[i * 4 + 2] = value; // B
    imageData.data[i * 4 + 3] = 255;   // A (完全不透明)
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function markAds() {
  // Create image bitmap from screenshot
  const { imageBitmap, host } = await captureVisibleTab();

  // Define crop dimensions (100x100 from center)
  const cropSize = 37;
  const cropX = Math.floor((imageBitmap.width - cropSize) / 2);
  const cropY = Math.floor((imageBitmap.height - cropSize) / 2);

  // Create cropped image bitmap
  const croppedBitmap = await cropImage(imageBitmap, cropX, cropY, cropSize, cropSize);

  // Convert cropped image to grayscale
  const grayscaleImage = convertToGrayscale(croppedBitmap);

  // Store the template
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  if (!host) {
    console.error('Failed to extract host from URL:', tab[0].url);
    return;
  }

  const adsId = Date.now();
  store.put({
    id: adsId,
    imageData: grayscaleImage.data, // Store grayscale data for faster matching
    width: cropSize,
    height: cropSize,
    host,
    duration: 3700
  });

  return adsId;
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


chrome.commands.onCommand.addListener((command) => {
  if (command === 'markAds') {
    console.log("Mark Ads command triggered");

    getActiveTab().then(tab => {
      markAds().then((adsId) => {
        chrome.tabs.sendMessage(tab.id, {
          action: "openSetDurationForm",
          adsId
        });
      }).catch(err => {
        console.error("Error marking ads:", err);
        chrome.tabs.sendMessage(tab.id, {
          action: "toast",
          content: "Error marking ads: " + err.message
        });
      })
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
  if (message.action === 'markAds') {
    console.log("Mark Ads message received");
    markAds().then(() => {
      console.log("Ads marked successfully");
      sendResponse({ status: 'success', message: 'Ads marked successfully' });
    }).catch(err => {
      console.error("Error marking ads:", err);
      sendResponse({ status: 'error', message: 'Error marking ads: ' + err.message });
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
        const { imageBitmap } = await captureVisibleTab();
        const cropSize = 100;
        const cropX = Math.max(Math.floor((imageBitmap.width - cropSize) / 2), 0);
        const cropY = Math.max(Math.floor((imageBitmap.height - cropSize) / 2), 0);
        const searchBitmap = await cropImage(imageBitmap, cropX, cropY, Math.min(cropSize, imageBitmap.width), Math.min(cropSize, imageBitmap.height));
        const searchBitmapGrayscale = convertToGrayscale(searchBitmap);

        const templateMatched = templates.find(template => {
          const matchResult = matchTemplate(
            template.imageData,
            searchBitmapGrayscale.data,
            template.width,
            template.height,
            searchBitmapGrayscale.width,
            searchBitmapGrayscale.height
          );

          // Check if confidence is above a threshold (e.g., 0.8)
          return matchResult.confidence > 0.8;
        });
        console.log("Ads found:", templateMatched);
        sendResponse({
          status: 'success',
          data: { adsFound: !!templateMatched, duration: templateMatched.duration }
        });
      };

      request.onerror = () => {
        sendResponse({ status: 'error', message: 'Failed to retrieve ads' });
      };
    }).catch(err => {
      console.error('Database error:', err);
      sendResponse({ status: 'error', message: 'Database error' });
    });
  } else if (message.action === 'updateDuration') {
    console.log("Update Duration message received");
    openDB().then(db => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const adsId = message.adsId;
      const duration = message.duration;

      store.get(adsId).onsuccess = (event) => {
        const adTemplate = event.target.result;
        if (adTemplate) {
          adTemplate.duration = duration;
          store.put(adTemplate).onsuccess = () => {
            console.log("Duration updated successfully");
            sendResponse({ status: 'success', message: 'Duration updated successfully' });
          };
        } else {
          console.error("Ad template not found for ID:", adsId);
          sendResponse({ status: 'error', message: 'Ad template not found' });
        }
      };

      transaction.onerror = () => {
        console.error("Transaction error:", transaction.error);
        sendResponse({ status: 'error', message: 'Failed to update duration' });
      };
    }).catch(err => {
      console.error('Database error:', err);
      sendResponse({ status: 'error', message: 'Database error' });
    });

  }

  return true; // Keep the message channel open for sendResponse
})

console.log("Service worker loaded and ready to handle commands and messages.");
