import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import CardGenerator from '../components/CardGenerator';
import { listEvents } from '../utils/api';
import '../styles/create.css';

export default function CreatePage() {
  const [searchParams] = useSearchParams();
  const preselectedId = searchParams.get('event') ? parseInt(searchParams.get('event'), 10) : null;

  const [events, setEvents]           = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [confirmed, setConfirmed]     = useState(false);

  useEffect(() => {
    listEvents()
      .then(({ data }) => {
        const list = data.events || [];
        setEvents(list);
        if (preselectedId) {
          const ev = list.find(e => e.id === preselectedId);
          if (ev) {
            setSelectedEvent(ev);
            setConfirmed(true);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [preselectedId]);

  if (loading) {
    return (
      <div className="create-page">
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Loading events…</p>
      </div>
    );
  }

  if (!confirmed) {
    return (
      <div className="create-page">
        <div className="create-event-selector">
          <h2 className="create-event-selector__title">Select Event</h2>
          <p className="create-event-selector__sub">Choose the event for this invitation card</p>

          {events.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '1.5rem' }}>
              No events found. Create an event first.
            </p>
          ) : (
            <div className="create-event-list">
              {events.map(ev => (
                <button
                  key={ev.id}
                  className={`create-event-item${selectedEvent?.id === ev.id ? ' create-event-item--active' : ''}`}
                  onClick={() => setSelectedEvent(ev)}
                  type="button"
                >
                  <span className="create-event-item__name">{ev.event_name}</span>
                  {ev.event_date && (
                    <span className="create-event-item__date">
                      {new Date(ev.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                  <span className={`create-event-item__mode create-event-item__mode--${ev.event_mode || 'invitation'}`}>
                    {ev.event_mode === 'contribution' ? 'Contribution' : 'Invitation'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selectedEvent && (
            <button
              className="btn-gold create-event-confirm"
              onClick={() => setConfirmed(true)}
              type="button"
            >
              Continue with "{selectedEvent.event_name}"
            </button>
          )}
        </div>
      </div>
    );
  }

  return <CardGenerator event={selectedEvent} />;
}
