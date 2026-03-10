/**
 * Slime Browser - Main UI Controller
 * Handles tabs, navigation, webviews, panels, and all browser features.
 */

// ==========================================
// State
// ==========================================

const tabs = [];
const tabMap = new Map();
let activeTabId = null;
let tabIdCounter = 0;
let youtubeScript = null;
let currentSettings = null;
let webviewPreloadPath = null;

const DEFAULT_URL = 'slime://newtab';
let SEARCH_ENGINE = 'https://www.google.com/search?q=';

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
};

// Load YouTube script from main process
window.slime.getYouTubeScript().then(script => {
  youtubeScript = script;
});

// ==========================================
// DOM References
// ==========================================

const tabsContainer = document.getElementById('tabs-container');
const webviewContainer = document.getElementById('webview-container');
const newTabPage = document.getElementById('new-tab-page');
const urlBar = document.getElementById('url-bar');
const urlBarContainer = document.getElementById('url-bar-container');
const acDropdown = document.getElementById('autocomplete-dropdown');
const blockedCountEl = document.getElementById('blocked-count');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const newTabBtn = document.getElementById('new-tab-btn');
const ntpSearchInput = document.getElementById('ntp-search-input');

// ==========================================
// Tab Management
// ==========================================

function createTab(url = DEFAULT_URL) {
  const id = ++tabIdCounter;

  const tab = {
    id,
    url,
    title: 'New Tab',
    webview: null,
    isNewTab: url === DEFAULT_URL,
  };

  if (!tab.isNewTab) {
    tab.webview = createWebview(id, url);
  }

  tabs.push(tab);
  tabMap.set(id, tab);
  renderTab(tab);
  switchToTab(id);

  return tab;
}

function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;

  const tab = tabs[index];

  if (tab.webview) {
    tab.webview.removeEventListener('page-title-updated', tab._listeners?.titleUpdated);
    tab.webview.removeEventListener('did-navigate', tab._listeners?.didNavigate);
    tab.webview.removeEventListener('page-favicon-updated', tab._listeners?.faviconUpdated);
    tab.webview.removeEventListener('did-navigate-in-page', tab._listeners?.didNavigateInPage);
    tab.webview.removeEventListener('did-start-loading', tab._listeners?.startLoading);
    tab.webview.removeEventListener('did-stop-loading', tab._listeners?.stopLoading);
    tab.webview.removeEventListener('dom-ready', tab._listeners?.domReady);
    tab.webview.removeEventListener('new-window', tab._listeners?.newWindow);
    tab.webview.remove();
  }

  const tabEl = document.querySelector(`[data-tab-id="${id}"]`);
  if (tabEl) tabEl.remove();

  tabs.splice(index, 1);
  tabMap.delete(id);

  if (tabs.length === 0) {
    createTab();
  } else if (activeTabId === id) {
    const newIndex = Math.min(index, tabs.length - 1);
    switchToTab(tabs[newIndex].id);
  }
}

function switchToTab(id) {
  activeTabId = id;
  hideSettings();
  closeAllPanels();

  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const tabEl = document.querySelector(`[data-tab-id="${id}"]`);
  if (tabEl) tabEl.classList.add('active');

  const tab = tabMap.get(id);
  if (!tab) return;

  document.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));

  if (tab.isNewTab) {
    newTabPage.style.display = 'flex';
    urlBar.value = '';
    setTimeout(() => ntpSearchInput.focus(), 50);
  } else {
    newTabPage.style.display = 'none';
    if (tab.webview) {
      tab.webview.classList.add('active');
    }
    urlBar.value = tab.url;
  }

  updateNavButtons();
  updateBookmarkButton();
}

function renderTab(tab) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.dataset.tabId = tab.id;
  el.innerHTML = `
    <div class="tab-favicon"><span>${escapeHtml(tab.title.charAt(0).toUpperCase())}</span></div>
    <span class="tab-title">${escapeHtml(tab.title)}</span>
    <button class="tab-close" title="Close Tab">&times;</button>
  `;

  el.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) {
      switchToTab(tab.id);
    }
  });

  el.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tab.id);
  });

  tabsContainer.appendChild(el);
}

function updateTabTitle(id, title) {
  const tab = tabMap.get(id);
  if (!tab) return;

  tab.title = title || 'Untitled';

  const tabEl = document.querySelector(`[data-tab-id="${id}"]`);
  if (!tabEl) return;

  const titleEl = tabEl.querySelector('.tab-title');
  if (titleEl) titleEl.textContent = tab.title;

  const faviconEl = tabEl.querySelector('.tab-favicon');
  if (faviconEl && !faviconEl.querySelector('img')) {
    faviconEl.querySelector('span').textContent = tab.title.charAt(0).toUpperCase();
  }
}

function updateTabFavicon(id, url) {
  try {
    const faviconUrl = new URL(url);
    const iconSrc = faviconUrl.origin + '/favicon.ico';

    const tabEl = document.querySelector(`[data-tab-id="${id}"]`);
    if (!tabEl) return;

    const faviconEl = tabEl.querySelector('.tab-favicon');
    if (!faviconEl) return;

    const img = document.createElement('img');
    img.src = iconSrc;
    img.onerror = () => {};
    img.onload = () => {
      faviconEl.innerHTML = '';
      faviconEl.appendChild(img);
    };
  } catch (e) { console.warn('[Slime]', e.message || e); }
}

function updateTabUrl(id, url) {
  const tab = tabMap.get(id);
  if (!tab) return;

  tab.url = url;

  if (id === activeTabId) {
    urlBar.value = url;
  }
}

// ==========================================
// Webview Management
// ==========================================

function createWebview(tabId, url) {
  const webview = document.createElement('webview');
  webview.setAttribute('src', url);
  webview.setAttribute('partition', 'persist:slime');
  webview.setAttribute('autosize', 'on');
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, webgl=yes, enableWebSQL=no');
  if (webviewPreloadPath) {
    webview.setAttribute('preload', `file://${webviewPreloadPath}`);
  }
  webview.dataset.tabId = tabId;

  const tab = tabMap.get(tabId);
  if (tab) {
    tab._listeners = {};
  }

  const _listeners = tab ? tab._listeners : {};

  _listeners.titleUpdated = (e) => {
    updateTabTitle(tabId, e.title);
  };
  webview.addEventListener('page-title-updated', _listeners.titleUpdated);

  _listeners.didNavigate = (e) => {
    updateTabUrl(tabId, e.url);
    updateTabFavicon(tabId, e.url);
    updateNavButtons();
    updateBookmarkButton();
    injectContentScripts(webview, e.url);
    // Record in history
    const wvTab = tabMap.get(tabId);
    recordHistory(e.url, wvTab?.title);
  };
  webview.addEventListener('did-navigate', _listeners.didNavigate);

  _listeners.faviconUpdated = (e) => {
    if (e.favicons && e.favicons.length > 0) {
      const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
      if (!tabEl) return;
      const faviconEl = tabEl.querySelector('.tab-favicon');
      if (!faviconEl) return;
      const img = document.createElement('img');
      img.src = e.favicons[0];
      img.onerror = () => {};
      img.onload = () => { faviconEl.innerHTML = ''; faviconEl.appendChild(img); };
    }
  };
  webview.addEventListener('page-favicon-updated', _listeners.faviconUpdated);

  _listeners.didNavigateInPage = (e) => {
    if (e.isMainFrame) {
      updateTabUrl(tabId, e.url);
      updateNavButtons();
    }
  };
  webview.addEventListener('did-navigate-in-page', _listeners.didNavigateInPage);

  _listeners.startLoading = () => {
    if (tabId === activeTabId) {
      btnReload.innerHTML = '&#x2715;';
      btnReload.title = 'Stop';
    }
  };
  webview.addEventListener('did-start-loading', _listeners.startLoading);

  _listeners.stopLoading = () => {
    if (tabId === activeTabId) {
      btnReload.innerHTML = '&#x21BB;';
      btnReload.title = 'Reload';
    }
  };
  webview.addEventListener('did-stop-loading', _listeners.stopLoading);

  _listeners.domReady = () => {
    injectContentScripts(webview, webview.getURL());
    checkPasswordAutofill(webview);
  };
  webview.addEventListener('dom-ready', _listeners.domReady);

  // Setup password capture listener
  setupPasswordCapture(webview, tabId);

  // Open links in new tab instead of popup — except auth flows
  _listeners.newWindow = (e) => {
    e.preventDefault();
    if (!e.url || e.url === 'about:blank') return;

    // Auth flows (Google sign-in, OAuth) stay in same tab
    const isAuth = /^https:\/\/(accounts\.google\.com|.*\.okta\.com|login\.|auth\.|signin\.|oauth\.)/.test(e.url) ||
                   e.url.includes('/oauth2/') || e.url.includes('/oauth/');
    if (isAuth) {
      webview.loadURL(e.url);
    } else {
      createTab(e.url);
    }
  };
  webview.addEventListener('new-window', _listeners.newWindow);

  // Handle webview crashes and load failures
  webview.addEventListener('crashed', () => {
    const t = tabMap.get(tabId);
    if (t) t.title = '(Crashed) ' + t.title;
    updateTabTitle(tabId, t?.title || 'Crashed');
    console.warn('[Slime] Webview crashed for tab', tabId);
  });

  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3) { // -3 is aborted, ignore
      console.warn('[Slime] Load failed:', e.errorDescription);
    }
  });

  webviewContainer.appendChild(webview);
  return webview;
}

function injectContentScripts(webview, url) {
  if (url && url.includes('youtube.com') && youtubeScript) {
    try {
      webview.executeJavaScript(youtubeScript);
    } catch (e) {
      console.warn('[Slime] Failed to inject YouTube tools:', e);
    }
  }
}

// ==========================================
// Navigation
// ==========================================

function navigate(input, newTab = false) {
  let url = input.trim();
  if (!url) return;

  // Block dangerous URL schemes
  if (/^(javascript|data|blob|file|vbscript):/i.test(url)) {
    console.warn('[Slime] Blocked dangerous URL scheme:', url.substring(0, 30));
    return;
  }

  // Handle internal URLs
  if (url.toLowerCase() === 'slime://settings') {
    showSettings();
    return;
  }

  // Hide settings if navigating away
  hideSettings();

  let isUrl = false;
  if (/^https?:\/\//i.test(url)) {
    isUrl = true;
  } else if (/^[\w][\w.-]*\.[a-z]{2,}(\/|$)/i.test(url)) {
    url = 'https://' + url;
    isUrl = true;
  }
  if (!isUrl) {
    url = SEARCH_ENGINE + encodeURIComponent(url);
  }

  if (newTab) {
    createTab(url);
    return;
  }

  const tab = tabMap.get(activeTabId);
  if (!tab) return;

  if (tab.isNewTab) {
    tab.isNewTab = false;
    tab.url = url;
    tab.webview = createWebview(tab.id, url);
    newTabPage.style.display = 'none';
    tab.webview.classList.add('active');
  } else if (tab.webview) {
    tab.webview.loadURL(url);
  }

  urlBar.value = url;
}

function updateNavButtons() {
  const tab = tabMap.get(activeTabId);
  if (!tab || !tab.webview) {
    btnBack.disabled = true;
    btnForward.disabled = true;
    return;
  }

  try {
    btnBack.disabled = !tab.webview.canGoBack();
    btnForward.disabled = !tab.webview.canGoForward();
  } catch (e) {
    btnBack.disabled = true;
    btnForward.disabled = true;
  }
}

// ==========================================
// History
// ==========================================

const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');
const historySearch = document.getElementById('history-search');
const historyCloseBtn = document.getElementById('history-close');
const historyClearBtn = document.getElementById('history-clear-btn');
const historyBtn = document.getElementById('btn-history');

function recordHistory(url, title) {
  if (!url || url === 'slime://newtab' || url.startsWith('devtools://')) return;
  window.slime.historyAdd({ url, title: title || url });
}

async function loadHistoryPanel(query = '') {
  const items = await window.slime.historyGet(query);
  historyList.innerHTML = '';

  if (items.length === 0) {
    historyList.innerHTML = '<div class="panel-empty">No history found</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'panel-item';
    const time = new Date(item.timestamp);
    const timeStr = time.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
                    time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    let domain = '';
    try { domain = new URL(item.url).hostname; } catch(e) { domain = item.url; }

    el.innerHTML = `
      <div class="panel-item-icon">${escapeHtml((item.title || '?').charAt(0).toUpperCase())}</div>
      <div class="panel-item-info">
        <div class="panel-item-title">${escapeHtml(item.title || item.url)}</div>
        <div class="panel-item-url">${escapeHtml(domain)}</div>
      </div>
      <div class="panel-item-time">${timeStr}</div>
    `;
    el.addEventListener('click', () => {
      navigate(item.url);
      historyPanel.style.display = 'none';
    });
    fragment.appendChild(el);
  });
  historyList.appendChild(fragment);
}

historyBtn.addEventListener('click', () => {
  closeAllPanels();
  const isVisible = historyPanel.style.display !== 'none';
  historyPanel.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible) {
    historySearch.value = '';
    loadHistoryPanel();
  }
});

historyCloseBtn.addEventListener('click', () => {
  historyPanel.style.display = 'none';
});

let historySearchTimeout;
historySearch.addEventListener('input', () => {
  clearTimeout(historySearchTimeout);
  historySearchTimeout = setTimeout(() => loadHistoryPanel(historySearch.value), 300);
});

historyClearBtn.addEventListener('click', () => {
  window.slime.historyClear();
  loadHistoryPanel();
});

// ==========================================
// Bookmarks
// ==========================================

const bookmarkBtn = document.getElementById('btn-bookmark');
const bookmarksPanelBtn = document.getElementById('btn-bookmarks-panel');
const bookmarksPanel = document.getElementById('bookmarks-panel');
const bookmarksList = document.getElementById('bookmarks-list');
const bookmarksSearch = document.getElementById('bookmarks-search');
const bookmarksCloseBtn = document.getElementById('bookmarks-close');

let _lastBookmarkCheckUrl = null;
let _lastBookmarkCheckResult = false;

async function updateBookmarkButton() {
  const tab = tabMap.get(activeTabId);
  if (!tab || tab.isNewTab || !tab.url) {
    bookmarkBtn.classList.remove('bookmarked');
    _lastBookmarkCheckUrl = null;
    return;
  }
  // Skip redundant IPC call if URL hasn't changed
  if (tab.url === _lastBookmarkCheckUrl) {
    bookmarkBtn.classList.toggle('bookmarked', _lastBookmarkCheckResult);
    return;
  }
  const isBookmarked = await window.slime.bookmarksCheck(tab.url);
  _lastBookmarkCheckUrl = tab.url;
  _lastBookmarkCheckResult = isBookmarked;
  bookmarkBtn.classList.toggle('bookmarked', isBookmarked);
}

bookmarkBtn.addEventListener('click', async () => {
  const tab = tabMap.get(activeTabId);
  if (!tab || tab.isNewTab || !tab.url) return;

  const isBookmarked = await window.slime.bookmarksCheck(tab.url);
  if (isBookmarked) {
    await window.slime.bookmarksRemove(tab.url);
  } else {
    await window.slime.bookmarksAdd({ url: tab.url, title: tab.title || tab.url });
  }
  _lastBookmarkCheckUrl = null; // Invalidate cache
  updateBookmarkButton();
});

async function loadBookmarksPanel(query = '') {
  let bookmarks = await window.slime.bookmarksGet();

  if (query) {
    const q = query.toLowerCase();
    bookmarks = bookmarks.filter(b =>
      b.url.toLowerCase().includes(q) ||
      (b.title && b.title.toLowerCase().includes(q))
    );
  }

  bookmarksList.innerHTML = '';

  if (bookmarks.length === 0) {
    bookmarksList.innerHTML = '<div class="panel-empty">No bookmarks yet</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  bookmarks.forEach(item => {
    const el = document.createElement('div');
    el.className = 'panel-item';

    let domain = '';
    try { domain = new URL(item.url).hostname; } catch(e) { domain = item.url; }

    el.innerHTML = `
      <div class="panel-item-icon">${escapeHtml((item.title || '?').charAt(0).toUpperCase())}</div>
      <div class="panel-item-info">
        <div class="panel-item-title">${escapeHtml(item.title || item.url)}</div>
        <div class="panel-item-url">${escapeHtml(domain)}</div>
      </div>
      <button class="panel-item-delete" title="Remove">&times;</button>
    `;

    el.querySelector('.panel-item-info').addEventListener('click', () => {
      navigate(item.url);
      bookmarksPanel.style.display = 'none';
    });

    el.querySelector('.panel-item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.slime.bookmarksRemove(item.url);
      _lastBookmarkCheckUrl = null; // Invalidate cache
      loadBookmarksPanel(bookmarksSearch.value);
      updateBookmarkButton();
    });

    fragment.appendChild(el);
  });
  bookmarksList.appendChild(fragment);
}

bookmarksPanelBtn.addEventListener('click', () => {
  closeAllPanels();
  const isVisible = bookmarksPanel.style.display !== 'none';
  bookmarksPanel.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible) {
    bookmarksSearch.value = '';
    loadBookmarksPanel();
  }
});

bookmarksCloseBtn.addEventListener('click', () => {
  bookmarksPanel.style.display = 'none';
});

let bookmarksSearchTimeout;
bookmarksSearch.addEventListener('input', () => {
  clearTimeout(bookmarksSearchTimeout);
  bookmarksSearchTimeout = setTimeout(() => loadBookmarksPanel(bookmarksSearch.value), 300);
});

// ==========================================
// Downloads
// ==========================================

const downloadsBtn = document.getElementById('btn-downloads');
const downloadsPanel = document.getElementById('downloads-panel');
const downloadsList = document.getElementById('downloads-list');
const downloadsCloseBtn = document.getElementById('downloads-close');
const downloadBadge = document.getElementById('download-badge');
const activeDownloads = new Map();

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function renderDownloadItem(dl) {
  let el = document.getElementById(`download-${dl.id}`);
  const isNew = !el;

  if (isNew) {
    el = document.createElement('div');
    el.id = `download-${dl.id}`;
    downloadsList.prepend(el);
  }

  const progress = Math.min(100, dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0);
  const state = dl.state || 'progressing';

  // If element already exists and download is still progressing, only update progress bar and status text
  if (!isNew && state === 'progressing') {
    el.className = `download-item ${state}`;
    const statusEl = el.querySelector('.download-item-status');
    if (statusEl) {
      statusEl.textContent = `${formatBytes(dl.receivedBytes || 0)} / ${formatBytes(dl.totalBytes || 0)} - ${progress}%`;
    }
    const progressBar = el.querySelector('.download-progress-bar');
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }
    return;
  }

  el.className = `download-item ${state}`;

  let statusText = '';
  let actionsHtml = '';

  if (state === 'progressing') {
    statusText = `${formatBytes(dl.receivedBytes || 0)} / ${formatBytes(dl.totalBytes || 0)} - ${progress}%`;
  } else if (state === 'completed') {
    statusText = `${formatBytes(dl.totalBytes || dl.receivedBytes || 0)} - Complete`;
    actionsHtml = `
      <button class="download-action-btn" data-action="open">Open</button>
      <button class="download-action-btn" data-action="show">Show in Folder</button>
    `;
  } else {
    statusText = 'Failed';
  }

  el.innerHTML = `
    <div class="download-item-header">
      <div class="download-item-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 12h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="download-item-info">
        <div class="download-item-name">${escapeHtml(dl.filename || 'Unknown')}</div>
        <div class="download-item-status">${statusText}</div>
      </div>
    </div>
    ${state === 'progressing' ? `<div class="download-progress"><div class="download-progress-bar" style="width:${progress}%"></div></div>` : ''}
    ${actionsHtml ? `<div class="download-actions">${actionsHtml}</div>` : ''}
  `;

  el.querySelectorAll('.download-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'open') window.slime.downloadOpen(dl.path);
      if (btn.dataset.action === 'show') window.slime.downloadShow(dl.path);
    });
  });
}

function showDownloadEmpty() {
  if (downloadsList.children.length === 0) {
    downloadsList.innerHTML = '<div class="panel-empty">No downloads yet</div>';
  }
}

window.slime.onDownloadStarted((dl) => {
  activeDownloads.set(dl.id, dl);
  const empty = downloadsList.querySelector('.panel-empty');
  if (empty) empty.remove();
  renderDownloadItem(dl);
  closeAllPanels();
  downloadsPanel.style.display = 'flex';
  downloadBadge.classList.add('active');
});

window.slime.onDownloadUpdated((dl) => {
  const existing = activeDownloads.get(dl.id) || {};
  Object.assign(existing, dl);
  activeDownloads.set(dl.id, existing);
  renderDownloadItem(existing);
});

window.slime.onDownloadDone((dl) => {
  const existing = activeDownloads.get(dl.id) || {};
  Object.assign(existing, dl);
  activeDownloads.set(dl.id, existing);
  renderDownloadItem(existing);
  // Hide badge if no active downloads
  let hasActive = false;
  activeDownloads.forEach(d => { if (d.state === 'progressing') hasActive = true; });
  if (!hasActive) downloadBadge.classList.remove('active');
});

downloadsBtn.addEventListener('click', () => {
  closeAllPanels();
  const isVisible = downloadsPanel.style.display !== 'none';
  downloadsPanel.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible) showDownloadEmpty();
});

downloadsCloseBtn.addEventListener('click', () => {
  downloadsPanel.style.display = 'none';
});

// ==========================================
// Passwords
// ==========================================

const passwordBar = document.getElementById('password-bar');
const passwordBarText = document.getElementById('password-bar-text');
const passwordBarSave = document.getElementById('password-bar-save');
const passwordBarDismiss = document.getElementById('password-bar-dismiss');
const passwordsBtn = document.getElementById('btn-passwords');
const passwordsPanel = document.getElementById('passwords-panel');
const passwordsList = document.getElementById('passwords-list');
const passwordsSearch = document.getElementById('passwords-search');
const passwordsCloseBtn = document.getElementById('passwords-close');
let pendingPassword = null;
let passwordBarTimeout = null;

// Password capture script — injected into webviews via executeJavaScript
const PASSWORD_CAPTURE_SCRIPT = `
(function() {
  if (window.__slimePasswordSetup) return;
  window.__slimePasswordSetup = true;

  function findLoginForms() {
    const forms = document.querySelectorAll('form');
    const results = [];
    forms.forEach(form => {
      const passInput = form.querySelector('input[type="password"]');
      if (!passInput) return;
      const userInput = form.querySelector(
        'input[type="email"], input[name="email"], input[name="username"], ' +
        'input[name="login"], input[name="user"], input[name="userid"], ' +
        'input[autocomplete="username"], input[autocomplete="email"], ' +
        'input[type="text"]'
      );
      if (userInput) results.push({ form, userInput, passInput });
    });
    return results;
  }

  function captureCredentials(userInput, passInput) {
    const username = userInput.value.trim();
    const password = passInput.value;
    if (username && password) {
      console.log('__SLIME_PW__' + JSON.stringify({
        url: location.origin,
        username: username,
        password: password,
        title: document.title
      }));
    }
  }

  function setup() {
    const forms = findLoginForms();
    forms.forEach(({ form, userInput, passInput }) => {
      if (form.__slimePwBound) return;
      form.__slimePwBound = true;

      form.addEventListener('submit', () => captureCredentials(userInput, passInput));
      passInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') captureCredentials(userInput, passInput);
      });
    });
    // Signal that forms exist
    if (forms.length > 0) {
      console.log('__SLIME_PW_FORMS__' + location.origin);
    }
  }

  setup();
  // Re-scan periodically for SPAs
  const obs = new MutationObserver(() => setTimeout(setup, 500));
  obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
`;

// Autofill script generator
function makeAutofillScript(username, password) {
  const u = JSON.stringify(username);
  const p = JSON.stringify(password);
  return `
  (function() {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      const passInput = form.querySelector('input[type="password"]');
      if (!passInput) return;
      const userInput = form.querySelector(
        'input[type="email"], input[name="email"], input[name="username"], ' +
        'input[name="login"], input[name="user"], input[name="userid"], ' +
        'input[autocomplete="username"], input[autocomplete="email"], ' +
        'input[type="text"]'
      );
      if (!userInput) return;

      function setVal(el, val) {
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setVal(userInput, ${u});
      setVal(passInput, ${p});
    });
  })();
  `;
}

function checkPasswordAutofill(webview) {
  // Inject capture script
  try {
    webview.executeJavaScript(PASSWORD_CAPTURE_SCRIPT);
  } catch (e) { console.warn('[Slime]', e.message || e); }

  // Try autofill with saved credentials (HTTPS only)
  const url = webview.getURL();
  if (url && url.startsWith('https://')) {
    window.slime.passwordsFind(url).then(matches => {
      if (matches.length > 0) {
        const cred = matches[0];
        try {
          webview.executeJavaScript(makeAutofillScript(cred.username, cred.password));
        } catch (e) {
          console.warn('[Slime] Autofill error:', e.message || e);
        }
      }
    }).catch(e => console.warn('[Slime] Autofill error:', e));
  }
}

function setupPasswordCapture(webview, tabId) {
  // Listen for password captures via console messages
  webview.addEventListener('console-message', (e) => {
    if (e.message && e.message.startsWith('__SLIME_PW__')) {
      try {
        const data = JSON.parse(e.message.substring(12));
        // Check if we already have this exact credential saved
        window.slime.passwordsFind(data.url).then(existing => {
          const alreadySaved = existing.some(p => p.username === data.username && p.password === data.password);
          if (alreadySaved) return;

          pendingPassword = data;
          let domain = '';
          try { domain = new URL(data.url).hostname; } catch(e) { domain = data.url; }
          passwordBarText.textContent = `Login speichern? ${data.username} auf ${domain}`;
          passwordBar.style.display = 'flex';
          clearTimeout(passwordBarTimeout);
          passwordBarTimeout = setTimeout(() => { passwordBar.style.display = 'none'; }, 15000);
        });
      } catch (err) { console.warn('[Slime]', err.message || err); }
    }
  });

  // Also re-inject capture script on in-page navigation (SPAs)
  webview.addEventListener('did-navigate-in-page', () => {
    try { webview.executeJavaScript(PASSWORD_CAPTURE_SCRIPT); } catch(e) { console.warn('[Slime]', e.message || e); }
  });
}

passwordBarSave.addEventListener('click', () => {
  if (pendingPassword) {
    window.slime.passwordsSave(pendingPassword);
    pendingPassword = null;
  }
  passwordBar.style.display = 'none';
});

passwordBarDismiss.addEventListener('click', () => {
  pendingPassword = null;
  passwordBar.style.display = 'none';
});

// Passwords Panel
async function loadPasswordsPanel(query = '') {
  let passwords = await window.slime.passwordsGet();

  if (query) {
    const q = query.toLowerCase();
    passwords = passwords.filter(p =>
      p.url.toLowerCase().includes(q) ||
      p.username.toLowerCase().includes(q) ||
      (p.title && p.title.toLowerCase().includes(q))
    );
  }

  passwordsList.innerHTML = '';

  if (passwords.length === 0) {
    passwordsList.innerHTML = '<div class="panel-empty">No saved passwords</div>';
    return;
  }

  passwords.forEach(item => {
    const el = document.createElement('div');
    el.className = 'panel-item';

    let domain = '';
    try { domain = new URL(item.url).hostname; } catch(e) { domain = item.url; }

    el.innerHTML = `
      <div class="panel-item-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </div>
      <div class="panel-item-info">
        <div class="panel-item-title">${escapeHtml(item.username)}</div>
        <div class="panel-item-url">${escapeHtml(domain)}</div>
      </div>
      <button class="panel-item-copy" title="Copy password">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" stroke-width="1.2"/></svg>
      </button>
      <button class="panel-item-delete" title="Remove">&times;</button>
    `;

    el.querySelector('.panel-item-info').addEventListener('click', () => {
      navigate(item.url);
      passwordsPanel.style.display = 'none';
    });

    el.querySelector('.panel-item-copy').addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(item.password);
      el.querySelector('.panel-item-copy').title = 'Copied!';
      setTimeout(() => { el.querySelector('.panel-item-copy').title = 'Copy password'; }, 2000);
    });

    el.querySelector('.panel-item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.slime.passwordsRemove({ url: item.url, username: item.username });
      loadPasswordsPanel(passwordsSearch.value);
    });

    passwordsList.appendChild(el);
  });
}

passwordsBtn.addEventListener('click', () => {
  closeAllPanels();
  const isVisible = passwordsPanel.style.display !== 'none';
  passwordsPanel.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible) {
    passwordsSearch.value = '';
    loadPasswordsPanel();
  }
});

passwordsCloseBtn.addEventListener('click', () => {
  passwordsPanel.style.display = 'none';
});

let passwordsSearchTimeout;
passwordsSearch.addEventListener('input', () => {
  clearTimeout(passwordsSearchTimeout);
  passwordsSearchTimeout = setTimeout(() => loadPasswordsPanel(passwordsSearch.value), 300);
});

// ==========================================
// Settings
// ==========================================

const settingsPage = document.getElementById('settings-page');
const settingsBtn = document.getElementById('btn-settings');
const settingSearchEngine = document.getElementById('setting-search-engine');
const settingCustomSearch = document.getElementById('setting-custom-search');
const customSearchGroup = document.getElementById('custom-search-group');
const settingHomepage = document.getElementById('setting-homepage');
const settingRestoreTabs = document.getElementById('setting-restore-tabs');
const settingZoom = document.getElementById('setting-zoom');
const settingAdblocker = document.getElementById('setting-adblocker');
const settingGlass = document.getElementById('setting-glass');
const settingAccentCustom = document.getElementById('setting-accent-custom');
const colorSwatches = document.querySelectorAll('.color-swatch');
const settingBgCustom = document.getElementById('setting-bg-custom');
const settingBgOpacity = document.getElementById('setting-bg-opacity');
const opacityValue = document.getElementById('opacity-value');
const bgSwatches = document.querySelectorAll('.bg-swatch');

async function loadSettings() {
  currentSettings = await window.slime.settingsGet();
  applySettings(currentSettings);
  populateSettingsUI(currentSettings);
}

function isValidHex(hex) {
  return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex);
}

function applySettings(s) {
  if (s.searchEngine === 'custom' && s.customSearchUrl) {
    SEARCH_ENGINE = s.customSearchUrl.replace('%s', '');
  } else {
    SEARCH_ENGINE = SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.google;
  }

  // Accent color (validated)
  const accent = isValidHex(s.accentColor) ? s.accentColor : '#4ade80';
  document.documentElement.style.setProperty('--accent', accent);
  // Generate soft/medium variants from hex
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  document.documentElement.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.12)`);
  document.documentElement.style.setProperty('--accent-medium', `rgba(${r}, ${g}, ${b}, 0.25)`);

  // Background color with opacity (validated)
  const bgHex = isValidHex(s.bgColor) ? s.bgColor : '#0c0c0c';
  const bgOpacity = Math.max(0.3, Math.min(1, (s.bgOpacity != null ? s.bgOpacity : 100) / 100));
  const br = parseInt(bgHex.slice(1, 3), 16);
  const bg2 = parseInt(bgHex.slice(3, 5), 16);
  const bb = parseInt(bgHex.slice(5, 7), 16);
  document.documentElement.style.setProperty('--bg-base', `rgba(${br}, ${bg2}, ${bb}, ${bgOpacity})`);
  // Surface = slightly lighter
  document.documentElement.style.setProperty('--bg-surface', `rgba(${Math.min(br+8,255)}, ${Math.min(bg2+8,255)}, ${Math.min(bb+8,255)}, ${bgOpacity})`);
  document.documentElement.style.setProperty('--bg-elevated', `rgba(${Math.min(br+16,255)}, ${Math.min(bg2+16,255)}, ${Math.min(bb+16,255)}, ${bgOpacity})`);
  document.documentElement.style.setProperty('--bg-hover', `rgba(${Math.min(br+25,255)}, ${Math.min(bg2+25,255)}, ${Math.min(bb+25,255)}, ${Math.min(bgOpacity+0.1,1)})`);
  document.documentElement.style.setProperty('--bg-active', `rgba(${Math.min(br+30,255)}, ${Math.min(bg2+30,255)}, ${Math.min(bb+30,255)}, ${Math.min(bgOpacity+0.1,1)})`);

  // Hue-rotate the logo icon to match accent color
  const hue = hexToHue(accent);
  // Base icon is green (~120deg hue), rotate relative to that
  const rotation = hue - 120;
  document.documentElement.style.setProperty('--logo-hue', `${rotation}deg`);

  // Glass morphism
  document.body.classList.toggle('glass-mode', !!s.glassMorphism);
}

function populateSettingsUI(s) {
  settingSearchEngine.value = s.searchEngine;
  settingCustomSearch.value = s.customSearchUrl || '';
  customSearchGroup.style.display = s.searchEngine === 'custom' ? 'block' : 'none';
  settingHomepage.value = s.homepage;
  settingRestoreTabs.checked = s.restoreTabs;
  settingZoom.value = String(s.zoomLevel);
  settingAdblocker.checked = s.adblockerEnabled;
  settingGlass.checked = !!s.glassMorphism;

  // Accent color swatches
  const accent = s.accentColor || '#4ade80';
  settingAccentCustom.value = accent;
  colorSwatches.forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === accent);
  });

  // Background color swatches
  const bgColor = s.bgColor || '#0c0c0c';
  settingBgCustom.value = bgColor;
  bgSwatches.forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === bgColor);
  });

  // Opacity slider
  const opacity = s.bgOpacity != null ? s.bgOpacity : 100;
  settingBgOpacity.value = opacity;
  opacityValue.textContent = opacity + '%';
}

async function saveSetting(key, value) {
  currentSettings[key] = value;
  currentSettings = await window.slime.settingsSave(currentSettings);
  applySettings(currentSettings);
}

function showSettings() {
  document.querySelectorAll('webview').forEach(wv => wv.classList.remove('active'));
  newTabPage.style.display = 'none';
  settingsPage.style.display = 'block';
  urlBar.value = 'slime://settings';
}

function hideSettings() {
  settingsPage.style.display = 'none';
}

settingsBtn.addEventListener('click', () => {
  if (settingsPage.style.display === 'block') {
    hideSettings();
    const tab = tabMap.get(activeTabId);
    if (tab) {
      if (tab.isNewTab) {
        newTabPage.style.display = 'flex';
      } else if (tab.webview) {
        tab.webview.classList.add('active');
        urlBar.value = tab.url;
      }
    }
  } else {
    showSettings();
  }
});

settingSearchEngine.addEventListener('change', () => {
  customSearchGroup.style.display = settingSearchEngine.value === 'custom' ? 'block' : 'none';
  saveSetting('searchEngine', settingSearchEngine.value);
});
settingCustomSearch.addEventListener('change', () => saveSetting('customSearchUrl', settingCustomSearch.value));
settingHomepage.addEventListener('change', () => saveSetting('homepage', settingHomepage.value));
settingRestoreTabs.addEventListener('change', () => saveSetting('restoreTabs', settingRestoreTabs.checked));
settingZoom.addEventListener('change', () => saveSetting('zoomLevel', parseInt(settingZoom.value)));
settingAdblocker.addEventListener('change', () => saveSetting('adblockerEnabled', settingAdblocker.checked));
settingGlass.addEventListener('change', () => saveSetting('glassMorphism', settingGlass.checked));

// Color swatches
colorSwatches.forEach(sw => {
  sw.addEventListener('click', () => {
    const color = sw.dataset.color;
    saveSetting('accentColor', color);
    settingAccentCustom.value = color;
    colorSwatches.forEach(s => s.classList.toggle('active', s.dataset.color === color));
  });
});

// Custom color picker
settingAccentCustom.addEventListener('input', () => {
  const color = settingAccentCustom.value;
  saveSetting('accentColor', color);
  colorSwatches.forEach(s => s.classList.remove('active'));
});

// Background swatches
bgSwatches.forEach(sw => {
  sw.addEventListener('click', () => {
    const color = sw.dataset.color;
    saveSetting('bgColor', color);
    settingBgCustom.value = color;
    bgSwatches.forEach(s => s.classList.toggle('active', s.dataset.color === color));
  });
});

// Custom background color picker
settingBgCustom.addEventListener('input', () => {
  const color = settingBgCustom.value;
  saveSetting('bgColor', color);
  bgSwatches.forEach(s => s.classList.remove('active'));
});

// Opacity slider
settingBgOpacity.addEventListener('input', () => {
  const val = parseInt(settingBgOpacity.value);
  opacityValue.textContent = val + '%';
  saveSetting('bgOpacity', val);
});

// ==========================================
// Session Restore
// ==========================================

function getSessionData() {
  return tabs
    .filter(t => !t.isNewTab && t.url)
    .map(t => ({ url: t.url, title: t.title }));
}

// Debounced session save — prevents rapid successive calls
let _sessionSaveTimer = null;
function debouncedSessionSave() {
  if (_sessionSaveTimer) clearTimeout(_sessionSaveTimer);
  _sessionSaveTimer = setTimeout(() => {
    window.slime.saveSession(getSessionData());
    _sessionSaveTimer = null;
  }, 2000);
}

// Auto-save session every 30 seconds
setInterval(() => {
  debouncedSessionSave();
}, 30000);

window.addEventListener('beforeunload', () => {
  // On close, save immediately (no debounce)
  window.slime.saveSession(getSessionData());
});

// ==========================================
// Sidebar Pin
// ==========================================

const sidebar = document.getElementById('sidebar');
const pinBtn = document.getElementById('btn-pin-sidebar');

pinBtn.addEventListener('click', () => {
  const isPinned = sidebar.classList.toggle('pinned');
  pinBtn.classList.toggle('pinned', isPinned);
  document.body.classList.toggle('sidebar-pinned', isPinned);
  pinBtn.title = isPinned ? 'Unpin sidebar' : 'Pin sidebar';
  saveSetting('sidebarPinned', isPinned);
});

// ==========================================
// Macros
// ==========================================

const macrosBtn = document.getElementById('macros-btn');
const macrosPanel = document.getElementById('macros-panel');
const macrosList = document.getElementById('macros-list');
const macrosCloseBtn = document.getElementById('macros-panel-close');
const macrosAddBtn = document.getElementById('macro-create-btn');

// Safely serialize a CSS selector for use inside executeJavaScript strings.
// Returns a JS string literal (with quotes) that can be embedded directly.
function safeSelector(selector) {
  return JSON.stringify(String(selector));
}

// Dismiss common cookie/popup overlays in the page
const DISMISS_POPUPS_SCRIPT = `
(function() {
  const selectors = [
    '[class*="cookie"] button',
    '[class*="consent"] button',
    '[id*="cookie"] button',
    '[id*="consent"] button',
    '[class*="Cookie"] button',
    '[class*="Consent"] button',
    'button[class*="accept"]',
    'button[class*="Accept"]',
    'button[id*="accept"]',
    'a[class*="accept"]',
    '[class*="popup"] button[class*="close"]',
    '[class*="modal"] button[class*="close"]',
    '[class*="overlay"] button[class*="close"]',
    '[class*="banner"] button[class*="close"]',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    '[aria-label="Dismiss"]',
  ];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    els.forEach(el => {
      if (el.offsetParent !== null) el.click();
    });
  }
})();
`;

const MacroRunner = {
  running: false,
  currentStep: 0,
  statusEl: null,

  createStatusBar() {
    if (this.statusEl) return;
    const bar = document.createElement('div');
    bar.id = 'macro-status-bar';
    bar.innerHTML = `
      <span id="macro-status-text"></span>
      <button id="macro-status-stop">Stop</button>
    `;
    document.getElementById('main').appendChild(bar);
    this.statusEl = bar;
    bar.querySelector('#macro-status-stop').addEventListener('click', () => this.stop());
  },

  updateStatus(name, step, total, error) {
    this.createStatusBar();
    const text = this.statusEl.querySelector('#macro-status-text');
    if (error) {
      text.textContent = `Error in "${name}" at step ${step}/${total}: ${error}`;
      this.statusEl.classList.add('error');
    } else {
      text.textContent = `Running: ${name} — Step ${step}/${total}`;
      this.statusEl.classList.remove('error');
    }
    this.statusEl.style.display = 'flex';
  },

  hideStatus() {
    if (this.statusEl) {
      setTimeout(() => {
        if (!this.running && this.statusEl) {
          this.statusEl.style.display = 'none';
        }
      }, 2000);
    }
  },

  async run(macro, webview) {
    if (this.running) return; // Already running a macro
    if (!webview) {
      const tab = tabMap.get(activeTabId);
      if (!tab) return;
      // If it's a new tab, first step must be navigate — we'll create webview on navigate
      webview = tab.webview;
    }
    this.running = true;
    this.currentStep = 0;

    for (let i = 0; i < macro.steps.length; i++) {
      if (!this.running) break;
      this.currentStep = i;
      this.updateStatus(macro.name, i + 1, macro.steps.length);
      try {
        webview = await this.executeStep(macro.steps[i], webview);
      } catch (err) {
        this.updateStatus(macro.name, i + 1, macro.steps.length, err.message || String(err));
        this.running = false;
        return;
      }
    }

    if (this.running) {
      this.updateStatus(macro.name, macro.steps.length, macro.steps.length);
    }
    this.running = false;
    this.hideStatus();
  },

  stop() {
    this.running = false;
    if (this.statusEl) {
      const text = this.statusEl.querySelector('#macro-status-text');
      text.textContent = 'Macro stopped.';
      this.hideStatus();
    }
  },

  async executeStep(step, webview) {
    switch (step.action) {
      case 'navigate': {
        // If we don't have a webview yet (new tab), create one
        if (!webview) {
          const tab = tabMap.get(activeTabId);
          if (tab && tab.isNewTab) {
            tab.isNewTab = false;
            tab.url = step.url;
            tab.webview = createWebview(tab.id, step.url);
            newTabPage.style.display = 'none';
            tab.webview.classList.add('active');
            webview = tab.webview;
            await new Promise(r => webview.addEventListener('did-finish-load', r, { once: true }));
            return webview;
          }
        }
        webview.loadURL(step.url);
        await new Promise(r => webview.addEventListener('did-finish-load', r, { once: true }));
        return webview;
      }
      case 'waitForElement': {
        await this.waitForEl(webview, step.selector, step.timeout || 10000);
        return webview;
      }
      case 'waitForNavigation': {
        await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(), step.timeout || 15000);
          webview.addEventListener('did-navigate', () => { clearTimeout(timeout); resolve(); }, { once: true });
        });
        return webview;
      }
      case 'wait': {
        await new Promise(r => setTimeout(r, step.ms || 1000));
        return webview;
      }
      case 'fill': {
        let value = step.value || '';
        if (step.usePassword) {
          const passwords = await window.slime.passwordsFind(webview.getURL());
          if (passwords.length > 0) value = passwords[0].password;
        }
        const fillSel = safeSelector(step.selector);
        const fillVal = JSON.stringify(value);
        await webview.executeJavaScript(`
          (() => {
            const el = document.querySelector(${fillSel});
            if (el) {
              el.focus();
              el.value = ${fillVal};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `);
        return webview;
      }
      case 'click': {
        const clickSel = safeSelector(step.selector);
        await webview.executeJavaScript(`
          (() => {
            const el = document.querySelector(${clickSel});
            if (el) el.click();
          })()
        `);
        return webview;
      }
      case 'clickText': {
        const searchText = JSON.stringify(step.text || '');
        const tag = JSON.stringify(step.tag || '');
        await webview.executeJavaScript(`
          (() => {
            const tag = ${tag} || 'a, button, [role="button"], input[type="button"], input[type="submit"], span, div';
            const els = document.querySelectorAll(tag);
            for (const el of els) {
              const t = (el.textContent || el.value || '').trim();
              if (t === ${searchText} || t.includes(${searchText})) {
                if (el.offsetParent !== null || getComputedStyle(el).display !== 'none') {
                  el.click();
                  return;
                }
              }
            }
          })()
        `);
        return webview;
      }
      case 'clickPosition': {
        const x = parseInt(step.x) || 0;
        const y = parseInt(step.y) || 0;
        await webview.executeJavaScript(`
          (() => {
            const el = document.elementFromPoint(${x}, ${y});
            if (el) {
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${x}, clientY: ${y} }));
            }
          })()
        `);
        return webview;
      }
      case 'check': {
        const checkSel = safeSelector(step.selector);
        await webview.executeJavaScript(`
          (() => {
            const el = document.querySelector(${checkSel});
            if (el && !el.checked) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `);
        return webview;
      }
      case 'select': {
        const selectSel = safeSelector(step.selector);
        const selectVal = JSON.stringify(step.value || '');
        await webview.executeJavaScript(`
          (() => {
            const el = document.querySelector(${selectSel});
            if (el) {
              el.value = ${selectVal};
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })()
        `);
        return webview;
      }
      case 'executeScript': {
        if (step.script) {
          await webview.executeJavaScript(step.script);
        }
        return webview;
      }
      case 'dismissPopups': {
        await webview.executeJavaScript(DISMISS_POPUPS_SCRIPT);
        return webview;
      }
      case 'keypress': {
        const key = JSON.stringify(step.key || 'Enter');
        const kpSel = step.selector ? safeSelector(step.selector) : null;
        const targetExpr = kpSel ? `document.querySelector(${kpSel}) || document.activeElement` : 'document.activeElement';
        await webview.executeJavaScript(`
          (() => {
            const target = ${targetExpr};
            if (target) {
              const opts = { key: ${key}, code: 'Key' + ${key}, bubbles: true, cancelable: true };
              target.dispatchEvent(new KeyboardEvent('keydown', opts));
              target.dispatchEvent(new KeyboardEvent('keypress', opts));
              target.dispatchEvent(new KeyboardEvent('keyup', opts));
            }
          })()
        `);
        return webview;
      }
      default:
        console.warn('[Slime] Unknown macro action:', step.action);
        return webview;
    }
  },

  async waitForEl(webview, selector, timeout) {
    const sel = safeSelector(selector);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!this.running) throw new Error('Macro cancelled');
      const found = await webview.executeJavaScript(
        `!!document.querySelector(${sel})`
      );
      if (found) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Timeout waiting for element: ${selector}`);
  },
};

// Macros Panel
async function loadMacrosPanel() {
  const macros = await window.slime.macros.get();
  macrosList.innerHTML = '';

  if (macros.length === 0) {
    macrosList.innerHTML = '<div class="panel-empty">No macros yet. Click + to create one.</div>';
    return;
  }

  macros.forEach(macro => {
    const el = document.createElement('div');
    el.className = 'panel-item';
    el.innerHTML = `
      <div class="panel-item-icon macro-icon">${escapeHtml(macro.icon || '>')}</div>
      <div class="panel-item-info">
        <div class="panel-item-title">${escapeHtml(macro.name)}</div>
        <div class="panel-item-url">${macro.steps.length} step${macro.steps.length !== 1 ? 's' : ''}</div>
      </div>
      <button class="panel-item-play macro-play-btn" title="Run macro">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg>
      </button>
      <button class="panel-item-edit macro-edit-btn" title="Edit macro">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
      </button>
      <button class="panel-item-delete" title="Delete macro">&times;</button>
    `;

    el.querySelector('.macro-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const tab = tabMap.get(activeTabId);
      if (!tab) return;
      macrosPanel.style.display = 'none';
      MacroRunner.run(macro, tab.webview);
    });

    el.querySelector('.macro-edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openMacroEditor(macro);
    });

    el.querySelector('.panel-item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      const allMacros = await window.slime.macros.get();
      const filtered = allMacros.filter(m => m.id !== macro.id);
      await window.slime.macros.save(filtered);
      loadMacrosPanel();
    });

    macrosList.appendChild(el);
  });
}

// Macro Editor — uses the existing #macro-editor-modal in index.html
const macroEditorModal = document.getElementById('macro-editor-modal');
const macroEditorTitle = document.getElementById('macro-editor-title');
const macroNameInput = document.getElementById('macro-name-input');
const macroIconInput = document.getElementById('macro-icon-input');
const macroStepsContainer = document.getElementById('macro-steps-container');
const macroAddStepBtn = document.getElementById('macro-add-step-btn');
const macroEditorCloseBtn = document.getElementById('macro-editor-close');
const macroEditorCancelBtn = document.getElementById('macro-editor-cancel');
const macroEditorSaveBtn = document.getElementById('macro-editor-save');

let _editingMacro = null;

function openMacroEditor(existingMacro) {
  const isEdit = !!existingMacro;
  _editingMacro = existingMacro ? JSON.parse(JSON.stringify(existingMacro)) : {
    id: 'macro-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8),
    name: '',
    icon: '>',
    steps: [],
    createdAt: Date.now(),
  };

  macroEditorTitle.textContent = isEdit ? 'Edit Macro' : 'New Macro';
  macroNameInput.value = _editingMacro.name;
  macroIconInput.value = _editingMacro.icon;
  macroEditorModal.style.display = 'flex';

  renderMacroSteps();
}

function closeMacroEditor() {
  macroEditorModal.style.display = 'none';
  _editingMacro = null;
}

function renderMacroSteps() {
  macroStepsContainer.innerHTML = '';
  if (!_editingMacro) return;

  _editingMacro.steps.forEach((step, idx) => {
    const stepEl = document.createElement('div');
    stepEl.className = 'macro-step-row';
    stepEl.innerHTML = `
      <span class="macro-step-num">${idx + 1}</span>
      <select class="macro-step-action settings-select" style="width:130px;">
        <option value="navigate" ${step.action === 'navigate' ? 'selected' : ''}>navigate</option>
        <option value="waitForElement" ${step.action === 'waitForElement' ? 'selected' : ''}>waitForElement</option>
        <option value="waitForNavigation" ${step.action === 'waitForNavigation' ? 'selected' : ''}>waitForNavigation</option>
        <option value="wait" ${step.action === 'wait' ? 'selected' : ''}>wait</option>
        <option value="fill" ${step.action === 'fill' ? 'selected' : ''}>fill</option>
        <option value="click" ${step.action === 'click' ? 'selected' : ''}>click</option>
        <option value="clickText" ${step.action === 'clickText' ? 'selected' : ''}>clickText</option>
        <option value="clickPosition" ${step.action === 'clickPosition' ? 'selected' : ''}>clickPosition</option>
        <option value="check" ${step.action === 'check' ? 'selected' : ''}>check</option>
        <option value="select" ${step.action === 'select' ? 'selected' : ''}>select</option>
        <option value="executeScript" ${step.action === 'executeScript' ? 'selected' : ''}>executeScript</option>
        <option value="dismissPopups" ${step.action === 'dismissPopups' ? 'selected' : ''}>dismissPopups</option>
        <option value="keypress" ${step.action === 'keypress' ? 'selected' : ''}>keypress</option>
      </select>
      <div class="macro-step-fields"></div>
      <button class="macro-step-remove" title="Remove step">&times;</button>
    `;

    // Drag & drop reordering
    stepEl.setAttribute('draggable', 'true');
    stepEl.dataset.stepIdx = idx;

    stepEl.querySelector('.macro-step-num').addEventListener('mousedown', () => {
      stepEl.classList.add('macro-step-dragging-ready');
    });

    stepEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
      stepEl.classList.add('macro-step-dragging');
      setTimeout(() => stepEl.style.opacity = '0.4', 0);
    });

    stepEl.addEventListener('dragend', () => {
      stepEl.style.opacity = '';
      stepEl.classList.remove('macro-step-dragging', 'macro-step-dragging-ready');
      macroStepsContainer.querySelectorAll('.macro-step-drop-above, .macro-step-drop-below').forEach(el => {
        el.classList.remove('macro-step-drop-above', 'macro-step-drop-below');
      });
    });

    stepEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = stepEl.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      stepEl.classList.toggle('macro-step-drop-above', e.clientY < mid);
      stepEl.classList.toggle('macro-step-drop-below', e.clientY >= mid);
    });

    stepEl.addEventListener('dragleave', () => {
      stepEl.classList.remove('macro-step-drop-above', 'macro-step-drop-below');
    });

    stepEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const rect = stepEl.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      let toIdx = parseInt(stepEl.dataset.stepIdx);
      if (e.clientY >= mid) toIdx++;
      if (fromIdx < toIdx) toIdx--;
      if (fromIdx !== toIdx) {
        const [moved] = _editingMacro.steps.splice(fromIdx, 1);
        _editingMacro.steps.splice(toIdx, 0, moved);
        renderMacroSteps();
      }
    });

    const actionSelect = stepEl.querySelector('.macro-step-action');
    actionSelect.addEventListener('change', () => {
      step.action = actionSelect.value;
      const keepKeys = ['action'];
      Object.keys(step).forEach(k => { if (!keepKeys.includes(k)) delete step[k]; });
      renderStepFields(step, stepEl.querySelector('.macro-step-fields'));
    });

    stepEl.querySelector('.macro-step-remove').addEventListener('click', () => {
      _editingMacro.steps.splice(idx, 1);
      renderMacroSteps();
    });

    macroStepsContainer.appendChild(stepEl);
    renderStepFields(step, stepEl.querySelector('.macro-step-fields'));
  });
}

function renderStepFields(step, container) {
  container.innerHTML = '';
  const makeInput = (key, placeholder, type) => {
    const inp = document.createElement('input');
    inp.type = type || 'text';
    inp.className = 'settings-input macro-step-input';
    inp.placeholder = placeholder;
    inp.value = step[key] || '';
    inp.addEventListener('input', () => {
      step[key] = type === 'number' ? (parseInt(inp.value) || 0) : inp.value;
    });
    container.appendChild(inp);
  };
  const makeCheckbox = (key, label) => {
    const wrap = document.createElement('label');
    wrap.className = 'macro-step-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!step[key];
    cb.addEventListener('change', () => { step[key] = cb.checked; });
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(' ' + label));
    container.appendChild(wrap);
  };

  switch (step.action) {
    case 'navigate':
      makeInput('url', 'URL', 'text');
      break;
    case 'waitForElement':
      makeInput('selector', 'CSS Selector', 'text');
      makeInput('timeout', 'Timeout (ms)', 'number');
      break;
    case 'waitForNavigation':
      makeInput('timeout', 'Timeout (ms)', 'number');
      break;
    case 'wait':
      makeInput('ms', 'Delay (ms)', 'number');
      break;
    case 'fill':
      makeInput('selector', 'CSS Selector', 'text');
      makeInput('value', 'Value', 'text');
      makeCheckbox('usePassword', 'Use password manager');
      break;
    case 'click':
      makeInput('selector', 'CSS Selector', 'text');
      break;
    case 'clickText':
      makeInput('text', 'Button text (e.g. Zum Postfach)', 'text');
      makeInput('tag', 'Element filter (optional, e.g. a, button)', 'text');
      break;
    case 'clickPosition':
      makeInput('x', 'X position (px)', 'number');
      makeInput('y', 'Y position (px)', 'number');
      break;
    case 'check':
      makeInput('selector', 'CSS Selector', 'text');
      break;
    case 'select':
      makeInput('selector', 'CSS Selector', 'text');
      makeInput('value', 'Option value', 'text');
      break;
    case 'executeScript':
      makeInput('script', 'JavaScript code', 'text');
      break;
    case 'dismissPopups':
      break;
    case 'keypress':
      makeInput('key', 'Key (e.g. Enter, Tab)', 'text');
      makeInput('selector', 'Target selector (optional)', 'text');
      break;
  }
}

if (macroAddStepBtn) {
  macroAddStepBtn.addEventListener('click', () => {
    if (!_editingMacro) return;
    _editingMacro.steps.push({ action: 'navigate' });
    renderMacroSteps();
    macroStepsContainer.scrollTop = macroStepsContainer.scrollHeight;
  });
}

if (macroEditorCloseBtn) {
  macroEditorCloseBtn.addEventListener('click', closeMacroEditor);
}
if (macroEditorCancelBtn) {
  macroEditorCancelBtn.addEventListener('click', closeMacroEditor);
}

let _savingMacro = false;
if (macroEditorSaveBtn) {
  macroEditorSaveBtn.addEventListener('click', async () => {
    if (_savingMacro) return;
    _savingMacro = true;
    try {
      if (!_editingMacro) return;
      _editingMacro.name = macroNameInput.value.trim() || 'Untitled Macro';
      _editingMacro.icon = macroIconInput.value.trim() || '>';
      const allMacros = await window.slime.macros.get();
      const idx = allMacros.findIndex(m => m.id === _editingMacro.id);
      if (idx >= 0) {
        allMacros[idx] = _editingMacro;
      } else {
        allMacros.push(_editingMacro);
      }
      await window.slime.macros.save(allMacros);
      closeMacroEditor();
      loadMacrosPanel();
    } finally {
      _savingMacro = false;
    }
  });
}

if (macrosBtn) {
  macrosBtn.addEventListener('click', () => {
    closeAllPanels();
    const isVisible = macrosPanel.style.display !== 'none';
    macrosPanel.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) loadMacrosPanel();
  });
}

if (macrosCloseBtn) {
  macrosCloseBtn.addEventListener('click', () => {
    macrosPanel.style.display = 'none';
  });
}

if (macrosAddBtn) {
  macrosAddBtn.addEventListener('click', () => {
    openMacroEditor(null);
  });
}

// ==========================================
// Panel Helpers
// ==========================================

function closeAllPanels() {
  historyPanel.style.display = 'none';
  bookmarksPanel.style.display = 'none';
  downloadsPanel.style.display = 'none';
  passwordsPanel.style.display = 'none';
  if (macrosPanel) macrosPanel.style.display = 'none';
}

// ==========================================
// Event Listeners
// ==========================================

// ==========================================
// URL Autocomplete
// ==========================================

let acItems = [];
let acIndex = -1;
let acDebounce = null;
let acCache = null; // { bookmarks, ts }

function acHighlight(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  const before = text.substring(0, idx);
  const match = text.substring(idx, idx + query.length);
  const after = text.substring(idx + query.length);
  return `${before}<span class="ac-match">${match}</span>${after}`;
}

async function acFetch(query) {
  if (!query || query.length < 1) return [];

  const [history, bookmarks] = await Promise.all([
    window.slime.historyGet(query),
    (acCache && Date.now() - acCache.ts < 30000)
      ? Promise.resolve(acCache.bookmarks)
      : window.slime.bookmarksGet().then(b => { acCache = { bookmarks: b, ts: Date.now() }; return b; })
  ]);

  const q = query.toLowerCase();
  const seen = new Set();
  const results = [];

  // Score and deduplicate bookmarks (priority)
  for (const b of bookmarks) {
    const url = b.url || '';
    const title = b.title || url;
    if (!url.toLowerCase().includes(q) && !title.toLowerCase().includes(q)) continue;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ url, title, type: 'bookmark', score: 100 });
  }

  // Score history entries
  for (const h of history) {
    const url = h.url || '';
    const title = h.title || url;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let score = 0;
    const urlLow = url.toLowerCase();
    const titleLow = title.toLowerCase();
    if (urlLow.startsWith('https://' + q) || urlLow.startsWith('http://' + q)) score += 50;
    else if (urlLow.includes('://' + q)) score += 40;
    else if (titleLow.startsWith(q)) score += 30;
    else if (urlLow.includes(q)) score += 20;
    else score += 10;
    results.push({ url, title, type: 'history', score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 8);
}

function acRender(query) {
  acDropdown.innerHTML = '';
  if (acItems.length === 0) {
    acHide();
    return;
  }

  const historyIcon = '<svg class="ac-item-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  const bookmarkIcon = '<svg class="ac-item-icon ac-bookmark" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a1 1 0 0 1 1 1v11.5l-5-3-5 3V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2" fill="currentColor" opacity="0.3"/></svg>';

  acItems.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'ac-item' + (i === acIndex ? ' selected' : '');
    el.setAttribute('role', 'option');
    el.innerHTML = `
      ${item.type === 'bookmark' ? bookmarkIcon : historyIcon}
      <div class="ac-item-text">
        <div class="ac-item-title">${acHighlight(item.title, query)}</div>
        <div class="ac-item-url">${acHighlight(item.url, query)}</div>
      </div>`;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      navigate(item.url);
      urlBar.blur();
    });
    el.addEventListener('mouseenter', () => {
      acIndex = i;
      acDropdown.querySelectorAll('.ac-item').forEach((el, j) => el.classList.toggle('selected', j === i));
    });
    acDropdown.appendChild(el);
  });

  acDropdown.classList.add('visible');
  urlBarContainer.classList.add('ac-open');
}

function acHide() {
  acDropdown.classList.remove('visible');
  urlBarContainer.classList.remove('ac-open');
  acDropdown.innerHTML = '';
  acItems = [];
  acIndex = -1;
}

function acScrollToSelected() {
  const selected = acDropdown.querySelector('.ac-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

urlBar.addEventListener('input', () => {
  clearTimeout(acDebounce);
  const query = urlBar.value.trim();
  if (!query) { acHide(); return; }
  acDebounce = setTimeout(async () => {
    acItems = await acFetch(query);
    acIndex = -1;
    acRender(query);
  }, 150);
});

urlBar.addEventListener('keydown', (e) => {
  if (acItems.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acIndex = Math.min(acIndex + 1, acItems.length - 1);
      acRender(urlBar.value.trim());
      acScrollToSelected();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      acIndex = Math.max(acIndex - 1, -1);
      acRender(urlBar.value.trim());
      acScrollToSelected();
      return;
    }
    if (e.key === 'Escape') {
      acHide();
      return;
    }
  }
  if (e.key === 'Enter') {
    const value = (acIndex >= 0 && acItems[acIndex]) ? acItems[acIndex].url : urlBar.value;
    acHide();
    navigate(value);
    urlBar.blur();
  }
});

urlBar.addEventListener('focus', () => urlBar.select());
urlBar.addEventListener('blur', () => { setTimeout(acHide, 100); });

ntpSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(ntpSearchInput.value);
    ntpSearchInput.value = '';
  }
});

document.querySelectorAll('.ntp-shortcut').forEach(el => {
  el.addEventListener('click', () => {
    navigate(el.dataset.url);
  });
});

btnBack.addEventListener('click', () => {
  const tab = tabMap.get(activeTabId);
  try { if (tab?.webview?.canGoBack()) tab.webview.goBack(); } catch(e) { console.warn('[Slime]', e.message || e); }
});

btnForward.addEventListener('click', () => {
  const tab = tabMap.get(activeTabId);
  try { if (tab?.webview?.canGoForward()) tab.webview.goForward(); } catch(e) { console.warn('[Slime]', e.message || e); }
});

btnReload.addEventListener('click', () => {
  const tab = tabMap.get(activeTabId);
  if (tab?.webview) {
    try {
      if (tab.webview.isLoading()) {
        tab.webview.stop();
      } else {
        tab.webview.reload();
      }
    } catch(e) { console.warn('[Slime]', e.message || e); }
  }
});

newTabBtn.addEventListener('click', () => createTab());

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 't') {
    e.preventDefault();
    createTab();
  }
  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault();
    if (activeTabId) closeTab(activeTabId);
  }
  if (e.ctrlKey && e.key === 'l') {
    e.preventDefault();
    urlBar.focus();
    urlBar.select();
  }
  if (e.ctrlKey && e.key === 'd') {
    e.preventDefault();
    bookmarkBtn.click();
  }
  if (e.key === 'F5') {
    e.preventDefault();
    const tab = tabMap.get(activeTabId);
    if (tab?.webview) tab.webview.reload();
  }
  if (e.altKey && e.key === 'ArrowLeft') {
    const tab = tabMap.get(activeTabId);
    try { if (tab?.webview?.canGoBack()) tab.webview.goBack(); } catch(ex) { console.warn('[Slime]', ex.message || ex); }
  }
  if (e.altKey && e.key === 'ArrowRight') {
    const tab = tabMap.get(activeTabId);
    try { if (tab?.webview?.canGoForward()) tab.webview.goForward(); } catch(ex) { console.warn('[Slime]', ex.message || ex); }
  }
  if (e.key === 'Escape') {
    closeAllPanels();
  }
});

// Close panels when clicking anywhere outside a panel
document.addEventListener('mousedown', (e) => {
  const clickedPanel = e.target.closest('.panel-overlay');
  const clickedSidebarBtn = e.target.closest('.sidebar-btn, #btn-bookmarks-panel, #btn-history, #btn-downloads, #btn-passwords, #macros-btn');
  if (!clickedPanel && !clickedSidebarBtn) {
    closeAllPanels();
  }
});

// Close panels when clicking on webview area
webviewContainer.addEventListener('mousedown', () => closeAllPanels(), true);
// Also catch when webview steals focus (e.g. clicking inside page content)
window.addEventListener('blur', () => closeAllPanels());

document.getElementById('btn-minimize').addEventListener('click', () => window.slime.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.slime.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.slime.close());

window.slime.onBlockedCountUpdated((count) => {
  blockedCountEl.textContent = count.toLocaleString();
});

// ==========================================
// Utilities
// ==========================================

function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  return h < 0 ? h + 360 : h;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==========================================
// Init
// ==========================================

async function init() {
  // Load webview preload path and settings
  webviewPreloadPath = await window.slime.getWebviewPreloadPath();
  await loadSettings();

  // Restore sidebar pinned state
  if (currentSettings?.sidebarPinned) {
    sidebar.classList.add('pinned');
    pinBtn.classList.add('pinned');
    document.body.classList.add('sidebar-pinned');
  }

  // Determine what to open
  const homepage = currentSettings?.homepage || DEFAULT_URL;
  let restored = false;

  if (currentSettings?.restoreTabs) {
    const sessionData = await window.slime.loadSession();
    if (sessionData && sessionData.length > 0) {
      sessionData.forEach(t => createTab(t.url));
      restored = true;
      // Fix tab ID collision: ensure counter is above any restored tab ID
      const maxId = Math.max(...tabs.map(t => t.id));
      if (maxId >= tabIdCounter) {
        tabIdCounter = maxId;
      }
    }
  }

  if (!restored) {
    createTab(homepage);
  }

  // Load existing downloads
  const dls = await window.slime.downloadsGet();
  dls.forEach(dl => {
    activeDownloads.set(dl.id, dl);
    renderDownloadItem(dl);
  });
  showDownloadEmpty();

  // Handle URLs opened from external apps (default browser)
  window.slime.onOpenUrl((url) => {
    createTab(url);
  });
}

init();
