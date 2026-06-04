import './template.css';

export default function BirthdayModernTemplate({ guestName, invitationCode, event, qrUrl, mini }) {
  const primary = event?.dress_code_main || '#7c3aed';
  const accent  = event?.dress_code_secondary || '#ec4899';

  return (
    <div className={`tpl tpl-birthday${mini ? ' tpl--mini' : ''}`}
         style={{ '--tpl-primary': primary, '--tpl-secondary': accent }}>
      <div className="tpl-bd-bg" />

      <div className="tpl-bd-inner">
        <p className="tpl-bd-eyebrow">🎉 SHEREHE YA</p>

        <h1 className="tpl-bd-name">{guestName || 'Jina la Mgeni'}</h1>

        <div className="tpl-bd-badge">
          <span>🎂</span>
          {event?.event_name && <span>{event.event_name}</span>}
        </div>

        <div className="tpl-bd-divider" />

        <div className="tpl-details tpl-details--light">
          {event?.event_date && (
            <div className="tpl-detail-row">
              <span className="tpl-detail-icon">📅</span>
              <span>{new Date(event.event_date).toLocaleDateString('sw-TZ', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
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

        {!mini && qrUrl && (
          <div className="tpl-qr-wrap">
            <div className="tpl-qr-box tpl-qr-box--glow"><img src={qrUrl} alt="QR" /></div>
            <p className="tpl-cn">{invitationCode}</p>
          </div>
        )}
        {mini && <div className="tpl-mini-qr-placeholder"><div className="tpl-mini-qr-square" /></div>}

        <p className="tpl-bd-footer">Karibu sana kwenye sherehe yetu!</p>
      </div>
    </div>
  );
}
