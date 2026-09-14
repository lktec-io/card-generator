import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MdIosShare, MdMoreVert } from 'react-icons/md';
import { pwaInstall, isStandalone, manualInstallHint } from '../utils/pwa';
import '../styles/install-prompt.css';

const SHOW_DELAY_MS = 3500;

// Guest-facing invitation pages: guests don't use the staff app, so don't ask them to install it
const GUEST_PREFIXES = ['/invite/', '/display/'];

const MESSAGES = {
  native: <>Install this app for quick and easy access.</>,
  ios: (
    <>
      Install this app for quick and easy access: tap{' '}
      <MdIosShare className="install-prompt-inline-icon" role="img" aria-label="Share" /> then{' '}
      <strong>Add to Home Screen</strong>.
    </>
  ),
  'firefox-android': (
    <>
      Install this app for quick and easy access: open the menu{' '}
      <MdMoreVert className="install-prompt-inline-icon" role="img" aria-label="menu" /> and tap{' '}
      <strong>Install</strong>.
    </>
  ),
  'safari-mac': (
    <>
      Install this app for quick and easy access: in Safari choose <strong>File → Add to Dock</strong>.
    </>
  ),
};

export default function InstallPrompt() {
  const { pathname } = useLocation();
  const onGuestPage = GUEST_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const [mode, setMode] = useState(null);   // null | 'native' | 'ios' | 'firefox-android' | 'safari-mac'
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (onGuestPage) {
      setMode(null);
      return undefined;
    }

    const readyAt = Date.now() + SHOW_DELAY_MS;

    const evaluate = () => {
      if (isStandalone() || pwaInstall.isInstalled()) {
        setMode(null);
        return;
      }
      if (Date.now() < readyAt - 50 || pwaInstall.recentlyDismissed() || pwaInstall.shownThisSession()) return;

      if (pwaInstall.canPromptNatively()) {
        pwaInstall.markShown();
        setMode('native');
      } else if (!pwaInstall.browserSupportsPrompt()) {
        const hint = manualInstallHint();
        if (hint) {
          pwaInstall.markShown();
          setMode(hint);
        }
      }
    };

    const timer = setTimeout(evaluate, SHOW_DELAY_MS);
    const unsubscribe = pwaInstall.subscribe(evaluate);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [onGuestPage]);

  if (!mode) return null;

  const close = () => {
    pwaInstall.dismiss();
    setMode(null);
  };

  const install = async () => {
    setBusy(true);
    let outcome = 'dismissed';
    try {
      outcome = await pwaInstall.promptInstall();
    } finally {
      setBusy(false);
      setMode(null);
      if (outcome !== 'accepted') pwaInstall.dismiss();
    }
  };

  return (
    <div
      className="install-prompt"
      role="dialog"
      aria-modal="false"
      aria-labelledby="install-prompt-title"
      aria-describedby="install-prompt-text"
    >
      <img className="install-prompt-icon" src="/icons/icon-192.png" alt="" width="44" height="44" />
      <div className="install-prompt-body">
        <p id="install-prompt-title" className="install-prompt-title">Install App</p>
        <p id="install-prompt-text" className="install-prompt-text">{MESSAGES[mode]}</p>
        <div className="install-prompt-actions">
          {mode === 'native' && (
            <button type="button" className="btn-gold install-prompt-btn" onClick={install} disabled={busy}>
              Install
            </button>
          )}
          <button type="button" className="btn-outline install-prompt-btn" onClick={close}>
            {mode === 'native' ? 'Not Now' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}
