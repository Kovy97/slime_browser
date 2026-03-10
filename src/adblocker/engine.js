/**
 * Slime Browser - Adblocker Engine
 * Blocks ads, trackers, and annoyances at the network level.
 * IMPORTANT: Do NOT block googlevideo.com streams - it hangs the YouTube player.
 */

// Common ad/tracker URL patterns
const BLOCK_PATTERNS = [
  // Ad networks
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /googleadservices\.com/i,
  /google-analytics\.com/i,
  /adservice\.google\./i,
  /pagead2\.googlesyndication/i,
  /amazon-adsystem\.com/i,
  /facebook\.com\/tr/i,
  /facebook\.net\/signals/i,
  /ads\.yahoo\.com/i,
  /ad\.doubleclick/i,
  /adnxs\.com/i,
  /adsrvr\.org/i,
  /criteo\.com/i,
  /outbrain\.com/i,
  /taboola\.com/i,
  /mgid\.com/i,

  // Trackers
  /scorecardresearch\.com/i,
  /quantserve\.com/i,
  /hotjar\.com/i,
  /fullstory\.com/i,
  /mouseflow\.com/i,
  /clarity\.ms/i,
  /newrelic\.com/i,
  /sentry\.io\/api/i,
  /mixpanel\.com/i,
  /amplitude\.com/i,
  /segment\.io/i,
  /optimizely\.com/i,

  // YouTube Ad tracking (safe to block - these are just telemetry, not video streams)
  /youtube\.com\/api\/stats\/ads/i,
  /youtube\.com\/pagead/i,
  /youtube\.com\/ptracking/i,
  /youtube\.com\/get_midroll_/i,
  /\/pagead\/interaction/i,
  /googleads\.g\.doubleclick/i,
  /play\.google\.com\/log/i,

  // Generic ad patterns
  /\/ads\//i,
  /\/adserver\//i,
  /\/ad_click/i,
  /\/ad_view/i,
  /\/popup_ad/i,
  /\/banner_ad/i,
];

// Whitelist - never block these
const WHITELIST = [
  /googleapis\.com\/css/i,
  /googleapis\.com\/js/i,
  /gstatic\.com/i,
  /google\.com\/recaptcha/i,
  /google\.com\/maps/i,
  /googlevideo\.com/i,   // NEVER block video streams!
  /youtube\.com\/watch/i,
  /youtube\.com\/embed/i,
  /youtubei\/v1\/player/i,  // Let player API through (we modify the response in inject.js)
  /youtubei\/v1\/next/i,
  /youtube\.com\/youtubei/i,
];

function shouldBlock(url) {
  for (const pattern of WHITELIST) {
    if (pattern.test(url)) return false;
  }

  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(url)) return true;
  }

  return false;
}

async function setupAdblocker(browserSession, onBlocked) {
  browserSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      if (shouldBlock(details.url)) {
        onBlocked(1);
        callback({ cancel: true });
      } else {
        callback({});
      }
    }
  );

  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    delete headers['X-Client-Data'];
    headers['DNT'] = '1';
    headers['Sec-GPC'] = '1';
    callback({ requestHeaders: headers });
  });

  console.log('[Slime Adblocker] Engine loaded with', BLOCK_PATTERNS.length, 'filter rules');
}

module.exports = { setupAdblocker, shouldBlock };
