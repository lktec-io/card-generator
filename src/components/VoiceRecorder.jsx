import { useState, useRef, useEffect, useCallback } from 'react';
import { MdMic, MdStop, MdDelete, MdPlayArrow, MdPause, MdReplay } from 'react-icons/md';
import '../styles/voice-recorder.css';

/* ── Custom Audio Player ──────────────────────────────────────────────── */

function AudioPlayer({ url }) {
  const [playing,  setPlaying]  = useState(false);
  const [current,  setCurrent]  = useState(0);
  const [total,    setTotal]    = useState(0);
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onloadedmetadata = () => setTotal(audio.duration);
    audio.ontimeupdate     = () => setCurrent(audio.currentTime);
    audio.onended          = () => { setPlaying(false); setCurrent(0); };
    return () => { audio.pause(); audio.src = ''; };
  }, [url]);

  const toggle = () => {
    const a = audioRef.current;
    if (playing) { a.pause(); setPlaying(false); }
    else         { a.play();  setPlaying(true);  }
  };

  const seek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    const time = pct * total;
    audioRef.current.currentTime = time;
    setCurrent(time);
  };

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pct = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="vr-player">
      <button className="vr-play-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <MdPause size={20} /> : <MdPlayArrow size={20} />}
      </button>
      <div className="vr-progress" onClick={seek} role="progressbar">
        <div className="vr-progress-fill" style={{ width: `${pct}%` }} />
        <div className="vr-progress-thumb" style={{ left: `${pct}%` }} />
      </div>
      <span className="vr-time">{fmt(current)} / {fmt(total || 0)}</span>
    </div>
  );
}

/* ── VoiceRecorder ────────────────────────────────────────────────────── */

function fmtTimer(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Props:
//   onAudioReady(blob)  — called when recording is ready to send
//   onClear()           — called when recording is deleted
export default function VoiceRecorder({ onAudioReady, onClear }) {
  const [phase,     setPhase]     = useState('idle');     // idle | recording | recorded
  const [seconds,   setSeconds]   = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl,  setAudioUrl]  = useState(null);
  const [micError,  setMicError]  = useState(null);

  const recorderRef  = useRef(null);
  const chunksRef    = useRef([]);
  const timerRef     = useRef(null);
  const streamRef    = useRef(null);

  const stopTimer = () => { clearInterval(timerRef.current); timerRef.current = null; };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => () => {
    stopTimer();
    stopStream();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const startRecording = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Pick the best supported MIME type
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm')              ? 'audio/webm'              :
        MediaRecorder.isTypeSupported('audio/mp4')               ? 'audio/mp4'               :
        '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current   = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      recorder.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const url  = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setPhase('recorded');
        onAudioReady?.(blob);
      };

      recorder.start(100);
      setPhase('recording');
      setSeconds(0);

      timerRef.current = setInterval(() => {
        setSeconds(s => {
          const next = s + 1;
          if (next >= 60) stopRecording();
          return next;
        });
      }, 1000);

    } catch (err) {
      console.error('[VoiceRecorder] mic error:', err);
      setMicError('Hakuna ruhusa ya mikrofoni. Tafadhali ruhusu matumizi ya sauti.');
    }
  }, [onAudioReady]);

  const stopRecording = useCallback(() => {
    stopTimer();
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  const clearRecording = useCallback(() => {
    stopTimer();
    stopStream();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    if (audioUrl) { URL.revokeObjectURL(audioUrl); }
    setAudioBlob(null);
    setAudioUrl(null);
    setSeconds(0);
    setPhase('idle');
    onClear?.();
  }, [audioUrl, onClear]);

  return (
    <div className="voice-recorder">
      {/* Header */}
      <div className="vr-header">
        <MdMic className="vr-header-icon" />
        <span className="vr-header-title">Ujumbe wa Sauti</span>
        <span className="vr-optional">Hiari</span>
      </div>

      {/* Error */}
      {micError && <p className="vr-error">{micError}</p>}

      {/* IDLE: start button */}
      {phase === 'idle' && (
        <button className="vr-btn vr-btn--start" onClick={startRecording}>
          <MdMic size={18} /> Anza Kurekodi
        </button>
      )}

      {/* RECORDING: pulse + timer + stop */}
      {phase === 'recording' && (
        <div className="vr-recording-row">
          <span className="vr-pulse-dot" />
          <span className="vr-recording-label">Inarekodi…</span>
          <span className="vr-timer">{fmtTimer(seconds)}</span>
          <span className="vr-max">/01:00</span>
          <button className="vr-btn vr-btn--stop" onClick={stopRecording}>
            <MdStop size={18} /> Simama
          </button>
        </div>
      )}

      {/* RECORDED: player + actions */}
      {phase === 'recorded' && audioUrl && (
        <div className="vr-recorded">
          <AudioPlayer url={audioUrl} />
          <div className="vr-recorded-actions">
            <button className="vr-action-btn vr-action-btn--delete" onClick={clearRecording}>
              <MdDelete size={16} /> Futa
            </button>
            <button className="vr-action-btn vr-action-btn--rerecord" onClick={() => { clearRecording(); setTimeout(startRecording, 50); }}>
              <MdReplay size={16} /> Rekodi Tena
            </button>
          </div>
          <p className="vr-hint">Sikiliza rekodi yako kabla ya kutuma.</p>
        </div>
      )}
    </div>
  );
}
