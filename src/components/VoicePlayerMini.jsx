import { useState, useRef, useEffect } from 'react';
import { MdPlayArrow, MdPause, MdMic } from 'react-icons/md';
import '../styles/voice-recorder.css';

/**
 * Compact voice player for admin tables.
 * Shows a small play/pause button when url is provided.
 * Shows nothing (—) when url is null.
 */
export default function VoicePlayerMini({ url }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  if (!url) return <span style={{ color: 'rgba(255,255,255,0.22)' }}>—</span>;

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      // Pause any other playing instances would require a global store —
      // for now just play this one.
      audioRef.current.currentTime = 0;
      audioRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <button
      className={`voice-play-btn${playing ? ' voice-play-btn--playing' : ''}`}
      onClick={toggle}
      title={playing ? 'Pause voice message' : 'Play voice message'}
    >
      {playing ? <MdPause size={14} /> : <MdMic size={14} />}
    </button>
  );
}
