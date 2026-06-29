import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  MdCalendarToday, MdLocationOn, MdMap, MdPalette,
  MdCheckCircle, MdCancel, MdQrCodeScanner, MdVisibility,
  MdDownload, MdSms, MdContentCopy,
} from 'react-icons/md';
import { GiDiamondRing } from 'react-icons/gi';
import { FaWhatsapp } from 'react-icons/fa';
import QRCode from 'qrcode';
import { getPublicInvite, submitRSVP } from '../utils/api';
import { celebrateRSVP, playSuccessSound } from '../utils/confettiCelebration';
import { useToast } from '../context/ToastContext';
import VoiceRecorder from '../components/VoiceRecorder';
import '../styles/public-invite.css';
import '../styles/voice-recorder.css';
import '../styles/contribution.css';

function formatDate(raw) {
  if (!raw) return null;
  return new Date(raw).toLocaleDateString('sw-TZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatAmount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function buildContributionMessage(inv, event, link) {
  const amount = inv?.requested_amount != null ? formatAmount(inv.requested_amount) : '0';
  return [
    `Habari ${inv?.guest_name || ''}`, '',
    'Unaombwa kuchangia katika:', '',
    event?.event_name || '', '',
    'Kiasi kilichopangwa:', '',
    `TZS ${amount}`, '',
    'Fungua link yako hapa:', '',
    link, '',
    'Asante kwa ushirikiano wako.',
  ].join('\n');
}

export default function PublicInvitePage({ isPreview = false }) {
  const { uuid } = useParams();
  const { showToast } = useToast();

  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [qrUrl,     setQrUrl]     = useState('');
  const [rsvpState, setRsvpState] = useState(null);
  const [rsvping,   setRsvping]   = useState(false);
  const [rsvpMsg,   setRsvpMsg]   = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    getPublicInvite(uuid)
      .then(async ({ data: d }) => {
        setData(d);
        if (d.invitation?.rsvp_response) {
          setRsvpState(d.invitation.rsvp_response);
        }
        if (d.invitation?.code) {
          const isContrib = d.event?.event_mode === 'contribution';
          const qrContent = isContrib
            ? `${window.location.origin}/invite/${d.invitation.invitation_uuid || uuid}`
            : d.invitation.code;
          const url = await QRCode.toDataURL(qrContent, {
            errorCorrectionLevel: isContrib ? 'L' : 'M', margin: 1, width: isContrib ? 300 : 280,
          });
          setQrUrl(url);
        }
      })
      .catch(() => setError('Mwaliko haukupatikana.'))
      .finally(() => setLoading(false));
  }, [uuid]);

  const handleShareContribution = (channel) => {
    const inv   = data?.invitation;
    const event = data?.event;
    const link  = `${window.location.origin}/invite/${inv?.invitation_uuid || uuid}`;
    const message = buildContributionMessage(inv, event, link);
    if (channel === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
    } else if (channel === 'sms') {
      window.location.href = `sms:?body=${encodeURIComponent(message)}`;
    } else if (channel === 'copy') {
      navigator.clipboard.writeText(message)
        .then(() => showToast('Ujumbe umenakiliwa!', 'success'))
        .catch(() => showToast('Imeshindwa kunakili.', 'error'));
    }
  };

  const playSound = (type) => {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      if (type === 'attending') {
        [523.25, 659.25, 783.99].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          osc.connect(gain);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.13);
          gain.gain.setValueAtTime(0.22, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.60);
          osc.start(ctx.currentTime + i * 0.13);
          osc.stop(ctx.currentTime + 0.60);
        });
      } else {
        const osc = ctx.createOscillator();
        osc.connect(gain);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.40);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.40);
      }
    } catch (_) { /* audio not supported */ }
  };

  const handleRSVP = async (response) => {
    if (rsvpState || rsvping) return;
    setRsvping(true);
    try {
      const { data: r } = await submitRSVP(uuid, response);
      setRsvpState(response);
      setRsvpMsg(r.message);
      if (response === 'attending') {
        playSuccessSound();
        celebrateRSVP();
      } else {
        playSound(response);
      }
      setShowModal(true);
      setTimeout(() => setShowModal(false), 6000);
    } catch (err) {
      const res = err.response?.data;
      if (res?.already_responded) {
        setRsvpState(res.response || 'already');
        setRsvpMsg('Tayari umeshajibu mwaliko huu.');
      } else {
        setRsvpMsg('Imeshindwa kuhifadhi jibu. Jaribu tena.');
      }
    } finally {
      setRsvping(false);
    }
  };

  if (loading) return (
    <div className="invite-page">
      <div className="invite-loading"><div className="invite-spinner" /></div>
    </div>
  );

  if (error) return (
    <div className="invite-page">
      <div className="invite-not-found">
        <GiDiamondRing size={52} />
        <h2>Mwaliko Haupatikani</h2>
        <p>Kiungo hiki hakifanyi kazi au kimeisha.</p>
        <p className="invite-not-found-sub">This invitation link is invalid or has expired.</p>
      </div>
    </div>
  );

  const inv   = data?.invitation;
  const event = data?.event;
  const isContribution = event?.event_mode === 'contribution';
  const hasDresscode = !!(
    event?.dress_code_main || event?.dress_code_secondary ||
    event?.dress_code_accent || event?.dress_code_notes
  );

  return (
    <div className="invite-page">
      <div className="invite-bg" aria-hidden="true" />

      {isPreview && (
        <div className="invite-preview-banner">
          <MdVisibility size={16} />
          Maoni ya Msimamizi — Admin Preview Mode
        </div>
      )}

      <div className="invite-container">

        <div className="invite-brand">
          <GiDiamondRing className="invite-ring" />
          <span>Nardio Events</span>
        </div>

        {/* ── SECTION 1: Card image ── */}
        {inv?.image_url && (
          <section className="invite-section invite-section--card">
            <div className="invite-card-img">
              <img src={inv.image_url} alt="Kadi ya Mwaliko" crossOrigin="anonymous" />
            </div>
          </section>
        )}

        {/* ── SECTION 2: Guest info ── */}
        <section className="invite-section invite-section--guest">
          <p className="invite-label">Umealikwa</p>
          <h1 className="invite-guest-name">{inv?.guest_name}</h1>
          {event?.event_name && (
            <h2 className="invite-event-name">{event.event_name}</h2>
          )}
          <div className="invite-cn-badge">
            <span className="invite-cn-label">{isContribution ? 'Nambari ya Mchangiaji' : 'Nambari ya Mwaliko'}</span>
            <span className="invite-cn-code">{inv?.code}</span>
          </div>
          {isContribution && inv?.requested_amount != null && (
            <div className="cd-amount-badge" style={{ marginTop: '0.85rem' }}>
              TZS {formatAmount(inv.requested_amount)}
            </div>
          )}
        </section>

        {/* ── SECTION 3: Event details ── */}
        {event && (event.event_date || event.event_time || event.venue || event.maps_link || event.contact_phone) && (
          <section className="invite-section invite-section--details">
            <h3 className="invite-section-title">Maelezo ya Tukio</h3>
            <div className="invite-details">
              {event.event_date && (
                <div className="invite-detail-row">
                  <MdCalendarToday className="invite-detail-icon" />
                  <span>{formatDate(event.event_date)}</span>
                </div>
              )}
              {event.event_time && (
                <div className="invite-detail-row">
                  <span className="invite-detail-icon" style={{ fontSize: '1rem' }}>🕒</span>
                  <span>{event.event_time}</span>
                </div>
              )}
              {event.venue && (
                <div className="invite-detail-row">
                  <MdLocationOn className="invite-detail-icon" />
                  <span>{event.venue}</span>
                </div>
              )}
              {event.maps_link && (
                <div className="invite-detail-row">
                  <MdMap className="invite-detail-icon" />
                  <a href={event.maps_link} target="_blank" rel="noreferrer" className="invite-maps-btn">
                    📍 Fungua Ramani
                  </a>
                </div>
              )}
              {event.contact_phone && (
                <div className="invite-detail-row">
                  <span className="invite-detail-icon" style={{ fontSize: '1rem' }}>📞</span>
                  <div className="invite-contact">
                    <span className="invite-contact-label">Msaada</span>
                    <a href={`tel:${event.contact_phone}`} className="invite-maps-btn">
                      {event.contact_name ? `${event.contact_name} — ` : ''}{event.contact_phone}
                    </a>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── SECTION 4: Dress code ── */}
        {hasDresscode && (
          <section className="invite-section invite-section--dress">
            <h3 className="invite-section-title">
              <MdPalette size={16} /> Mavazi ya Sherehe
            </h3>
            <div className="invite-color-swatches">
              <div className="invite-color-chip">
                <span className="invite-color-circle" style={{ background: event.dress_code_main || '#d4af37' }} />
                <span>Primary</span>
              </div>
              <div className="invite-color-chip">
                <span className="invite-color-circle" style={{ background: event.dress_code_secondary || '#1a1a2e' }} />
                <span>Secondary</span>
              </div>
              <div className="invite-color-chip">
                <span className="invite-color-circle" style={{ background: event.dress_code_accent || '#ffffff', border: '2px solid rgba(255,255,255,0.22)' }} />
                <span>Accent</span>
              </div>
            </div>
            {event.dress_code_notes && (
              <p className="invite-dress-notes">{event.dress_code_notes}</p>
            )}
          </section>
        )}

        {/* ── Contribution: Download + Share ── */}
        {isContribution && (
          <section className="invite-section">
            <h3 className="invite-section-title">
              <MdDownload size={16} /> Pakua na Shiriki Kadi Yako
            </h3>
            {inv?.image_url && (
              <a
                className="btn-gold"
                href={inv.image_url}
                download={`${inv.code || 'kadi'}.png`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none', width: '100%', marginBottom: '1rem' }}
              >
                <MdDownload size={18} /> Pakua Kadi (PNG)
              </a>
            )}
            <div className="cc-share-row">
              <button className="cc-share-btn cc-share-btn--whatsapp" onClick={() => handleShareContribution('whatsapp')}>
                <FaWhatsapp size={18} /> WhatsApp
              </button>
              <button className="cc-share-btn cc-share-btn--sms" onClick={() => handleShareContribution('sms')}>
                <MdSms size={18} /> SMS
              </button>
              <button className="cc-share-btn" onClick={() => handleShareContribution('copy')}>
                <MdContentCopy size={18} /> Nakili Ujumbe
              </button>
            </div>
          </section>
        )}

        {!isContribution && (
          <>
            {/* ── SECTION 5: QR Code ── */}
            <section className="invite-section invite-section--qr">
              <h3 className="invite-section-title">
                <MdQrCodeScanner size={16} /> QR Code ya Mwaliko
              </h3>
              <div className="invite-qr-wrap">
                {qrUrl && (
                  <div className="invite-qr-box">
                    <img src={qrUrl} alt="QR Code" className="invite-qr-img" />
                  </div>
                )}
                <p className="invite-qr-cn">{inv?.code}</p>
                <p className="invite-qr-hint">Onyesha QR Code hii mlangoni kwenye tukio</p>
              </div>
            </section>

            {/* ── SECTION 6: Voice Message ── */}
            <section className="invite-section">
              <VoiceRecorder uuid={uuid} />
            </section>

            {/* ── SECTION 7: RSVP ── */}
            <section className="invite-section invite-section--rsvp">
              <h3 className="invite-rsvp-title">Je, Utahudhuria?</h3>
              <p className="invite-rsvp-sub">Tafadhali thibitisha mahudhurio yako</p>

              {(rsvpState === 'attending' || rsvpState === 'declined') ? (
                <div className={`invite-rsvp-done invite-rsvp-done--${rsvpState}`}>
                  {rsvpState === 'attending' ? (
                    <>
                      <MdCheckCircle size={28} />
                      <div><strong>Utahudhuria!</strong><p>{rsvpMsg || 'Asante! Tunafurahi kukuona.'}</p></div>
                    </>
                  ) : (
                    <>
                      <MdCancel size={28} />
                      <div><strong>Hutahudhuria</strong><p>{rsvpMsg || 'Asante kwa kutujulisha.'}</p></div>
                    </>
                  )}
                </div>
              ) : rsvpState === 'already' ? (
                <div className="invite-rsvp-done invite-rsvp-done--already">
                  <MdCheckCircle size={24} />
                  <div><strong>Tayari Ulijibu</strong><p>Tayari umeshajibu mwaliko huu.</p></div>
                </div>
              ) : (
                <div className="invite-rsvp-btns">
                  <button className="invite-btn-attend" onClick={() => handleRSVP('attending')} disabled={rsvping}>
                    {rsvping ? <span className="invite-btn-spinner" /> : <MdCheckCircle size={20} />}
                    NITAHUDHURIA
                  </button>
                  <button className="invite-btn-decline" onClick={() => handleRSVP('declined')} disabled={rsvping}>
                    {rsvping ? <span className="invite-btn-spinner" /> : <MdCancel size={20} />}
                    SITAHUDHURIA
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        <p className="invite-footer">Powered by Nardio Events</p>
      </div>

      {showModal && rsvpState && (
        <div className="rsvp-modal-overlay" onClick={() => setShowModal(false)}>
          <div className={`rsvp-modal rsvp-modal--${rsvpState}`} onClick={e => e.stopPropagation()}>
            <div className="rsvp-modal-icon">
              {rsvpState === 'attending' ? <MdCheckCircle size={48} /> : <MdCancel size={48} />}
            </div>
            {rsvpState === 'attending' ? (
              <>
                <h2 className="rsvp-modal-title">🎉 Asante!</h2>
                <p className="rsvp-modal-msg">Mahudhurio yamethibitishwa.</p>
                <p className="rsvp-modal-sub">Tunakutarajia.</p>
              </>
            ) : (
              <>
                <h2 className="rsvp-modal-title">Asante!</h2>
                <p className="rsvp-modal-msg">Jibu lako limepokelewa.</p>
              </>
            )}
            <button className="rsvp-modal-btn" onClick={() => setShowModal(false)}>Sawa, Asante</button>
          </div>
        </div>
      )}
    </div>
  );
}
