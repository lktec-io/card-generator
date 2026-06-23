import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import CardGenerator from '../components/CardGenerator';
import { listEvents } from '../utils/api';
import '../styles/create.css';

export default function CreatePage() {
  const [searchParams] = useSearchParams();
  const preselectedId = searchParams.get('event') ? parseInt(searchParams.get('event'), 10) : null;

  const [selectedEvent, setSelectedEvent] = useState(null);
  const [ready, setReady] = useState(!preselectedId);

  useEffect(() => {
    if (!preselectedId) return;
    listEvents()
      .then(({ data }) => {
        const ev = (data.events || []).find(e => e.id === preselectedId);
        setSelectedEvent(ev || null);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [preselectedId]);

  if (!ready) return null;

  return <CardGenerator event={selectedEvent} />;
}
