window.__unocss = {
  shortcuts: [
    ['code', 'bg-gray-100 p1 px1.5 rounded-lg text-xs text-gray-800'],
  ]
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (tabs.length === 0) {
        reject(new Error("No active tabs found"));
      } else {
        resolve(tabs[0]);
      }
    });
  }
  );
}

document.addEventListener('DOMContentLoaded', () => {
  // check enabled state
  getActiveTab().then((tab) => {
    chrome.tabs.sendMessage(tab.id, { action: "checkEnabled" }, (response) => {
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
            chrome.tabs.sendMessage(tab.id, {
              action: "setEnabled",
              enabled: enabledInput.checked,
            });
          });
        }
        );
      } else {
        console.error("Status text element not found in popup");
      }
    })

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

    const cleanAdsButton = document.querySelector('#cleanAdsBtn');
    if (cleanAdsButton) {
      cleanAdsButton.addEventListener('click', function () {
        chrome.runtime.sendMessage({
          action: "cleanAds",
        }, (response) => {
          let msg;
          if (response.status === 'success') {
            msg = response.message || "Ads cleaned successfully";
            console.log(msg);
          } else {
            msg = response.message || "Failed to clean ads";
            console.error(msg);
          }
          chrome.tabs.sendMessage(tab.id, {
            action: "toast",
            content: msg,
          });
        });
      })
    } else {
      console.error("Clean Ads button not found in popup");
    }
  })
});

console.log("Popup script loaded");
