// PWA support: service-worker registration and the browser's install-prompt event.
// Imported at the top of main.jsx so `beforeinstallprompt` is captured even when the
// browser fires it before React has rendered.

const DISMISSED_AT_KEY  = 'cardhub_install_dismissed_at';
const INSTALLED_KEY     = 'cardhub_installed';
const SHOWN_SESSION_KEY = 'cardhub_install_prompt_shown';
const DISMISS_DAYS      = 14;

let deferredPrompt = null;
const subscribers  = new Set();
const notify = () => subscribers.forEach((fn) => fn());

function storage(kind) {
  return {
    get(key)        { try { return window[kind].getItem(key); } catch { return null; } },
    set(key, value) { try { window[kind].setItem(key, value); } catch { /* storage unavailable */ } },
    remove(key)     { try { window[kind].removeItem(key); } catch { /* storage unavailable */ } },
  };
}
const local   = storage('localStorage');
const session = storage('sessionStorage');

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();          // show our own prompt instead of the browser's mini-infobar
    deferredPrompt = event;
    local.remove(INSTALLED_KEY);     // browsers only offer install while the app is not installed
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    local.set(INSTALLED_KEY, '1');
    notify();
  });
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* the app works without it */ });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

// True when running as an installed app rather than in a browser tab
export function isStandalone() {
  const query = '(display-mode: standalone), (display-mode: fullscreen), '
    + '(display-mode: minimal-ui), (display-mode: window-controls-overlay)';
  return Boolean(window.matchMedia?.(query).matches) || window.navigator.standalone === true;
}

// Browsers without `beforeinstallprompt` that still let people install from their own menu
export function manualInstallHint() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) return 'ios';
  if (/Android/.test(ua) && /Firefox\//.test(ua)) return 'firefox-android';
  const safari = /Macintosh/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)
    ? ua.match(/Version\/(\d+)[\d.]* Safari/)
    : null;
  if (safari && Number(safari[1]) >= 17) return 'safari-mac';
  return null;
}

export const pwaInstall = {
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  canPromptNatively: () => deferredPrompt !== null,
  browserSupportsPrompt: () => 'onbeforeinstallprompt' in window,
  isInstalled: () => local.get(INSTALLED_KEY) === '1',
  recentlyDismissed() {
    const at = Number(local.get(DISMISSED_AT_KEY));
    return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  },
  shownThisSession: () => session.get(SHOWN_SESSION_KEY) === '1',
  markShown: () => session.set(SHOWN_SESSION_KEY, '1'),
  dismiss: () => local.set(DISMISSED_AT_KEY, String(Date.now())),

  // Opens the browser's own install dialog. The event can only be used once.
  async promptInstall() {
    const event = deferredPrompt;
    if (!event) return 'unavailable';
    deferredPrompt = null;
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome || 'dismissed';
  },
};
