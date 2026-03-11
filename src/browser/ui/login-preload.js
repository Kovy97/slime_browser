/**
 * Slime Browser - Login Window Preload (Firefox disguise)
 * Runs with contextIsolation OFF so overrides affect the page directly.
 * Makes the window look like Firefox to Google's detection.
 */
(() => {
  const FIREFOX_VERSION = '136.0';
  const firefoxUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:' + FIREFOX_VERSION + ') Gecko/20100101 Firefox/' + FIREFOX_VERSION;

  // 1. Override User-Agent and related navigator properties
  Object.defineProperty(navigator, 'userAgent', { get: () => firefoxUA, configurable: true });
  Object.defineProperty(navigator, 'appVersion', { get: () => '5.0 (Windows)', configurable: true });
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });
  Object.defineProperty(navigator, 'product', { get: () => 'Gecko', configurable: true });
  Object.defineProperty(navigator, 'productSub', { get: () => '20100101', configurable: true });
  Object.defineProperty(navigator, 'appName', { get: () => 'Netscape', configurable: true });
  Object.defineProperty(navigator, 'vendor', { get: () => '', configurable: true });
  Object.defineProperty(navigator, 'vendorSub', { get: () => '', configurable: true });

  // 2. Firefox-specific properties
  Object.defineProperty(navigator, 'buildID', { get: () => '20250301000000', configurable: true });
  Object.defineProperty(navigator, 'oscpu', { get: () => 'Windows NT 10.0; Win64; x64', configurable: true });

  // 3. Remove Chromium/Electron giveaways
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

  // window.chrome — Firefox doesn't have this
  try { delete window.chrome; } catch(e) {}
  Object.defineProperty(window, 'chrome', { get: () => undefined, configurable: true });

  // navigator.userAgentData — Chrome's UA Client Hints, Firefox doesn't have this
  try { delete navigator.userAgentData; } catch(e) {}
  Object.defineProperty(navigator, 'userAgentData', { get: () => undefined, configurable: true });

  // navigator.connection — Chrome-only Network Information API
  try { delete navigator.connection; } catch(e) {}
  Object.defineProperty(navigator, 'connection', { get: () => undefined, configurable: true });

  // navigator.deviceMemory — Chrome-only Device Memory API
  try { delete navigator.deviceMemory; } catch(e) {}
  Object.defineProperty(navigator, 'deviceMemory', { get: () => undefined, configurable: true });

  // navigator.scheduling — Chrome-only Scheduling API
  try { delete navigator.scheduling; } catch(e) {}
  Object.defineProperty(navigator, 'scheduling', { get: () => undefined, configurable: true });

  // performance.memory — Chrome-only
  if (performance.memory) {
    try { delete performance.memory; } catch(e) {}
    Object.defineProperty(performance, 'memory', { get: () => undefined, configurable: true });
  }

  // 4. Plugins — Firefox returns empty
  const ffPlugins = {
    length: 0,
    item: () => null,
    namedItem: () => null,
    refresh: () => {},
    [Symbol.iterator]: function*() {},
  };
  Object.defineProperty(navigator, 'plugins', { get: () => ffPlugins, configurable: true });
  Object.defineProperty(navigator, 'mimeTypes', { get: () => ffPlugins, configurable: true });

  // 5. Languages
  Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en-US', 'en'], configurable: true });
  Object.defineProperty(navigator, 'language', { get: () => 'de-DE', configurable: true });

  // 6. WebGL — hide ANGLE (Chromium-specific renderer)
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attrs) {
    const ctx = origGetContext.call(this, type, attrs);
    if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
      const origGetParam = ctx.getParameter.bind(ctx);
      const debugExt = ctx.getExtension('WEBGL_debug_renderer_info');
      ctx.getParameter = function(param) {
        if (debugExt) {
          if (param === debugExt.UNMASKED_VENDOR_WEBGL) return 'Mozilla';
          if (param === debugExt.UNMASKED_RENDERER_WEBGL) return 'Direct3D11';
        }
        return origGetParam(param);
      };
    }
    return ctx;
  };

  // 7. Remove Electron globals
  for (const prop of ['process', 'require', 'module', '__filename', '__dirname']) {
    if (window[prop]) { try { delete window[prop]; } catch(e) {} }
  }
})();
