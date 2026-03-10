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
  } catch (e) {}
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
  webview.dataset.tabId = tabId;

  webview.addEventListener('page-title-updated', (e) => {
    updateTabTitle(tabId, e.title);
  });

  webview.addEventListener('did-navigate', (e) => {
    updateTabUrl(tabId, e.url);
    updateTabFavicon(tabId, e.url);
    updateNavButtons();
    updateBookmarkButton();
    injectContentScripts(webview, e.url);
    // Record in history
    const wvTab = tabMap.get(tabId);
    recordHistory(e.url, wvTab?.title);
  });

  webview.addEventListener('page-favicon-updated', (e) => {
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
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) {
      updateTabUrl(tabId, e.url);
      updateNavButtons();
    }
  });

  webview.addEventListener('did-start-loading', () => {
    if (tabId === activeTabId) {
      btnReload.innerHTML = '&#x2715;';
      btnReload.title = 'Stop';
    }
  });

  webview.addEventListener('did-stop-loading', () => {
    if (tabId === activeTabId) {
      btnReload.innerHTML = '&#x21BB;';
      btnReload.title = 'Reload';
    }
  });

  webview.addEventListener('dom-ready', () => {
    injectContentScripts(webview, webview.getURL());
    checkPasswordAutofill(webview);
  });

  // Setup password capture listener
  setupPasswordCapture(webview, tabId);

  // Open links in new tab instead of popup — except auth flows
  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (!e.url || e.url === 'about:blank') return;

    // Auth flows (Google sign-in, OAuth) stay in same tab
    const isAuth = e.url.includes('accounts.google.com') ||
                   e.url.includes('signin') ||
                   e.url.includes('oauth') ||
                   e.url.includes('login') ||
                   e.url.includes('auth');
    if (isAuth) {
      webview.loadURL(e.url);
    } else {
      createTab(e.url);
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

  // Handle internal URLs
  if (url.toLowerCase() === 'slime://settings') {
    showSettings();
    return;
  }

  // Hide settings if navigating away
  hideSettings();

  if (url.match(/^https?:\/\//) || url.match(/^[\w-]+\.\w{2,}/)) {
    if (!url.match(/^https?:\/\//)) {
      url = 'https://' + url;
    }
  } else {
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

  const progress = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
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
  } catch (e) {}

  // Try autofill with saved credentials
  const url = webview.getURL();
  if (url) {
    window.slime.passwordsFind(url).then(matches => {
      if (matches.length > 0) {
        const cred = matches[0];
        try {
          webview.executeJavaScript(makeAutofillScript(cred.username, cred.password));
        } catch (e) {}
      }
    });
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
      } catch (err) {}
    }
  });

  // Also re-inject capture script on in-page navigation (SPAs)
  webview.addEventListener('did-navigate-in-page', () => {
    try { webview.executeJavaScript(PASSWORD_CAPTURE_SCRIPT); } catch(e) {}
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

async function loadSettings() {
  currentSettings = await window.slime.settingsGet();
  applySettings(currentSettings);
  populateSettingsUI(currentSettings);
}

function applySettings(s) {
  if (s.searchEngine === 'custom' && s.customSearchUrl) {
    SEARCH_ENGINE = s.customSearchUrl.replace('%s', '');
  } else {
    SEARCH_ENGINE = SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.google;
  }
}

function populateSettingsUI(s) {
  settingSearchEngine.value = s.searchEngine;
  settingCustomSearch.value = s.customSearchUrl || '';
  customSearchGroup.style.display = s.searchEngine === 'custom' ? 'block' : 'none';
  settingHomepage.value = s.homepage;
  settingRestoreTabs.checked = s.restoreTabs;
  settingZoom.value = String(s.zoomLevel);
  settingAdblocker.checked = s.adblockerEnabled;
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
});

// ==========================================
// Panel Helpers
// ==========================================

function closeAllPanels() {
  historyPanel.style.display = 'none';
  bookmarksPanel.style.display = 'none';
  downloadsPanel.style.display = 'none';
  passwordsPanel.style.display = 'none';
}

// ==========================================
// Event Listeners
// ==========================================

urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    navigate(urlBar.value);
    urlBar.blur();
  }
});

urlBar.addEventListener('focus', () => urlBar.select());

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
  try { if (tab?.webview?.canGoBack()) tab.webview.goBack(); } catch(e) {}
});

btnForward.addEventListener('click', () => {
  const tab = tabMap.get(activeTabId);
  try { if (tab?.webview?.canGoForward()) tab.webview.goForward(); } catch(e) {}
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
    } catch(e) {}
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
    try { if (tab?.webview?.canGoBack()) tab.webview.goBack(); } catch(e) {}
  }
  if (e.altKey && e.key === 'ArrowRight') {
    const tab = tabMap.get(activeTabId);
    try { if (tab?.webview?.canGoForward()) tab.webview.goForward(); } catch(e) {}
  }
  if (e.key === 'Escape') {
    closeAllPanels();
  }
});

// Close panels when clicking on main content area
document.getElementById('main').addEventListener('click', () => {
  closeAllPanels();
});

document.getElementById('btn-minimize').addEventListener('click', () => window.slime.minimize());
document.getElementById('btn-maximize').addEventListener('click', () => window.slime.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.slime.close());

window.slime.onBlockedCountUpdated((count) => {
  blockedCountEl.textContent = count.toLocaleString();
});

// ==========================================
// Utilities
// ==========================================

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
  // Load settings first
  await loadSettings();

  // Determine what to open
  const homepage = currentSettings?.homepage || DEFAULT_URL;
  let restored = false;

  if (currentSettings?.restoreTabs) {
    const sessionData = await window.slime.loadSession();
    if (sessionData && sessionData.length > 0) {
      sessionData.forEach(t => createTab(t.url));
      restored = true;
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
}

init();
