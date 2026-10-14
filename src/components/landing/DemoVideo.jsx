import { useEffect, useRef, useState } from 'react';
import { MdQrCodeScanner } from 'react-icons/md';

/**
 * Short, decorative demo of guests being scanned and admitted.
 *
 * VIDEO — put it at  src/assets/landing/cardhub-demo.mp4  (or .webm).
 * Optional still for before playback: src/assets/landing/cardhub-demo-poster.(jpg|webp|png)
 * See src/assets/landing/README.md.
 *
 * Muted, looped, inline on mobile, no controls (it is decorative). It plays only
 * while on screen, and not at all when the visitor asks for reduced motion —
 * then the poster (or first frame) shows with a play control instead. With no
 * file, or a file that fails to load, a clean placeholder is shown: never a
 * broken player, never a console error.
 */
const VIDEOS = import.meta.glob('../../assets/landing/cardhub-demo.{mp4,webm}', { eager: true, query: '?url', import: 'default' });
const POSTERS = import.meta.glob('../../assets/landing/cardhub-demo-poster.{jpg,jpeg,webp,png}', { eager: true, query: '?url', import: 'default' });
const pick = (map, ext) => Object.entries(map).find(([k]) => k.endsWith(ext))?.[1] || null;
const MP4 = pick(VIDEOS, '.mp4');
const WEBM = pick(VIDEOS, '.webm');
const POSTER = Object.values(POSTERS)[0] || null;

export default function DemoVideo() {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(null);           // from the file itself, so nothing is cropped
  const [calm] = useState(() => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const available = Boolean(MP4 || WEBM) && !failed;

  // play only while visible
  useEffect(() => {
    const v = ref.current;
    if (!v || !available || calm || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) v.play().catch(() => {});   // autoplay can be refused; the poster stays
      else v.pause();
    }, { threshold: 0.25 });
    io.observe(v);
    return () => io.disconnect();
  }, [available, calm]);

  if (!available) {
    return (
      <div className="lp-video lp-video--empty" role="img" aria-label="CardHub demo video placeholder">
        <MdQrCodeScanner className="lp-video-ph-icon" aria-hidden="true" />
        <p className="lp-video-ph-title">Guest check-in, in seconds</p>
        <p className="lp-video-ph-text">Scan the QR code, confirm the guest, admit.</p>
      </div>
    );
  }

  const portrait = ratio !== null && ratio < 1;
  return (
    <div className={`lp-video${portrait ? ' lp-video--portrait' : ''}`} style={ratio ? { aspectRatio: String(ratio) } : undefined}>
      <video
        ref={ref}
        className="lp-video-el"
        muted
        loop
        playsInline
        autoPlay={!calm}
        controls={calm}
        preload="metadata"
        poster={POSTER || undefined}
        disablePictureInPicture
        aria-label="Short CardHub demo: guests' invitation QR codes are scanned and they are admitted to the event"
        onLoadedMetadata={(e) => { const { videoWidth: w, videoHeight: h } = e.currentTarget; if (w && h) setRatio(w / h); }}
        onError={() => setFailed(true)}
      >
        {WEBM && <source src={WEBM} type="video/webm" onError={() => !MP4 && setFailed(true)} />}
        {MP4 && <source src={MP4} type="video/mp4" onError={() => setFailed(true)} />}
        Your browser cannot play this video. It shows guests&apos; invitation QR codes being scanned at the entrance and the guests being admitted.
      </video>
    </div>
  );
}
