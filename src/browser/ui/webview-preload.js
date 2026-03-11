/**
 * Slime Browser - Webview Preload
 * Injected into every webpage for content modification.
 */

// =============================================================================
// Anti-Bot Detection (Cloudflare, etc.)
// Must run BEFORE page scripts to pass fingerprint checks.
// =============================================================================
(() => {
  try {
    // 1. Remove navigator.webdriver flag (backup for --disable-blink-features)
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });

    // 2. Add window.chrome object (real Chrome always has this)
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: () => {},
        sendMessage: () => {},
      };
    }

    // 3. Fix navigator.plugins (Electron has empty plugins array)
    const fakePlugins = {
      length: 5,
      0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      2: { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      3: { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      4: { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      item: function(i) { return this[i] || null; },
      namedItem: function(name) {
        for (let i = 0; i < this.length; i++) {
          if (this[i].name === name) return this[i];
        }
        return null;
      },
      refresh: function() {},
      [Symbol.iterator]: function*() {
        for (let i = 0; i < this.length; i++) yield this[i];
      },
    };
    Object.defineProperty(navigator, 'plugins', {
      get: () => fakePlugins,
      configurable: true,
    });

    // 4. Fix navigator.mimeTypes
    const fakeMimeTypes = {
      length: 2,
      0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      1: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      item: function(i) { return this[i] || null; },
      namedItem: function(name) {
        for (let i = 0; i < this.length; i++) {
          if (this[i].type === name) return this[i];
        }
        return null;
      },
      [Symbol.iterator]: function*() {
        for (let i = 0; i < this.length; i++) yield this[i];
      },
    };
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => fakeMimeTypes,
      configurable: true,
    });

    // 5. Ensure navigator.languages is populated
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['de-DE', 'de', 'en-US', 'en'],
        configurable: true,
      });
    }

    // 6. Fix permissions API (Cloudflare checks notification permission query)
    const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (originalQuery) {
      navigator.permissions.query = (params) => {
        if (params.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery(params);
      };
    }

    // 7. Mask Electron-specific properties
    // Remove process & require references that might leak through
    if (window.process) {
      try { delete window.process; } catch(e) {}
    }
    if (window.require) {
      try { delete window.require; } catch(e) {}
    }

    // 8. Spoof navigator.userAgentData (Google checks this for login)
    // Electron reports "Chromium" brand — Google requires "Google Chrome"
    const chromeMajor = /Chrome\/([\d]+)/.exec(navigator.userAgent)?.[1] || '130';
    const chromeFullVer = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] || '130.0.0.0';
    const fakeUAData = {
      brands: [
        { brand: 'Google Chrome', version: chromeMajor },
        { brand: 'Chromium', version: chromeMajor },
        { brand: 'Not_A Brand', version: '24' },
      ],
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: (hints) => Promise.resolve({
        brands: fakeUAData.brands,
        mobile: false,
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        bitness: '64',
        model: '',
        uaFullVersion: chromeFullVer,
        fullVersionList: [
          { brand: 'Google Chrome', version: chromeFullVer },
          { brand: 'Chromium', version: chromeFullVer },
          { brand: 'Not_A Brand', version: '24.0.0.0' },
        ],
      }),
      toJSON: function() {
        return { brands: this.brands, mobile: this.mobile, platform: this.platform };
      },
    };
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => fakeUAData,
      configurable: true,
    });

    // 9. Clean Electron/SlimeBrowser from User-Agent if leaked
    const cleanUA = navigator.userAgent
      .replace(/\s*Electron\/[\d.]+/g, '')
      .replace(/\s*SlimeBrowser\/[\d.]+/g, '');
    if (cleanUA !== navigator.userAgent) {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => cleanUA,
        configurable: true,
      });
      Object.defineProperty(navigator, 'appVersion', {
        get: () => cleanUA.replace('Mozilla/', ''),
        configurable: true,
      });
    }

  } catch (e) { /* never break the page */ }
})();

// Remove common annoyances
window.addEventListener('DOMContentLoaded', () => {
  // Block notification prompts
  if (window.Notification) {
    window.Notification.requestPermission = () => Promise.resolve('denied');
  }

  // Block programmatic clipboard hijacking but allow user-initiated copies
  document.addEventListener('copy', (e) => {
    if (!e.isTrusted) e.stopImmediatePropagation();
  }, true);

  // =========================================================================
  // Cosmetic ad filtering — hide known ad elements via CSS
  // Only target highly specific selectors to avoid breaking page layouts
  // =========================================================================
  const adCSS = document.createElement('style');
  adCSS.textContent = `
    /* Google Ads */
    ins.adsbygoogle,
    div[id^="div-gpt-ad"],
    [id*="google_ads_iframe"],
    [data-google-query-id],
    iframe[src*="doubleclick.net"],
    iframe[src*="googlesyndication.com"],
    /* Specific ad frameworks */
    .adsbygoogle,
    .ad-placeholder,
    .sponsored-content,
    .sponsored-ad,
    [id*="InterRedAd"],
    [class*="InterRedAd"]
    {
      display: none !important;
      height: 0 !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
  `;
  (document.head || document.documentElement).appendChild(adCSS);
});

// NOTE: document.hidden/visibilityState overrides removed
// — Cloudflare detects tampered visibility API as a bot indicator

// Cookie Consent & Popup Auto-Dismiss is now injected via browser.js
// based on the cookieAutoDismiss setting (toggleable in Settings)
