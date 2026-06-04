import { useState, useEffect } from 'react';
import { MdToggleOn, MdToggleOff, MdRefresh, MdGridView } from 'react-icons/md';
import { listAllTemplates, toggleTemplate } from '../utils/api';
import { getTemplateComponent, CATEGORY_EMOJI } from '../templates/index';
import { useToast } from '../context/ToastContext';
import '../styles/template-gallery.css';
import '../styles/events.css';

/* ── Thumbnail ────────────────────────────────────────────────────────── */

function TemplateThumbnail({ slug }) {
  const Component = getTemplateComponent(slug);
  return (
    <div className="tg-card-preview" style={{ borderRadius: '8px 8px 0 0' }}>
      <div className="tg-preview-scale-wrap">
        <div className="tg-preview-scale-inner">
          <Component mini guestName="Jina la Mgeni" invitationCode="CN-001" event={null} qrUrl={null} />
        </div>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const { showToast } = useToast();

  const load = () => {
    setLoading(true);
    listAllTemplates()
      .then(({ data }) => setTemplates(data.templates || []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleToggle = async (tmpl) => {
    try {
      const { data } = await toggleTemplate(tmpl.id);
      setTemplates(prev => prev.map(t => t.id === tmpl.id ? data.template : t));
      showToast(`${tmpl.name} ${data.template.is_active ? 'enabled' : 'disabled'}.`, 'success');
    } catch {
      showToast('Failed to update template.', 'error');
    }
  };

  return (
    <div className="events-page page-enter">
      <div className="events-container">

        <div className="events-header">
          <div>
            <span className="events-ornament">— Template Engine —</span>
            <h1>Invitation Templates</h1>
            <p>Manage and preview all available invitation templates</p>
          </div>
          <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
            <button className="btn-outline" onClick={load} disabled={loading} style={{ fontSize: '0.82rem', padding: '0.55rem 1.1rem' }}>
              <MdRefresh size={15} /> Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="events-loading"><div className="ev-spinner" /> Loading…</div>
        ) : (
          <div className="tg-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {templates.map(tmpl => (
              <div key={tmpl.id} className={`tg-card${!tmpl.is_active ? ' tg-card--disabled' : ''}`}
                   style={{ cursor: 'default', opacity: tmpl.is_active ? 1 : 0.55 }}>
                <TemplateThumbnail slug={tmpl.slug} />
                <div className="tg-card-info" style={{ gap: '0.4rem' }}>
                  <p className="tg-card-name">{tmpl.name}</p>
                  <span className="tg-card-cat">
                    {CATEGORY_EMOJI[tmpl.category] || '🎉'} {tmpl.category}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                    <span style={{ fontSize: '0.65rem', color: tmpl.is_active ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                      {tmpl.is_active ? 'Active' : 'Disabled'}
                    </span>
                    <button
                      onClick={() => handleToggle(tmpl)}
                      title={tmpl.is_active ? 'Disable' : 'Enable'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: tmpl.is_active ? '#4ade80' : '#94a3b8', fontSize: '1.4rem', lineHeight: 1 }}
                    >
                      {tmpl.is_active ? <MdToggleOn size={26} /> : <MdToggleOff size={26} />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '2rem', padding: '1.25rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--gold)', display: 'block', marginBottom: '0.4rem' }}>💡 Template Engine</strong>
          Templates are CSS/React components — no image uploads needed.
          Each guest sees the same template with their unique name, QR code, and invitation details injected automatically.
          New templates can be added by creating a component in <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: 4 }}>src/templates/</code> and registering it in the template index.
        </div>

      </div>
    </div>
  );
}
