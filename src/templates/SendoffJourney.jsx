import './template.css';

export default function SendoffJourneyTemplate({ guestName, invitationCode, event, qrUrl, mini }) {
  const primary = event?.dress_code_main || '#92400e';
  const accent  = event?.dress_code_secondary || '#f59e0b';

  return (
    <div className={`tpl tpl-sendoff${mini ? ' tpl--mini' : ''}`}
         style={{ '--tpl-primary': primary, '--tpl-secondary': accent }}>
      <div className="tpl-sf-bg" />

      <div className="tpl-sf-inner">
        <p className="tpl-sf-eyebrow">✈️ SAFARI NJEMA</p>

        <h1 className="tpl-sf-name">{guestName || 'Jina la Mgeni'}</h1>

        {event?.event_name && (
          <p className="tpl-sf-event">{event.event_name}</p>
        )}

        <div className="tpl-sf-horizon" />

        <div className="tpl-details tpl-details--warm">
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
            <div className="tpl-qr-box tpl-qr-box--warm"><img src={qrUrl} alt="QR" /></div>
            <p className="tpl-cn tpl-cn--warm">{invitationCode}</p>
          </div>
        )}
        {mini && <div className="tpl-mini-qr-placeholder"><div className="tpl-mini-qr-square" /></div>}

        <p className="tpl-sf-footer">Tunaomba uwe pamoja nasi katika sherehe hii muhimu.</p>
      </div>
    </div>
  );
}
