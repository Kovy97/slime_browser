/**
 * Slime Browser - YouTube Tools v4
 *
 * Ad bypass strategy (optimized for speed):
 *   1. Intercept player API → strip all ad config → ads never get scheduled
 *   2. Fallback: Ad detected → extract video ID → reload video directly via
 *      YouTube's internal API (skips the entire ad pipeline instantly)
 */

const YOUTUBE_TOOLS_CSS = `
  /* Hide ad overlay/banner elements */
  #player-ads, #masthead-ad, ytd-ad-slot-renderer,
  ytd-banner-promo-renderer, ytd-video-masthead-ad-v3-renderer,
  ytd-in-feed-ad-layout-renderer, .ytp-ad-overlay-container,
  .ytp-ad-text-overlay, #sponsor-card, .ytd-mealbar-promo-renderer,
  tp-yt-paper-dialog.ytd-popup-container,
  ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
  .ytp-ad-skip-button-container, .ytp-ad-preview-container,
  .ytp-ad-message-container, .video-ads,
  ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer,
  ytd-compact-promoted-video-renderer, .sparkles-light-cta,
  ytd-player-legacy-desktop-watch-ads-renderer,
  ytd-display-ad-renderer, ytd-rich-item-renderer:has(ytd-display-ad-renderer),
  .ytp-ad-action-interstitial, .ytp-ad-image-overlay,
  .ytp-ad-overlay-ad-info-button-container {
    display: none !important;
  }

  /* Slime YouTube toolbar - bar under video */
  #slime-yt-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: #0a0a1a;
    border: 1px solid rgba(74, 222, 128, 0.15);
    border-radius: 10px;
    margin: 8px 0 4px 0;
    font-family: 'Segoe UI', sans-serif;
    flex-wrap: wrap;
  }

  #slime-yt-toolbar .slime-toolbar-brand {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #4ade80;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    margin-right: 6px;
    padding-right: 10px;
    border-right: 1px solid rgba(74, 222, 128, 0.2);
    white-space: nowrap;
    user-select: none;
  }

  #slime-yt-toolbar .slime-toolbar-brand svg {
    width: 14px;
    height: 14px;
  }

  #slime-yt-toolbar .slime-toolbar-group {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    border-right: 1px solid rgba(255,255,255,0.08);
  }

  #slime-yt-toolbar .slime-toolbar-group:last-child {
    border-right: none;
  }

  #slime-yt-toolbar .slime-toolbar-label {
    color: rgba(255,255,255,0.4);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 4px;
    white-space: nowrap;
  }

  .slime-yt-btn {
    background: rgba(74, 222, 128, 0.08);
    color: #ccc;
    border: 1px solid rgba(255,255,255,0.1);
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: all 0.15s;
    white-space: nowrap;
    line-height: 1.4;
  }

  .slime-yt-btn:hover {
    background: rgba(74, 222, 128, 0.2);
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.4);
  }

  .slime-yt-btn.active {
    background: #4ade80;
    color: #0a0a1a;
    border-color: #4ade80;
  }
`;

const YOUTUBE_TOOLS_SCRIPT = `
(function() {
  if (window.__slimeYTLoaded) return;
  window.__slimeYTLoaded = true;

  // Cleanup previous observers if script re-runs
  if (window._slimeObservers) {
    window._slimeObservers.forEach(obs => obs.disconnect());
  }
  window._slimeObservers = [];

  if (window._slimeLoopInterval) {
    clearInterval(window._slimeLoopInterval);
    window._slimeLoopInterval = null;
  }

  if (window._slimeKeydownHandler) {
    document.removeEventListener('keydown', window._slimeKeydownHandler);
    window._slimeKeydownHandler = null;
  }

  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(YOUTUBE_TOOLS_CSS)};
  document.head.appendChild(style);

  let isReloadingVideo = false;

  // ===========================================
  // HELPER: Get video ID from URL
  // ===========================================

  function getVideoId() {
    const params = new URLSearchParams(location.search);
    return params.get('v');
  }

  function getTimestamp() {
    const params = new URLSearchParams(location.search);
    const t = params.get('t');
    return t ? parseInt(t) : 0;
  }

  // ===========================================
  // STRATEGY 1: Strip ads from player API response
  // ===========================================

  function stripAdsFromPlayerData(data) {
    if (!data || typeof data !== 'object') return data;

    const adKeys = [
      'adPlacements', 'adSlots', 'playerAds', 'adParams',
      'adBreakParams', 'adBreakHeartbeatParams', 'adSafetyReason',
    ];
    adKeys.forEach(key => delete data[key]);

    if (data.playerConfig) {
      delete data.playerConfig.adRequestConfig;
      delete data.playerConfig.adsRequestConfig;
    }

    if (data.playbackTracking) {
      delete data.playbackTracking.ptrackingUrl;
      delete data.playbackTracking.qoeUrl;
      delete data.playbackTracking.atrUrl;
    }

    return data;
  }

  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

    // Block ad telemetry
    if (url.includes('/ptracking') ||
        url.includes('/get_midroll_') ||
        url.includes('play.google.com/log') ||
        url.includes('/pagead/')) {
      return Promise.resolve(new Response('', { status: 204 }));
    }

    // Intercept player API → strip ad config
    if (url.includes('/youtubei/v1/player')) {
      return origFetch.apply(this, args).then(async (response) => {
        try {
          const text = await response.text();
          try {
            let data = JSON.parse(text);
            data = stripAdsFromPlayerData(data);
            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          } catch(e) {
            // Return original response if parsing fails
            return new Response(text, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }
        } catch(e) {
          return origFetch.apply(this, args);
        }
      });
    }

    return origFetch.apply(this, args);
  };

  // XHR override
  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._slimeUrl = url;
    return origXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._slimeUrl && typeof this._slimeUrl === 'string') {
      if (this._slimeUrl.includes('/ptracking') ||
          this._slimeUrl.includes('/get_midroll_') ||
          this._slimeUrl.includes('/pagead/')) {
        Object.defineProperty(this, 'readyState', { value: 4 });
        Object.defineProperty(this, 'status', { value: 204 });
        Object.defineProperty(this, 'responseText', { value: '' });
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new Event('load'));
        return;
      }

      if (this._slimeUrl.includes('/youtubei/v1/player')) {
        this.addEventListener('load', function() {
          try {
            let data = JSON.parse(this.responseText);
            data = stripAdsFromPlayerData(data);
            Object.defineProperty(this, 'responseText', { value: JSON.stringify(data) });
            Object.defineProperty(this, 'response', { value: JSON.stringify(data) });
          } catch(e) {}
        });
      }
    }
    return origXHRSend.apply(this, args);
  };

  // ===========================================
  // STRATEGY 2: Instant ad bypass via video reload
  // When ad is detected, force-load the real video immediately
  // ===========================================

  function bypassAd() {
    const player = document.querySelector('#movie_player');
    if (!player) return;

    const isAd = player.classList.contains('ad-showing') ||
                 player.classList.contains('ad-interrupting');
    if (!isAd) return;
    if (isReloadingVideo) return;

    const videoId = getVideoId();
    if (!videoId) return;

    isReloadingVideo = true;

    // Method 1: Use YouTube's internal player API to directly load the video
    // This completely bypasses the ad pipeline
    try {
      if (typeof player.loadVideoById === 'function') {
        const startTime = getTimestamp();
        player.loadVideoById(videoId, startTime);
        console.log('[Slime] Ad bypassed via loadVideoById:', videoId);
        setTimeout(() => { isReloadingVideo = false; }, 1500);
        return;
      }
    } catch(e) {}

    // Method 2: Use the CancelPlayback + loadVideoById combo
    try {
      if (typeof player.cancelPlayback === 'function') {
        player.cancelPlayback();
      }
      if (typeof player.loadVideoById === 'function') {
        player.loadVideoById(videoId, getTimestamp());
        console.log('[Slime] Ad bypassed via cancel+reload:', videoId);
        setTimeout(() => { isReloadingVideo = false; }, 1500);
        return;
      }
    } catch(e) {}

    // Method 3: Fast-forward fallback (least preferred, but better than nothing)
    try {
      const video = document.querySelector('video');
      if (video && video.duration > 0 && isFinite(video.duration)) {
        video.currentTime = video.duration;
        video.muted = true;
      }
      // Also click skip button if available
      const skipBtn = document.querySelector(
        '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
      );
      if (skipBtn) skipBtn.click();
    } catch(e) {}

    setTimeout(() => { isReloadingVideo = false; }, 1500);
  }

  // MutationObserver: React to ad-showing class instantly
  function watchForAds() {
    const player = document.querySelector('#movie_player');
    if (!player) {
      setTimeout(watchForAds, 300);
      return;
    }

    // Check immediately on load
    bypassAd();

    const observer = new MutationObserver(() => {
      bypassAd();
    });

    observer.observe(player, {
      attributes: true,
      attributeFilter: ['class'],
    });
    window._slimeObservers.push(observer);

    // Also remove ad DOM nodes as they appear
    const bodyObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'YTD-AD-SLOT-RENDERER' ||
              node.tagName === 'YTD-IN-FEED-AD-LAYOUT-RENDERER' ||
              node.tagName === 'YTD-PROMOTED-SPARKLES-WEB-RENDERER' ||
              node.tagName === 'YTD-DISPLAY-AD-RENDERER') {
            node.remove();
          }
        }
      }
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
    window._slimeObservers.push(bodyObserver);
  }

  watchForAds();

  // Backup polling (less frequent since MutationObserver handles most cases)
  if (window._slimeBypassInterval) clearInterval(window._slimeBypassInterval);
  window._slimeBypassInterval = setInterval(() => {
    if (location.hostname.includes('youtube.com')) {
      bypassAd();
    }
  }, 500);

  // ===========================================
  // PLAYER TOOLS
  // ===========================================

  function setSpeed(speed) {
    const video = document.querySelector('video');
    if (video) {
      video.playbackRate = speed;
      showNotification('Speed: ' + speed + 'x');
    }
  }

  function takeScreenshot() {
    const video = document.querySelector('video');
    if (!video) return;
    if (!video.videoWidth || !video.videoHeight) {
      showNotification('Cannot capture screenshot - video not ready');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    try {
      canvas.getContext('2d').drawImage(video, 0, 0);
      const link = document.createElement('a');
      link.download = 'slime-screenshot-' + Date.now() + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      showNotification('Screenshot saved!');
    } catch (e) {
      showNotification('Screenshot failed - video is protected');
      console.warn('[Slime YT] Screenshot CORS error:', e);
    }
  }

  function togglePiP() {
    const video = document.querySelector('video');
    if (!video) return;
    if (!document.pictureInPictureEnabled) {
      showNotification('Picture-in-Picture not supported');
      return;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(e => {
        showNotification('Failed to exit PiP');
        console.warn('[Slime YT] PiP exit error:', e);
      });
    } else {
      video.requestPictureInPicture().catch(e => {
        showNotification('Failed to enter PiP');
        console.warn('[Slime YT] PiP error:', e);
      });
    }
  }

  // ===========================================
  // AUTO MAX QUALITY
  // ===========================================

  function forceMaxQuality(retries) {
    if (retries === undefined) retries = 3;
    const player = document.querySelector('#movie_player');
    if (!player) {
      if (retries > 0) {
        setTimeout(() => forceMaxQuality(retries - 1), 1000);
      }
      return;
    }

    const levels = typeof player.getAvailableQualityLevels === 'function'
      ? player.getAvailableQualityLevels()
      : [];

    if (!levels || levels.length === 0) {
      if (retries > 0) {
        setTimeout(() => forceMaxQuality(retries - 1), 1000);
      }
      return;
    }

    const best = levels[0];
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(best, best);
      }
    } catch (e) {}

    try {
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(best);
      }
    } catch (e) {}

    console.log('[Slime] Forced quality to', best);
    showNotification('Quality: ' + best);
  }

  let loopStart = null, loopEnd = null;
  function toggleLoop() {
    const video = document.querySelector('video');
    if (!video) return;
    if (window._slimeLoopInterval) {
      clearInterval(window._slimeLoopInterval);
      window._slimeLoopInterval = null; loopStart = null; loopEnd = null;
      showNotification('Loop disabled');
      return;
    }
    if (!loopStart) {
      loopStart = video.currentTime;
      showNotification('Loop start: ' + formatTime(loopStart));
    } else {
      loopEnd = video.currentTime;
      if (loopEnd <= loopStart) {
        // Swap if end is before start
        const tmp = loopStart;
        loopStart = loopEnd;
        loopEnd = tmp;
      }
      if (loopEnd - loopStart < 0.5) {
        showNotification('Loop segment too short (min 0.5s)');
        loopStart = null;
        loopEnd = null;
        return;
      }
      showNotification('Looping ' + formatTime(loopStart) + ' - ' + formatTime(loopEnd));
      window._slimeLoopInterval = setInterval(() => {
        if (video.currentTime >= loopEnd || video.currentTime < loopStart) {
          video.currentTime = loopStart;
        }
      }, 100);
    }
  }

  function showNotification(text) {
    let notif = document.getElementById('slime-notif');
    if (!notif) {
      notif = document.createElement('div');
      notif.id = 'slime-notif';
      notif.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;background:#1a1a2e;color:#4ade80;padding:10px 20px;border-radius:8px;border:1px solid #4ade80;font-family:Segoe UI,sans-serif;font-size:14px;font-weight:600;transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(notif);
    }
    notif.textContent = text;
    notif.style.opacity = '1';
    clearTimeout(notif._timeout);
    notif._timeout = setTimeout(() => { notif.style.opacity = '0'; }, 2000);
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function createToolbar() {
    if (document.getElementById('slime-yt-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.id = 'slime-yt-toolbar';

    // Brand
    const brand = document.createElement('div');
    brand.className = 'slime-toolbar-brand';
    brand.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#4ade80" stroke-width="1.5" fill="none"/><circle cx="6" cy="7" r="1.2" fill="#4ade80"/><circle cx="10" cy="7" r="1.2" fill="#4ade80"/><path d="M5.5 10.5q2.5 2 5 0" stroke="#4ade80" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>SLIME';
    toolbar.appendChild(brand);

    // Speed group
    const speedGroup = document.createElement('div');
    speedGroup.className = 'slime-toolbar-group';
    const speedLabel = document.createElement('span');
    speedLabel.className = 'slime-toolbar-label';
    speedLabel.textContent = 'Speed';
    speedGroup.appendChild(speedLabel);

    [0.5, 1, 1.5, 2, 3].forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'slime-yt-btn' + (s === 1 ? ' active' : '');
      btn.textContent = s + 'x';
      btn.addEventListener('click', () => {
        setSpeed(s);
        speedGroup.querySelectorAll('.slime-yt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      speedGroup.appendChild(btn);
    });
    toolbar.appendChild(speedGroup);

    // Tools group
    const toolsGroup = document.createElement('div');
    toolsGroup.className = 'slime-toolbar-group';
    const toolsLabel = document.createElement('span');
    toolsLabel.className = 'slime-toolbar-label';
    toolsLabel.textContent = 'Tools';
    toolsGroup.appendChild(toolsLabel);

    [
      { label: '\u{1F4F7}', title: 'Screenshot (S)', action: takeScreenshot },
      { label: 'PiP', title: 'Picture in Picture (Alt+P)', action: togglePiP },
      { label: '\u{1F501}', title: 'Segment Loop (Alt+L)', action: toggleLoop },
      { label: 'MAX', title: 'Max Quality', action: () => forceMaxQuality() },
    ].forEach(({ label, title, action }) => {
      const btn = document.createElement('button');
      btn.className = 'slime-yt-btn';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', action);
      toolsGroup.appendChild(btn);
    });
    toolbar.appendChild(toolsGroup);

    // Insert below the video player, retry until anchor is found
    function insertToolbar(retries) {
      if (document.getElementById('slime-yt-toolbar') !== toolbar && document.getElementById('slime-yt-toolbar')) return;
      const selectors = [
        '#below',
        '#above-the-fold',
        '#info',
        '#meta',
      ];
      for (const sel of selectors) {
        const anchor = document.querySelector(sel);
        if (anchor && anchor.parentElement) {
          anchor.parentElement.insertBefore(toolbar, anchor);
          return;
        }
      }
      // Fallback: after player container
      const player = document.querySelector('#player-container-inner') ||
                     document.querySelector('#player-container-outer') ||
                     document.querySelector('#player');
      if (player) {
        player.after(toolbar);
        return;
      }
      // Retry if DOM not ready yet
      if (retries > 0) {
        setTimeout(() => insertToolbar(retries - 1), 500);
      } else {
        // Last resort: fixed position at bottom
        toolbar.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:99999;';
        document.body.appendChild(toolbar);
      }
    }
    insertToolbar(10);
  }

  if (!window._slimeKeydownHandler) {
    window._slimeKeydownHandler = function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      switch(e.key) {
        case 's': takeScreenshot(); break;
        case 'p': if (e.altKey) togglePiP(); break;
        case 'l': if (e.altKey) toggleLoop(); break;
      }
    };
    document.addEventListener('keydown', window._slimeKeydownHandler);
  }

  let _slimeLastVideoUrl = '';

  function onVideoPage() {
    createToolbar();
    // Only force quality once per navigation (avoid re-triggering on DOM mutations)
    const currentUrl = location.href;
    if (currentUrl !== _slimeLastVideoUrl) {
      _slimeLastVideoUrl = currentUrl;
      setTimeout(() => forceMaxQuality(), 800);
    }
  }

  const pageObserver = new MutationObserver(() => {
    if (location.pathname === '/watch') {
      onVideoPage();
    } else {
      const tb = document.getElementById('slime-yt-toolbar');
      if (tb) tb.remove();
    }
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });
  window._slimeObservers.push(pageObserver);
  if (location.pathname === '/watch') onVideoPage();

  // Also listen for YouTube SPA navigations
  document.addEventListener('yt-navigate-finish', () => {
    if (location.pathname === '/watch') {
      onVideoPage();
    }
  });

  console.log('[Slime Browser] YouTube Tools v4 loaded');
})();
`;

function getYouTubeScript() {
  return YOUTUBE_TOOLS_SCRIPT;
}

module.exports = { getYouTubeScript };
