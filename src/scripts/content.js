window.__unocss = {
  shortcuts: [
    ['toast-container', 'fixed top-0 left-0 w-100vw h-100vh z-2147483647 pointer-events-none'],
    ['toast', 'bg-[rgba(255,255,255,.3)] backdrop-blur absolute z-2147483647 px3 py2 top-10% right-50% translate-x-50% rounded-lg c-gray-800'],
    ['speeding-up-container', 'fixed top-0 left-0 w-100vw h-100vh z-2147483647 backdrop-blur bg-[rgba(0,0,0,.06)] flex items-center justify-center'],
    ['speeding-up-icon', 'w-37%'],
    ['form-overlay', 'fixed z-2147483647 top-0 left-0 w-100vw h-100vh bg-[rgba(0,0,0,.06)] backdrop-blur flex items-center justify-center'],
    ['form-container', 'p4 rounded-xl bg-white w-fit flex flex-col gap4'],
    ['form-input', 'b-1 outline-none b-gray-300 p2 rounded-lg'],
    ['form-button-container', 'flex justify-end gap4'],
    ['form-button', 'm0 bg-gray text-white py1 rounded-lg hover:bg-gray-500 active:bg-gray-600 cursor-pointer text-xs'],
    ['form-button-okay', 'bg-indigo hover:bg-indigo-500 active:bg-indigo-600'],
  ]
}

const DETECT_ADS_INTERVAL = 1000; // 1 second
let adsDetectingEnabled = false;
let templateFrame = null;

function videoSpeedUp(duration) {
  const video = getVideoElement();
  if (!video) {
    console.error("No video element found to speed up");
    return Promise.reject("No video element found");
  }

  const speedUpContainer = document.createElement('div');
  speedUpContainer.classList.add('speeding-up-container');
  const speedUpIcon = document.createElement('img');
  speedUpIcon.src = chrome.runtime.getURL('assets/speeding-up.svg');
  speedUpIcon.classList.add('speeding-up-icon');
  speedUpContainer.appendChild(speedUpIcon);
  getRootElement().appendChild(speedUpContainer);
  video.muted = true; // Mute video during speed up

  return new Promise((resolve) => {
    video.currentTime += duration / 1000;
    setTimeout(() => {
      speedUpContainer.remove();
      video.muted = false; // Unmute video after speed up
      setTimeout(resolve, DETECT_ADS_INTERVAL);
    }, DETECT_ADS_INTERVAL);
  })
}

function getRootElement() {
  let rootElem = document.body;
  const video = getVideoElement();
  if (video && (document.fullscreenElement === video || document.fullscreenElement?.contains(video))) {
    rootElem = document.fullscreenElement || video.parentElement;
  }
  return rootElem;
}

function getVideoElement() {
  const video = Array.from(document.querySelectorAll('video')).find(v => !v.paused && v.readyState > 2);
  if (!video) {
    console.warn("No playing video found");
    return null;
  }
  return video;
}

function captureVideoFrame(frameSize) {
  const video = getVideoElement();
  if (!video) {
    console.error("No video element found to capture frame");
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = frameSize;
  canvas.height = frameSize;
  const context = canvas.getContext('2d');
  if (!context) {
    console.error("Failed to get canvas context");
    return null;
  }
  context.drawImage(video, video.videoWidth - frameSize, video.videoHeight - frameSize, frameSize, frameSize, 0, 0, frameSize, frameSize);
  const base64Image = canvas.toDataURL('image/png');
  return base64Image;
}

function checkAds(adsId) {
  const videoFrame = captureVideoFrame(150);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: "checkAds",
      videoFrame,
      adsId
    }, (response) => {
      const { status, data } = response;
      if (status === 'success') {
        console.log("Ads checking finished.");
        resolve(data);
      } else {
        console.error("Failed to check ads.");
        resolve(null);
      }
    });
  })
}

function checkAdsTimer() {
  if (!adsDetectingEnabled) {
    console.log("Ads detecting is disabled, skipping check.");
    return;
  }
  checkAds().then((data) => {
    if (data?.adsFound) {
      adsDetectingEnabled = false; // Disable ads detecting after finding an ad
      console.log("Ads found, speeding up video.");
      videoSpeedUp(data.duration).then(() => {
        console.log("Video sped up.");
        adsDetectingEnabled = true; // Re-enable ads detecting after speeding up
        setTimeout(checkAdsTimer, DETECT_ADS_INTERVAL);
      }
      ).catch((error) => {
        console.error("Error speeding up video:", error);
      });
      return
    }
    console.log("No ads found, continuing to check.");
    setTimeout(checkAdsTimer, DETECT_ADS_INTERVAL);
  })

}

function toast(message) {
  const toastContainer = document.createElement('div');
  toastContainer.classList.add('toast-container');
  const toast = document.createElement('div');
  toast.classList.add('toast');
  toast.textContent = message;
  toastContainer.appendChild(toast);
  getRootElement().appendChild(toastContainer);

  return new Promise((resolve) => {
    setTimeout(() => {
      toastContainer.remove();
      resolve();
    }, 2000); // Remove toast after 2 seconds
  });
}

function markAds() {
  document.querySelector('.form-overlay')?.remove();
  const video = getVideoElement();
  if (!video) {
    console.error("No video element found to set ads duration");
    toast("No video element found to set ads duration");
  }

  const formOverlay = document.createElement('div')
  formOverlay.classList.add('form-overlay');
  const formContainer = document.createElement('div')
  formContainer.classList.add('form-container');
  const input = document.createElement('input');
  input.type = 'number';
  input.classList.add('form-input');
  input.placeholder = 'Ads duration in ms';
  input.id = 'adsDurationInput';
  const formButtonContainer = document.createElement('div');
  formButtonContainer.classList.add('form-button-container');
  const formCancelButton = document.createElement('button');
  formCancelButton.textContent = 'Cancel';
  formCancelButton.classList.add('form-button');
  formCancelButton.addEventListener('click', () => {
    formOverlay.remove();
    video?.play();
    console.log("Form cancelled");
  });
  const formSubmitButton = document.createElement('button');
  formSubmitButton.textContent = 'Okay';
  formSubmitButton.classList.add('form-button');
  formSubmitButton.classList.add('form-button-okay');
  formSubmitButton.addEventListener('click', () => {
    const duration = parseInt(input.value, 10);
    if (isNaN(duration) || duration <= 0) {
      toast("Please enter a valid duration in seconds.");
      return;
    }
    console.log("Setting ads duration to:", duration);
    chrome.runtime.sendMessage({
      action: "saveAdsTemplate",
      duration,
      templateFrame,
    }, (response) => {
      if (response.status === 'success') {
        formOverlay.remove();
        video?.play();
        toast('Ads marked.');
      } else {
        toast("Failed mark ads: " + response.message);
      }
    });
  });
  formButtonContainer.appendChild(formCancelButton);
  formButtonContainer.appendChild(formSubmitButton);
  formContainer.appendChild(input);
  formContainer.appendChild(formButtonContainer);
  formOverlay.appendChild(formContainer);
  getRootElement().appendChild(formOverlay);
  video?.pause();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);
  if (message.action === "toast") {
    console.log("Displaying toast message:", message.content);
    toast(message.content).then(() => {
      sendResponse({ status: "success" });
    });
  }
  else if (message.action === 'checkEnabled') {
    // check whether ads detecting is enabled
    sendResponse({ enabled: adsDetectingEnabled });
  } else if (message.action === 'setEnabled') {
    adsDetectingEnabled = message.enabled ?? !adsDetectingEnabled;
    console.log("Ads detecting enabled:", adsDetectingEnabled);
    toast(`Ads detecting ${adsDetectingEnabled ? 'enabled' : 'disabled'}`)
    checkAdsTimer();
    sendResponse({ status: "success" });
  } else if (message.action === 'markAds') {
    console.log("Opening set duration form");
    templateFrame = captureVideoFrame(150);
    markAds();
  }
  return true;
});

console.log("Content script loaded and ready to handle messages.");