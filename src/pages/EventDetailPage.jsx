import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  MdArrowBack, MdCalendarToday, MdLocationOn, MdPalette,
  MdMap, MdPeople, MdCheckCircle, MdHourglassEmpty,
  MdThumbUp, MdThumbDown, MdDownload, MdShare, MdDelete,
  MdQrCodeScanner, MdEdit, MdSave, MdClose, MdContentCopy,
  MdOpenInNew, MdVisibility, MdGridView, MdViewList, MdAddPhotoAlternate,
  MdWarning, MdSms, MdAttachMoney, MdGroups, MdIosShare,
} from 'react-icons/md';
import { FaWhatsapp } from 'react-icons/fa';
import { getEvent, updateEvent, deleteInvitation, getVoiceMessages, deleteVoiceMessage, trackInvitationShare } from '../utils/api';
import { useToast } from '../context/ToastContext';
import VoicePlayerMini from '../components/VoicePlayerMini';
import ConfirmModal from '../components/ConfirmModal';
import '../styles/events.css';
import '../styles/voice-recorder.css';
import '../styles/contribution.css';

const EVENT_TYPES = [
  'Wedding', 'Kitchen Party', 'Birthday', 'Sendoff',
  'Graduation', 'Conference', 'Church Event', 'Corporate Event',
];

const TYPE_COLORS = {
  'Wedding': '#d4af37', 'Birthday': '#a78bfa', 'Kitchen Party': '#fb923c',
  'Sendoff': '#34d399', 'Graduation': '#60a5fa', 'Conference': '#f87171',
  'Church Event': '#fbbf24', 'Corporate Event': '#94a3b8',
};

function formatDate(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status === 'used' ? 'badge-used' : 'badge-unused'}`}>
      {status === 'used' ? 'Checked In' : 'Pending'}
    </span>
  );
}

function formatAmount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// Exact Swahili message format from the Contribution Campaign spec —
// guests see this whether shared by the admin or re-shared by themselves.
function buildContributionMessage(inv, ev, link) {
  const amount = inv.requested_amount != null ? formatAmount(inv.requested_amount) : '0';
  return [
    `Habari ${inv.guest_name}`,
    '',
    'Unaombwa kuchangia katika:',
    '',
    ev?.event_name || '',
    '',
    'Kiasi kilichopangwa:',
    '',
    `TZS ${amount}`,
    '',
    'Fungua link yako hapa:',
    '',
    link,
    '',
    'Asante kwa ushirikiano wako.',
  ].join('\n');
}

function inviteLink(inv) {
  const base = window.location.origin;
  return inv.invitation_uuid
    ? `${base}/invite/${inv.invitation_uuid}`
    : `${base}/invite/${inv.code}`;
}

export default function EventDetailPage() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const { showToast } = useToast();

  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [editing,       setEditing]       = useState(false);
  const [form,          setForm]          = useState({});
  const [saving,        setSaving]        = useState(false);
  const [delInvId,      setDelInvId]      = useState(null);
  const [delInv,        setDelInv]        = useState(null);
  const [voiceMsgs,      setVoiceMsgs]      = useState([]);
  const [loadingVoice,   setLoadingVoice]   = useState(false);
  const [deletingVmId,   setDeletingVmId]   = useState(null);  // id being deleted
  const [deleteVmModal,  setDeleteVmModal]  = useState(null);  // vm object | null  // full inv object for modal
  const [invView,  setInvView]  = useState(() => localStorage.getItem('invView') || 'list');

  // Provide color defaults so the pickers always save a value, even for old events
  function initForm(ev) {
    return {
      ...ev,
      dress_code_main:      ev.dress_code_main      || '#d4af37',
      dress_code_secondary: ev.dress_code_secondary || '#1a1a2e',
      dress_code_accent:    ev.dress_code_accent     || '#ffffff',
      name_color:           ev.name_color            || '#111111',
      cn_color:             ev.cn_color              || '#222222',
      amount_color:         ev.amount_color          || '#222222',
    };
  }

  const load = () => {
    setLoading(true);
    getEvent(id)
      .then(({ data: d }) => { setData(d); setForm(initForm(d.event)); })
      .catch(() => setError('Failed to load event.'))
      .finally(() => setLoading(false));
  };

  const loadVoice = () => {
    setLoadingVoice(true);
    getVoiceMessages(id)
      .then(({ data: d }) => setVoiceMsgs(d.messages || []))
      .catch(() => {})
      .finally(() => setLoadingVoice(false));
  };

  const confirmDeleteVm = async () => {
    const vm = deleteVmModal;
    if (!vm) return;
    setDeleteVmModal(null);
    setDeletingVmId(vm.id);
    try {
      await deleteVoiceMessage(vm.id);
      setVoiceMsgs(prev => prev.filter(m => m.id !== vm.id));
      showToast('Voice message deleted successfully.', 'success');
    } catch {
      showToast('Imeshindwa kufuta ujumbe.', 'error');
    } finally {
      setDeletingVmId(null);
    }
  };

  useEffect(() => { load(); loadVoice(); }, [id]);

  const switchInvView = (v) => {
    setInvView(v);
    localStorage.setItem('invView', v);
  };

  /* ── Save event edits ── */
  const handleSave = async () => {
    setSaving(true);
    try {
      await updateEvent(id, form);
      setEditing(false);
      load();
      showToast('Event updated.', 'success');
    } catch {
      showToast('Failed to update event.', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* ── Blob download — direct file, not new tab ── */
  const handleDownload = async (inv) => {
    if (!inv.image_url) { showToast('No card image available.', 'info'); return; }
    try {
      const res  = await fetch(inv.image_url);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${inv.code}-${(inv.guest_name || '').replace(/\s+/g, '-')}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(inv.image_url, '_blank');
    }
  };

  /* ── Native share → WhatsApp fallback ── */
  const handleShare = async (inv) => {
    const url   = inviteLink(inv);
    const ev    = data?.event;
    const name  = ev?.event_name || 'tukio letu';
    const date  = ev?.event_date ? new Date(ev.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    const time  = ev?.event_time || null;
    const venue = ev?.venue      || null;

    const TYPE_EMOJI = {
      'Wedding': '💍', 'Kitchen Party': '🍽️', 'Birthday': '🎂',
      'Sendoff': '✈️', 'Graduation': '🎓', 'Conference': '💼',
      'Church Event': '⛪', 'Corporate Event': '🏢',
    };
    const emoji = TYPE_EMOJI[ev?.event_type || ''] || '🎉';

    // Build compact details line (no empty lines between date/time/venue)
    const details = [
      date  ? `📅 ${date}`  : null,
      time  ? `🕒 ${time}`  : null,
      venue ? `📍 ${venue}` : null,
    ].filter(Boolean).join('\n');

    const fullMessage = [
      `Habari ${inv.guest_name},`,
      `Tunafurahi kukualika kuhudhuria:`,
      `${emoji} ${name}`,
      details ? `\n${details}` : '',
      `\nFungua link hapa chini kuona mwaliko wako rasmi, QR Code ya kuingilia na kuthibitisha uwepo wako:`,
      url,
      `Karibu sana.`,
    ].filter(Boolean).join('\n');

    if (navigator.share) {
      try {
        // Strip URL from text to prevent duplication (browser appends url param separately)
        const textOnly = fullMessage.replace(url, '').trimEnd();
        await navigator.share({ title: `Mwaliko — ${name}`, text: textOnly, url });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(fullMessage)}`, '_blank');
  };

  /* ── Contribution Campaign sharing — WhatsApp / SMS / Copy Link ──
     Each action also stamps invitations.shared_at (fire-and-forget) so the
     "Total Shared" Contribution Dashboard metric stays accurate. */
  const handleShareContribution = (inv, channel) => {
    const link    = inviteLink(inv);
    const message = buildContributionMessage(inv, data?.event, link);

    if (channel === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
    } else if (channel === 'sms') {
      const phone = (inv.phone_number || '').replace(/[^\d+]/g, '');
      window.location.href = `sms:${phone}?body=${encodeURIComponent(message)}`;
    } else if (channel === 'copy') {
      navigator.clipboard.writeText(message)
        .then(() => showToast('Message copied successfully!', 'success'))
        .catch(() => showToast('Failed to copy.', 'error'));
    }

    trackInvitationShare(inv.id)
      .then(({ data: d }) => {
        if (!d?.success) return;
        setData((prev) => {
          if (!prev) return prev;
          const alreadyShared = prev.invitations.find((i) => i.id === inv.id)?.shared_at;
          return {
            ...prev,
            invitations: prev.invitations.map((i) =>
              i.id === inv.id ? { ...i, shared_at: i.shared_at || new Date().toISOString() } : i),
            contribution: prev.contribution && !alreadyShared
              ? { ...prev.contribution, total_shared: (Number(prev.contribution.total_shared) || 0) + 1 }
              : prev.contribution,
          };
        });
      })
      .catch(() => {});
  };

  /* ── Copy invite link ── */
  const handleCopyLink = (inv) => {
    const url = inviteLink(inv);
    navigator.clipboard.writeText(url)
      .then(() => showToast('Link copied successfully!', 'success'))
      .catch(() => showToast('Failed to copy.', 'error'));
  };

  /* ── Open guest view ── */
  const handleOpen = (inv) => window.open(inviteLink(inv), '_blank');

  /* ── Admin preview (with banner) ── */
  const handlePreview = (inv) => {
    const base = window.location.origin;
    const url  = inv.invitation_uuid
      ? `${base}/display/${inv.invitation_uuid}`
      : inviteLink(inv);
    window.open(url, '_blank');
  };

  /* ── Delete invitation ── */
  const openDelModal  = (inv) => { setDelInvId(inv.id); setDelInv(inv); };
  const closeDelModal = () => { setDelInvId(null); setDelInv(null); };

  const handleDeleteInv = async () => {
    try {
      await deleteInvitation(delInvId);
      setData(prev => ({
        ...prev,
        invitations: prev.invitations.filter(i => i.id !== delInvId),
      }));
      showToast('Invitation deleted.', 'success');
    } catch {
      showToast('Failed to delete invitation.', 'error');
    } finally {
      closeDelModal();
    }
  };

  /* ── Action buttons shared between list and grid ── */
  const ActionButtons = ({ inv }) => (
    <div className="row-actions">
      <button className="btn-action btn-download" onClick={() => handleDownload(inv)} disabled={!inv.image_url} title="Download card">
        <MdDownload size={14} />
      </button>
      <button className="btn-action btn-share"   onClick={() => handleShare(inv)}   title="Share">
        <MdShare size={14} />
      </button>
      <button className="btn-action btn-copy"    onClick={() => handleCopyLink(inv)} title="Copy invite link">
        <MdContentCopy size={14} />
      </button>
      <button className="btn-action btn-open"    onClick={() => handleOpen(inv)}    title="Open guest view">
        <MdOpenInNew size={14} />
      </button>
      <button className="btn-action btn-preview" onClick={() => handlePreview(inv)} title="Admin preview">
        <MdVisibility size={14} />
      </button>
      <button className="btn-action btn-delete"  onClick={() => openDelModal(inv)}  title="Delete">
        <MdDelete size={14} />
      </button>
    </div>
  );

  /* ── Action buttons for Contribution Campaign invitations ──
     Contribution cards are rendered dynamically (no static image_url), so
     "Download" lives on the guest preview page — admins are pointed there.
     Sharing exposes all three spec'd channels directly. */
  const ContributionActionButtons = ({ inv }) => (
    <div className="row-actions">
      <button className="btn-action btn-share" onClick={() => handleShareContribution(inv, 'whatsapp')} title="Share via WhatsApp">
        <FaWhatsapp size={14} />
      </button>
      <button className="btn-action btn-share" onClick={() => handleShareContribution(inv, 'sms')} title="Share via SMS">
        <MdSms size={14} />
      </button>
      <button className="btn-action btn-copy" onClick={() => handleShareContribution(inv, 'copy')} title="Copy contribution message">
        <MdContentCopy size={14} />
      </button>
      <button className="btn-action btn-open" onClick={() => handleOpen(inv)} title="Open guest view">
        <MdOpenInNew size={14} />
      </button>
      <button className="btn-action btn-preview" onClick={() => handlePreview(inv)} title="Preview & download card">
        <MdVisibility size={14} />
      </button>
      <button className="btn-action btn-delete" onClick={() => openDelModal(inv)} title="Delete">
        <MdDelete size={14} />
      </button>
    </div>
  );

  /* ── Loading / error states ── */
  if (loading) return (
    <div className="events-page page-enter">
      <div className="events-container">
        <div className="events-loading"><div className="ev-spinner" /> Loading…</div>
      </div>
    </div>
  );

  if (error) return (
    <div className="events-page page-enter">
      <div className="events-container">
        <p className="ef-error">{error}</p>
        <button className="btn-outline" onClick={() => navigate('/events')}>Back to Events</button>
      </div>
    </div>
  );

  const ev           = data?.event;
  const invs         = data?.invitations || [];
  const stats        = data?.stats || {};
  const rsvp         = data?.rsvp  || {};
  const contribution = data?.contribution || {};
  const isContribution = ev?.event_mode === 'contribution';

  return (
    <div className="events-page page-enter">
      <div className="events-container">

        {/* ── Breadcrumb ── */}
        <button className="ev-back" onClick={() => navigate('/events')}>
          <MdArrowBack size={16} /> Events
        </button>

        {/* ── Event header ── */}
        <div className="ev-detail-header">
          <div className="ev-detail-title">
            <span className="events-ornament">— {ev?.event_type} —</span>
            {editing ? (
              <input
                className="ev-name-edit"
                value={form.event_name || ''}
                onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))}
              />
            ) : (
              <h1>{ev?.event_name}</h1>
            )}
          </div>
          <div className="ev-detail-actions">
            {editing ? (
              <>
                <button className="btn-gold" onClick={handleSave} disabled={saving}>
                  <MdSave size={15} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-outline" onClick={() => { setEditing(false); setForm(initForm(ev)); }}>
                  <MdClose size={15} /> Cancel
                </button>
              </>
            ) : (
              <button className="btn-outline" onClick={() => setEditing(true)}>
                <MdEdit size={15} /> Edit Event
              </button>
            )}
          </div>
        </div>

        {/* ── Stats row ── */}
        {isContribution ? (
          /* ── Contribution Dashboard ── */
          <div className="cd-stats-grid">
            <div className="cd-stat-card">
              <span className="cd-stat-label"><MdGroups size={15} /> Total Records</span>
              <span className="cd-stat-value">{contribution.total_records ?? 0}</span>
            </div>
            <div className="cd-stat-card">
              <span className="cd-stat-label"><MdAttachMoney size={15} /> Total Requested Amount</span>
              <span className="cd-stat-value">TZS {formatAmount(contribution.total_requested_amount)}</span>
            </div>
            <div className="cd-stat-card">
              <span className="cd-stat-label"><MdAttachMoney size={15} /> Average Contribution</span>
              <span className="cd-stat-value">TZS {formatAmount(contribution.avg_contribution)}</span>
            </div>
            <div className="cd-stat-card">
              <span className="cd-stat-label"><MdIosShare size={15} /> Total Shared</span>
              <span className="cd-stat-value">{contribution.total_shared ?? 0}</span>
            </div>
          </div>
        ) : (
          <div className="ev-stats-row">
            <div className="ev-mini-stat"><MdPeople size={18}/><span>{stats.total ?? 0}</span><label>Invited</label></div>
            <div className="ev-mini-stat ev-mini--green"><MdCheckCircle size={18}/><span>{stats.checked_in ?? 0}</span><label>Checked In</label></div>
            <div className="ev-mini-stat"><MdHourglassEmpty size={18}/><span>{stats.pending ?? 0}</span><label>Pending</label></div>
            <div className="ev-mini-stat ev-mini--green"><MdThumbUp size={18}/><span>{rsvp.attending ?? 0}</span><label>RSVP Yes</label></div>
            <div className="ev-mini-stat ev-mini--red"><MdThumbDown size={18}/><span>{rsvp.declined ?? 0}</span><label>RSVP No</label></div>
          </div>
        )}

        {/* ── Event info ── */}
        <div className="ev-info-grid">
          <div className="ev-info-card">
            <h3>Event Details</h3>
            <div className="ev-info-rows">
              {editing ? (
                <>
                  <div className="ev-info-edit-row">
                    <label>Type</label>
                    <select value={form.event_type || 'Wedding'} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                      {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Date</label>
                    <input type="date" value={(form.event_date || '').split('T')[0]} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Time</label>
                    <input value={form.event_time || ''} onChange={e => setForm(f => ({ ...f, event_time: e.target.value }))} placeholder="e.g. 5:00 PM" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Venue</label>
                    <input value={form.venue || ''} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} placeholder="Venue" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Maps Link</label>
                    <input value={form.maps_link || ''} onChange={e => setForm(f => ({ ...f, maps_link: e.target.value }))} placeholder="Google Maps URL" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Contact Name</label>
                    <input value={form.contact_name || ''} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="Event Coordinator" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Contact Phone</label>
                    <input type="tel" value={form.contact_phone || ''} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="+255754123456" />
                  </div>
                </>
              ) : (
                <>
                  {ev?.event_date && <div className="ev-info-row"><MdCalendarToday size={15}/><span>{formatDate(ev.event_date)}</span></div>}
                  {ev?.event_time && <div className="ev-info-row"><span style={{width:15,textAlign:'center'}}>🕒</span><span>{ev.event_time}</span></div>}
                  {ev?.venue      && <div className="ev-info-row"><MdLocationOn size={15}/><span>{ev.venue}</span></div>}
                  {ev?.maps_link  && (
                    <div className="ev-info-row">
                      <MdMap size={15}/>
                      <a href={ev.maps_link} target="_blank" rel="noreferrer" className="ev-maps-link">Open Directions</a>
                    </div>
                  )}
                  {ev?.contact_phone && (
                    <div className="ev-info-row">
                      <span style={{width:15,textAlign:'center'}}>📞</span>
                      <a href={`tel:${ev.contact_phone}`} className="ev-maps-link">{ev.contact_name || ev.contact_phone}</a>
                    </div>
                  )}
                  {!ev?.event_date && !ev?.venue && <p className="ev-info-empty">No details added</p>}
                </>
              )}
            </div>
          </div>

          <div className="ev-info-card">
            <h3>Dress Code</h3>
            {editing ? (
              <div className="ev-info-rows">
                <div className="ev-info-edit-row">
                  <label>Primary Color</label>
                  <div className="color-picker-wrap">
                    <input type="color" value={form.dress_code_main || '#d4af37'} onChange={e => setForm(f => ({ ...f, dress_code_main: e.target.value }))} />
                    <span className="color-swatch" style={{ background: form.dress_code_main || '#d4af37' }} />
                    <span className="color-hex">{form.dress_code_main || '#d4af37'}</span>
                  </div>
                </div>
                <div className="ev-info-edit-row">
                  <label>Secondary Color</label>
                  <div className="color-picker-wrap">
                    <input type="color" value={form.dress_code_secondary || '#1a1a2e'} onChange={e => setForm(f => ({ ...f, dress_code_secondary: e.target.value }))} />
                    <span className="color-swatch" style={{ background: form.dress_code_secondary || '#1a1a2e' }} />
                    <span className="color-hex">{form.dress_code_secondary || '#1a1a2e'}</span>
                  </div>
                </div>
                <div className="ev-info-edit-row">
                  <label>Accent Color</label>
                  <div className="color-picker-wrap">
                    <input type="color" value={form.dress_code_accent || '#ffffff'} onChange={e => setForm(f => ({ ...f, dress_code_accent: e.target.value }))} />
                    <span className="color-swatch" style={{ background: form.dress_code_accent || '#ffffff' }} />
                    <span className="color-hex">{form.dress_code_accent || '#ffffff'}</span>
                  </div>
                </div>
                <div className="ev-info-edit-row">
                  <label>Notes</label>
                  <textarea value={form.dress_code_notes || ''} onChange={e => setForm(f => ({ ...f, dress_code_notes: e.target.value }))} rows={3} />
                </div>
              </div>
            ) : (
              <div className="dress-code-display">
                {(ev?.dress_code_main || ev?.dress_code_secondary || ev?.dress_code_accent || ev?.dress_code_notes) ? (
                  <>
                    <div className="dress-swatches-row">
                      <div className="dress-swatch-chip">
                        <span className="dress-swatch-circle" style={{ background: ev.dress_code_main || '#d4af37' }} />
                        <span>Primary</span>
                      </div>
                      <div className="dress-swatch-chip">
                        <span className="dress-swatch-circle" style={{ background: ev.dress_code_secondary || '#1a1a2e' }} />
                        <span>Secondary</span>
                      </div>
                      <div className="dress-swatch-chip">
                        <span className="dress-swatch-circle" style={{ background: ev.dress_code_accent || '#ffffff', border: '2px solid rgba(255,255,255,0.22)' }} />
                        <span>Accent</span>
                      </div>
                    </div>
                    {ev?.dress_code_notes && <p className="dress-notes">{ev.dress_code_notes}</p>}
                  </>
                ) : (
                  <p className="ev-info-empty">No dress code specified</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Invitations section ── */}
        <div className="ev-inv-section">
          <div className="ev-inv-head">
            <h2>Invitations ({invs.length})</h2>
            <div className="ev-inv-toolbar">
              {/* View toggle — not applicable to Contribution Campaigns (one table format) */}
              {!isContribution && (
                <div className="view-toggle">
                  <button
                    className={`view-toggle-btn${invView === 'list' ? ' active' : ''}`}
                    onClick={() => switchInvView('list')}
                    title="List view"
                  >
                    <MdViewList size={18} />
                  </button>
                  <button
                    className={`view-toggle-btn${invView === 'grid' ? ' active' : ''}`}
                    onClick={() => switchInvView('grid')}
                    title="Grid view"
                  >
                    <MdGridView size={18} />
                  </button>
                </div>
              )}
              <button className="btn-gold" onClick={() => navigate(`/create?event=${id}`)}>
                <MdAddPhotoAlternate size={15} /> {isContribution ? 'Import Contributors' : 'Add Invitations'}
              </button>
            </div>
          </div>

          {invs.length === 0 ? (
            <div className="events-empty" style={{ padding: '3rem 1rem' }}>
              <MdPeople size={48} style={{ opacity: 0.25 }} />
              <h3>No {isContribution ? 'Contributors' : 'Invitations'} Yet</h3>
              <p>{isContribution ? 'Import a contributors list (CSV) to start sharing contribution cards.' : 'Add invitations to start tracking guests.'}</p>
              <button className="btn-gold" onClick={() => navigate(`/create?event=${id}`)}>
                <MdAddPhotoAlternate size={15} /> {isContribution ? 'Import Contributors' : 'Create First Invitation'}
              </button>
            </div>
          ) : isContribution ? (
            /* ── CONTRIBUTION TABLE — Code / Name / Phone / Amount / Shared ── */
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Code</th><th>Guest Name</th><th>Phone</th><th>Amount</th>
                    <th>Shared</th><th>Created</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invs.map(inv => (
                    <tr key={inv.id}>
                      <td><span className="code-cell">{inv.code}</span></td>
                      <td><strong>{inv.guest_name}</strong></td>
                      <td className="date-cell">{inv.phone_number || '—'}</td>
                      <td>
                        {inv.requested_amount != null
                          ? <span className="cd-amount-badge">TZS {formatAmount(inv.requested_amount)}</span>
                          : <span className="no-thumb">—</span>}
                      </td>
                      <td>
                        {inv.shared_at
                          ? <span className="rsvp-mini rsvp-mini--attending">✓ Shared</span>
                          : <span className="rsvp-mini rsvp-mini--none">—</span>}
                      </td>
                      <td className="date-cell">{formatDateTime(inv.created_at)}</td>
                      <td><ContributionActionButtons inv={inv} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : invView === 'list' ? (
            /* ── LIST VIEW ── */
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Card</th><th>Code</th><th>Guest Name</th><th>Phone</th>
                    <th>RSVP</th><th>Voice</th><th>Status</th><th>Created</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invs.map(inv => (
                    <tr key={inv.id}>
                      <td>
                        {inv.image_url
                          ? <a href={inv.image_url} target="_blank" rel="noreferrer"><img src={inv.image_url} alt={inv.code} className="thumb" /></a>
                          : <span className="no-thumb">—</span>}
                      </td>
                      <td><span className="code-cell">{inv.code}</span></td>
                      <td><strong>{inv.guest_name}</strong></td>
                      <td className="date-cell">{inv.phone_number || '—'}</td>
                      <td>
                        {inv.rsvp_response ? (
                          <span className={`rsvp-mini rsvp-mini--${inv.rsvp_response}`}>
                            {inv.rsvp_response === 'attending' ? '✓ Yes' : '✗ No'}
                          </span>
                        ) : <span className="rsvp-mini rsvp-mini--none">—</span>}
                      </td>
                      <td><VoicePlayerMini url={inv.rsvp_voice_url} /></td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="date-cell">{formatDateTime(inv.created_at)}</td>
                      <td><ActionButtons inv={inv} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* ── GRID VIEW ── */
            <div className="inv-grid">
              {invs.map(inv => (
                <div key={inv.id} className="inv-grid-card">
                  {/* Card image */}
                  <div className="inv-grid-img">
                    {inv.image_url
                      ? <img src={inv.image_url} alt={inv.code} />
                      : <div className="inv-grid-no-img"><MdAddPhotoAlternate size={28} /></div>
                    }
                  </div>
                  {/* Info */}
                  <div className="inv-grid-body">
                    <p className="inv-grid-name">{inv.guest_name}</p>
                    <div className="inv-grid-meta">
                      <span className="code-cell">{inv.code}</span>
                      <StatusBadge status={inv.status} />
                      {inv.rsvp_response && (
                        <span className={`rsvp-mini rsvp-mini--${inv.rsvp_response}`}>
                          {inv.rsvp_response === 'attending' ? '✓ RSVP Yes' : '✗ RSVP No'}
                        </span>
                      )}
                    </div>
                    <ActionButtons inv={inv} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Voice Messages section — Invitation Events only ── */}
        {!isContribution && (
        <div className="ev-inv-section" style={{ marginTop: '1.5rem' }}>
          <div className="ev-inv-head">
            <h2>Ujumbe wa Sauti ({voiceMsgs.length})</h2>
            <button className="btn-outline" onClick={loadVoice} disabled={loadingVoice} style={{ fontSize: '0.78rem', padding: '0.45rem 0.9rem' }}>
              {loadingVoice ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {voiceMsgs.length === 0 ? (
            <p className="ev-info-empty" style={{ padding: '1.5rem 0', textAlign: 'center' }}>
              Hakuna ujumbe wa sauti bado.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Jina</th>
                    <th>Msimbo</th>
                    <th>Saa Ilitumwa</th>
                    <th>Ujumbe</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {voiceMsgs.map(vm => (
                    <tr key={vm.id}>
                      <td><strong>{vm.guest_name}</strong></td>
                      <td><span className="code-cell">{vm.invitation_code}</span></td>
                      <td className="date-cell">{formatDateTime(vm.created_at)}</td>
                      <td><VoicePlayerMini url={vm.voice_message_url} /></td>
                      <td>
                        <button
                          className="btn-action btn-delete"
                          onClick={() => setDeleteVmModal(vm)}
                          disabled={deletingVmId === vm.id}
                          title="Futa Ujumbe"
                          aria-label="Delete voice message"
                        >
                          {deletingVmId === vm.id
                            ? <span style={{ width: 14, height: 14, border: '2px solid rgba(239,68,68,0.25)', borderTopColor: '#ef4444', borderRadius: '50%', display: 'inline-block', animation: 'spin .78s linear infinite' }} />
                            : <MdDelete size={14} />
                          }
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

      </div>

      <ConfirmModal
        open={!!(delInvId && delInv)}
        title="Delete Invitation?"
        message={delInv ? (
          <>Remove <strong>{delInv.guest_name}</strong> ({delInv.code})? This action cannot be undone.</>
        ) : ''}
        confirmLabel="Delete"
        onConfirm={handleDeleteInv}
        onCancel={closeDelModal}
      />

      <ConfirmModal
        open={!!deleteVmModal}
        title="Delete Voice Message"
        message={deleteVmModal ? (
          <>
            Are you sure you want to permanently delete the voice message from{' '}
            <strong>{deleteVmModal.guest_name}</strong> ({deleteVmModal.invitation_code})?
            <br /><br />
            This action cannot be undone.
          </>
        ) : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDeleteVm}
        onCancel={() => setDeleteVmModal(null)}
      />
    </div>
  );
}
