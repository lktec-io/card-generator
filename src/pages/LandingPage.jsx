import { Link } from 'react-router-dom';
import { FaWhatsapp } from 'react-icons/fa';
import {
  MdPhone, MdSms, MdArrowForward, MdQrCode2, MdPeopleAlt,
  MdVerified, MdInsights, MdBrush, MdEditCalendar, MdShare, MdHowToReg,
} from 'react-icons/md';
import CardShowcase from '../components/landing/CardShowcase';
import DemoVideo from '../components/landing/DemoVideo';
import { isLoggedIn, isAdmin, canManage } from '../utils/auth';
import '../styles/landing.css';

/**
 * Public CARDHUB landing page — no authentication, no dashboard data.
 * Same dark + gold theme as the app. Real card images and the demo video drop
 * into src/assets/landing/ (see the README there); placeholders until then.
 */

const PHONE_LOCAL = '0794987520';
const PHONE_INTL  = '255794987520';
const WA_TEXT = 'Hello CARDHUB, I would like to learn more about your digital invitation services.';
const WA_URL  = `https://wa.me/${PHONE_INTL}?text=${encodeURIComponent(WA_TEXT)}`;
const LOGIN_URL = '/login';

const FEATURES = [
  { Icon: MdBrush,     title: 'Beautiful Digital Invitations', text: 'Each guest’s name, invitation code and card type on your own design.' },
  { Icon: MdPeopleAlt, title: 'Easy Guest Management',         text: 'Add guests one by one or import a list, then manage them per event.' },
  { Icon: FaWhatsapp,  title: 'WhatsApp & SMS Sharing',        text: 'Send invitations by WhatsApp or SMS, with a log of every message.' },
  { Icon: MdQrCode2,   title: 'QR-Based Guest Verification',   text: 'Scan the QR code at the gate, or enter the invitation code by hand.' },
  { Icon: MdHowToReg,  title: 'RSVP Tracking',                 text: 'Guests confirm from their invitation link; see who is coming.' },
  { Icon: MdInsights,  title: 'Event Insights',                text: 'Invited, checked-in and RSVP figures for every event.' },
];

const STEPS = [
  { Icon: MdEditCalendar, title: 'Create Your Event',  text: 'Set up the event and prepare your invitation design.' },
  { Icon: MdShare,        title: 'Generate & Share',   text: 'Personalise cards and share them by WhatsApp, SMS or link.' },
  { Icon: MdVerified,     title: 'Manage Your Guests', text: 'Track responses and verify guests at the entrance.' },
];

/** Where "Access Dashboard" takes someone who is already signed in. */
function signedInHome() {
  if (isAdmin()) return '/dashboard';
  if (canManage()) return '/events';
  return '/verify';
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

function Logo({ className = '' }) {
  return (
    <span className={`lp-logo-tile ${className}`}>
      <picture>
        <source srcSet="/landing/cardhub-logo.webp" type="image/webp" />
        <img src="/landing/cardhub-logo.png" alt="CardHub — Digital Invitations" width="520" height="330" />
      </picture>
    </span>
  );
}

export default function LandingPage() {
  const loggedIn = isLoggedIn();

  return (
    <div className="lp">
      <header className="lp-header">
        <a href="/" className="lp-brand" aria-label="CardHub home"><Logo /></a>
        <nav className="lp-header-nav" aria-label="Main">
          <a href="#how" className="lp-link">How it works</a>
          <a href="#contact" className="lp-link">Contact</a>
          <DashboardCta loggedIn={loggedIn} className="lp-btn lp-btn--sm lp-btn--primary" label="Access Dashboard" />
        </nav>
      </header>

      <main>
        {/* ── Hero + card showcase ── */}
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
          <CardShowcase />
        </section>

        {/* ── How it works + demo video ── */}
        <section className="lp-section lp-demo" id="how" aria-labelledby="lp-how-title">
          <div className="lp-demo-copy">
            <p className="lp-eyebrow">How it works</p>
            <h2 id="lp-how-title" className="lp-h2">From invitation to <span className="lp-accent">entrance</span></h2>
            <ol className="lp-steps">
              {STEPS.map(({ Icon, title, text }, i) => (
                <li key={title} className="lp-step">
                  <span className="lp-step-icon" aria-hidden="true"><Icon /></span>
                  <div>
                    <h3 className="lp-h3"><span className="lp-step-num">{i + 1}.</span> {title}</h3>
                    <p className="lp-support">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <DemoVideo />
        </section>

        {/* ── Features ── */}
        <section className="lp-section" aria-labelledby="lp-features-title">
          <h2 id="lp-features-title" className="lp-h2 lp-h2--center">Everything your event needs</h2>
          <ul className="lp-features">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title} className="lp-feature">
                <span className="lp-feature-icon" aria-hidden="true"><Icon /></span>
                <div>
                  <h3 className="lp-h3">{title}</h3>
                  <p className="lp-support">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Contact + closing CTA ── */}
        <section className="lp-section" id="contact" aria-labelledby="lp-final-title">
          <div className="lp-final">
            <div className="lp-final-copy">
              <h2 id="lp-final-title" className="lp-h2">Make Your Next Event Easier with <span className="lp-accent">CARDHUB</span></h2>
              <p className="lp-support">Call, text or WhatsApp us on <a className="lp-phone" href={`tel:${PHONE_LOCAL}`}>{PHONE_LOCAL}</a>.</p>
              <DashboardCta loggedIn={loggedIn} className="lp-btn lp-btn--primary" label="Get Started" signedInLabel="Open Dashboard" />
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
      </main>

      <footer className="lp-footer">
        <Logo className="lp-logo-tile--sm" />
        <p className="lp-support">Digital invitations, guest management and event-day verification in one platform.</p>
        <p className="lp-footer-meta">© {new Date().getFullYear()} CardHub · <a href={`tel:${PHONE_LOCAL}`}>{PHONE_LOCAL}</a></p>
      </footer>
    </div>
  );
}
