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
