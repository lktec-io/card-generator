import { useState, useEffect, useCallback } from 'react';
import { MdCheckCircle, MdSearch } from 'react-icons/md';
import { listTemplates } from '../utils/api';
import { getTemplateComponent, CATEGORY_EMOJI } from '../templates/index';
import '../styles/template-gallery.css';

/* ── Mini preview wrapper ─────────────────────────────────────────────── */

function TemplateMiniPreview({ slug, event }) {
  const Component = getTemplateComponent(slug);
  return (
    <div className="tg-preview-scale-wrap">
      <div className="tg-preview-scale-inner">
        <Component mini guestName="Jina la Mgeni" invitationCode="CN-001" event={event} qrUrl={null} />
      </div>
    </div>
  );
}

/* ── Main gallery ─────────────────────────────────────────────────────── */

// Props:
//   selectedId   {number|null}  currently selected template id
//   onChange     {fn(template)} called when selection changes
//   event        {object|null}  current event data (used to preview colors)
export default function TemplateGallery({ selectedId, onChange, event }) {
  const [templates,   setTemplates]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState('All');
  const [search,      setSearch]      = useState('');

  useEffect(() => {
    listTemplates()
      .then(({ data }) => setTemplates(data.templates || []))
      .finally(() => setLoading(false));
  }, []);

  const categories = ['All', ...Array.from(new Set(templates.map(t => t.category)))];

  const filtered = templates.filter(t => {
    const matchCat    = filter === 'All' || t.category === filter;
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleSelect = useCallback((tmpl) => {
    onChange(tmpl);
  }, [onChange]);

  return (
    <div className="tg-root">
      {/* Filters */}
      <div className="tg-controls">
        <div className="tg-search">
          <MdSearch size={16} />
          <input
            type="text"
            placeholder="Tafuta template…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="tg-cats">
          {categories.map(c => (
            <button
              key={c}
              className={`tg-cat-btn${filter === c ? ' active' : ''}`}
              onClick={() => setFilter(c)}
            >
              {CATEGORY_EMOJI[c] || '🎉'} {c}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="tg-loading"><div className="tg-spinner" /> Loading templates…</div>
      ) : filtered.length === 0 ? (
        <p className="tg-empty">Hakuna template zinazopatikana.</p>
      ) : (
        <div className="tg-grid">
          {filtered.map(tmpl => {
            const selected = selectedId === tmpl.id;
            return (
              <div
                key={tmpl.id}
                className={`tg-card${selected ? ' tg-card--selected' : ''}`}
                onClick={() => handleSelect(tmpl)}
              >
                {selected && (
                  <div className="tg-check">
                    <MdCheckCircle size={18} />
                  </div>
                )}

                {/* Mini template preview */}
                <div className="tg-card-preview">
                  <TemplateMiniPreview slug={tmpl.slug} event={event} />
                </div>

                <div className="tg-card-info">
                  <p className="tg-card-name">{tmpl.name}</p>
                  <span className="tg-card-cat">
                    {CATEGORY_EMOJI[tmpl.category] || '🎉'} {tmpl.category}
                  </span>
                  {tmpl.is_premium && <span className="tg-card-premium">⭐ Premium</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
