# Slime Browser

## Overview
Chromium-based browser built with Electron. Features built-in aggressive adblocker and YouTube tools.
This is a **long-term project** — developed iteratively over weeks/months.

## Tech Stack
- **Electron 33+** (Chromium under the hood)
- **Vanilla JS** — no framework, no build step
- **Node.js** backend (main process)
- **CSS** custom dark theme (green accent #4ade80, dark bg #0a0a1a)

## Project Structure
```
slime-browser/
├── package.json
├── .gitignore
├── CLAUDE.md              # This file
├── src/
│   ├── main.js            # Electron main process (window, IPC, session)
│   ├── preload.js         # Context bridge (exposes slime API to renderer)
│   ├── adblocker/
│   │   └── engine.js      # Network-level request blocking (regex patterns)
│   ├── youtube/
│   │   └── inject.js      # YouTube content script (ad skip, speed, PiP, screenshot, loop)
│   ├── browser/
│   │   ├── ui/
│   │   │   ├── index.html     # Main browser UI (titlebar, tabs, navbar, new tab page)
│   │   │   ├── styles.css     # Full theme/styling
│   │   │   ├── browser.js     # Tab management, navigation, webview control
│   │   │   └── webview-preload.js  # Injected into every page (anti-annoyance)
│   │   └── tabs/          # (reserved for future tab persistence/session restore)
│   └── assets/            # (reserved for icons, logos)
```

## Architecture
- **Main Process** (`main.js`): Creates BrowserWindow, sets up adblocker on `persist:slime` session partition, handles IPC for window controls and YouTube script delivery
- **Preload** (`preload.js`): Context bridge exposing `window.slime` API (minimize, maximize, close, blocked count, YouTube script)
- **Renderer** (`browser.js`): Pure DOM manipulation for tabs, URL bar, webview management. No `require()` allowed — everything goes through `window.slime`
- **Webviews**: Each tab is a `<webview>` tag with `partition="persist:slime"` (shared session with adblocker)
- **Adblocker**: `session.webRequest.onBeforeRequest` intercepts all requests before loading. Regex-based pattern matching against known ad/tracker domains
- **YouTube Tools**: Script string generated in main process, sent to renderer via IPC, injected into YouTube webviews via `executeJavaScript()`

## Key Design Decisions
- **No `nodeIntegration`** in renderer — security first, everything via contextBridge
- **Custom frameless window** with own titlebar (drag region + window controls)
- **Partition `persist:slime`** — all webviews share one session (cookies persist, adblocker applies globally)
- **Regex-based adblocker** (own engine, no external dependency) — easy to extend with new patterns
- **YouTube script as string** — must be serializable for `executeJavaScript()`, no module imports inside

## Current Features (v1.0)
- [x] Frameless window with custom titlebar
- [x] Tab management (create, close, switch)
- [x] URL bar with Google search fallback
- [x] Back/Forward/Reload navigation
- [x] New Tab Page with search + shortcuts
- [x] Built-in adblocker (40+ filter patterns)
- [x] Blocked requests counter (live)
- [x] DNT & GPC headers
- [x] YouTube: auto ad-skip
- [x] YouTube: speed control toolbar (0.5x–3x)
- [x] YouTube: screenshot capture
- [x] YouTube: Picture-in-Picture
- [x] YouTube: segment loop
- [x] Keyboard shortcuts (Ctrl+T/W/L, F5, Alt+Arrows)

## Planned Features (Roadmap)
- [ ] Bookmarks system (save, organize, sync)
- [ ] History with search
- [ ] Download manager
- [ ] Extension support (basic Chrome extension compatibility)
- [ ] Settings page (slime://settings)
- [ ] Custom themes / theme switcher
- [ ] Tab session restore on restart
- [ ] Incognito / private mode
- [ ] Built-in password manager
- [ ] SponsorBlock integration (community-sourced skip segments)
- [ ] YouTube: return dislikes (via Return YouTube Dislike API)
- [ ] YouTube: auto quality selector
- [ ] YouTube: custom homepage (remove recommendations)
- [ ] Cookie consent auto-dismiss
- [ ] Reader mode for articles
- [ ] Sidebar (bookmarks, history, tools)
- [ ] Multi-profile support
- [ ] Electron Builder packaging (exe/installer)

## Commands
```bash
npm start       # Launch the browser
npm run dev     # Launch with --dev flag (for future dev tools toggle)
npm run build   # Build installer + extract app.asar to dist/
```

## Release Workflow (MUST follow for every update)

1. **Make changes** — edit source files in `src/`
2. **Test locally** — IMPORTANT: delete `node_modules/electron/dist/resources/app.asar` first!
   Electron loads app.asar over source files if it exists. Without deleting it, you test the OLD code.
   ```bash
   rm node_modules/electron/dist/resources/app.asar 2>/dev/null
   npx electron .
   ```
3. **Bump version** in `package.json` (semver: patch for fixes, minor for features)
4. **Build** — creates installer + extracts `dist/app.asar` for hot-update:
   ```bash
   npm run build
   ```
5. **Commit & push**:
   ```bash
   git add <changed files>   # Never git add -A (may include secrets/binaries)
   git commit -m "feat/fix/chore: description (vX.Y.Z)"
   git push origin master
   ```
6. **Create GitHub Release** with `dist/app.asar` attached:
   - Go to https://github.com/Kovy97/slime_browser/releases/new
   - Tag: `vX.Y.Z`, Title: `vX.Y.Z`
   - Attach `dist/app.asar` as binary
   - Publish → installed browsers auto-detect the update

### Common Pitfalls
- **app.asar in node_modules**: Electron loads `node_modules/electron/dist/resources/app.asar` INSTEAD of source files. Always delete it before dev testing.
- **Single Instance Lock**: If the installed Slime Browser is running, `npx electron .` won't start a new instance — it sends a message to the existing one. Close the installed browser first.
- **Forgot GitHub Release**: Pushing code alone does NOT trigger updates. The asar updater checks GitHub Releases for `app.asar` assets.
- **Only ONE onBeforeSendHeaders per session**: Electron replaces previous handlers. All header modifications must be in `adblocker/engine.js`.

## Rules
- NEVER use `require()` in renderer/browser.js — always use `window.slime` API via preload
- YouTube inject script must be a plain string (no imports, no require) — it runs inside webview context
- Adblocker patterns are regex — test new patterns before adding
- All webviews MUST use `partition="persist:slime"` for adblocker to work
- Keep the theme consistent: dark background (#0a0a1a), green accent (#4ade80)
- No external UI frameworks — vanilla JS + CSS only
