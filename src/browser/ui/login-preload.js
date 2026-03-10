/**
 * Slime Browser - Login Window Preload (Firefox disguise)
 * Runs with contextIsolation OFF so overrides affect the page directly.
 * Makes the window look like Firefox to Google's detection.
 */
(() => {
  // 1. Remove Chromium/Electron giveaways
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

  // 2. Remove window.chrome entirely — Firefox doesn't have it
  try { delete window.chrome; } catch(e) {}
  Object.defineProperty(window, 'chrome', { get: () => undefined, configurable: true });

  // 3. Remove navigator.userAgentData — Firefox doesn't support this API
  try { delete navigator.userAgentData; } catch(e) {}
  Object.defineProperty(navigator, 'userAgentData', { get: () => undefined, configurable: true });

  // 4. Fix plugins — Firefox has different defaults
  const ffPlugins = {
    length: 0,
    item: () => null,
    namedItem: () => null,
    refresh: () => {},
    [Symbol.iterator]: function*() {},
  };
  Object.defineProperty(navigator, 'plugins', { get: () => ffPlugins, configurable: true });

  // 5. Clean UA
  const cleanUA = navigator.userAgent
    .replace(/\s*Electron\/[\d.]+/g, '')
    .replace(/\s*SlimeBrowser\/[\d.]+/g, '')
    .replace(/\s*Chrome\/[\d.]+/g, '')
    .replace(/\s*Safari\/[\d.]+/g, '');
  // Only override if it still looks like Chrome
  if (navigator.userAgent.includes('Chrome')) {
    const firefoxUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
    Object.defineProperty(navigator, 'userAgent', { get: () => firefoxUA, configurable: true });
    Object.defineProperty(navigator, 'appVersion', { get: () => '5.0 (Windows)', configurable: true });
    Object.defineProperty(navigator, 'product', { get: () => 'Gecko', configurable: true });
    Object.defineProperty(navigator, 'appName', { get: () => 'Netscape', configurable: true });
    Object.defineProperty(navigator, 'vendor', { get: () => '', configurable: true });
  }

  // 6. Languages
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en-US', 'en'], configurable: true });
  }

  // 7. Remove Electron globals
  for (const prop of ['process', 'require', 'module', '__filename', '__dirname']) {
    if (window[prop]) { try { delete window[prop]; } catch(e) {} }
  }

  // 8. Firefox-specific: buildID
  Object.defineProperty(navigator, 'buildID', { get: () => '20181001000000', configurable: true });

  // 9. Firefox-specific: oscpu
  Object.defineProperty(navigator, 'oscpu', { get: () => 'Windows NT 10.0; Win64; x64', configurable: true });
})();
