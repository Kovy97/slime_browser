/**
 * Slime Browser - Adblocker Engine
 * Blocks ads, trackers, and annoyances at the network level.
 * IMPORTANT: Do NOT block googlevideo.com streams - it hangs the YouTube player.
 */

// Exact domain blocking via Set — O(1) lookup
const BLOCK_DOMAINS = new Set([
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'amazon-adsystem.com',
  'ads.yahoo.com',
  'ad.doubleclick',
  'adnxs.com',
  'adsrvr.org',
  'criteo.com',
  'outbrain.com',
  'taboola.com',
  'mgid.com',
  'scorecardresearch.com',
  'quantserve.com',
  'hotjar.com',
  'fullstory.com',
  'mouseflow.com',
  'clarity.ms',
  'newrelic.com',
  'mixpanel.com',
  'amplitude.com',
  'segment.io',
  'optimizely.com',

  // Major ad networks
  '2mdn.net', 'adform.net', 'admob.com', 'adsymptotic.com',
  'advertising.com', 'bidswitch.net', 'casalemedia.com', 'contextweb.com',
  'cpmstar.com', 'districtm.io', 'dotomi.com', 'exoclick.com',
  'eyeota.net', 'flashtalking.com', 'freewheel.com', 'indexww.com',
  'innity.com', 'mathtag.com', 'media.net', 'mediamath.com',
  'mediavine.com', 'moatads.com', 'mookie1.com', 'myvisualiq.net',
  'nativo.com', 'openx.net', 'pubmatic.com', 'rfihub.com',
  'richaudience.com', 'rubiconproject.com', 'smaato.net', 'smartadserver.com',
  'spotxchange.com', 'stickyadstv.com', 'teads.tv', 'tribalfusion.com',
  'triplelift.com', 'turn.com', 'undertone.com', 'yieldmo.com',
  'zedo.com',

  // Trackers
  'adjust.com', 'appsflyer.com', 'branch.io', 'bugsnag.com',
  'chartbeat.com', 'clicktale.net', 'comscore.com', 'crazyegg.com',
  'demdex.net', 'effectivemeasure.net', 'evidon.com',
  'heapanalytics.com', 'histats.com',
  'inspectlet.com', 'kissmetrics.com', 'krxd.net', 'liadm.com',
  'logly.co.jp', 'luckyorange.com', 'marketo.com', 'mxpnl.com',
  'nr-data.net', 'omtrdc.net', 'pardot.com',
  'pingdom.net', 'pippio.com', 'sailthru.com', 'siteimproveanalytics.com',
  'statcounter.com', 'tapad.com', 'tealiumiq.com', 'trackjs.com',
  'tynt.com', 'urbanairship.com', 'webtrends.com',

  // German-specific ad networks (GMX, Web.de, etc.)
  'adsserver.unity3d.com', 'adtech.de', 'ag-online.de',
  'emetriq.de', 'interred.de', 'iqdigital.de',
  'meetrics.net', 'nuggad.net', 'plista.com',
  'stroeerdigitalgroup.de', 'stroeer.de', 'yieldlove.com',
  'showheroes.com', 'smartclip.net', 'ligatus.com',
  'performance-marketplace.com',

  // Note: uimserv.net and ui-portal.de are United Internet CDNs used for
  // both ads AND legitimate site assets (CSS, JS) — do NOT block them

  // Popup/redirect
  'popads.net', 'popcash.net', 'propellerads.com',
  'revcontent.com', 'revjet.com',
]);

// Combined regex for patterns that need path/substring matching
// Single compiled regex with alternation — tested once per URL
const BLOCK_REGEX = new RegExp([
  'adservice\\.google\\.',
  'pagead2\\.googlesyndication',
  'facebook\\.com\\/tr',
  'facebook\\.net\\/signals',
  'sentry\\.io\\/api',
  'youtube\\.com\\/api\\/stats\\/ads',
  'youtube\\.com\\/pagead',
  'youtube\\.com\\/ptracking',
  'youtube\\.com\\/get_midroll_',
  '\\/pagead\\/interaction',
  'googleads\\.g\\.doubleclick',
  'play\\.google\\.com\\/log',
  '\\/adserver\\/',
  '\\/ad_click',
  '\\/ad_view',
  '\\/popup_ad',
  '\\/banner_ad',

  // Common ad paths (specific to avoid false positives)
  '\\/ad[-_]?banner',
  '\\/ad[-_]?click',
  '\\/ad[-_]?track',
  '\\/banner[-_]?ad',
  '\\/click[-_]?track',
  '\\/doubleclick',
  '\\/interstitial',
  '\\/pop[-_]?under',
  '\\/prebid',
  '\\/promo[-_]?ad',
  '\\/tracking[-_]?pixel',
  '[?&]ad_',
  '[?&]adid=',
  '[?&]ad_type=',
  '[?&]click_url=',
  '\\/beacon\\.',
  '\\/collect\\?',
].join('|'), 'i');

// Combined whitelist regex — single test per URL
const WHITELIST_REGEX = new RegExp([
  'googleapis\\.com\\/css',
  'googleapis\\.com\\/js',
  'gstatic\\.com',
  'google\\.com\\/recaptcha',
  'google\\.com\\/maps',
  'googlevideo\\.com',
  'youtube\\.com\\/watch',
  'youtube\\.com\\/embed',
  'youtubei\\/v1\\/player',
  'youtubei\\/v1\\/next',
  'youtube\\.com\\/youtubei',
  'youtube-nocookie\\.com',
  'youtu\\.be',
  // United Internet CDNs (GMX, Web.de) — serve site CSS/JS, not just ads
  'uimserv\\.net',
  'ui-portal\\.de',
  'uicdn\\.com',
].join('|'), 'i');

/**
 * Extract the hostname from a URL string for Set-based lookup.
 * Returns empty string on failure to avoid throwing.
 */
function extractHostname(url) {
  try {
    const start = url.indexOf('://');
    if (start === -1) return '';
    const hostStart = start + 3;
    let hostEnd = url.indexOf('/', hostStart);
    if (hostEnd === -1) hostEnd = url.length;
    // Strip port if present
    const host = url.substring(hostStart, hostEnd).split(':')[0];
    return host.toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * Check if a hostname matches any blocked domain (including subdomains).
 */
function isDomainBlocked(hostname) {
  if (BLOCK_DOMAINS.has(hostname)) return true;
  // Check if it's a subdomain of a blocked domain
  for (const domain of BLOCK_DOMAINS) {
    if (hostname.endsWith('.' + domain)) return true;
  }
  return false;
}

function shouldBlock(url) {
  // Whitelist check first (single regex)
  if (WHITELIST_REGEX.test(url)) return false;

  // Fast domain Set lookup
  const hostname = extractHostname(url);
  if (hostname && isDomainBlocked(hostname)) return true;

  // Path/pattern regex (single combined regex)
  if (BLOCK_REGEX.test(url)) return true;

  return false;
}

const TOTAL_RULES = BLOCK_DOMAINS.size + 36; // Set entries + regex alternations

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

  console.log('[Slime Adblocker] Engine loaded with', TOTAL_RULES, 'filter rules');
}

module.exports = { setupAdblocker, shouldBlock };
