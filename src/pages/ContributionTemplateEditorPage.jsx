import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { MdAddPhotoAlternate, MdSave, MdArrowBack, MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { listAllTemplates, createContributionTemplate, updateTemplateLayout } from '../utils/api';
import { useToast } from '../context/ToastContext';
import ContributionCardCanvas from '../components/ContributionCardCanvas';
import '../styles/contribution.css';
import '../styles/events.css';

const CATEGORIES = [
  'Graduation Fundraising', 'Wedding Contributions', 'Church Building Fund',
  'Mission Project', 'Choir Uniform Fund', 'General Fundraiser',
];

const ELEMENT_LABELS = { guestName: 'Guest Name', cn: 'CN', amount: 'Requested Amount', qr: 'QR Code' };

const SAMPLE_DATA = { guestName: 'Jina la Mfadhili', cn: 'CN-001', amount: 'TZS 50,000' };

function parseLayout(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

export default function ContributionTemplateEditorPage() {
  const { id } = useParams();
  const isNew  = id === 'new';
  const navigate = useNavigate();
  const { showToast } = useToast();
  const canvasRef = useRef(null);

  const [loading, setLoading] = useState(!isNew);
  const [saving,  setSaving]  = useState(false);

  // Step 1 — creation form
  const [name,      setName]      = useState('');
  const [category,  setCategory]  = useState(CATEGORIES[CATEGORIES.length - 1]);
  const [bgFile,    setBgFile]    = useState(null);
  const [bgPreview, setBgPreview] = useState(null);
  const [dragOver,  setDragOver]  = useState(false);
  const [error,     setError]     = useState('');

  // Step 2 — saved template + drag layout
  const [template, setTemplate] = useState(null);
  const [layout,   setLayout]   = useState(null);
  const [qrSample, setQrSample] = useState(null);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    listAllTemplates('contribution')
      .then(({ data }) => {
        const tmpl = (data.templates || []).find((t) => String(t.id) === String(id));
        if (!tmpl) {
          showToast('Template not found.', 'error');
          navigate('/templates');
          return;
        }
        setTemplate(tmpl);
        setLayout(parseLayout(tmpl.layout_config) || {});
      })
      .catch(() => showToast('Failed to load template.', 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // Sample QR — purely illustrative, lets the admin position the optional QR element
  useEffect(() => {
    QRCode.toDataURL('https://wedding.nardio.online/invite/sample-link', {
      errorCorrectionLevel: 'L', margin: 1, width: 300,
    }).then(setQrSample).catch(() => {});
  }, []);

  const loadBgFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setBgFile(file);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => setBgPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Template name is required.');
    if (!bgFile)      return setError('Please upload a background image.');

    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('name', name.trim());
      form.append('category', category);
      form.append('background', bgFile);
      const { data } = await createContributionTemplate(form);
      showToast('Template created — now position the elements.', 'success');
      navigate(`/templates/contributions/${data.template.id}/editor`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create template.');
    } finally {
      setSaving(false);
    }
  };

  const handleLayoutChange = useCallback((next) => setLayout(next), []);

  const toggleQrVisible = () => {
    setLayout((prev) => {
      const cur = prev?.qr || { x: 800, y: 700, visible: false };
      return { ...prev, qr: { ...cur, visible: !cur.visible } };
    });
  };

  const handleSaveLayout = async () => {
    if (!template || !layout) return;
    setSaving(true);
    try {
      await updateTemplateLayout(template.id, layout);
      showToast('Layout saved.', 'success');
    } catch {
      showToast('Failed to save layout.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="cte-page page-enter">
        <div className="events-loading"><div className="ev-spinner" /> Loading…</div>
      </div>
    );
  }

  const showCreateForm = isNew || !template;

  return (
    <div className="cte-page page-enter">
      <div className="events-header">
        <div>
          <span className="events-ornament">— Template Engine —</span>
          <h1>{showCreateForm ? 'New Contribution Template' : `Edit Layout — ${template.name}`}</h1>
          <p>
            {showCreateForm
              ? 'Upload a background image and give your template a name and category.'
              : "Drag Guest Name, CN, Amount and the QR Code onto your template. Works with mouse and touch — the live preview updates instantly."}
          </p>
        </div>
        <button className="btn-outline" onClick={() => navigate('/templates')}>
          <MdArrowBack size={15} /> Back to Templates
        </button>
      </div>

      {showCreateForm ? (
        <div className="cte-layout">
          <form className="cte-panel" onSubmit={handleCreate}>
            <h2 className="cte-panel-title">Template Details</h2>

            <label
              className={`upload-box${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); loadBgFile(e.dataTransfer.files[0]); }}
            >
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => loadBgFile(e.target.files[0])}
              />
              {bgPreview ? (
                <img src={bgPreview} alt="Background preview" />
              ) : (
                <>
                  <MdAddPhotoAlternate className="upload-icon" />
                  <span className="upload-title">Upload Background Image</span>
                  <span className="upload-sub">Click or drag &amp; drop — PNG, JPG, WebP</span>
                </>
              )}
            </label>

            <div className="cte-field">
              <label htmlFor="ct-name">Template Name</label>
              <input
                id="ct-name"
                type="text"
                value={name}
                maxLength={100}
                placeholder="e.g. Graduation Gold Frame"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="cte-field">
              <label htmlFor="ct-cat">Category</label>
              <select id="ct-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {error && <p className="form-error">{error}</p>}

            <button className="btn-gold" type="submit" disabled={saving}>
              {saving ? <><div className="btn-spinner" /> Creating…</> : <><MdSave size={17} /> Create &amp; Continue</>}
            </button>
          </form>

          <div className="cte-panel">
            <h2 className="cte-panel-title">Preview</h2>
            <p className="cte-hint">
              Once created, you'll be able to drag Guest Name, CN, Requested Amount and an optional
              QR Code directly onto this background — exactly where guests will see them.
            </p>
            <ContributionCardCanvas backgroundImage={bgPreview} layoutConfig={null} data={{}} />
          </div>
        </div>
      ) : (
        <div className="cte-layout">
          <div className="cte-panel">
            <h2 className="cte-panel-title">{template.name}</h2>
            <span className="ct-card-cat">{template.category}</span>

            <div className="cte-toggle-row">
              <span>QR Code (optional)</span>
              <button
                type="button"
                className="btn-outline"
                onClick={toggleQrVisible}
                style={{ padding: '0.4rem 0.9rem', fontSize: '0.78rem' }}
              >
                {layout?.qr?.visible
                  ? <><MdVisibility size={15} /> Visible</>
                  : <><MdVisibilityOff size={15} /> Hidden</>}
              </button>
            </div>

            <div className="cte-element-list">
              {Object.keys(ELEMENT_LABELS).map((key) => (
                <span key={key} className={`cte-element-chip${layout?.[key]?.visible ? ' is-visible' : ''}`}>
                  {ELEMENT_LABELS[key]}
                </span>
              ))}
            </div>

            <p className="cte-hint">
              Drag any visible element on the template to reposition it. When you're happy with the
              layout, click <strong>Save Layout</strong> — guests will see this exact placement.
            </p>

            <button className="btn-gold" onClick={handleSaveLayout} disabled={saving}>
              {saving ? <><div className="btn-spinner" /> Saving…</> : <><MdSave size={17} /> Save Layout</>}
            </button>
          </div>

          <div className="cte-canvas-wrap">
            <ContributionCardCanvas
              ref={canvasRef}
              backgroundImage={template.background_image}
              layoutConfig={layout}
              data={{ ...SAMPLE_DATA, qrDataUrl: layout?.qr?.visible ? qrSample : null }}
              editable
              onLayoutChange={handleLayoutChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
