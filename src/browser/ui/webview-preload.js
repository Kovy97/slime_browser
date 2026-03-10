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

    // 8. Clean Electron/SlimeBrowser from User-Agent if leaked
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

// Prevent anti-adblock detection
try {
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
} catch (e) { /* property may already be defined */ }

// =============================================================================
// Cookie Consent & Popup Auto-Dismiss System
// =============================================================================
(() => {
  try {
    // ---- Button text patterns (case-insensitive) ----
    const ACCEPT_PATTERNS = [
      // German
      /^alle akzeptieren$/i, /^akzeptieren$/i, /^zustimmen$/i,
      /^einverstanden$/i, /^alle annehmen$/i, /^verstanden$/i,
      /^weiter ohne$/i,
      // English
      /^accept all$/i, /^accept cookies?$/i, /^accept$/i,
      /^i agree$/i, /^got it$/i, /^allow all$/i, /^agree$/i,
      /^ok$/i, /^continue$/i, /^dismiss$/i
    ];

    // ---- CSS selectors for accept/consent buttons ----
    const BUTTON_SELECTORS = [
      '[id*="accept" i]', '[id*="consent" i]',
      '[class*="accept" i]', '[class*="consent" i]',
      '.cmp-accept', '.js-accept',
      '#onetrust-accept-btn-handler',
      '[data-testid*="accept" i]', '[data-action*="accept" i]'
    ].join(',');

    // ---- CSS selectors for cookie banner containers ----
    const BANNER_SELECTORS = [
      '#cookie-banner', '#cookie-consent', '#cookie-notice',
      '.cookie-banner', '.cookie-consent', '.cookie-notice',
      '#CybotCookiebotDialog', '#onetrust-banner-sdk',
      '.cc-banner', '.cc-window',
      '#gdpr-consent', '.gdpr-banner',
      '.consent-banner', '.consent-modal',
      '[class*="cookie-banner" i]', '[class*="cookie-consent" i]',
      '[id*="cookie-banner" i]',
      '[aria-label*="cookie" i]', '[aria-label*="consent" i]'
    ].join(',');

    // ---- Selectors for general popups ----
    const POPUP_SELECTORS = [
      '[class*="newsletter-popup" i]', '[id*="newsletter-popup" i]',
      '[class*="newsletter-overlay" i]', '[id*="newsletter-overlay" i]',
      '[class*="subscribe-popup" i]', '[id*="subscribe-popup" i]',
      '[class*="adblock-notice" i]', '[id*="adblock-notice" i]',
      '[class*="adblock-overlay" i]', '[id*="adblock-overlay" i]',
      '[class*="adb-message" i]', '[id*="adb-message" i]',
      '[class*="anti-adblock" i]', '[id*="anti-adblock" i]'
    ].join(',');

    // =========================================================================
    // Strategy A — Click common accept/dismiss buttons
    // =========================================================================
    function tryClickButtons() {
      // First try by known CSS selectors (consent framework buttons)
      const selectorBtns = document.querySelectorAll(BUTTON_SELECTORS);
      for (const el of selectorBtns) {
        const tag = el.tagName.toLowerCase();
        if ((tag === 'button' || tag === 'a' || tag === 'input' ||
             el.getAttribute('role') === 'button') && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }

      // Then try by text content matching
      const candidates = document.querySelectorAll(
        'button, a, [role="button"], input[type="button"], input[type="submit"]'
      );
      for (const el of candidates) {
        const text = (el.textContent || el.value || '').trim();
        if (text.length > 50) continue; // skip elements with long text
        for (const pattern of ACCEPT_PATTERNS) {
          if (pattern.test(text) && el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
      }
      return false;
    }

    // =========================================================================
    // Strategy B — Hide cookie banner containers via CSS
    // =========================================================================
    function hideBanners() {
      const banners = document.querySelectorAll(BANNER_SELECTORS);
      let hidden = 0;
      for (const el of banners) {
        if (el.offsetParent !== null || getComputedStyle(el).display !== 'none') {
          el.style.setProperty('display', 'none', 'important');
          hidden++;
        }
      }
      return hidden > 0;
    }

    // =========================================================================
    // Strategy C — Remove blocking overlays/backdrops
    // =========================================================================
    function removeOverlays() {
      // Remove body scroll lock
      if (document.body.classList.contains('modal-open')) {
        document.body.classList.remove('modal-open');
      }
      const bodyStyle = document.body.style;
      if (bodyStyle.overflow === 'hidden') bodyStyle.overflow = '';
      const htmlStyle = document.documentElement.style;
      if (htmlStyle.overflow === 'hidden') htmlStyle.overflow = '';

      // Only hide overlay backdrops (semi-transparent full-screen covers)
      // Targeted selector: most cookie/ad overlays have a class or id
      const allEls = document.querySelectorAll('div[class], div[id]');
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      for (const el of allEls) {
        const style = getComputedStyle(el);
        if (style.position !== 'fixed') continue;
        const z = parseInt(style.zIndex, 10);
        if (isNaN(z) || z <= 999) continue;

        // Skip elements that might be security warnings
        const text = el.textContent?.toLowerCase() || '';
        if (text.includes('security') || text.includes('warning') || text.includes('dangerous') ||
            text.includes('malware') || text.includes('phishing') || text.includes('certificate') ||
            text.includes('sicherheit') || text.includes('warnung')) {
          continue;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width < vw * 0.8 || rect.height < vh * 0.8) continue;
        // Only target backdrop-like elements (semi-transparent or no visible content)
        const bg = style.backgroundColor;
        const opacity = parseFloat(style.opacity);
        // Robust rgba regex with explicit character classes to prevent ReDoS
        const rgbaMatch = bg.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\s*\)/);
        const bgAlpha = rgbaMatch && rgbaMatch[1] ? parseFloat(rgbaMatch[1]) : 1;
        const isBackdrop = bgAlpha < 0.95 || opacity < 0.95;
        if (isBackdrop && el.children.length <= 1) {
          el.style.setProperty('display', 'none', 'important');
        }
      }
    }

    // =========================================================================
    // General popup/overlay dismissal
    // =========================================================================
    function dismissPopups() {
      const popups = document.querySelectorAll(POPUP_SELECTORS);
      for (const el of popups) {
        const style = getComputedStyle(el);
        const pos = style.position;
        // Only dismiss overlays, not inline page content
        if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') {
          const z = parseInt(style.zIndex, 10);
          if (!isNaN(z) && z > 99) {
            el.style.setProperty('display', 'none', 'important');
          }
        }
      }
    }

    // =========================================================================
    // Master dismiss function — runs all strategies
    // =========================================================================
    function runAllDismiss() {
      try {
        tryClickButtons();
        hideBanners();
        removeOverlays();
        dismissPopups();
      } catch (e) { /* never break the page */ }
    }

    // ---- Internal reference via non-enumerable Symbol-based key ----
    // Websites cannot detect or enumerate this property
    const _slimeKey = Symbol.for('slime-dismiss');
    Object.defineProperty(window, _slimeKey, {
      value: runAllDismiss,
      enumerable: false,
      configurable: false,
      writable: false
    });

    // =========================================================================
    // Trigger on DOMContentLoaded + delayed re-run for lazy-loaded banners
    // =========================================================================
    window.addEventListener('DOMContentLoaded', () => {
      runAllDismiss();
      setTimeout(runAllDismiss, 1500);
    });

    // =========================================================================
    // MutationObserver for dynamically injected banners
    // =========================================================================
    let debounceTimer = null;
    let observerStartTime = Date.now();

    const observer = new MutationObserver(() => {
      // Stop after 30 seconds
      if (Date.now() - observerStartTime > 30000) {
        observer.disconnect();
        return;
      }
      // Debounce: max once per 1000ms to reduce CPU impact
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runAllDismiss();
      }, 1000);
    });

    // Start observing once body is available
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        observerStartTime = Date.now();
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    // Hard stop the observer after 30 seconds regardless
    setTimeout(() => {
      observer.disconnect();
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }, 30000);

  } catch (e) { /* never break the page */ }
})();
