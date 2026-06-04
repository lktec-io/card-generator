import { useState, useRef, useEffect, useCallback } from 'react';
import { MdMic, MdStop, MdDelete, MdPlayArrow, MdPause, MdReplay, MdSend } from 'react-icons/md';
import { sendVoiceMessage } from '../utils/api';
import { celebrateRSVP } from '../utils/confettiCelebration';
import '../styles/voice-recorder.css';

const MAX_SECONDS = 30;

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
    const time = ((e.clientX - rect.left) / rect.width) * total;
    audioRef.current.currentTime = time;
    setCurrent(time);
  };

  const fmt  = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pct  = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="vr-player">
      <button className="vr-play-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <MdPause size={20} /> : <MdPlayArrow size={20} />}
      </button>
      <div className="vr-progress" onClick={seek}>
        <div className="vr-progress-fill" style={{ width: `${pct}%` }} />
        <div className="vr-progress-thumb" style={{ left: `${pct}%` }} />
      </div>
      <span className="vr-time">{fmt(current)} / {fmt(total || 0)}</span>
    </div>
  );
}

/* ── Success popup (small, auto-dismisses) ────────────────────────────── */

function VoiceSuccessPopup({ onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="vm-success-popup">
      <span className="vm-success-icon">🎉</span>
      <div>
        <strong>Asante!</strong>
        <p>Ujumbe wako umetumwa.</p>
      </div>
    </div>
  );
}

/* ── Sound for voice send ─────────────────────────────────────────────── */

function playVoiceSentSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const freqs = [440, 554, 659];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.10);
      gain.gain.setValueAtTime(0.20, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.50);
      osc.start(ctx.currentTime + i * 0.10);
      osc.stop(ctx.currentTime + 0.50);
    });
  } catch (_) {}
}

/* ── Main component ───────────────────────────────────────────────────── */

// Props:
//   uuid  — invitation UUID (required for upload endpoint)
export default function VoiceRecorder({ uuid }) {
  // phase: idle | recording | recorded | uploading | sent
  const [phase,      setPhase]      = useState('idle');
  const [remaining,  setRemaining]  = useState(MAX_SECONDS);
  const [audioBlob,  setAudioBlob]  = useState(null);
  const [audioUrl,   setAudioUrl]   = useState(null);
  const [micError,   setMicError]   = useState(null);
  const [uploadErr,  setUploadErr]  = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const recorderRef = useRef(null);
  const chunksRef   = useRef([]);
  const timerRef    = useRef(null);
  const streamRef   = useRef(null);

  const stopTimer  = () => { clearInterval(timerRef.current); timerRef.current = null; };
  const stopStream = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };

  useEffect(() => () => {
    stopTimer();
    stopStream();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, []);

  /* ── Start recording ── */
  const startRecording = useCallback(async () => {
    setMicError(null);
    setUploadErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm')              ? 'audio/webm'              :
        MediaRecorder.isTypeSupported('audio/mp4')               ? 'audio/mp4'               :
        '';

      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32000,  // low bitrate → small file, good for mobile
      });
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
      };

      recorder.start(100);
      setPhase('recording');
      setRemaining(MAX_SECONDS);

      timerRef.current = setInterval(() => {
        setRemaining(r => {
          const next = r - 1;
          if (next <= 0) { stopRecording(); return 0; }
          return next;
        });
      }, 1000);

    } catch (err) {
      console.error('[VoiceRecorder]', err.name, err.message);
      setMicError('Hakuna ruhusa ya mikrofoni. Tafadhali ruhusu matumizi ya sauti kwenye kivinjari chako.');
    }
  }, []);

  /* ── Stop recording ── */
  const stopRecording = useCallback(() => {
    stopTimer();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  /* ── Clear / re-record ── */
  const clearRecording = useCallback(() => {
    stopTimer();
    stopStream();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setRemaining(MAX_SECONDS);
    setPhase('idle');
    setUploadErr(null);
  }, [audioUrl]);

  /* ── Send voice message ── */
  const handleSend = async () => {
    if (!audioBlob || !uuid) return;
    setPhase('uploading');
    setUploadErr(null);
    try {
      await sendVoiceMessage(uuid, audioBlob);
      setPhase('sent');
      playVoiceSentSound();
      celebrateRSVP();
      setShowSuccess(true);
    } catch (err) {
      console.error('[sendVoiceMessage]', err);
      setUploadErr('Imeshindwa kutuma. Jaribu tena.');
      setPhase('recorded');
    }
  };

  /* ── Render ── */

  if (phase === 'sent') {
    return (
      <div className="voice-recorder voice-recorder--sent">
        <div className="vr-header">
          <span className="vr-header-icon">🎙️</span>
          <span className="vr-header-title">Ujumbe wa Sauti</span>
        </div>
        <div className="vr-sent-msg">
          <span>✅</span>
          <span>Ujumbe wako umetumwa kwa mafanikio.</span>
        </div>
        {showSuccess && <VoiceSuccessPopup onClose={() => setShowSuccess(false)} />}
      </div>
    );
  }

  return (
    <div className="voice-recorder">
      {/* Header */}
      <div className="vr-header">
        <span className="vr-header-icon">🎙️</span>
        <span className="vr-header-title">Tuma Ujumbe wa Sauti kwa Waandaaji</span>
        <span className="vr-optional">Hiari</span>
      </div>

      {phase === 'idle' && (
        <>
          <p className="vr-desc">Unaweza kuacha ujumbe mfupi wa sauti kwa waandaaji wa tukio.</p>
          {micError && <p className="vr-error">{micError}</p>}
          <button className="vr-btn vr-btn--start" onClick={startRecording}>
            <MdMic size={18} /> Rekodi
          </button>
        </>
      )}

      {phase === 'recording' && (
        <div className="vr-recording-row">
          <span className="vr-pulse-dot" />
          <span className="vr-recording-label">Inarekodi...</span>
          <span className={`vr-countdown${remaining <= 5 ? ' vr-countdown--urgent' : ''}`}>
            {remaining}s
          </span>
          <button className="vr-btn vr-btn--stop" onClick={stopRecording}>
            <MdStop size={17} /> Stop
          </button>
        </div>
      )}

      {(phase === 'recorded' || phase === 'uploading') && audioUrl && (
        <div className="vr-recorded">
          <AudioPlayer url={audioUrl} />

          {uploadErr && <p className="vr-error">{uploadErr}</p>}

          {phase === 'uploading' ? (
            <div className="vr-uploading">
              <div className="vr-upload-spinner" />
              <span>Inatuma ujumbe wako...</span>
            </div>
          ) : (
            <div className="vr-recorded-actions">
              <button className="vr-action-btn vr-action-btn--delete" onClick={clearRecording}>
                <MdDelete size={15} /> Futa
              </button>
              <button className="vr-action-btn vr-action-btn--rerecord" onClick={() => { clearRecording(); setTimeout(startRecording, 60); }}>
                <MdReplay size={15} /> Rekodi Tena
              </button>
              <button className="vr-action-btn vr-action-btn--send" onClick={handleSend}>
                <MdSend size={15} /> Tuma Ujumbe
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
