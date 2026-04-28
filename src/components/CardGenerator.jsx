import { useState, useRef, useCallback } from 'react';
import { generateCard } from '../utils/api';
import { MdCloudUpload, MdDownload, MdAutoAwesome, MdAddPhotoAlternate } from 'react-icons/md';
import { FiRefreshCw } from 'react-icons/fi';
import '../styles/create.css';

function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_W = 700;   // smaller upload = faster server processing
      let w = img.width;
      let h = img.height;
      if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(resolve, 'image/jpeg', 0.60); // 0.60 quality — strong compression, fast upload
    };
    img.src = url;
  });
}

export default function CardGenerator() {
  const [imageFile,    setImageFile]   = useState(null);
  const [imagePreview, setPreview]     = useState(null);
  const [guestName,    setGuestName]   = useState('');
  const [loading,      setLoading]     = useState(false);
  const [progress,     setProgress]    = useState(0);
  const [result,       setResult]      = useState(null);
  const [error,        setError]       = useState('');
  const [dragOver,     setDragOver]    = useState(false);
  const [downloading,  setDownloading] = useState(false);
  const fileInputRef = useRef(null);

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

  const finishProgress = () => {
    setProgress(100);
    setTimeout(() => { setProgress(0); setLoading(false); }, 350);
  };

  const handleGenerate = async () => {
    if (!imageFile) return setError('Please upload a wedding card image first.');
    const name = guestName.trim();
    if (!name) return setError('Guest name is required.');

    // Set loading state FIRST, then yield so React repaints before heavy work
    setLoading(true);
    setError('');
    setProgress(10);
    await new Promise((r) => setTimeout(r, 0)); // yield to event loop → UI updates instantly

    try {
      setProgress(30);
      const compressed = await compressImage(imageFile);

      setProgress(55);
      const fd = new FormData();
      fd.append('image',      compressed, 'card.jpg');
      fd.append('guest_name', name);

      setProgress(70);
      const { data } = await generateCard(fd);

      setProgress(95);
      setResult(data);
      localStorage.setItem('lastCardUrl', data.image_url);
      finishProgress();
    } catch (err) {
      setError(err.response?.data?.message || 'Generation failed. Please try again.');
      finishProgress();
    }
  };

  const handleDownload = async (url, code) => {
    setDownloading(true);
    try {
      const res  = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch failed');
      const blob    = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link    = document.createElement('a');
      link.href     = blobUrl;
      link.download = `wedding-invitation-${code}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setPreview(null);
    setGuestName('');
    setResult(null);
    setError('');
    setProgress(0);
  };

  return (
    <>
      {/* YouTube-style top progress bar */}
      {progress > 0 && (
        <div
          className="top-loader"
          style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }}
        />
      )}

      <div className="create-page page-enter">
        <div className="create-header">
          <span className="create-ornament">— Card Generator —</span>
          <h1>Create Invitation Card</h1>
          <p>Upload your design — we'll embed the QR code and guest details.</p>
        </div>

        <div className="create-layout">

          {/* ── Left: form ── */}
          <div className="form-panel">

            <div
              className={`upload-box${dragOver ? ' drag-over' : ''}`}
              onClick={() => fileInputRef.current.click()}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current.click()}
              aria-label="Upload wedding card image"
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
                  <div className="upload-icon"><MdCloudUpload /></div>
                  <p className="upload-title">Drop wedding card here</p>
                  <p className="upload-sub">or click to browse · JPG · PNG · WebP · max 10 MB</p>
                </>
              )}
            </div>

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

            {error && <p className="form-error">{error}</p>}

            <button
              className="btn-gold"
              onClick={handleGenerate}
              disabled={loading || !imageFile || !guestName.trim()}
            >
              {loading
                ? <><div className="btn-spinner" /> Generating…</>
                : <><MdAutoAwesome size={17} /> Generate Card</>
              }
            </button>
          </div>

          {/* ── Right: result ── */}
          <div className="result-panel">
            {loading ? (
              <div className="generate-loading">
                <div className="generate-spinner" />
                <p>Creating your invitation…</p>
              </div>
            ) : !result ? (
              <div className="result-placeholder">
                <div className="result-placeholder-icon">
                  <MdAddPhotoAlternate />
                </div>
                <p>Generated card will appear here</p>
              </div>
            ) : (
              <div className="result-card fade">
                <img src={result.image_url} alt="Generated invitation" />

                <div className="result-meta">
                  <p className="result-code">{result.code}</p>
                  <p className="result-name">{result.guest_name}</p>
                </div>

                <div className="result-actions">
                  <button
                    className="btn-gold"
                    onClick={() => handleDownload(result.image_url, result.code)}
                    disabled={downloading}
                  >
                    <MdDownload size={17} />
                    {downloading ? 'Saving…' : 'Download'}
                  </button>
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
