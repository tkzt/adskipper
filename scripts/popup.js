window.__unocss = {
  shortcuts: [
    ['code', 'bg-gray-100 p1 px1.5 rounded-lg text-xs text-gray-800'],
  ]
}

document.addEventListener('DOMContentLoaded', () => {
  // check enabled state
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "checkEnabled" }, (response) => {
        const { enabled } = response;
        const enabledInput = document.querySelector('#detectingEnableSwitch');
        if (enabledInput) {
          enabledInput.checked = enabled;
          enabledInput.addEventListener('change', function () {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs.length === 0) {
                console.error("No active tabs found");
                return;
              }
              chrome.tabs.sendMessage(tabs[0].id, {
                action: "setEnabled",
                enabled: enabledInput.checked,
              });
            });
          }
          );
        } else {
          console.error("Status text element not found in popup");
        }
      });
    }
  }
  );

  const markAdsButton = document.querySelector('#markAdsBtn');
  if (markAdsButton) {
    markAdsButton.addEventListener('click', function () {
      chrome.runtime.sendMessage({
        action: "markAds",
      });
    });
  } else {
    console.error("Mark Ads button not found in popup");
  }
});

console.log("Popup script loaded");
