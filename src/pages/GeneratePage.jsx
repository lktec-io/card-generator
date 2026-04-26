import { useState, useRef, useCallback } from 'react';
import '../styles/generator.css';

const LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'sw', label: 'Kiswahili' },
];

export default function GeneratePage() {
  const [file, setFile]           = useState(null);
  const [preview, setPreview]     = useState(null);
  const [guestName, setGuestName] = useState('');
  const [language, setLanguage]   = useState('en');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState('');
  const [dragging, setDragging]   = useState(false);

  const fileInputRef = useRef(null);

  // ── file handling ───────────────────────────────────────────────────

  const applyFile = useCallback((f) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Please upload a JPG, PNG, or WebP image file.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('Image must be under 10 MB.');
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setError('');
    setResult(null);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    applyFile(e.dataTransfer.files[0]);
  }, [applyFile]);

  // ── generate ────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!file)            return setError('Please upload a card image.');
    if (!guestName.trim()) return setError('Please enter the guest name.');

    setLoading(true);
    setError('');

    const form = new FormData();
    form.append('image',      file);
    form.append('guest_name', guestName.trim());
    form.append('language',   language);

    try {
      const res  = await fetch('/api/generate', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok || !data.success) throw new Error(data.message || 'Generation failed.');

      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreview(null);
    setGuestName('');
    setLanguage('en');
    setResult(null);
    setError('');
  };

  // ── render ──────────────────────────────────────────────────────────

  return (
    <div className="gen-page">
      <div className="gen-container">

        {/* Header */}
        <header className="gen-header">
          <p className="gen-header-ornament">✦ &nbsp; ✦ &nbsp; ✦</p>
          <h1>Create Invitation</h1>
          <p className="gen-subtitle">
            Upload your card design and receive a print-ready<br />
            invitation with a unique QR code embedded.
          </p>
        </header>

        {!result ? (
          <div className="gen-form">

            {/* Upload zone */}
            <div
              className={`upload-zone${dragging ? ' dragging' : ''}${preview ? ' has-file' : ''}`}
              onClick={() => fileInputRef.current.click()}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current.click()}
              aria-label="Upload card image"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => applyFile(e.target.files[0])}
              />

              {preview ? (
                <div className="upload-preview-wrap">
                  <img src={preview} alt="Card preview" className="upload-preview-img" />
                  <div className="upload-preview-overlay">
                    <span>Click to change image</span>
                  </div>
                </div>
              ) : (
                <div className="upload-placeholder">
                  <div className="upload-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  <p className="upload-main">Drop your card design here</p>
                  <p className="upload-sub">or click to browse &nbsp;·&nbsp; JPG, PNG, WebP &nbsp;·&nbsp; max 10 MB</p>
                </div>
              )}
            </div>

            {/* Guest name */}
            <div className="form-group">
              <label className="form-label" htmlFor="guestName">
                Guest Name <span className="required">*</span>
              </label>
              <input
                id="guestName"
                type="text"
                className="form-input"
                placeholder="Enter guest's full name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                maxLength={100}
              />
            </div>

            {/* Language */}
            <div className="form-group">
              <label className="form-label" htmlFor="language">
                Invitation Language
              </label>
              <select
                id="language"
                className="form-select"
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
              className="btn-generate"
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? (
                <span className="btn-inner">
                  <span className="spinner" /> Generating…
                </span>
              ) : (
                <span className="btn-inner">Generate Invitation</span>
              )}
            </button>
          </div>

        ) : (
          /* Result */
          <div className="gen-result">
            <div className="result-badge">
              <span className="badge-check">✓</span>
              Invitation Created
            </div>

            <div className="result-meta">
              <div className="meta-row">
                <span className="meta-label">Guest</span>
                <span className="meta-value">{result.guest_name}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Code</span>
                <span className="meta-value code-badge">{result.code}</span>
              </div>
            </div>

            <div className="result-preview">
              <img src={result.image_url} alt="Generated invitation card" />
            </div>

            <div className="result-actions">
              <a
                href={result.image_url}
                download={`invitation-${result.code}.png`}
                target="_blank"
                rel="noreferrer"
                className="btn-download"
              >
                Download Invitation
              </a>
              <button className="btn-new" onClick={handleReset}>
                Create Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
