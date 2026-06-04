import './template.css';

export default function WeddingGoldTemplate({ guestName, invitationCode, event, qrUrl, mini }) {
  const primary   = event?.dress_code_main      || '#d4af37';
  const secondary = event?.dress_code_secondary || '#f5e6a3';

  return (
    <div className={`tpl tpl-wedding${mini ? ' tpl--mini' : ''}`}
         style={{ '--tpl-primary': primary, '--tpl-secondary': secondary }}>
      {/* Background layers */}
      <div className="tpl-wg-bg" />
      <div className="tpl-wg-vignette" />

      <div className="tpl-wg-inner">
        {/* Top ornament */}
        <div className="tpl-wg-ornament-row">
          <span className="tpl-wg-line" />
          <span className="tpl-wg-diamond">◆</span>
          <span className="tpl-wg-line" />
        </div>

        <p className="tpl-wg-label">MWALIKO RASMI</p>

        <h1 className="tpl-wg-name">{guestName || 'Jina la Mgeni'}</h1>

        {event?.event_name && (
          <p className="tpl-wg-event">{event.event_name}</p>
        )}

        <div className="tpl-wg-ornament-row" style={{ marginTop: '0.5em' }}>
          <span className="tpl-wg-line" />
          <span className="tpl-wg-diamond" style={{ fontSize: '0.4em' }}>◆</span>
          <span className="tpl-wg-line" />
        </div>

        {/* Details */}
        <div className="tpl-details">
          {event?.event_date && (
            <div className="tpl-detail-row">
              <span className="tpl-detail-icon">📅</span>
              <span>{new Date(event.event_date).toLocaleDateString('sw-TZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </div>
          )}
          {event?.event_time && (
            <div className="tpl-detail-row">
              <span className="tpl-detail-icon">🕒</span>
              <span>{event.event_time}</span>
            </div>
          )}
          {event?.venue && (
            <div className="tpl-detail-row">
              <span className="tpl-detail-icon">📍</span>
              <span>{event.venue}</span>
            </div>
          )}
        </div>

        {/* QR + code */}
        {!mini && qrUrl && (
          <div className="tpl-qr-wrap">
            <div className="tpl-qr-box"><img src={qrUrl} alt="QR" /></div>
            <p className="tpl-cn">{invitationCode}</p>
          </div>
        )}

        {mini && (
          <div className="tpl-mini-qr-placeholder">
            <div className="tpl-mini-qr-square" />
          </div>
        )}

        {/* Bottom ornament */}
        <div className="tpl-wg-ornament-row" style={{ marginTop: '1em' }}>
          <span className="tpl-wg-line" />
          <span className="tpl-wg-diamond">◆</span>
          <span className="tpl-wg-line" />
        </div>
      </div>
    </div>
  );
}
