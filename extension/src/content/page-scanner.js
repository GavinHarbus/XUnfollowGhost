// Page-world scanner: runs in MAIN world on x.com pages.
// Declared in manifest.json with "world": "MAIN" to bypass CSP.
//
// Architecture: Instead of making our own API calls (which X blocks via
// x-client-transaction-id signing), we INTERCEPT X's own API responses.
// We navigate X to the followers page, let X make its own requests with
// valid transaction IDs, and capture the response data from those XHRs.

(function () {
  'use strict';

  var SOURCE = 'xunfollowghost-page';
  var EXT_SOURCE = 'xunfollowghost-ext';

  console.log('[XUnfollowGhost] page-scanner.js loaded (response-intercept mode)');

  // ---- State ----
  var capturedBearer = null;
  var capturedQueryId = null;
  var scanAbortFlag = false;
  var isScanning = false;

  // Intercepted Followers API responses queue
  var followersResponseQueue = [];
  var responseWaiters = [];  // resolve functions waiting for next response

  // ---- Helpers ----

  function post(data) {
    window.postMessage(Object.assign({}, data, { source: SOURCE }), '*');
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---- Fetch monkey-patch ----
  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var headers = (init && init.headers) || (input instanceof Request ? input.headers : null);

      if (headers) {
        var auth = null;
        if (headers instanceof Headers) {
          auth = headers.get('authorization');
        } else if (typeof headers === 'object' && !Array.isArray(headers)) {
          var keys = Object.keys(headers);
          for (var i = 0; i < keys.length; i++) {
            if (keys[i].toLowerCase() === 'authorization') { auth = headers[keys[i]]; break; }
          }
        }
        if (auth && auth.indexOf('Bearer ') === 0 && !capturedBearer) {
          capturedBearer = auth.substring(7);
          console.log('[XUnfollowGhost] Bearer captured from fetch');
          post({ type: 'auth:captured', bearerToken: capturedBearer });
        }
      }

      // Intercept Followers responses
      if (url.indexOf('/graphql/') !== -1 && url.indexOf('/Followers') !== -1) {
        var m = url.match(/\/graphql\/([^/]+)\/Followers/);
        if (m) {
          capturedQueryId = m[1];
          post({ type: 'auth:captured', queryId: m[1], operationName: 'Followers' });
        }
        var realPromise = originalFetch.apply(this, arguments);
        realPromise.then(function (resp) {
          if (resp.ok) {
            resp.clone().json().then(function (json) {
              console.log('[XUnfollowGhost] Intercepted Followers fetch response');
              onFollowersResponse(json);
            }).catch(function () {});
          }
        }).catch(function () {});
        return realPromise;
      }
    } catch (e) { /* silent */ }
    return originalFetch.apply(this, arguments);
  };

  // ---- XHR monkey-patch ----
  var originalXhrOpen = XMLHttpRequest.prototype.open;
  var originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  var originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._xugUrl = url;
    this._xugHeaders = {};
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._xugHeaders) {
      this._xugHeaders[name.toLowerCase()] = value;
    }
    return originalXhrSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var self = this;
    this.addEventListener('loadend', function () {
      try {
        var url = self._xugUrl || '';
        var headers = self._xugHeaders || {};

        // Capture bearer
        if (headers['authorization'] && headers['authorization'].indexOf('Bearer ') === 0 && !capturedBearer) {
          capturedBearer = headers['authorization'].substring(7);
          console.log('[XUnfollowGhost] Bearer captured from XHR');
          post({ type: 'auth:captured', bearerToken: capturedBearer });
        }

        // Intercept Followers responses
        if (url.indexOf('/graphql/') !== -1 && url.indexOf('/Followers') !== -1) {
          var match = url.match(/\/graphql\/([^/]+)\/Followers/);
          if (match) {
            capturedQueryId = match[1];
            console.log('[XUnfollowGhost] Followers queryId captured from XHR:', match[1]);
            post({ type: 'auth:captured', queryId: match[1], operationName: 'Followers' });
          }
          if (self.status >= 200 && self.status < 300 && self.responseText) {
            try {
              var json = JSON.parse(self.responseText);
              console.log('[XUnfollowGhost] Intercepted Followers XHR response, status:', self.status);
              onFollowersResponse(json);
            } catch (e) { /* not JSON */ }
          }
        }
      } catch (e) { /* silent */ }
    });
    return originalXhrSend.apply(this, arguments);
  };

  // ---- Response interception handler ----

  function onFollowersResponse(json) {
    var parsed = parseResponse(json);
    console.log('[XUnfollowGhost] Parsed intercepted response: users=' + parsed.users.length +
      ', hasNextCursor=' + !!parsed.nextCursor);

    var responseData = {
      users: parsed.users,
      nextCursor: parsed.nextCursor,
      raw: json,
      timestamp: Date.now(),
    };

    // If someone is waiting for a response, resolve them immediately
    if (responseWaiters.length > 0) {
      var waiter = responseWaiters.shift();
      waiter(responseData);
    } else {
      followersResponseQueue.push(responseData);
    }
  }

  // Wait for the next intercepted Followers response (or get from queue)
  function waitForFollowersResponse(timeoutMs) {
    // Check queue first
    if (followersResponseQueue.length > 0) {
      return Promise.resolve(followersResponseQueue.shift());
    }
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        // Remove this waiter
        var idx = responseWaiters.indexOf(resolve);
        if (idx !== -1) responseWaiters.splice(idx, 1);
        resolve(null); // timeout
      }, timeoutMs || 30000);

      responseWaiters.push(function (data) {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  // ---- User identification ----

  function extractUser() {
    try {
      var twid = document.cookie.match(/twid=u%3D(\d+)/);
      if (twid) {
        post({ type: 'auth:userIdentified', userId: twid[1], screenName: null });
      }
    } catch (e) { /* silent */ }
  }

  extractUser();
  setTimeout(extractUser, 2000);

  setTimeout(function () {
    try {
      var link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      if (link) {
        var href = link.getAttribute('href');
        if (href) {
          post({ type: 'auth:userIdentified', userId: null, screenName: href.replace('/', '') });
        }
      }
    } catch (e) { /* silent */ }
  }, 3000);

  // ---- Response parser ----

  function parseResponse(json) {
    var users = [];
    var nextCursor = null;

    try {
      var instructions = json && json.data && json.data.user && json.data.user.result &&
        json.data.user.result.timeline && json.data.user.result.timeline.timeline &&
        json.data.user.result.timeline.timeline.instructions;
      if (!instructions) instructions = [];

      for (var i = 0; i < instructions.length; i++) {
        var entries = instructions[i].entries || [];
        for (var j = 0; j < entries.length; j++) {
          var entry = entries[j];
          var content = entry.content;
          if (!content) continue;

          // Cursor entries
          if (content.entryType === 'TimelineTimelineCursor' && content.cursorType === 'Bottom') {
            nextCursor = content.value;
            continue;
          }
          if (content.cursorType === 'Bottom') {
            nextCursor = content.value;
            continue;
          }

          // User entries
          var userResult = content.itemContent && content.itemContent.user_results &&
            content.itemContent.user_results.result;
          if (!userResult || !userResult.legacy) continue;

          var legacy = userResult.legacy;
          users.push({
            userId: userResult.rest_id,
            screenName: legacy.screen_name,
            displayName: legacy.name,
            avatarUrl: (legacy.profile_image_url_https || '').replace('_normal', '_bigger'),
            isBlueVerified: userResult.is_blue_verified || false,
            followerCount: legacy.followers_count || 0,
            followingCount: legacy.friends_count || 0,
          });
        }

        // Also check for TimelineAddEntries instruction type
        if (instructions[i].type === 'TimelineAddEntries') {
          var ents = instructions[i].entries || [];
          for (var l = 0; l < ents.length; l++) {
            if (ents[l].entryId && ents[l].entryId.indexOf('cursor-bottom') === 0 &&
                ents[l].content && ents[l].content.value) {
              nextCursor = ents[l].content.value;
            }
          }
        }
      }
    } catch (e) { /* silent */ }

    if (users.length === 0) nextCursor = null;
    return { users: users, nextCursor: nextCursor };
  }

  // ---- Scroll-driven pagination ----
  // Simulate scrolling to trigger X's infinite scroll, which makes X load the next page.
  // X's SPA may use a nested scrollable container rather than window-level scroll.

  function findScrollContainer() {
    // Walk up from the timeline content to find the actual scrollable element
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

  function scrollToBottom() {
    window.scrollTo(0, document.body.scrollHeight);
  }

  function getScreenName() {
    try {
      var link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
      if (link) return link.getAttribute('href').replace('/', '');
    } catch (e) { /* silent */ }
    return null;
  }

  // Navigate to followers page using SPA navigation
  function navigateToFollowers(screenName) {
    return new Promise(function (resolve) {
      var targetPath = '/' + screenName + '/followers';

      // Already on followers page?
      if (window.location.pathname === targetPath || window.location.pathname === '/' + screenName + '/verified_followers') {
        resolve(true);
        return;
      }

      // Try clicking real link
      var link = document.querySelector(
        'a[href="/' + screenName + '/followers"], ' +
        'a[href="/' + screenName + '/verified_followers"]'
      );

      if (link) {
        console.log('[XUnfollowGhost] Clicking followers link');
        link.click();
      } else {
        // Fall back to direct navigation
        console.log('[XUnfollowGhost] Navigating to followers page directly');
        window.location.href = 'https://x.com/' + screenName + '/followers';
      }

      // Wait for the page to be on followers path
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

  // ---- Active scanner (response-intercept mode) ----
  //
  // Approach: navigate to followers page, let X make API calls,
  // intercept responses, scroll to paginate, deduplicate by userId.

  async function runScan(config) {
    if (isScanning) {
      post({ type: 'scan:pageError', error: 'already_scanning' });
      return;
    }

    isScanning = true;
    scanAbortFlag = false;

    var userId = config.userId;
    var screenName = getScreenName();

    console.log('[XUnfollowGhost] Scan starting (response-intercept mode). screenName:', screenName);

    if (!screenName) {
      post({ type: 'scan:pageError', error: 'no_screen_name',
        message: 'Could not detect your screen name. Please make sure you are logged in.' });
      isScanning = false;
      return;
    }

    var originalHref = window.location.href;

    // Drain any stale responses from before the scan
    followersResponseQueue = [];
    responseWaiters = [];

    // Collected users, deduplicated by userId
    var userMap = {};  // userId -> user object
    var page = 0;

    // Drain all currently queued responses into userMap, returns array of NEW users added
    function drainQueue() {
      var newUsers = [];
      while (followersResponseQueue.length > 0) {
        var resp = followersResponseQueue.shift();
        for (var i = 0; i < resp.users.length; i++) {
          var u = resp.users[i];
          if (!userMap[u.userId]) {
            userMap[u.userId] = u;
            newUsers.push(u);
          }
        }
      }
      return newUsers;
    }

    // Collect responses for a duration, returns array of new unique users added
    function collectResponses(durationMs) {
      return new Promise(function (resolve) {
        var allNew = drainQueue();
        var elapsed = 0;
        var interval = setInterval(function () {
          var batch = drainQueue();
          allNew = allNew.concat(batch);
          elapsed += 300;
          if (elapsed >= durationMs) {
            clearInterval(interval);
            resolve(allNew);
          }
        }, 300);
      });
    }

    // Step 1: Navigate to followers page
    console.log('[XUnfollowGhost] Navigating to followers page...');
    var navigated = await navigateToFollowers(screenName);
    if (!navigated || scanAbortFlag) {
      post({ type: 'scan:pageError', error: 'navigation_failed',
        message: 'Could not navigate to followers page.' });
      isScanning = false;
      return;
    }

    // Step 2: Wait for initial load
    await sleep(3000);
    var initialNewUsers = drainQueue();
    console.log('[XUnfollowGhost] After initial load: ' + initialNewUsers.length + ' unique users');

    if (initialNewUsers.length === 0 && !scanAbortFlag) {
      scrollToBottom();
      await sleep(2000);
      initialNewUsers = drainQueue();
      console.log('[XUnfollowGhost] After scroll attempt: ' + initialNewUsers.length + ' unique users');
    }

    if (initialNewUsers.length > 0) {
      page = 1;
      var total = Object.keys(userMap).length;
      post({ type: 'scan:batch', users: initialNewUsers, page: page });
      post({ type: 'scan:pageDone', page: page, fetched: total, hasMore: true });
    }

    // Step 3: Scroll-driven pagination
    // Find the actual scroll container (X may use nested scrollable div, not window)
    var scrollContainer = findScrollContainer();
    console.log('[XUnfollowGhost] Scroll container:', scrollContainer ? scrollContainer.tagName + '.' + scrollContainer.className.substring(0, 30) : 'window');

    var noNewDataRounds = 0;
    var maxNoNewDataRounds = 5;

    while (!scanAbortFlag && noNewDataRounds < maxNoNewDataRounds) {
      var sh = getScrollHeight(scrollContainer);
      var vh = getViewportHeight(scrollContainer);

      // Strategy 1: Scroll the detected container (up then down)
      var scrollUpTarget = Math.max(0, sh - vh * 3);
      doScroll(scrollContainer, scrollUpTarget);
      await sleep(300);

      // Incremental scroll down
      var pos = scrollUpTarget;
      while (pos < sh) {
        pos += vh * 0.7;
        doScroll(scrollContainer, pos);
        await sleep(150);
      }
      doScroll(scrollContainer, sh + 2000);
      await sleep(300);

      // Strategy 2: Also scroll window (in case container detection was wrong)
      if (scrollContainer) {
        window.scrollTo(0, document.documentElement.scrollHeight + 2000);
        await sleep(200);
      }

      // Strategy 3: scrollIntoView on the last timeline cell
      var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      if (cells.length > 0) {
        cells[cells.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
        await sleep(300);
        // Scroll a bit more past it
        doScroll(scrollContainer, getScrollTop(scrollContainer) + vh);
        window.scrollTo(0, window.scrollY + window.innerHeight);
        await sleep(200);
      }

      // Strategy 4: Dispatch synthetic wheel event on the timeline to trigger listeners
      var timeline = document.querySelector('[aria-label*="Timeline"]') ||
                     document.querySelector('section[role="region"]');
      if (timeline) {
        timeline.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 1000, bubbles: true, cancelable: true
        }));
        await sleep(200);
      }

      // Wait for new responses
      var newUsersThisRound = await collectResponses(5000);

      if (newUsersThisRound.length > 0) {
        noNewDataRounds = 0;
        page++;
        var total2 = Object.keys(userMap).length;
        console.log('[XUnfollowGhost] Page ' + page + ': +' + newUsersThisRound.length +
          ' new users (total: ' + total2 + ')');
        post({ type: 'scan:batch', users: newUsersThisRound, page: page });
        post({ type: 'scan:pageDone', page: page, fetched: total2, hasMore: true });
      } else {
        noNewDataRounds++;
        console.log('[XUnfollowGhost] No new users (attempt ' + noNewDataRounds + '/' + maxNoNewDataRounds + ')');
      }

      await sleep(1000 + Math.random() * 1000);
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
      runScan({ userId: msg.userId, queryId: msg.queryId });
    }
    if (msg.type === 'page:cancelScan') {
      scanAbortFlag = true;
    }
  });
})();
