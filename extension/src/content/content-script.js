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
})();
