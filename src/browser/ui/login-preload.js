/**
 * Slime Browser - Login Window Preload
 * Runs with contextIsolation OFF so property overrides affect the page directly.
 * Spoofs Electron fingerprints so Google accepts the login.
 */

(() => {
  const chromeVersion = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '130.0.0.0';
  const chromeMajor = chromeVersion.split('.')[0];

  // 1. Remove webdriver flag
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // 2. window.chrome object
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: () => {},
      sendMessage: () => {},
    };
  }

  // 3. navigator.userAgentData — Google's primary check
  const fakeUAData = {
    brands: [
      { brand: 'Google Chrome', version: chromeMajor },
      { brand: 'Chromium', version: chromeMajor },
      { brand: 'Not_A Brand', version: '24' },
    ],
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: () => Promise.resolve({
      brands: fakeUAData.brands,
      mobile: false,
      platform: 'Windows',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      model: '',
      uaFullVersion: chromeVersion,
      fullVersionList: [
        { brand: 'Google Chrome', version: chromeVersion },
        { brand: 'Chromium', version: chromeVersion },
        { brand: 'Not_A Brand', version: '24.0.0.0' },
      ],
    }),
    toJSON() {
      return { brands: this.brands, mobile: this.mobile, platform: this.platform };
    },
  };
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => fakeUAData,
    configurable: true,
  });

  // 4. Plugins (non-empty like real Chrome)
  const fakePlugins = {
    length: 5,
    0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    2: { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    3: { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    4: { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    item(i) { return this[i] || null; },
    namedItem(name) { for (let i = 0; i < this.length; i++) { if (this[i].name === name) return this[i]; } return null; },
    refresh() {},
    [Symbol.iterator]: function*() { for (let i = 0; i < this.length; i++) yield this[i]; },
  };
  Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true });

  // 5. Languages
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['de-DE', 'de', 'en-US', 'en'],
      configurable: true,
    });
  }

  // 6. Clean UA string
  const cleanUA = navigator.userAgent
    .replace(/\s*Electron\/[\d.]+/g, '')
    .replace(/\s*SlimeBrowser\/[\d.]+/g, '');
  if (cleanUA !== navigator.userAgent) {
    Object.defineProperty(navigator, 'userAgent', { get: () => cleanUA, configurable: true });
    Object.defineProperty(navigator, 'appVersion', { get: () => cleanUA.replace('Mozilla/', ''), configurable: true });
  }

  // 7. Remove Electron globals
  if (window.process) { try { delete window.process; } catch(e) {} }
  if (window.require) { try { delete window.require; } catch(e) {} }
  if (window.module) { try { delete window.module; } catch(e) {} }
  if (window.__filename) { try { delete window.__filename; } catch(e) {} }
  if (window.__dirname) { try { delete window.__dirname; } catch(e) {} }

  // 8. Permissions API fix
  const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
  if (origQuery) {
    navigator.permissions.query = (params) => {
      if (params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return origQuery(params);
    };
  }
})();
