import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  MdCalendarToday, MdLocationOn, MdMap, MdPalette,
  MdCheckCircle, MdCancel, MdQrCodeScanner,
} from 'react-icons/md';
import { GiDiamondRing } from 'react-icons/gi';
import QRCode from 'qrcode';
import { getPublicInvite, submitRSVP } from '../utils/api';
import '../styles/public-invite.css';

function formatDate(raw) {
  if (!raw) return null;
  return new Date(raw).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function PublicInvitePage() {
  const { code } = useParams();

  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [qrUrl,    setQrUrl]    = useState('');
  const [rsvpDone, setRsvpDone] = useState(null); // 'attending' | 'declined'
  const [rsvping,  setRsvping]  = useState(false);

  useEffect(() => {
    getPublicInvite(code)
      .then(async ({ data: d }) => {
        setData(d);
        if (d.invitation?.rsvp_response) setRsvpDone(d.invitation.rsvp_response);
        const url = await QRCode.toDataURL(code, {
          errorCorrectionLevel: 'L', margin: 1, width: 300,
        });
        setQrUrl(url);
      })
      .catch(() => setError('Invitation not found.'))
      .finally(() => setLoading(false));
  }, [code]);

  const handleRSVP = async (response) => {
    setRsvping(true);
    try {
      await submitRSVP(code, response);
      setRsvpDone(response);
    } catch {
      alert('Failed to submit RSVP. Please try again.');
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
        <h2>Invitation Not Found</h2>
        <p>This invitation link is invalid or has expired.</p>
      </div>
    </div>
  );

  const inv   = data?.invitation;
  const event = data?.event;

  return (
    <div className="invite-page">
      {/* Atmospheric background */}
      <div className="invite-bg" aria-hidden="true" />

      <div className="invite-container">

        {/* ── Brand ── */}
        <div className="invite-brand">
          <GiDiamondRing className="invite-ring" />
          <span>Nardio Events</span>
        </div>

        {/* ── Card image ── */}
        {inv?.image_url && (
          <div className="invite-card-img">
            <img src={inv.image_url} alt="Invitation Card" />
          </div>
        )}

        {/* ── Guest greeting ── */}
        <div className="invite-greeting">
          <p className="invite-label">You are cordially invited</p>
          <h1 className="invite-guest-name">{inv?.guest_name}</h1>
          {event && <h2 className="invite-event-name">{event.event_name}</h2>}
        </div>

        {/* ── Event details ── */}
        {event && (
          <div className="invite-details">
            {event.event_date && (
              <div className="invite-detail-row">
                <MdCalendarToday className="invite-detail-icon" />
                <span>{formatDate(event.event_date)}</span>
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
                  Open Directions
                </a>
              </div>
            )}
            {(event.dress_code_main || event.dress_code_notes) && (
              <div className="invite-dress-code">
                <div className="invite-dress-head">
                  <MdPalette className="invite-detail-icon" /> Dress Code
                </div>
                {event.dress_code_main && (
                  <p><strong>Main:</strong> {event.dress_code_main}
                    {event.dress_code_secondary && ` & ${event.dress_code_secondary}`}
                  </p>
                )}
                {event.dress_code_notes && <p className="invite-dress-notes">{event.dress_code_notes}</p>}
              </div>
            )}
          </div>
        )}

        {/* ── QR Code ── */}
        <div className="invite-qr-section">
          <p className="invite-qr-label">
            <MdQrCodeScanner size={16} /> Your Invitation Code
          </p>
          {qrUrl && <img src={qrUrl} alt="QR Code" className="invite-qr-img" />}
          <span className="invite-cn-code">{code}</span>
          <p className="invite-qr-hint">Show this code at the entrance</p>
        </div>

        {/* ── RSVP ── */}
        <div className="invite-rsvp">
          <h3>Will you attend?</h3>

          {rsvpDone ? (
            <div className={`invite-rsvp-done invite-rsvp-done--${rsvpDone}`}>
              {rsvpDone === 'attending' ? (
                <><MdCheckCircle size={22} /> Thank you! We look forward to seeing you.</>
              ) : (
                <><MdCancel size={22} /> Thank you for letting us know.</>
              )}
            </div>
          ) : (
            <div className="invite-rsvp-btns">
              <button
                className="invite-btn-attend"
                onClick={() => handleRSVP('attending')}
                disabled={rsvping}
              >
                <MdCheckCircle size={18} /> I Will Attend
              </button>
              <button
                className="invite-btn-decline"
                onClick={() => handleRSVP('declined')}
                disabled={rsvping}
              >
                <MdCancel size={18} /> I Will Not Attend
              </button>
            </div>
          )}
        </div>

        <p className="invite-footer">Powered by Nardio Events</p>
      </div>
    </div>
  );
}
