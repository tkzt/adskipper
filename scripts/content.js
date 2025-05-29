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

let adsDetectingEnabled = false;
const DETECT_ADS_INTERVAL = 1200; // 1.2 seconds


function videoSpeedUp(duration) {
  const video = getVideoElement();
  if (!video) {
    console.error("No video element found to speed up");
    return Promise.reject("No video element found");
  }
  return new Promise((resolve) => {
    video
    video.playbackRate = 16;
    setTimeout(() => {
      video.playbackRate = 1.0; // Reset playback speed after duration
      resolve();
    }, duration / video.playbackRate);
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

function checkAds() {
  if (!adsDetectingEnabled) {
    console.log("Ads detecting is disabled, skipping check.");
    return;
  }
  chrome.runtime.sendMessage({
    action: "checkAds",
  }, (response) => {
    const { status, data } = response;
    if (status === 'success') {
      console.log("Ads checking finished.");
      if (data.adsFound) {
        videoSpeedUp(data.duration).then(() => {
          console.log("Video sped up.");
          setTimeout(checkAds, DETECT_ADS_INTERVAL);
        }
        ).catch((error) => {
          console.error("Error speeding up video:", error);
        });
        return;
      }
      setTimeout(
        checkAds
        , DETECT_ADS_INTERVAL);
    } else {
      console.error("Failed to check ads.");
    }
  });
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

function openSetDurationForm(adsId) {
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
      action: "updateDuration",
      duration,
      adsId,
    }, (response) => {
      if (response.status === 'success') {
        formOverlay.remove();
        video?.play();
        toast('Duration saved.');
      } else {
        toast("Failed to set ads duration: " + response.message);
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
    checkAds();
    sendResponse({ status: "success" });
  } else if (message.action === 'openSetDurationForm') {
    console.log("Opening set duration form");
    openSetDurationForm(message.adsId);
  }
  return true;
});

console.log("Content script loaded and ready to handle messages.");