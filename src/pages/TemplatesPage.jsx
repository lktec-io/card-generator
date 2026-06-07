import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MdToggleOn, MdToggleOff, MdRefresh, MdAddPhotoAlternate, MdEdit } from 'react-icons/md';
import { listAllTemplates, toggleTemplate } from '../utils/api';
import { getTemplateComponent, CATEGORY_EMOJI } from '../templates/index';
import { useToast } from '../context/ToastContext';
import ContributionCardCanvas from '../components/ContributionCardCanvas';
import '../styles/template-gallery.css';
import '../styles/events.css';
import '../styles/contribution.css';

/* ── Thumbnail (invitation — fixed React component) ──────────────────── */

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

const TABS = [
  { key: 'invitation',   label: 'Invitation Templates' },
  { key: 'contribution', label: 'Contribution Templates' },
];

export default function TemplatesPage() {
  const [tab, setTab] = useState('invitation');

  const [invTemplates, setInvTemplates] = useState([]);
  const [ctTemplates,  setCtTemplates]  = useState([]);
  const [loading,      setLoading]      = useState(true);

  const { showToast } = useToast();
  const navigate = useNavigate();

  const load = (which = tab) => {
    setLoading(true);
    listAllTemplates(which)
      .then(({ data }) => {
        if (which === 'invitation') setInvTemplates(data.templates || []);
        else                        setCtTemplates(data.templates || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleToggle = async (tmpl, list, setList) => {
    try {
      const { data } = await toggleTemplate(tmpl.id);
      setList(list.map((t) => (t.id === tmpl.id ? data.template : t)));
      showToast(`${tmpl.name} ${data.template.is_active ? 'enabled' : 'disabled'}.`, 'success');
    } catch {
      showToast('Failed to update template.', 'error');
    }
  };

  const isInvitation = tab === 'invitation';

  return (
    <div className="events-page page-enter">
      <div className="events-container">

        <div className="events-header">
          <div>
            <span className="events-ornament">— Template Engine —</span>
            <h1>Templates</h1>
            <p>Manage Invitation Templates and Contribution Templates from one library.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
            <button className="btn-outline" onClick={() => load(tab)} disabled={loading} style={{ fontSize: '0.82rem', padding: '0.55rem 1.1rem' }}>
              <MdRefresh size={15} /> Refresh
            </button>
            {!isInvitation && (
              <button className="btn-gold" onClick={() => navigate('/templates/contributions/new/editor')} style={{ fontSize: '0.82rem', padding: '0.55rem 1.1rem' }}>
                <MdAddPhotoAlternate size={16} /> Upload Template
              </button>
            )}
          </div>
        </div>

        <div className="tg-cats" style={{ marginBottom: '1.25rem' }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tg-cat-btn${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="events-loading"><div className="ev-spinner" /> Loading…</div>

        ) : isInvitation ? (
          <div className="tg-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {invTemplates.map((tmpl) => (
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
                      onClick={() => handleToggle(tmpl, invTemplates, setInvTemplates)}
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

        ) : (
          <div className="ct-grid">
            <button className="ct-upload-card" onClick={() => navigate('/templates/contributions/new/editor')}>
              <MdAddPhotoAlternate />
              <span>Upload Template</span>
            </button>

            {ctTemplates.map((tmpl) => (
              <div key={tmpl.id} className="ct-card" style={{ opacity: tmpl.is_active ? 1 : 0.6 }}>
                <div className="ct-card-preview">
                  <ContributionCardCanvas
                    backgroundImage={tmpl.background_image}
                    layoutConfig={tmpl.layout_config}
                    data={{ guestName: 'Jina la Mfadhili', cn: 'CN-001', amount: 'TZS 50,000' }}
                    mini
                  />
                </div>
                <div className="ct-card-body">
                  <p className="ct-card-name">{tmpl.name}</p>
                  <div className="ct-card-meta">
                    <span className="ct-card-cat">{tmpl.category}</span>
                    <span className="ct-card-usage">Used {tmpl.usage_count || 0}×</span>
                  </div>
                  <div className="ct-card-meta">
                    <span className={`ct-card-status ct-card-status--${tmpl.is_active ? 'active' : 'disabled'}`}>
                      {tmpl.is_active ? 'Active' : 'Disabled'}
                    </span>
                    <button
                      onClick={() => handleToggle(tmpl, ctTemplates, setCtTemplates)}
                      title={tmpl.is_active ? 'Disable' : 'Enable'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: tmpl.is_active ? '#4ade80' : '#94a3b8', fontSize: '1.4rem', lineHeight: 1 }}
                    >
                      {tmpl.is_active ? <MdToggleOn size={26} /> : <MdToggleOff size={26} />}
                    </button>
                  </div>
                  <div className="ct-card-actions">
                    <button className="btn-outline" style={{ flex: 1, fontSize: '0.78rem', padding: '0.5rem 0.8rem' }}
                            onClick={() => navigate(`/templates/contributions/${tmpl.id}/editor`)}>
                      <MdEdit size={14} /> Edit Layout
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {ctTemplates.length === 0 && (
              <div className="tg-empty" style={{ gridColumn: '1 / -1' }}>
                No contribution templates yet — click "Upload Template" to add one.
              </div>
            )}
          </div>
        )}

        {isInvitation && (
          <div style={{ marginTop: '2rem', padding: '1.25rem', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--gold)', display: 'block', marginBottom: '0.4rem' }}>💡 Template Engine</strong>
            Templates are CSS/React components — no image uploads needed.
            Each guest sees the same template with their unique name, QR code, and invitation details injected automatically.
            New templates can be added by creating a component in <code style={{ background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: 4 }}>src/templates/</code> and registering it in the template index.
          </div>
        )}

      </div>
    </div>
  );
}
