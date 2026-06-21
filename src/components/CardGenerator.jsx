import { useState } from 'react';
import { generateCard } from '../utils/api';
import { MdAutoAwesome, MdDownload, MdAddPhotoAlternate, MdExpandMore, MdExpandLess } from 'react-icons/md';
import { FiRefreshCw } from 'react-icons/fi';
import '../styles/create.css';

export default function CardGenerator({ event = null }) {
  const eventId        = event?.id     || null;
  const isContribution = event?.event_mode === 'contribution';

  const [imageFile,    setImageFile]   = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [dragOver,     setDragOver]    = useState(false);

  const [guestName,    setGuestName]   = useState('');
  const [phoneNumber,  setPhoneNumber] = useState('');
  const [amount,       setAmount]      = useState('');

  const [nameColor,    setNameColor]   = useState(event?.name_color   || '#111111');
  const [cnColor,      setCnColor]     = useState(event?.cn_color     || '#222222');
  const [amountColor,  setAmountColor] = useState(event?.amount_color || '#222222');
  const [showColors,   setShowColors]  = useState(false);

  const [result,       setResult]      = useState(null); // { image_url, code, guest_name }
  const [loading,      setLoading]     = useState(false);
  const [progress,     setProgress]    = useState(0);
  const [error,        setError]       = useState('');

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setResult(null);
    setError('');
  };

  const handleFileChange = (e) => loadFile(e.target.files[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    loadFile(e.dataTransfer.files[0]);
  };

  const finishProgress = () => {
    setProgress(100);
    setTimeout(() => { setProgress(0); setLoading(false); }, 350);
  };

  const handleGenerate = async () => {
    if (!imageFile)         return setError('Please upload a card image first.');
    if (!guestName.trim())  return setError('Guest name is required.');

    setLoading(true);
    setError('');
    setProgress(15);

    const fd = new FormData();
    fd.append('image',            imageFile);
    fd.append('guest_name',       guestName.trim());
    fd.append('phone',            phoneNumber.trim() || '');
    fd.append('name_color',       nameColor);
    fd.append('cn_color',         cnColor);
    fd.append('amount_color',     amountColor);
    if (eventId)            fd.append('event_id',           String(eventId));
    if (isContribution && amount.trim()) {
      fd.append('requested_amount', amount.trim());
    }

    try {
      setProgress(40);
      const { data } = await generateCard(fd);
      setProgress(90);
      if (!data.success) throw new Error(data.message || 'Generation failed.');
      setResult({ image_url: data.image_url, code: data.code, guest_name: data.guest_name });
      finishProgress();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Generation failed. Please try again.');
      setProgress(0);
      setLoading(false);
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setGuestName('');
    setPhoneNumber('');
    setAmount('');
    setResult(null);
    setError('');
    setProgress(0);
  };

  return (
    <>
      {progress > 0 && (
        <div className="top-loader" style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }} />
      )}

      <div className="create-page page-enter">
        <div className="create-header">
          <span className="create-ornament">— Card Generator —</span>
          <h1>{isContribution ? 'Create Contribution Card' : 'Create Invitation Card'}</h1>
          <p>Upload your card design, enter the guest name — QR code and invitation number are added automatically.</p>
        </div>

        <div className="create-layout">

          {/* ── Left: form ── */}
          <div className="form-panel">

            <label
              className={`upload-box${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
              {imagePreview ? (
                <img src={imagePreview} alt="Uploaded card" />
              ) : (
                <>
                  <MdAddPhotoAlternate className="upload-icon" />
                  <span className="upload-title">Upload Card Design</span>
                  <span className="upload-sub">Click or drag &amp; drop — JPG, PNG, WebP</span>
                </>
              )}
            </label>

            <div className="form-group">
              <label htmlFor="guestName">Guest Name</label>
              <input
                id="guestName"
                type="text"
                placeholder="e.g. John &amp; Jane Doe"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && guestName.trim() && handleGenerate()}
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label htmlFor="phoneNumber">Phone Number</label>
              <input
                id="phoneNumber"
                type="tel"
                placeholder="e.g. +255712345678"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                maxLength={30}
              />
            </div>

            {isContribution && (
              <div className="form-group">
                <label htmlFor="amount">Contribution Amount</label>
                <input
                  id="amount"
                  type="text"
                  placeholder="e.g. TZS 50,000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  maxLength={50}
                />
              </div>
            )}

            {/* Card text color pickers — collapsible */}
            <div className="color-section">
              <button
                type="button"
                className="color-section-toggle"
                onClick={() => setShowColors(v => !v)}
              >
                Card Text Colors
                {showColors ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
              </button>
              {showColors && (
                <div className="color-pickers-grid">
                  <div className="color-picker-row">
                    <span className="color-picker-label">Name</span>
                    <input type="color" value={nameColor}   onChange={(e) => setNameColor(e.target.value)}   />
                    <span className="color-hex-sm">{nameColor}</span>
                  </div>
                  <div className="color-picker-row">
                    <span className="color-picker-label">Code (CN)</span>
                    <input type="color" value={cnColor}     onChange={(e) => setCnColor(e.target.value)}     />
                    <span className="color-hex-sm">{cnColor}</span>
                  </div>
                  {isContribution && (
                    <div className="color-picker-row">
                      <span className="color-picker-label">Amount</span>
                      <input type="color" value={amountColor} onChange={(e) => setAmountColor(e.target.value)} />
                      <span className="color-hex-sm">{amountColor}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && <p className="form-error">{error}</p>}

            <button
              className="btn-gold"
              onClick={handleGenerate}
              disabled={loading || !guestName.trim() || !imageFile}
            >
              {loading
                ? <><div className="btn-spinner" /> Generating…</>
                : <><MdAutoAwesome size={17} /> Generate Card</>
              }
            </button>

            {result && (
              <div className="inv-summary">
                <p className="inv-code">{result.code}</p>
                <p className="inv-name">{result.guest_name}</p>
              </div>
            )}
          </div>

          {/* ── Right: card preview ── */}
          <div className="result-panel">
            {loading ? (
              <div className="generate-loading">
                <div className="generate-spinner" />
                <p>Creating your invitation…</p>
              </div>
            ) : !result ? (
              <div className="result-placeholder">
                <div className="result-placeholder-icon">🎴</div>
                <p>Card preview will appear here</p>
              </div>
            ) : (
              <div className="result-card fade">
                <img
                  src={result.image_url}
                  alt={result.guest_name}
                  style={{ width: '100%', borderRadius: 'var(--radius-md)', display: 'block' }}
                />
                <div className="result-actions">
                  <a
                    className="btn-gold"
                    href={result.image_url}
                    download={`${result.code}.png`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}
                  >
                    <MdDownload size={17} /> Download PNG
                  </a>
                  <button className="btn-outline" onClick={handleReset}>
                    <FiRefreshCw size={15} /> New Card
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
