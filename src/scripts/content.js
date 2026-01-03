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
let templateRegion = null; // { x, y, w, h } in intrinsic video pixels

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
  // legacy behavior: capture bottom-right square of intrinsic video pixels
  context.drawImage(video, video.videoWidth - frameSize, video.videoHeight - frameSize, frameSize, frameSize, 0, 0, frameSize, frameSize);
  const base64Image = canvas.toDataURL('image/png');
  return base64Image;
}

// Create a full-screen selection overlay that draws the current video frame
// and allows the user to box-select a region. Once selection confirmed, it
// calls onConfirm(base64Image) with a normalized 150x150 image of that region.
function openSelectionOverlay(onConfirm, onCancel) {
  const video = getVideoElement();
  if (!video) {
    toast('No video element found to select region');
    return;
  }

  // Pause video while selecting
  try { video.pause(); } catch (e) { }

  const root = getRootElement();
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.zIndex = '2147483647';
  overlay.style.background = 'rgba(0,0,0,0.25)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.cursor = 'crosshair';

  // Canvas matching the video's displayed size
  const videoRect = video.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(videoRect.width));
  canvas.height = Math.max(1, Math.round(videoRect.height));
  canvas.style.width = canvas.width + 'px';
  canvas.style.height = canvas.height + 'px';
  canvas.style.position = 'absolute';
  canvas.style.left = (videoRect.left) + 'px';
  canvas.style.top = (videoRect.top) + 'px';
  canvas.style.boxShadow = '0 0 0 10000px rgba(0,0,0,0.25)';
  canvas.style.border = '2px solid rgba(255,255,255,0.8)';
  canvas.style.background = 'transparent';
  overlay.appendChild(canvas);
  root.appendChild(overlay);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    toast('Failed to create canvas context');
    overlay.remove();
    try { video.play(); } catch (e) { }
    return;
  }

  // Draw current video frame scaled to displayed size
  function drawFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, canvas.width, canvas.height);
  }
  drawFrame();

  // Selection state
  let selecting = false;
  let startX = 0, startY = 0, curX = 0, curY = 0;

  function getRect() {
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);
    return { x, y, w, h };
  }

  function redraw() {
    drawFrame();
    const r = getRect();
    if (r.w > 0 && r.h > 0) {
      // dim outside selection
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.clearRect(r.x, r.y, r.w, r.h);
      ctx.restore();

      // draw stroke
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.restore();
    }
  }

  function toIntrinsic(rect) {
    // Map from displayed canvas coords to video intrinsic pixels
    const scaleX = video.videoWidth / canvas.width;
    const scaleY = video.videoHeight / canvas.height;
    return {
      x: Math.round(rect.x * scaleX),
      y: Math.round(rect.y * scaleY),
      w: Math.max(1, Math.round(rect.w * scaleX)),
      h: Math.max(1, Math.round(rect.h * scaleY)),
    };
  }

  function finishSelection() {
    const r = getRect();
    if (r.w <= 0 || r.h <= 0) {
      // nothing selected -> treat as cancel
      cleanup();
      onCancel && onCancel();
      return;
    }
    const intrinsic = toIntrinsic(r);

    // create 150x150 normalized image of selected region
    const tmp = document.createElement('canvas');
    tmp.width = intrinsic.w;
    tmp.height = intrinsic.h;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(video, intrinsic.x, intrinsic.y, intrinsic.w, intrinsic.h, 0, 0, intrinsic.w, intrinsic.h);
    const base64 = tmp.toDataURL('image/png');

    cleanup();
    // return both base64 and intrinsic region so we can reuse same crop later
    onConfirm && onConfirm(base64, intrinsic);
  }

  function cleanup() {
    overlay.remove();
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    // resume handled by caller when needed
  }

  function onMouseDown(e) {
    selecting = true;
    // coordinates relative to canvas
    const rect = canvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    curX = startX; curY = startY;
    redraw();
  }
  function onMouseMove(e) {
    if (!selecting) return;
    const rect = canvas.getBoundingClientRect();
    curX = Math.max(0, Math.min(canvas.width, e.clientX - rect.left));
    curY = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));
    redraw();
  }
  function onMouseUp(e) {
    if (!selecting) return;
    selecting = false;
    // finalize selection and ask for confirmation (simple double-click alternative)
    // show a small inline confirm/cancel UI near canvas center
    const r = getRect();
    if (r.w <= 0 || r.h <= 0) {
      cleanup();
      onCancel && onCancel();
      return;
    }

    // Create simple confirmation UI
    const confirmBox = document.createElement('div');
    confirmBox.style.position = 'fixed';
    confirmBox.style.left = (videoRect.left + (videoRect.width / 2) - 120) + 'px';
    confirmBox.style.top = (videoRect.top + (videoRect.height / 2) - 30) + 'px';
    confirmBox.style.zIndex = '2147483648';
    confirmBox.style.display = 'flex';
    confirmBox.style.gap = '8px';
    confirmBox.style.background = 'rgba(0,0,0,0.6)';
    confirmBox.style.padding = '8px';
    confirmBox.style.borderRadius = '8px';

    const ok = document.createElement('button');
    ok.textContent = 'Confirm';
    ok.style.cursor = 'pointer';
    ok.addEventListener('click', () => {
      confirmBox.remove();
      finishSelection();
    });
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cursor = 'pointer';
    cancel.addEventListener('click', () => {
      confirmBox.remove();
      cleanup();
      onCancel && onCancel();
    });
    confirmBox.appendChild(ok);
    confirmBox.appendChild(cancel);
    root.appendChild(confirmBox);
  }

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // allow escape to cancel
  function onKey(e) {
    if (e.key === 'Escape') {
      cleanup();
      try { video.play(); } catch (err) { }
      window.removeEventListener('keydown', onKey);
      onCancel && onCancel();
    }
  }
  window.addEventListener('keydown', onKey);
}

function checkAds(adsId) {
  const video = getVideoElement();
  if (!video) {
    console.error("No video element found to capture frame for checking ads");
    return Promise.resolve(null);
  }

  function captureRegion() {
    try {
      const tmp = document.createElement('canvas');
      tmp.width = video.videoWidth;
      tmp.height = video.videoHeight;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(video, 0, 0);
      return tmp.toDataURL('image/png');
    } catch (e) {
      console.error('Failed to capture region:', e);
      return null;
    }
  }

  let videoFrame = captureRegion();
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
  }).catch((error) => {
    console.error("Error during ads checking:", error);
    setTimeout(checkAdsTimer, DETECT_ADS_INTERVAL);
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
      templateRegion,
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
    console.log("Opening selection overlay for marking ads");
    const video = getVideoElement();
    if (!video) {
      toast('No video element found to mark ads');
      return;
    }
    openSelectionOverlay((base64, intrinsic) => {
      // user confirmed selection; set template and open duration form
      templateFrame = base64;
      templateRegion = intrinsic;
      markAds();
    }, () => {
      // user cancelled selection
      try { video.play(); } catch (e) { }
      toast('Selection cancelled');
    });
  }
  return true;
});

console.log("Content script loaded and ready to handle messages.");