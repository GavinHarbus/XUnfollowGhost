// Message types for communication between page world, content script, service worker, and popup
export const MSG = {
  // Page world -> Content script -> Service worker (passive captures)
  AUTH_CAPTURED: 'auth:captured',
  USER_IDENTIFIED: 'auth:userIdentified',

  // Popup -> Service worker
  START_SCAN: 'scan:start',
  CANCEL_SCAN: 'scan:cancel',
  GET_STATUS: 'scan:getStatus',
  GET_UNFOLLOWERS: 'data:getUnfollowers',
  GET_SCAN_HISTORY: 'data:getScanHistory',
  GET_STATS: 'data:getStats',
  UPDATE_SETTINGS: 'settings:update',
  GET_SETTINGS: 'settings:get',
  CLEAR_ALL_DATA: 'data:clearAll',
  EXPORT_CSV: 'data:exportCsv',

  // Service worker -> Content script -> Page world (scan commands)
  PAGE_START_SCAN: 'page:startScan',
  PAGE_CANCEL_SCAN: 'page:cancelScan',

  // Page world -> Content script -> Service worker (scan results)
  SCAN_BATCH: 'scan:batch',
  SCAN_PAGE_DONE: 'scan:pageDone',
  SCAN_FINISHED: 'scan:finished',
  SCAN_PAGE_ERROR: 'scan:pageError',

  // Service worker -> Popup (pushed updates)
  SCAN_PROGRESS: 'scan:progress',
  SCAN_COMPLETE: 'scan:complete',
  SCAN_ERROR: 'scan:error',
};
