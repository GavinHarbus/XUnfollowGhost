// Page-world scanner: runs in MAIN world on x.com pages.
// Parses the rendered DOM of the followers page to extract follower data.
// Simulates scrolling to trigger X's infinite scroll and load all followers.

(function () {
  'use strict';

  var SOURCE = 'xunfollowghost-page';
  var EXT_SOURCE = 'xunfollowghost-ext';

  console.log('[XUnfollowGhost] page-scanner.js loaded (DOM-parse mode)');

  // ---- Intercept __INITIAL_STATE__ to capture follower count ----
  // At document_start, X hasn't set __INITIAL_STATE__ yet.
  // We use Object.defineProperty to intercept the exact moment X's script
  // sets it, extracting followers_count before React hydration clears it.
  var cachedFollowerCount = null;

  function extractCountFromState(state) {
    try {
      if (!state || cachedFollowerCount !== null) return;
      var users = state.entities && state.entities.users && state.entities.users.entities;
      if (!users) return;
      var keys = Object.keys(users);
      for (var i = 0; i < keys.length; i++) {
        var u = users[keys[i]];
        if (u && typeof u.followers_count === 'number') {
          cachedFollowerCount = u.followers_count;
          console.log('[XUnfollowGhost] Intercepted follower count:', cachedFollowerCount);
          return;
        }
      }
    } catch (e) { /* silent */ }
  }

  (function interceptInitialState() {
    var storedValue = window.__INITIAL_STATE__;
    // If already set (unlikely at document_start), grab it now
    if (storedValue) extractCountFromState(storedValue);

    try {
      Object.defineProperty(window, '__INITIAL_STATE__', {
        get: function () { return storedValue; },
        set: function (val) {
          storedValue = val;
          extractCountFromState(val);
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {
      // Fallback: poll if defineProperty fails
      var interval = setInterval(function () {
        if (window.__INITIAL_STATE__) {
          extractCountFromState(window.__INITIAL_STATE__);
          if (cachedFollowerCount !== null) clearInterval(interval);
        }
      }, 50);
      setTimeout(function () { clearInterval(interval); }, 5000);
    }
  })();

  // ---- State ----
  var scanAbortFlag = false;
  var isScanning = false;
  var scanGeneration = 0; // tracks which scan "owns" isScanning

  // ---- Helpers ----

  function post(data) {
    window.postMessage(Object.assign({}, data, { source: SOURCE }), '*');
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---- Get expected follower count ----

  function getExpectedFollowerCount() {
    // Primary: from intercepted __INITIAL_STATE__ (captured via defineProperty)
    if (cachedFollowerCount !== null) return cachedFollowerCount;

    // Fallback: try live state (probably cleared by React, but worth a shot)
    var count = extractCountFromState(window.__INITIAL_STATE__);
    if (count) return cachedFollowerCount; // extractCountFromState sets cachedFollowerCount

    return null;
  }

  // ---- Get current user's screen name ----

  function getScreenName() {
    try {
      var link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      if (link) return link.getAttribute('href').replace('/', '');
    } catch (e) { /* silent */ }
    return null;
  }

  // ---- Navigate to followers page ----

  function navigateToFollowers(screenName) {
    return new Promise(function (resolve) {
      var currentPath = window.location.pathname.toLowerCase();

      // Already on a followers page — no navigation needed
      if (currentPath.endsWith('/followers') ||
          currentPath.endsWith('/verified_followers')) {
        resolve(true);
        return;
      }

      // Always use full page navigation instead of link.click().
      // X's SPA router intercepts link clicks, causing client-side nav
      // where the page-scanner context survives but React hasn't rendered
      // the new content yet — leading to broken scans.
      // Full navigation destroys this context; the auto-resume mechanism
      // in content-script.js will re-trigger the scan on the new page.
      console.log('[XUnfollowGhost] Full-page navigating to followers page');
      window.location.href = 'https://x.com/' + screenName + '/followers';

      // This context will be destroyed by the navigation.
      // Resolve false after a timeout as a safety net (should never fire).
      setTimeout(function () { resolve(false); }, 15000);
    });
  }

  // ---- Scroll helpers ----

  function findScrollContainer() {
    var startPoints = [
      document.querySelector('section[role="region"]'),
      document.querySelector('[data-testid="primaryColumn"]'),
      document.querySelector('main'),
    ];
    for (var i = 0; i < startPoints.length; i++) {
      var el = startPoints[i];
      if (!el) continue;
      var parent = el;
      while (parent && parent !== document.documentElement) {
        var style = window.getComputedStyle(parent);
        if ((style.overflowY === 'scroll' || style.overflowY === 'auto') &&
            parent.scrollHeight > parent.clientHeight + 10) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }
    return null;
  }

  function doScroll(container, y) {
    if (container) {
      container.scrollTop = y;
    } else {
      window.scrollTo(0, y);
    }
  }

  function getScrollHeight(container) {
    if (container) return container.scrollHeight;
    return document.documentElement.scrollHeight || document.body.scrollHeight;
  }

  function getScrollTop(container) {
    if (container) return container.scrollTop;
    return window.scrollY || window.pageYOffset;
  }

  function getViewportHeight(container) {
    if (container) return container.clientHeight;
    return window.innerHeight;
  }

  // ---- DOM parsing ----

  function parseFollowersFromDOM() {
    var users = [];
    var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');

    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var user = parseUserCell(cell);
      if (user) {
        users.push(user);
      }
    }

    return users;
  }

  // Primary: extract @handle from span text (most reliable)
  function getHandleFromCell(cell) {
    var spans = cell.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var t = (spans[i].textContent || '').trim();
      if (t.startsWith('@')) {
        var h = t.slice(1).trim();
        if (/^[A-Za-z0-9_]{1,15}$/.test(h)) return h.toLowerCase();
      }
    }
    // Fallback: profile link href
    var links = cell.querySelectorAll('a[href^="/"]');
    for (var j = 0; j < links.length; j++) {
      var href = links[j].getAttribute('href') || '';
      var match = href.match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (match) return match[1].toLowerCase();
    }
    return null;
  }

  function parseUserCell(cell) {
    try {
      // Find the UserCell container
      var userCell = cell.querySelector('[data-testid="UserCell"]');
      if (!userCell) return null;

      // Extract screenName — @handle text first, then link href fallback
      var screenName = getHandleFromCell(userCell);
      if (!screenName) return null;

      // Get display name from dir="auto" spans (skip @handle spans)
      var displayName = null;
      var nameSpans = userCell.querySelectorAll('span[dir="auto"]');
      for (var j = 0; j < nameSpans.length; j++) {
        var t = nameSpans[j].textContent.trim();
        if (t && !t.startsWith('@') && t.length > 0) {
          displayName = t;
          break;
        }
      }
      if (!displayName) displayName = screenName;

      // Extract avatar URL
      var avatarUrl = '';
      var avatarImg = userCell.querySelector('img[src*="pbs.twimg.com/profile_images"]');
      if (!avatarImg) {
        avatarImg = userCell.querySelector('[data-testid^="UserAvatar"] img');
      }
      if (avatarImg) {
        avatarUrl = avatarImg.getAttribute('src') || '';
      }

      // Check for verified badge — multiple selector strategies
      var isBlueVerified = !!(
        userCell.querySelector('[data-testid="icon-verified"]') ||
        userCell.querySelector('[data-testid*="verified"]') ||
        userCell.querySelector('svg[aria-label*="Verified"]') ||
        userCell.querySelector('svg[aria-label*="verified"]')
      );

      return {
        screenName: screenName,
        displayName: displayName,
        avatarUrl: avatarUrl,
        isBlueVerified: isBlueVerified,
      };
    } catch (e) {
      return null;
    }
  }

  // ---- Find scroll container from UserCell parent (reference script pattern) ----

  function pickScroller() {
    var cell = document.querySelector('[data-testid="UserCell"]');
    if (!cell) return findScrollContainer();
    var el = cell.parentElement;
    while (el && el !== document.documentElement) {
      var style = window.getComputedStyle(el);
      var ov = style.overflowY;
      // Must have scrollable overflow AND actually be taller than its viewport
      if ((ov === 'scroll' || ov === 'auto') && el.scrollHeight > el.clientHeight + 10) {
        return el;
      }
      el = el.parentElement;
    }
    return findScrollContainer();
  }

  // ---- Check if at bottom of scroll container ----

  function isAtBottom(scroller) {
    if (scroller) {
      return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5;
    }
    // Window fallback
    var scrollTop = window.scrollY || window.pageYOffset;
    var docHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
    return scrollTop + window.innerHeight >= docHeight - 5;
  }

  // ---- Main scan logic ----

  async function runScan() {
    // If a previous scan is still winding down, force-abort it
    if (isScanning) {
      scanAbortFlag = true;
      isScanning = false;
      // Brief delay to let any running async code see the abort flag
      await sleep(200);
    }

    isScanning = true;
    scanAbortFlag = false;
    var myGeneration = ++scanGeneration;

    try {
      await doScan();
    } catch (e) {
      console.error('[XUnfollowGhost] Scan error:', e);
      post({
        type: 'scan:pageError',
        error: 'unexpected_error',
        message: 'Scan failed unexpectedly: ' + (e.message || e),
      });
    } finally {
      // Only clear isScanning if we're still the active scan
      if (scanGeneration === myGeneration) {
        isScanning = false;
      }
    }
  }

  async function doScan() {
    var screenName = getScreenName();

    console.log('[XUnfollowGhost] Scan starting (DOM-parse mode). screenName:', screenName);

    if (!screenName) {
      post({
        type: 'scan:pageError',
        error: 'no_screen_name',
        message: 'Could not detect your screen name. Please make sure you are logged in.',
      });
      return;
    }

    // Step 1: Navigate to followers page
    console.log('[XUnfollowGhost] Navigating to followers page...');
    var navigated = await navigateToFollowers(screenName);
    if (!navigated || scanAbortFlag) {
      post({
        type: 'scan:pageError',
        error: 'navigation_failed',
        message: 'Could not navigate to followers page.',
      });
      return;
    }

    // Step 2: Wait for initial content to load
    await sleep(3000);

    // Try to get expected follower count early
    var expectedCount = getExpectedFollowerCount();
    console.log('[XUnfollowGhost] Expected follower count:', expectedCount);

    // Wait until we see at least one UserCell
    var waited = 0;
    while (waited < 10000) {
      if (scanAbortFlag) return postCancelled(screenName, 0, 0);
      if (document.querySelector('[data-testid="UserCell"]')) break;
      await sleep(500);
      waited += 500;
    }

    // Step 3: Scroll-driven pagination using simple interval pattern
    var userMap = {};
    var page = 0;
    var unchanged = 0;
    var maxUnchangedRounds = 8; // consecutive no-new-data rounds when atBottom

    // Find scroller starting from UserCell (most reliable)
    var scroller = pickScroller();
    console.log('[XUnfollowGhost] Scroll container:',
      scroller ? scroller.tagName + '.' + scroller.className.substring(0, 30) : 'window');

    // Run scan loop as a promise wrapping setInterval
    await new Promise(function (resolve) {
      var timer = setInterval(function () {
        if (scanAbortFlag) {
          clearInterval(timer);
          resolve();
          return;
        }

        // Parse all visible cells
        var parsed = parseFollowersFromDOM();
        var newUsers = [];
        for (var i = 0; i < parsed.length; i++) {
          var key = parsed[i].screenName.toLowerCase();
          if (!userMap[key]) {
            userMap[key] = parsed[i];
            newUsers.push(parsed[i]);
          }
        }

        var total = Object.keys(userMap).length;

        if (newUsers.length > 0) {
          unchanged = 0;
          page++;
          console.log('[XUnfollowGhost] Page ' + page + ': +' + newUsers.length +
            ' new users (total: ' + total + ')');
          post({ type: 'scan:batch', users: newUsers, page: page });
          post({ type: 'scan:pageDone', page: page, fetched: total, hasMore: true });
        }

        // Scroll down 90% of container height
        if (scroller) {
          scroller.scrollTop += Math.floor(scroller.clientHeight * 0.9);
        } else {
          window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
        }

        // Track consecutive rounds with no new users
        if (newUsers.length > 0) {
          unchanged = 0;
        } else {
          unchanged++;
        }

        // Finish when no new users found for enough consecutive rounds
        if (unchanged >= maxUnchangedRounds) {
          clearInterval(timer);
          resolve();
          return;
        }
      }, 1200);
    });

    // Step 4: Verify completeness against expected count
    var expectedCount = getExpectedFollowerCount();
    var scannedCount = Object.keys(userMap).length;

    // X's follower count often includes suspended/deactivated accounts that are
    // NOT rendered in the DOM. A small gap (≤3 or ≤2%) is normal and expected.
    if (expectedCount) {
      var finalGap = expectedCount - scannedCount;
      if (finalGap <= 0) {
        console.log('[XUnfollowGhost] Verification passed: ' + scannedCount + '/' + expectedCount);
      } else if (finalGap <= 3 || (finalGap / expectedCount) * 100 <= 2) {
        console.log('[XUnfollowGhost] Scan complete: ' + scannedCount + '/' + expectedCount +
          ' (gap of ' + finalGap + ' likely suspended/deactivated accounts)');
      } else {
        console.log('[XUnfollowGhost] Scan complete: ' + scannedCount + '/' + expectedCount +
          ' (' + finalGap + ' account(s) likely suspended or deactivated)');
      }
    }

    // Step 5: Done
    var allUsers = objectValues(userMap);
    console.log('[XUnfollowGhost] Scan complete. Total unique users: ' + allUsers.length + ', pages: ' + page);

    post({
      type: 'scan:finished',
      totalUsers: allUsers.length,
      totalPages: page,
      cancelled: scanAbortFlag,
      allUsers: allUsers,
      ownerScreenName: screenName,
      expectedCount: expectedCount,
      isComplete: expectedCount ? allUsers.length >= expectedCount : null,
    });
  }

  function postCancelled(screenName, totalUsers, totalPages) {
    post({
      type: 'scan:finished',
      totalUsers: totalUsers,
      totalPages: totalPages,
      cancelled: true,
      allUsers: [],
      ownerScreenName: screenName,
    });
  }

  function objectValues(obj) {
    var arr = [];
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) arr.push(obj[keys[i]]);
    return arr;
  }

  // ---- Listen for commands from content script ----

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== EXT_SOURCE) return;

    var msg = event.data;
    if (msg.type === 'page:startScan') {
      runScan();
    }
    if (msg.type === 'page:cancelScan') {
      scanAbortFlag = true;
      isScanning = false; // Force reset so next startScan can proceed immediately
    }
  });
})();
