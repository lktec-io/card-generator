import './template.css';

export default function ConferenceProTemplate({ guestName, invitationCode, event, qrUrl, mini }) {
  const primary = event?.dress_code_main || '#0f172a';
  const accent  = event?.dress_code_secondary || '#38bdf8';

  return (
    <div className={`tpl tpl-conference${mini ? ' tpl--mini' : ''}`}
         style={{ '--tpl-primary': primary, '--tpl-secondary': accent }}>
      <div className="tpl-cf-topbar" />

      <div className="tpl-cf-inner">
        <div className="tpl-cf-logo-row">
          <span className="tpl-cf-logo-icon">💼</span>
          <span className="tpl-cf-logo-text">NARDIO EVENTS</span>
        </div>

        <div className="tpl-cf-divider" />

        <p className="tpl-cf-label">MWALIKO WA KIKAO</p>
        <h1 className="tpl-cf-name">{guestName || 'Jina la Mgeni'}</h1>

        {event?.event_name && (
          <p className="tpl-cf-event">{event.event_name}</p>
        )}

        <div className="tpl-details tpl-details--corporate">
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
            <div className="tpl-qr-box tpl-qr-box--blue"><img src={qrUrl} alt="QR" /></div>
            <p className="tpl-cn tpl-cn--blue">{invitationCode}</p>
          </div>
        )}
        {mini && <div className="tpl-mini-qr-placeholder"><div className="tpl-mini-qr-square" /></div>}

        <div className="tpl-cf-divider" style={{ marginTop: '1em' }} />
        <p className="tpl-cf-footer">Tafadhali thibitisha uwepo wako mapema.</p>
      </div>
    </div>
  );
}
