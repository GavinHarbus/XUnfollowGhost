// Page-world scanner: runs in MAIN world on x.com pages.
// Parses the rendered DOM of the followers page to extract follower data.
// Simulates scrolling to trigger X's infinite scroll and load all followers.

(function () {
  'use strict';

  var SOURCE = 'xunfollowghost-page';
  var EXT_SOURCE = 'xunfollowghost-ext';

  console.log('[XUnfollowGhost] page-scanner.js loaded (DOM-parse mode)');

  // ---- State ----
  var scanAbortFlag = false;
  var isScanning = false;

  // ---- Helpers ----

  function post(data) {
    window.postMessage(Object.assign({}, data, { source: SOURCE }), '*');
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
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
      var targetPath = '/' + screenName + '/followers';

      if (window.location.pathname === targetPath ||
          window.location.pathname === '/' + screenName + '/verified_followers') {
        resolve(true);
        return;
      }

      var link = document.querySelector(
        'a[href="/' + screenName + '/followers"], ' +
        'a[href="/' + screenName + '/verified_followers"]'
      );

      if (link) {
        console.log('[XUnfollowGhost] Clicking followers link');
        link.click();
      } else {
        console.log('[XUnfollowGhost] Navigating to followers page directly');
        window.location.href = 'https://x.com/' + screenName + '/followers';
      }

      var check = setInterval(function () {
        if (window.location.pathname.indexOf('/followers') !== -1) {
          clearInterval(check);
          clearTimeout(to);
          resolve(true);
        }
      }, 300);

      var to = setTimeout(function () {
        clearInterval(check);
        resolve(window.location.pathname.indexOf('/followers') !== -1);
      }, 10000);
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

  function parseUserCell(cell) {
    try {
      // Find the UserCell container
      var userCell = cell.querySelector('[data-testid="UserCell"]');
      if (!userCell) return null;

      // Extract screenName from profile link
      // Look for links that point to user profiles (href="/{screenName}")
      var profileLinks = userCell.querySelectorAll('a[role="link"]');
      var screenName = null;
      var displayName = null;

      for (var i = 0; i < profileLinks.length; i++) {
        var href = profileLinks[i].getAttribute('href');
        if (!href) continue;
        // Skip non-profile links (e.g. /followers, /following, /i/...)
        var match = href.match(/^\/([A-Za-z0-9_]+)$/);
        if (match) {
          screenName = match[1];
          // The first link with just a username is typically the avatar link,
          // try to get display name from a subsequent link
          if (!displayName) {
            // Look for text content in this or nearby links
            var textSpans = profileLinks[i].querySelectorAll('span');
            for (var s = 0; s < textSpans.length; s++) {
              var text = textSpans[s].textContent.trim();
              if (text && text !== '@' + screenName && text.length > 0) {
                displayName = text;
                break;
              }
            }
          }
          break;
        }
      }

      if (!screenName) return null;

      // Get display name if not found yet — try from dir="auto" spans
      if (!displayName) {
        var nameSpans = userCell.querySelectorAll('span[dir="auto"]');
        for (var j = 0; j < nameSpans.length; j++) {
          var t = nameSpans[j].textContent.trim();
          if (t && !t.startsWith('@') && t.length > 0) {
            displayName = t;
            break;
          }
        }
      }

      if (!displayName) displayName = screenName;

      // Extract avatar URL
      var avatarUrl = '';
      var avatarImg = userCell.querySelector('img[src*="pbs.twimg.com/profile_images"]');
      if (!avatarImg) {
        // Fallback: any img inside avatar container
        avatarImg = userCell.querySelector('[data-testid^="UserAvatar"] img');
      }
      if (avatarImg) {
        avatarUrl = avatarImg.getAttribute('src') || '';
      }

      // Check for verified badge
      var isBlueVerified = false;
      var verifiedBadge = userCell.querySelector('[data-testid="icon-verified"]');
      if (!verifiedBadge) {
        // Fallback: look for the verified SVG path
        var svgs = userCell.querySelectorAll('svg[aria-label]');
        for (var k = 0; k < svgs.length; k++) {
          var label = svgs[k].getAttribute('aria-label') || '';
          if (label.toLowerCase().indexOf('verified') !== -1 ||
              label.toLowerCase().indexOf('verif') !== -1) {
            isBlueVerified = true;
            break;
          }
        }
      } else {
        isBlueVerified = true;
      }

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

  // ---- Wait for new content via MutationObserver ----

  function waitForNewContent(timeoutMs) {
    return new Promise(function (resolve) {
      var timeline = document.querySelector('[aria-label*="Timeline"]') ||
                     document.querySelector('section[role="region"]');

      if (!timeline) {
        // Fallback: just wait
        setTimeout(function () { resolve(false); }, timeoutMs);
        return;
      }

      var resolved = false;
      var observer = new MutationObserver(function () {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          // Small delay to let DOM settle
          setTimeout(function () { resolve(true); }, 300);
        }
      });

      observer.observe(timeline, { childList: true, subtree: true });

      setTimeout(function () {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  // ---- Scroll and trigger loading ----

  function scrollDown(scrollContainer) {
    var sh = getScrollHeight(scrollContainer);
    var vh = getViewportHeight(scrollContainer);
    var st = getScrollTop(scrollContainer);

    // Scroll incrementally from current position
    var target = st + vh * 0.8;
    doScroll(scrollContainer, target);

    // Also scroll to very bottom
    setTimeout(function () {
      doScroll(scrollContainer, sh + 2000);
    }, 200);

    // Also use window scroll in case container detection is wrong
    if (scrollContainer) {
      setTimeout(function () {
        window.scrollTo(0, document.documentElement.scrollHeight + 2000);
      }, 300);
    }

    // scrollIntoView on last cell
    var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (cells.length > 0) {
      setTimeout(function () {
        cells[cells.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
      }, 400);
    }
  }

  // ---- Main scan logic ----

  async function runScan() {
    if (isScanning) {
      post({ type: 'scan:pageError', error: 'already_scanning' });
      return;
    }

    isScanning = true;
    scanAbortFlag = false;

    var screenName = getScreenName();

    console.log('[XUnfollowGhost] Scan starting (DOM-parse mode). screenName:', screenName);

    if (!screenName) {
      post({
        type: 'scan:pageError',
        error: 'no_screen_name',
        message: 'Could not detect your screen name. Please make sure you are logged in.',
      });
      isScanning = false;
      return;
    }

    var originalHref = window.location.href;

    // Step 1: Navigate to followers page
    console.log('[XUnfollowGhost] Navigating to followers page...');
    var navigated = await navigateToFollowers(screenName);
    if (!navigated || scanAbortFlag) {
      post({
        type: 'scan:pageError',
        error: 'navigation_failed',
        message: 'Could not navigate to followers page.',
      });
      isScanning = false;
      return;
    }

    // Step 2: Wait for initial content to load
    await sleep(3000);

    // Wait until we see at least one cell
    var waited = 0;
    while (waited < 10000) {
      var initialCells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      if (initialCells.length > 0) break;
      await sleep(500);
      waited += 500;
    }

    // Collected users, deduplicated by screenName
    var userMap = {};
    var page = 0;

    // Parse initial content
    var initialUsers = parseFollowersFromDOM();
    for (var i = 0; i < initialUsers.length; i++) {
      var u = initialUsers[i];
      if (!userMap[u.screenName.toLowerCase()]) {
        userMap[u.screenName.toLowerCase()] = u;
      }
    }

    if (initialUsers.length > 0) {
      page = 1;
      var total = Object.keys(userMap).length;
      console.log('[XUnfollowGhost] Initial parse: ' + total + ' unique users');
      post({ type: 'scan:batch', users: objectValues(userMap), page: page });
      post({ type: 'scan:pageDone', page: page, fetched: total, hasMore: true });
    }

    // Step 3: Scroll-driven pagination
    var scrollContainer = findScrollContainer();
    console.log('[XUnfollowGhost] Scroll container:',
      scrollContainer ? scrollContainer.tagName + '.' + scrollContainer.className.substring(0, 30) : 'window');

    var noNewDataRounds = 0;
    var maxNoNewDataRounds = 5;

    while (!scanAbortFlag && noNewDataRounds < maxNoNewDataRounds) {
      // Scroll down to trigger loading
      scrollDown(scrollContainer);

      // Wait for new content
      await waitForNewContent(5000);
      await sleep(500);

      // Parse the DOM again and find new users
      var allParsed = parseFollowersFromDOM();
      var newUsers = [];
      for (var j = 0; j < allParsed.length; j++) {
        var key = allParsed[j].screenName.toLowerCase();
        if (!userMap[key]) {
          userMap[key] = allParsed[j];
          newUsers.push(allParsed[j]);
        }
      }

      if (newUsers.length > 0) {
        noNewDataRounds = 0;
        page++;
        var total2 = Object.keys(userMap).length;
        console.log('[XUnfollowGhost] Page ' + page + ': +' + newUsers.length +
          ' new users (total: ' + total2 + ')');
        post({ type: 'scan:batch', users: newUsers, page: page });
        post({ type: 'scan:pageDone', page: page, fetched: total2, hasMore: true });
      } else {
        noNewDataRounds++;
        console.log('[XUnfollowGhost] No new users (attempt ' + noNewDataRounds + '/' + maxNoNewDataRounds + ')');
      }

      await sleep(800 + Math.random() * 800);
    }

    // Step 4: Done
    var allUsers = objectValues(userMap);
    console.log('[XUnfollowGhost] Scan complete. Total unique users: ' + allUsers.length + ', pages: ' + page);

    post({
      type: 'scan:finished',
      totalUsers: allUsers.length,
      totalPages: page,
      cancelled: scanAbortFlag,
      allUsers: allUsers,
      ownerScreenName: screenName,
    });

    navigateBack(originalHref);
    isScanning = false;
  }

  function objectValues(obj) {
    var arr = [];
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) arr.push(obj[keys[i]]);
    return arr;
  }

  function navigateBack(originalHref) {
    if (originalHref && window.location.href !== originalHref) {
      window.history.back();
    }
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
    }
  });
})();
