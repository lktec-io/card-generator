import { useState, useRef, useCallback } from 'react';
import { generateCard } from '../utils/api';
import '../styles/create.css';

const LANG_OPTIONS = [
  { value: 'english',  label: 'English' },
  { value: 'swahili',  label: 'Kiswahili' },
];

export default function CardGenerator() {
  const [imageFile, setImageFile]     = useState(null);
  const [imagePreview, setPreview]    = useState(null);
  const [guestName, setGuestName]     = useState('');
  const [language, setLanguage]       = useState('english');
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null);   // { code, guest_name, image_url }
  const [error, setError]             = useState('');
  const [dragOver, setDragOver]       = useState(false);

  const fileInputRef = useRef(null);

  // ── file handling ─────────────────────────────────────────────────────

  const applyFile = useCallback((file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Only JPEG, PNG, or WebP images are supported.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10 MB.');
      return;
    }
    setImageFile(file);
    setPreview(URL.createObjectURL(file));
    setError('');
    setResult(null);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    applyFile(e.dataTransfer.files[0]);
  }, [applyFile]);

  // ── generate ──────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!imageFile)        return setError('Please upload a wedding card image first.');
    if (!guestName.trim()) return setError('Please enter the guest name.');

    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('image',      imageFile);
    formData.append('guest_name', guestName.trim());
    formData.append('language',   language);

    try {
      const { data } = await generateCard(formData);
      setResult(data);
      // Store last generated URL so VerifyPage can use it as background
      localStorage.setItem('lastCardUrl', data.image_url);
    } catch (err) {
      setError(err.response?.data?.message || 'Generation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setPreview(null);
    setGuestName('');
    setLanguage('english');
    setResult(null);
    setError('');
  };

  // ── render ────────────────────────────────────────────────────────────

  return (
    <div className="create-page">
      <div className="create-header">
        <h1>💍 Create Invitation Card</h1>
        <p>Upload your card design — we'll embed the QR code and guest details.</p>
      </div>

      <div className="create-layout">

        {/* ── Left: form ── */}
        <div className="form-panel">

          {/* Upload box */}
          <div
            className={`upload-box${dragOver ? ' drag-over' : ''}`}
            onClick={() => fileInputRef.current.click()}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current.click()}
            aria-label="Upload wedding card"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => applyFile(e.target.files[0])}
            />
            {imagePreview ? (
              <img src={imagePreview} alt="Card preview" />
            ) : (
              <>
                <div className="upload-icon">📂</div>
                <p className="upload-title">Drop wedding card here</p>
                <p className="upload-sub">or click to browse · JPG · PNG · WebP · max 10 MB</p>
              </>
            )}
          </div>

          {/* Guest name */}
          <div className="form-group">
            <label htmlFor="guestName">Guest Name</label>
            <input
              id="guestName"
              type="text"
              placeholder="e.g. John & Jane Doe"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              maxLength={100}
            />
          </div>

          {/* Language */}
          <div className="form-group">
            <label htmlFor="language">Invitation Language</label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {error && <p className="form-error">{error}</p>}

          <button
            className="btn-gold"
            onClick={handleGenerate}
            disabled={loading || !imageFile || !guestName.trim()}
          >
            {loading ? '⏳ Generating…' : '✨ Generate Card'}
          </button>
        </div>

        {/* ── Right: result ── */}
        <div className="result-panel">
          {!result ? (
            <div className="result-placeholder">
              <p>Generated card will appear here</p>
            </div>
          ) : (
            <div className="result-card">
              <img src={result.image_url} alt="Generated invitation" />

              <div className="result-meta">
                <p className="result-code">Code: {result.code}</p>
                <p className="result-name">Guest: {result.guest_name}</p>
              </div>

              <div className="result-actions">
                <a
                  href={result.image_url}
                  download={`${result.code}.png`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-gold"
                >
                  ⬇ Download Card
                </a>
                <button className="btn-outline" onClick={handleReset}>
                  Create Another
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
