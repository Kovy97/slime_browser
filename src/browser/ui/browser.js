/**
 * Slime Browser - Main UI Controller
 * Handles tabs, navigation, webviews, and YouTube tool injection.
 */

// ==========================================
// State
// ==========================================

const tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let youtubeScript = null;

const DEFAULT_URL = 'slime://newtab';
const SEARCH_ENGINE = 'https://www.google.com/search?q=';

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

  if (tabs.length === 0) {
    createTab();
  } else if (activeTabId === id) {
    const newIndex = Math.min(index, tabs.length - 1);
    switchToTab(tabs[newIndex].id);
  }
}

function switchToTab(id) {
  activeTabId = id;

  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const tabEl = document.querySelector(`[data-tab-id="${id}"]`);
  if (tabEl) tabEl.classList.add('active');

  const tab = tabs.find(t => t.id === id);
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
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  tab.title = title || 'Untitled';

  const tabEl = document.querySelector(`[data-tab-id="${id}"]`);
  if (!tabEl) return;

  const titleEl = tabEl.querySelector('.tab-title');
  if (titleEl) titleEl.textContent = tab.title;

  // Update favicon letter if no image loaded yet
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
    img.onerror = () => {}; // Keep letter fallback on error
    img.onload = () => {
      faviconEl.innerHTML = '';
      faviconEl.appendChild(img);
    };
  } catch (e) {}
}

function updateTabUrl(id, url) {
  const tab = tabs.find(t => t.id === id);
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
    injectContentScripts(webview, e.url);
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

  const tab = tabs.find(t => t.id === activeTabId);
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
  const tab = tabs.find(t => t.id === activeTabId);
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
  const tab = tabs.find(t => t.id === activeTabId);
  try { if (tab?.webview?.canGoBack()) tab.webview.goBack(); } catch(e) {}
});

btnForward.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  try { if (tab?.webview?.canGoForward()) tab.webview.goForward(); } catch(e) {}
});

btnReload.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
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
  if (e.key === 'F5') {
    e.preventDefault();
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab?.webview) tab.webview.reload();
  }
  if (e.altKey && e.key === 'ArrowLeft') {
    const tab = tabs.find(t => t.id === activeTabId);
    try { if (tab?.webview?.canGoBack()) tab.webview.goBack(); } catch(e) {}
  }
  if (e.altKey && e.key === 'ArrowRight') {
    const tab = tabs.find(t => t.id === activeTabId);
    try { if (tab?.webview?.canGoForward()) tab.webview.goForward(); } catch(e) {}
  }
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
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==========================================
// Init
// ==========================================

createTab();
