import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FaWhatsapp } from 'react-icons/fa';
import {
  MdPhone, MdSms, MdArrowForward, MdQrCode2, MdPeopleAlt,
  MdVerified, MdEventAvailable, MdInsights, MdBrush, MdEditCalendar, MdShare, MdHowToReg,
} from 'react-icons/md';
import { isLoggedIn, isAdmin, canManage } from '../utils/auth';
import '../styles/landing.css';

/**
 * Public CARDHUB landing page — no authentication, no dashboard data.
 *
 * The three cards are SAMPLE designs drawn in CSS with fictional names, a
 * placeholder code and a decorative (non-scannable) QR icon. Real generated
 * cards carry guests' names and working check-in QR codes, so none are shown
 * publicly.
 */

const PHONE_LOCAL = '0794987520';
const PHONE_INTL  = '255794987520';
const WA_TEXT = 'Hello CARDHUB, I would like to learn more about your digital invitation services.';
const WA_URL  = `https://wa.me/${PHONE_INTL}?text=${encodeURIComponent(WA_TEXT)}`;
const LOGIN_URL = '/login';

const FEATURES = [
  { Icon: MdBrush,          title: 'Beautiful Digital Invitations', text: 'Personalised cards with each guest’s name, invitation code and card type on your own design.' },
  { Icon: MdPeopleAlt,      title: 'Easy Guest Management',         text: 'Add guests one by one or import a guest list, then manage every invitation per event.' },
  { Icon: FaWhatsapp,       title: 'WhatsApp & SMS Sharing',        text: 'Send invitations by WhatsApp or SMS, with a log of every message.' },
  { Icon: MdQrCode2,        title: 'QR-Based Guest Verification',   text: 'Scan the QR code at the gate, or enter the invitation code manually.' },
  { Icon: MdHowToReg,       title: 'RSVP Tracking',                 text: 'Guests confirm attendance from their invitation link; see who is coming.' },
  { Icon: MdInsights,       title: 'Event Insights',                text: 'Invited, checked-in and RSVP figures for each event on your dashboard.' },
];

const STEPS = [
  { Icon: MdEditCalendar, title: 'Create Your Event', text: 'Set up the event and prepare your invitation design.' },
  { Icon: MdShare,        title: 'Generate & Share',  text: 'Personalise cards and share them through WhatsApp, SMS or a link.' },
  { Icon: MdVerified,     title: 'Manage Your Guests', text: 'Track responses and verify guests at the entrance.' },
];

const SAMPLES = [
  { key: 'wedding',  theme: 'lp-card--emerald', kicker: 'Wedding Invitation', names: 'Amani & Neema', line: 'request the pleasure of your company', date: 'Saturday · 12 December', guest: 'Sample Guest', type: 'Double' },
  { key: 'birthday', theme: 'lp-card--ivory',   kicker: 'Birthday Celebration', names: 'Zawadi turns 30', line: 'join us for an evening of joy', date: 'Friday · 6 March', guest: 'Sample Guest', type: 'Single' },
  { key: 'grad',     theme: 'lp-card--navy',    kicker: 'Graduation Party', names: 'Baraka’s Graduation', line: 'celebrate this milestone with us', date: 'Sunday · 21 June', guest: 'Sample Guest', type: 'Single' },
];

/** Where "Access Dashboard" should take someone who is already signed in. */
function signedInHome() {
  if (isAdmin()) return '/dashboard';
  if (canManage()) return '/events';
  return '/verify';
}

function Logo({ className = '' }) {
  return (
    <picture>
      <source srcSet="/landing/cardhub-logo.webp" type="image/webp" />
      <img src="/landing/cardhub-logo.png" alt="CardHub — Digital Invitations" className={className} width="520" height="330" />
    </picture>
  );
}

/**
 * Signed out: the login page (the specified destination).
 * Signed in: straight to the user's own home — no pointless second login.
 */
function DashboardCta({ loggedIn, className, label, signedInLabel = 'Go to Dashboard' }) {
  return loggedIn
    ? <Link to={signedInHome()} className={className}>{signedInLabel} <MdArrowForward aria-hidden="true" /></Link>
    : <a href={LOGIN_URL} className={className}>{label} <MdArrowForward aria-hidden="true" /></a>;
}

function SampleCard({ s, className }) {
  return (
    <article className={`lp-card ${s.theme} ${className}`} aria-label={`Sample ${s.kicker.toLowerCase()} card`}>
      <span className="lp-card-sample">Sample</span>
      <p className="lp-card-kicker">{s.kicker}</p>
      <h3 className="lp-card-names">{s.names}</h3>
      <p className="lp-card-line">{s.line}</p>
      <p className="lp-card-date">{s.date}</p>
      <span className="lp-card-orn" aria-hidden="true"><i /></span>
      <div className="lp-card-guest">
        <span className="lp-card-guest-label">Guest</span>
        <span className="lp-card-guest-name">{s.guest}</span>
      </div>
      <div className="lp-card-foot">
        {/* decorative icon — not a real, scannable code */}
        <MdQrCode2 className="lp-card-qr" aria-hidden="true" />
        <div className="lp-card-code">
          <span>CN-0000</span>
          <span className="lp-card-type">{s.type}</span>
        </div>
      </div>
    </article>
  );
}

export default function LandingPage() {
  const loggedIn = isLoggedIn();
  const stageRef = useRef(null);

  // Gentle pointer tilt on desktop only; never on touch or with reduced motion.
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
        el.style.setProperty('--tilt-x', `${(-y * 6).toFixed(2)}deg`);
        el.style.setProperty('--tilt-y', `${(x * 8).toFixed(2)}deg`);
      });
    };
    const reset = () => { el.style.setProperty('--tilt-x', '0deg'); el.style.setProperty('--tilt-y', '0deg'); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', reset);
    return () => { cancelAnimationFrame(frame); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', reset); };
  }, []);

  return (
    <div className="lp">
      <header className="lp-header">
        <a href="/" className="lp-brand" aria-label="CardHub home"><Logo className="lp-brand-logo" /></a>
        <nav className="lp-header-nav" aria-label="Main">
          <a href="#contact" className="lp-link">Contact</a>
          <DashboardCta loggedIn={loggedIn} className="lp-btn lp-btn--sm lp-btn--primary" label="Access Dashboard" />
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="lp-hero" aria-labelledby="lp-hero-title">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">Digital invitations made simple</p>
            <h1 id="lp-hero-title" className="lp-display">
              Create Beautiful Invitations.
              <span className="lp-accent"> Share Every Moment.</span>
            </h1>
            <p className="lp-lead">
              Design, personalise and share digital invitations. Manage your guests, track responses and
              simplify event entry from one platform.
            </p>
            <div className="lp-actions">
              <DashboardCta loggedIn={loggedIn} className="lp-btn lp-btn--primary" label="Access Dashboard" />
              <a href="#contact" className="lp-btn lp-btn--ghost">Contact Us</a>
            </div>
          </div>

          <div className="lp-stage" ref={stageRef}>
            <div className="lp-stage-inner">
              <SampleCard s={SAMPLES[1]} className="lp-card--left" />
              <SampleCard s={SAMPLES[2]} className="lp-card--right" />
              <SampleCard s={SAMPLES[0]} className="lp-card--front" />
            </div>
            <p className="lp-stage-note">Sample designs · names and codes are illustrative</p>
          </div>
        </section>

        {/* ── What it does ── */}
        <section className="lp-section" aria-labelledby="lp-features-title">
          <p className="lp-eyebrow lp-eyebrow--center">Everything in one place</p>
          <h2 id="lp-features-title" className="lp-h2">From invitation to <span className="lp-accent">entrance</span></h2>
          <ul className="lp-features">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title} className="lp-feature">
                <span className="lp-feature-icon" aria-hidden="true"><Icon /></span>
                <h3 className="lp-h3">{title}</h3>
                <p className="lp-support">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── How it works ── */}
        <section className="lp-section lp-section--tint" aria-labelledby="lp-steps-title">
          <p className="lp-eyebrow lp-eyebrow--center">How it works</p>
          <h2 id="lp-steps-title" className="lp-h2">Three simple steps</h2>
          <ol className="lp-steps">
            {STEPS.map(({ Icon, title, text }, i) => (
              <li key={title} className="lp-step">
                <span className="lp-step-num" aria-hidden="true">{i + 1}</span>
                <span className="lp-step-icon" aria-hidden="true"><Icon /></span>
                <h3 className="lp-h3">{title}</h3>
                <p className="lp-support">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Contact ── */}
        <section className="lp-section" id="contact" aria-labelledby="lp-contact-title">
          <div className="lp-contact">
            <div>
              <p className="lp-eyebrow">Contact us</p>
              <h2 id="lp-contact-title" className="lp-h2 lp-h2--left">Planning an event? <span className="lp-accent">Let’s talk.</span></h2>
              <p className="lp-support">Call, text or WhatsApp us on <a className="lp-phone" href={`tel:${PHONE_LOCAL}`}>{PHONE_LOCAL}</a>.</p>
            </div>
            <div className="lp-contact-actions">
              <a className="lp-contact-btn" href={`tel:${PHONE_LOCAL}`}><MdPhone aria-hidden="true" /> Call Us</a>
              <a className="lp-contact-btn" href={`sms:${PHONE_LOCAL}`}><MdSms aria-hidden="true" /> Send SMS</a>
              <a className="lp-contact-btn lp-contact-btn--wa" href={WA_URL} target="_blank" rel="noopener noreferrer">
                <FaWhatsapp aria-hidden="true" /> WhatsApp Us
              </a>
            </div>
          </div>
        </section>

        {/* ── Closing CTA ── */}
        <section className="lp-final" aria-labelledby="lp-final-title">
          <MdEventAvailable className="lp-final-icon" aria-hidden="true" />
          <h2 id="lp-final-title" className="lp-h2 lp-h2--light">Make Your Next Event Easier with <span className="lp-accent lp-accent--light">CARDHUB</span></h2>
          <DashboardCta loggedIn={loggedIn} className="lp-btn lp-btn--light" label="Get Started" signedInLabel="Open Dashboard" />
        </section>
      </main>

      <footer className="lp-footer">
        <Logo className="lp-footer-logo" />
        <p className="lp-support">Digital invitations, guest management and event-day verification in one platform.</p>
        <p className="lp-footer-meta">© {new Date().getFullYear()} CardHub · <a href={`tel:${PHONE_LOCAL}`}>{PHONE_LOCAL}</a></p>
      </footer>
    </div>
  );
}
