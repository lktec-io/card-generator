import { useEffect, useRef } from 'react';
import { MdQrCode2 } from 'react-icons/md';

/**
 * Three invitation cards with subtle depth (one in front, two behind).
 *
 * REAL IMAGES — drop them into  src/assets/landing/cards/  named:
 *   card-1.(webp|jpg|jpeg|png)   front, primary card
 *   card-2.(webp|jpg|jpeg|png)   back left
 *   card-3.(webp|jpg|jpeg|png)   back right
 * Portrait, 5:7 (e.g. 1000 × 1400 px). Any slot without a file shows a clean
 * placeholder, so the page works before, during and after the images arrive.
 * See src/assets/landing/README.md.
 *
 * The placeholders are drawn in CSS with fictional text and a decorative QR
 * icon — never a real guest, a real code or a scannable QR.
 */
const FILES = import.meta.glob('../../assets/landing/cards/card-[123].{webp,jpg,jpeg,png}', {
  eager: true, query: '?url', import: 'default',
});
const urlFor = (n) => {
  const key = Object.keys(FILES).find((k) => new RegExp(`/card-${n}\\.(webp|jpe?g|png)$`, 'i').test(k));
  return key ? FILES[key] : null;
};

const SLOTS = [
  { n: 1, pos: 'front', theme: 'lp-ph--ink',   kicker: 'Wedding Invitation',   title: 'Your Names Here',  line: 'request the pleasure of your company', date: 'Saturday · 12 December', type: 'Double' },
  { n: 2, pos: 'left',  theme: 'lp-ph--ivory', kicker: 'Birthday Celebration', title: 'Your Event',       line: 'join us for an evening of joy',        date: 'Friday · 6 March',       type: 'Single' },
  { n: 3, pos: 'right', theme: 'lp-ph--wine',  kicker: 'Graduation Party',     title: 'Your Celebration', line: 'celebrate this milestone with us',     date: 'Sunday · 21 June',       type: 'Single' },
];

function Placeholder({ s }) {
  return (
    <div className={`lp-ph ${s.theme}`}>
      <span className="lp-ph-badge">Sample</span>
      <p className="lp-ph-kicker">{s.kicker}</p>
      <h3 className="lp-ph-title">{s.title}</h3>
      <p className="lp-ph-line">{s.line}</p>
      <p className="lp-ph-date">{s.date}</p>
      <span className="lp-ph-orn" aria-hidden="true"><i /></span>
      <div className="lp-ph-guest"><span>Guest</span><strong>Sample Guest</strong></div>
      <div className="lp-ph-foot">
        <MdQrCode2 className="lp-ph-qr" aria-hidden="true" />
        <span className="lp-ph-code">CN-0000<em>{s.type}</em></span>
      </div>
    </div>
  );
}

export default function CardShowcase() {
  const stageRef = useRef(null);

  // gentle pointer tilt on desktop only; never on touch or with reduced motion
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!fine || calm) return undefined;
    let frame = 0;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--tilt-x', `${(-y * 5).toFixed(2)}deg`);
        el.style.setProperty('--tilt-y', `${(x * 7).toFixed(2)}deg`);
      });
    };
    const reset = () => { el.style.setProperty('--tilt-x', '0deg'); el.style.setProperty('--tilt-y', '0deg'); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', reset);
    return () => { cancelAnimationFrame(frame); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', reset); };
  }, []);

  const hasReal = SLOTS.some((s) => urlFor(s.n));

  return (
    <div className="lp-stage" ref={stageRef}>
      <div className="lp-stage-inner">
        {/* back cards first so the front one paints on top */}
        {[SLOTS[1], SLOTS[2], SLOTS[0]].map((s) => {
          const url = urlFor(s.n);
          return (
            <figure key={s.n} className={`lp-card lp-card--${s.pos}${url ? ' lp-card--photo' : ''}`} data-slot={`card-${s.n}`}>
              {url
                ? <img src={url} alt={`CardHub invitation card sample ${s.n}`} loading={s.n === 1 ? 'eager' : 'lazy'} decoding="async" />
                : <Placeholder s={s} />}
            </figure>
          );
        })}
      </div>
      {!hasReal && <p className="lp-stage-note">Sample layouts · names and codes are placeholders</p>}
    </div>
  );
}
