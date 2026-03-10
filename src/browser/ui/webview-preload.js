/**
 * Slime Browser - Webview Preload
 * Injected into every webpage for content modification.
 */

// Remove common annoyances
window.addEventListener('DOMContentLoaded', () => {
  // Block notification prompts
  if (window.Notification) {
    window.Notification.requestPermission = () => Promise.resolve('denied');
  }

  // Block clipboard hijacking
  document.addEventListener('copy', (e) => e.stopImmediatePropagation(), true);
});

// Prevent anti-adblock detection
Object.defineProperty(document, 'hidden', { get: () => false });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });

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
      '[class*="newsletter" i]', '[id*="newsletter" i]',
      '[class*="subscribe" i]', '[id*="subscribe" i]',
      '[class*="popup" i]', '[id*="popup" i]',
      '[class*="modal" i]', '[id*="modal" i]',
      '[class*="adblock" i]', '[id*="adblock" i]',
      '[class*="ad-block" i]', '[id*="ad-block" i]',
      '[class*="adb-message" i]', '[id*="adb-message" i]'
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
      if (bodyStyle.overflow === 'hidden') {
        bodyStyle.overflow = 'auto';
      }
      const htmlStyle = document.documentElement.style;
      if (htmlStyle.overflow === 'hidden') {
        htmlStyle.overflow = 'auto';
      }

      // Find and hide fixed/sticky overlays with high z-index covering viewport
      const allEls = document.querySelectorAll('div, section, aside');
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      for (const el of allEls) {
        const style = getComputedStyle(el);
        const pos = style.position;
        if (pos !== 'fixed' && pos !== 'sticky') continue;
        const z = parseInt(style.zIndex, 10);
        if (isNaN(z) || z <= 999) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width >= vw * 0.5 && rect.height >= vh * 0.5) {
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
        if (!tryClickButtons()) {
          hideBanners();
        }
        removeOverlays();
        dismissPopups();
      } catch (e) { /* never break the page */ }
    }

    // ---- Expose for manual trigger ----
    window.__slimeDismissPopups = runAllDismiss;

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
      // Debounce: max once per 500ms
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runAllDismiss();
      }, 500);
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
