import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MdEvent } from 'react-icons/md';
import CardGenerator from '../components/CardGenerator';
import { listEvents } from '../utils/api';
import '../styles/create.css';

export default function CreatePage() {
  const [searchParams] = useSearchParams();
  const preselected = searchParams.get('event') ? parseInt(searchParams.get('event'), 10) : null;

  const [events,   setEvents]   = useState([]);
  const [eventId,  setEventId]  = useState(preselected);
  const [loadingE, setLoadingE] = useState(true);

  useEffect(() => {
    listEvents()
      .then(({ data }) => setEvents(data.events || []))
      .finally(() => setLoadingE(false));
  }, []);

  return (
    <>
      {/* Event selector — optional */}
      {!loadingE && events.length > 0 && (
        <div className="create-event-bar">
          <MdEvent size={16} />
          <label htmlFor="event-select">Assign to Event:</label>
          <select
            id="event-select"
            value={eventId || ''}
            onChange={(e) => setEventId(e.target.value ? parseInt(e.target.value, 10) : null)}
          >
            <option value="">— No event (standalone card) —</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.event_name} ({ev.event_type})</option>
            ))}
          </select>
        </div>
      )}
      <CardGenerator eventId={eventId} />
    </>
  );
}
