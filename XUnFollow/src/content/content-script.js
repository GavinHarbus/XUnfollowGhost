// Content script: runs in ISOLATED world on x.com pages.
// Thin message bridge between page-world scanner (MAIN) and service worker.

(function () {
  'use strict';

  // Page world -> Service worker
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== 'xunfollowghost-page') return;

    // Forward all page-world messages to service worker
    chrome.runtime.sendMessage(event.data).catch(() => {});
  });

  // Service worker -> Page world
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'page:startScan' || message.type === 'page:cancelScan') {
      window.postMessage(
        { ...message, source: 'xunfollowghost-ext' },
        '*'
      );
      sendResponse({ relayed: true });
    }
  });

  // Auto-resume: after full page navigation (e.g. navigating to /followers),
  // the old page-scanner context is destroyed. Check if the service worker
  // has a pending scan for this tab, and if so, re-trigger it.
  chrome.runtime.sendMessage({ type: 'scan:checkPending' }).then((response) => {
    if (response?.shouldResume) {
      // Delay to ensure page-scanner (MAIN world, document_start) and React app are loaded
      setTimeout(() => {
        window.postMessage(
          { type: 'page:startScan', source: 'xunfollowghost-ext' },
          '*'
        );
      }, 2000);
    }
  }).catch(() => {});
})();
