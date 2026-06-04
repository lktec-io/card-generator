import './template.css';

export default function GraduationPremiumTemplate({ guestName, invitationCode, event, qrUrl, mini }) {
  const primary = event?.dress_code_main || '#1d3557';
  const accent  = event?.dress_code_secondary || '#d4af37';

  return (
    <div className={`tpl tpl-graduation${mini ? ' tpl--mini' : ''}`}
         style={{ '--tpl-primary': primary, '--tpl-secondary': accent }}>
      <div className="tpl-gr-bg" />

      <div className="tpl-gr-inner">
        {/* Academic seal area */}
        <div className="tpl-gr-seal">
          <span className="tpl-gr-seal-icon">🎓</span>
        </div>

        <p className="tpl-gr-title">MWALIKO WA KUSHEREHEKEA</p>

        <h1 className="tpl-gr-name">{guestName || 'Jina la Mgeni'}</h1>

        {event?.event_name && (
          <p className="tpl-gr-event">{event.event_name}</p>
        )}

        <div className="tpl-gr-divider" />

        <div className="tpl-details tpl-details--center">
          {event?.event_date && (
            <div className="tpl-detail-row">
              <span className="tpl-detail-icon">📅</span>
              <span>{new Date(event.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
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
            <div className="tpl-qr-box tpl-qr-box--dark"><img src={qrUrl} alt="QR" /></div>
            <p className="tpl-cn tpl-cn--light">{invitationCode}</p>
          </div>
        )}

        {mini && <div className="tpl-mini-qr-placeholder"><div className="tpl-mini-qr-square" /></div>}

        <p className="tpl-gr-footer">Hongera sana kwa mafanikio yako.</p>
      </div>
    </div>
  );
}
