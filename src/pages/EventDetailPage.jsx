import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Calendar, ChartColumn, CircleCheck, Download,
  Eye, Heart, Hourglass, ImagePlus, LayoutGrid,
  List, Map, MapPin, MessageSquareText, Pencil, Save,
  Search, Share2, Shield, ThumbsDown, ThumbsUp, Ticket,
  Trash2, Users, UsersRound, X, MessageCircle,
} from 'lucide-react';
import { getEvent, updateEvent, deleteInvitation, getVoiceMessages, deleteVoiceMessage,
  sendInvitationSms, sendBulkSms, getBulkSmsProgress, getSmsLogs, retrySms as apiRetrySms,
  listUsersDropdown, getThankYouInfo, saveThankYouTemplate, sendThankYouSms, sendThankYouBulkSms,
  sendWhatsAppInvitation,
} from '../utils/api';
import { isAdmin, canManage } from '../utils/auth';
import WhatsAppPanel from '../components/WhatsAppPanel';
import SendProgressModal from '../components/SendProgressModal';
import { useToast } from '../context/ToastContext';
import VoicePlayerMini from '../components/VoicePlayerMini';
import ConfirmModal from '../components/ConfirmModal';
import '../styles/events.css';
import '../styles/voice-recorder.css';
import '../styles/sms.css';

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

// Generated-card search: case-insensitive partial match on guest name or invitation code.
// Codes also match without punctuation/spaces, so "cn318" and "318" both find "CN-318".
function matchesCardQuery(inv, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = String(inv.guest_name || '').toLowerCase();
  const code = String(inv.code || '').toLowerCase();
  if (name.includes(q) || code.includes(q)) return true;
  const compact = q.replace(/[^a-z0-9]/g, '');
  return compact.length > 0 && code.replace(/[^a-z0-9]/g, '').includes(compact);
}

const VERIFIER_ROLES = ['verifier', 'gate_staff'];

// SMS segment maths. Beem sends with encoding 0 (GSM-7), so anything outside the GSM
// alphabet is flagged rather than silently re-encoded.
const GSM_BASE = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT  = '^{}\\[~]|€';

function smsInfo(text) {
  const s = String(text || '');
  let units = 0;
  let unsupported = false;
  for (const ch of s) {
    if (GSM_BASE.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else { unsupported = true; units += 1; }
  }
  const single = unsupported ? 70 : 160;
  const multi  = unsupported ? 67 : 153;
  const segments = units === 0 ? 0 : (units <= single ? 1 : Math.ceil(units / multi));
  return { chars: s.length, units, segments, unsupported };
}

// Same placeholders the existing SMS service fills in
function personalise(template, inv, ev) {
  const date = ev?.event_date
    ? new Date(ev.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  return String(template || '')
    .replace(/\{guest_name\}/g,      inv?.guest_name || 'Mgeni')
    .replace(/\{event_name\}/g,      ev?.event_name  || '')
    .replace(/\{venue\}/g,           ev?.venue       || '')
    .replace(/\{event_date\}/g,      date)
    .replace(/\{event_time\}/g,      ev?.event_time  || '')
    .replace(/\{invitation_code\}/g, inv?.code       || '');
}

// "Verifier: John" / "Manager: Mary" / "Verifier: Not assigned" — the one assignee in events.assigned_to
function assigneeLabel(ev) {
  if (!ev?.assigned_to) return 'Verifier: Not assigned';
  const name = ev.assigned_to_name || `User #${ev.assigned_to}`;
  return ev.assigned_to_role === 'event_manager' ? `Manager: ${name}` : `Verifier: ${name}`;
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
  const [cardQuery, setCardQuery] = useState('');
  const [staffList, setStaffList] = useState([]);   // for the Event Verifier selector (admins only)
  const canAssignVerifier = isAdmin();                // same rule as the server's canAssign()

  // Post-event thank-you SMS (same rule as the server's requireManager)
  const canSendSms = canManage();
  const [tyInfo,       setTyInfo]       = useState(null);   // { template, counts, already_sent_ids, tracking_available }
  const [tyMessage,    setTyMessage]    = useState('');     // send-time only — never written to the event
  const [tyGroup,      setTyGroup]      = useState('checked_in');
  const [tyResend,     setTyResend]     = useState(false);
  const [tyStep,       setTyStep]       = useState(null);   // null | 'count' | 'preview'
  const [tyStarting,   setTyStarting]   = useState(false);
  const [tyJob,        setTyJob]        = useState(null);   // { jobId, total, sent, failed, skipped, already, done }
  const [tySingle,     setTySingle]     = useState(null);   // invitation awaiting confirmation
  const [tySendingId,  setTySendingId]  = useState(null);
  const [tySentIds,    setTySentIds]    = useState([]);     // invitations already thanked
  const [tyError,      setTyError]      = useState('');     // why the details could not load
  const [tyLoading,    setTyLoading]    = useState(false);
  const [tyEditing,    setTyEditing]    = useState(false);   // view mode ↔ edit mode
  const [tyDraft,      setTyDraft]      = useState('');      // edit buffer, discarded on Cancel
  const [tySaving,     setTySaving]     = useState(false);
  const tySpeedRef = useRef([]);                              // progress samples for real SMS/sec
  const [tySpeed,      setTySpeed]      = useState(null);
  const tyPollRef = useRef(null);
  // Synchronous send guards. State updates are async, so rapid repeat clicks on a confirm
  // button can all run before React re-renders — these refs stop a second send outright.
  const tySingleRef = useRef(false);
  const tyBulkRef   = useRef(false);

  // SMS state
  const [smsSending,     setSmsSending]     = useState({}); // { [invId]: 'idle'|'sending'|'sent'|'failed' }
  // WhatsApp is a separate channel with its own per-row state and its own panel.
  const [waSending,      setWaSending]      = useState({});
  const [waRefresh,      setWaRefresh]      = useState(0);  // bump to reload the panel
  const [selectedIds,    setSelectedIds]    = useState([]); // for "send to selected"
  const [smsConfirm,     setSmsConfirm]     = useState(null);  // invitation | null
  const [bulkSmsConfirm, setBulkSmsConfirm] = useState(false);
  const [bulkJob,        setBulkJob]        = useState(null);  // { jobId, total, sent, failed, done }
  const [smsLogs,        setSmsLogs]        = useState([]);
  const [loadingLogs,    setLoadingLogs]    = useState(false);
  const [showLogs,       setShowLogs]       = useState(false);
  const [retryingLogId,  setRetryingLogId]  = useState(null);
  const pollRef = useRef(null);

  // Provide color defaults so the pickers always save a value, even for old events
  function initForm(ev) {
    return {
      ...ev,
      dress_code_main:      ev.dress_code_main      || '#d4af37',
      dress_code_secondary: ev.dress_code_secondary || '#1a1a2e',
      dress_code_accent:    ev.dress_code_accent     || '#ffffff',
      name_color:           ev.name_color            || '#111111',
      cn_color:             ev.cn_color              || '#222222',
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

  useEffect(() => { setCardQuery(''); setTyMessage(''); setTyJob(null); load(); loadVoice(); loadThankYou(); }, [id]);

  useEffect(() => {
    if (!canAssignVerifier) return;
    listUsersDropdown()
      .then(({ data: d }) => setStaffList(d.users || []))
      .catch(() => setStaffList([]));
  }, [canAssignVerifier]);

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
      date  ? `🗓️ Tarehe: ${date}`  : null,
      time  ? `🕒 Muda: ${time}`  : null,
      venue ? `📍Mahali: ${venue}` : null,
    ].filter(Boolean).join('\n');

    const fullMessage = [
      `KADI YA MWALIKO`,
      `Habari ${inv.guest_name},`,
      `Tunayofuraha kukualika/kuwaalika kuhudhuria:`,
      `${emoji} ${name}`,
      details ? `\n${details}` : '',
      `\nBonyeza link 👇 hapa chini kuona mwaliko wako rasmi, kuthibitisha uwepo wako, na kupata ramani ya kufika kwenye tukio:`,
      url,

      `Karibu sana!`
      ,

  

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

  /* Copy-link was removed from the row actions: Share already hands the guest
     the link, so the two buttons did the same job. */

  /* ── Open guest view ── */
  const handleOpen = (inv) => window.open(inviteLink(inv), '_blank');

  /* ── Send single SMS ── */
  const handleSendSms = async (inv) => {
    setSmsConfirm(null);
    setSmsSending(prev => ({ ...prev, [inv.id]: 'sending' }));
    try {
      await sendInvitationSms(inv.id);
      setSmsSending(prev => ({ ...prev, [inv.id]: 'sent' }));
      showToast(`SMS sent to ${inv.guest_name}.`, 'success');
      setTimeout(() => setSmsSending(prev => ({ ...prev, [inv.id]: 'idle' })), 6000);
    } catch (err) {
      setSmsSending(prev => ({ ...prev, [inv.id]: 'failed' }));
      // No response means we don't know whether it went out — say so rather than "failed".
      showToast(err.response?.data?.message
        || (err.response ? 'Failed to send SMS.' : 'No answer from the server — check the SMS log before resending.'), 'error');
      setTimeout(() => setSmsSending(prev => ({ ...prev, [inv.id]: 'idle' })), 6000);
    }
  };

  /* ── Send bulk SMS ── */
  const handleBulkSms = async () => {
    setBulkSmsConfirm(false);
    try {
      const { data } = await sendBulkSms(id);
      setBulkJob({ jobId: data.job_id, total: data.total, sent: 0, failed: 0, done: false });
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const { data: p } = await getBulkSmsProgress(data.job_id);
          setBulkJob({ jobId: p.job_id, total: p.total, sent: p.sent, failed: p.failed, done: p.done });
          if (p.done) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            showToast(`Bulk SMS complete — ${p.sent} sent, ${p.failed} failed.`, 'success');
          }
        } catch (pollErr) {
          // 404 = job expired or the server restarted: it will never report done.
          // Stop instead of spinning forever; other errors are transient.
          if (pollErr.response?.status === 404) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBulkJob(null);
            showToast('Lost track of the bulk SMS job — check the SMS log for what was sent.', 'error');
          }
        }
      }, 1200);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to start bulk SMS.', 'error');
    }
  };

  /* ── Post-event thank-you: load default message + recipient counts ── */
  const loadThankYou = () => {
    if (!canSendSms) return;
    setTyLoading(true);
    setTyError('');
    getThankYouInfo(id)
      .then(({ data: d }) => {
        setTyInfo(d);
        setTySentIds(d.already_sent_ids || []);
        // d.template is the saved message when the event has one, else the default
        if (!tyEditing) setTyMessage(d.template || '');
      })
      .catch((err) => {
        // Never hide the section silently — show why, so the cause is visible on the page
        setTyInfo(null);
        setTyError(err.response?.data?.message || err.message || 'Could not load the thank-you details.');
      })
      .finally(() => setTyLoading(false));
  };

  /* ── Thank-you message: edit → save → edit again ── */
  const startTyEdit  = () => { setTyDraft(tyMessage); setTyEditing(true); };
  const cancelTyEdit = () => { setTyDraft(''); setTyEditing(false); };   // unsaved changes dropped

  const saveTyMessage = async () => {
    const text = tyDraft.trim();
    const max  = tyInfo?.max_chars || 800;
    if (!text)             { showToast('The message cannot be empty.', 'error'); return; }
    if (text.length > max) { showToast(`Message too long — maximum ${max} characters.`, 'error'); return; }
    setTySaving(true);
    try {
      const { data } = await saveThankYouTemplate(id, text);
      const saved = data.saved_template || text;
      setTyMessage(saved);
      setTyInfo(prev => (prev ? { ...prev, saved_template: saved, template: saved } : prev));
      setTyEditing(false);
      setTyDraft('');
      showToast('Message saved successfully', 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to save the message.', 'error');
    } finally {
      setTySaving(false);
    }
  };

  /* ── Thank-you: one guest ── */
  const handleThankYouSingle = async (inv) => {
    if (!inv || tySingleRef.current) return;
    tySingleRef.current = true;
    setTySingle(null);
    setTySendingId(inv.id);
    try {
      await sendThankYouSms(inv.id, tyMessage);
      setTySentIds(prev => (prev.includes(inv.id) ? prev : [...prev, inv.id]));
      showToast(`Thank-you SMS sent to ${inv.guest_name}.`, 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to send thank-you SMS.', 'error');
    } finally {
      tySingleRef.current = false;
      setTySendingId(null);
    }
  };

  /* ── Thank-you: bulk (recipients are resolved on the server) ── */
  const startThankYouBulk = async () => {
    if (tyBulkRef.current || tyStarting || (tyJob && !tyJob.done)) return;  // server guards too (409)
    tyBulkRef.current = true;
    setTyStep(null);
    setTyStarting(true);
    try {
      const { data } = await sendThankYouBulkSms(id, {
        message:    tyMessage,
        recipients: tyGroup,
        resend:     tyResend,
      });
      tySpeedRef.current = [{ t: Date.now(), processed: 0 }];
      setTySpeed(null);
      setTyJob({
        jobId: data.job_id, total: data.total, sent: 0, failed: 0,
        skipped: data.skipped || 0, skipped_no_phone: data.skipped_no_phone || 0,
        skipped_already: data.skipped_already || 0, already: data.already || 0,
        failures: [], done: false,
      });
      if (tyPollRef.current) clearInterval(tyPollRef.current);
      tyPollRef.current = setInterval(async () => {
        try {
          const { data: p } = await getBulkSmsProgress(data.job_id);
          setTyJob({
            jobId: p.job_id, total: p.total, sent: p.sent, failed: p.failed,
            skipped: p.skipped || 0, skipped_no_phone: p.skipped_no_phone || 0,
            skipped_already: p.skipped_already || 0, already: p.already || 0,
            failures: p.failures || [], done: p.done,
          });

          // Real throughput: processed messages over elapsed time, across a short window
          // of actual progress samples. Nothing is estimated or animated.
          const processed = (p.sent || 0) + (p.failed || 0);
          const samples = tySpeedRef.current;
          samples.push({ t: Date.now(), processed });
          if (samples.length > 6) samples.shift();
          const first = samples[0];
          const last  = samples[samples.length - 1];
          const secs  = (last.t - first.t) / 1000;
          setTySpeed(secs > 0.5 ? (last.processed - first.processed) / secs : null);

          if (p.done) {
            clearInterval(tyPollRef.current);
            tyPollRef.current = null;
            loadThankYou();      // refresh the already-thanked list behind the modal
          }
        } catch (pollErr) {
          if (pollErr.response?.status === 404) {   // job gone — it will never finish
            clearInterval(tyPollRef.current);
            tyPollRef.current = null;
            setTyJob(null);
            setTySpeed(null);
            showToast('Lost track of the thank-you job — check the SMS log for what was sent.', 'error');
            loadThankYou();
          }
        }
      }, 700);
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to start thank-you SMS.', 'error');
    } finally {
      tyBulkRef.current = false;
      setTyStarting(false);
    }
  };

  /* ── Load SMS logs ── */
  const loadSmsLogs = async () => {
    setLoadingLogs(true);
    try {
      const { data } = await getSmsLogs(id);
      setSmsLogs(data.logs || []);
    } catch { /* */ }
    finally { setLoadingLogs(false); }
  };

  /* ── Retry failed SMS ── */
  const handleRetry = async (log) => {
    setRetryingLogId(log.id);
    try {
      await apiRetrySms(log.id);
      showToast('SMS re-sent successfully.', 'success');
      loadSmsLogs();
    } catch (err) {
      showToast(err.response?.data?.message || 'Retry failed.', 'error');
    } finally {
      setRetryingLogId(null);
    }
  };

  // Stop polling on unmount
  useEffect(() => () => {
    if (pollRef.current)   clearInterval(pollRef.current);
    if (tyPollRef.current) clearInterval(tyPollRef.current);
  }, []);

  /* The separate "admin preview" button was removed: Show opens the same
     invitation, so having both only made the row longer. */

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

  /* ── WhatsApp: one guest ───────────────────────────────────────────────
     The button goes straight to the backend, which validates the number,
     checks for an existing successful send and writes the log. */
  const handleWhatsApp = async (inv) => {
    if (waSending[inv.id] === 'sending') return;          // double-click guard
    if (!inv.phone_number) return showToast('This guest has no phone number.', 'info');
    setWaSending((s) => ({ ...s, [inv.id]: 'sending' }));
    try {
      await sendWhatsAppInvitation(inv.id);
      setWaSending((s) => ({ ...s, [inv.id]: 'sent' }));
      showToast(`WhatsApp invitation sent to ${inv.guest_name}.`, 'success');
      setWaRefresh((n) => n + 1);
    } catch (err) {
      setWaSending((s) => ({ ...s, [inv.id]: 'failed' }));
      // 409 = already sent, 503 = not configured, 502 = provider/number problem.
      showToast(err.response?.data?.message || 'WhatsApp send failed.', 'error');
    }
  };

  /* ── Action buttons shared between list and grid ──
     Share · Download · SMS · WhatsApp · Show · Thanks · Delete.
     Copy-link and the duplicate "admin preview" were removed: Share already
     hands over the link, and Show opens the same invitation. */
  const ActionButtons = ({ inv }) => {
    const smsState = smsSending[inv.id] || 'idle';
    const waState  = waSending[inv.id] || 'idle';
    return (
      <div className="row-actions">
        <button className="btn-action btn-share"   onClick={() => handleShare(inv)}   title="Share" aria-label="Share">
          <Share2 size={14} />
        </button>
        <button className="btn-action btn-download" onClick={() => handleDownload(inv)} disabled={!inv.image_url} title="Download card" aria-label="Download card">
          <Download size={14} />
        </button>
        <button
          className={`btn-action btn-sms${smsState === 'sent' ? ' btn-sms--sent' : smsState === 'failed' ? ' btn-sms--failed' : ''}`}
          onClick={() => inv.phone_number ? setSmsConfirm(inv) : showToast('This guest has no phone number.', 'info')}
          disabled={smsState === 'sending'}
          title={inv.phone_number ? `Send SMS to ${inv.phone_number}` : 'No phone number'}
        >
          {smsState === 'sending'
            ? <span className="sms-retry-spin" />
            : <MessageSquareText size={14} />}
        </button>
        {/* WhatsApp. Lucide has no WhatsApp brand mark and importing one from
            another icon set would break the single-library rule, so MessageCircle
            carries the label and tooltip instead. */}
        <button
          className={`btn-action btn-wa-row${waState === 'sent' ? ' btn-wa-row--sent' : waState === 'failed' ? ' btn-wa-row--failed' : ''}`}
          onClick={() => handleWhatsApp(inv)}
          disabled={waState === 'sending'}
          title={inv.phone_number ? `Send WhatsApp to ${inv.phone_number}` : 'No phone number'}
          aria-label="WhatsApp"
        >
          {waState === 'sending' ? <span className="sms-retry-spin" /> : <MessageCircle size={14} />}
        </button>
        <button className="btn-action btn-open" onClick={() => handleOpen(inv)} title="Show invitation" aria-label="Show invitation">
          <Eye size={14} />
        </button>
        {canSendSms && !isContribution && (
          <button
            className={`btn-action btn-thanks${tySentIds.includes(inv.id) ? ' btn-thanks--sent' : ''}`}
            onClick={() => {
              if (!inv.phone_number) return showToast('This guest has no phone number.', 'info');
              if (tyTooLong) return showToast(`Message too long — maximum ${tyMaxChars} characters.`, 'error');
              setTySingle(inv);
            }}
            disabled={tySendingId === inv.id}
            title={!inv.phone_number ? 'No phone number'
              : tySentIds.includes(inv.id) ? 'Thank You Sent — send again' : 'Send Thank You'}
          >
            {tySendingId === inv.id ? <span className="sms-retry-spin" /> : <Heart size={14} />}
          </button>
        )}
        <button className="btn-action btn-delete"  onClick={() => openDelModal(inv)}  title="Delete" aria-label="Delete">
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

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

  const ev             = data?.event;
  const invs           = data?.invitations || [];
  const stats          = data?.stats || {};
  const rsvp           = data?.rsvp  || {};
  const isContribution = ev?.event_mode === 'contribution';
  const guestsWithPhone = invs.filter(i => i.phone_number).length;
  // This event's cards only — `invs` is loaded for the current event id
  const shownInvs      = cardQuery.trim() ? invs.filter(inv => matchesCardQuery(inv, cardQuery)) : invs;
  // "Select all" covers the rows actually on screen that can be messaged, so it
  // follows the card search rather than silently selecting hidden guests.
  const selectableIds  = shownInvs.filter(inv => inv.phone_number).map(inv => inv.id);
  const analytics      = data?.analytics || null;

  // Thank-you recipients — counts come from the server; the server resolves the guests itself
  const tyCounts       = tyInfo?.counts?.[tyGroup] || { total: 0, with_phone: 0 };
  const tyAlready      = tyInfo?.tracking_available
    ? (tyInfo.already_sent_ids || []).length
    : 0;
  // Counter follows whichever text is on screen: the draft while editing, else the saved message
  const tyShownText    = tyEditing ? tyDraft : tyMessage;
  const tySms          = smsInfo(personalise(tyShownText, shownInvs[0] || invs[0], ev));
  const tyMaxChars     = tyInfo?.max_chars || 800;
  const tyTooLong      = tySms.chars > tyMaxChars;     // the server refuses these too
  const tySkipped      = Math.max(0, tyCounts.total - tyCounts.with_phone);
  const tyQueued       = Math.max(0, tyCounts.with_phone - (tyResend ? 0 : tyAlready));
  const tyBusy         = tyStarting || !!(tyJob && !tyJob.done);

  // Event Verifier selector: verifiers only. If the event is currently assigned to someone who is
  // not in that list (e.g. an event manager, or a verifier this admin can't list), keep them as an
  // option so the current assignment is shown and is NOT silently changed on save.
  const verifierOptions  = staffList.filter(u => VERIFIER_ROLES.includes(u.role));
  const currentAssignee  = ev?.assigned_to
    && !verifierOptions.some(u => u.id === ev.assigned_to)
    ? { id: ev.assigned_to, name: ev.assigned_to_name || `User #${ev.assigned_to}`, role: ev.assigned_to_role }
    : null;
  const assignedValue    = form.assigned_to == null ? '' : String(form.assigned_to);

  return (
    <div className="events-page page-enter">
      <div className="events-container">

        {/* ── Breadcrumb ── */}
        <button className="ev-back" onClick={() => navigate('/events')}>
          <ArrowLeft size={16} /> Events
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
                  <Save size={15} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-outline" onClick={() => { setEditing(false); setForm(initForm(ev)); }}>
                  <X size={15} /> Cancel
                </button>
              </>
            ) : (
              <button className="btn-outline" onClick={() => setEditing(true)}>
                <Pencil size={15} /> Edit Event
              </button>
            )}
          </div>
        </div>

        {/* ── Stats row ── */}
        {isContribution ? (
          <div className="ev-stats-row">
            <div className="ev-mini-stat"><Users size={18}/><span>{invs.length}</span><label>Total Cards</label></div>
          </div>
        ) : (
          <div className="ev-stats-row">
            <div className="ev-mini-stat"><Users size={18}/><span>{stats.total ?? 0}</span><label>Invited</label></div>
            <div className="ev-mini-stat ev-mini--green"><CircleCheck size={18}/><span>{stats.checked_in ?? 0}</span><label>Checked In</label></div>
            <div className="ev-mini-stat"><Hourglass size={18}/><span>{stats.pending ?? 0}</span><label>Pending</label></div>
            <div className="ev-mini-stat ev-mini--green"><ThumbsUp size={18}/><span>{rsvp.attending ?? 0}</span><label>RSVP Yes</label></div>
            <div className="ev-mini-stat ev-mini--red"><ThumbsDown size={18}/><span>{rsvp.declined ?? 0}</span><label>RSVP No</label></div>
          </div>
        )}

        {/* ── Invitation analytics — Single / Double from the existing card_type ── */}
        {!isContribution && analytics && (
          <div className="ev-analytics">
            <div className="ev-an-head">
              <h3><ChartColumn size={16} /> Invitation Analytics</h3>
              {analytics.card_type_available && analytics.total > 0 && (
                <span className="ev-an-note">Expected = Single + (Double × 2)</span>
              )}
            </div>

            {analytics.card_type_available ? (
              <>
                <div className="ev-an-grid">
                  <div className="ev-an-tile">
                    <span className="ev-an-label"><Ticket size={13} /> Single</span>
                    <strong className="ev-an-value">{analytics.single}</strong>
                  </div>
                  <div className="ev-an-tile">
                    <span className="ev-an-label"><Ticket size={13} /> Double</span>
                    <strong className="ev-an-value">{analytics.double}</strong>
                  </div>
                  <div className="ev-an-tile">
                    <span className="ev-an-label"><Users size={13} /> Total</span>
                    <strong className="ev-an-value">{analytics.total}</strong>
                  </div>
                  <div className="ev-an-tile ev-an-tile--gold">
                    <span className="ev-an-label"><UsersRound size={13} /> Expected Guests</span>
                    <strong className="ev-an-value">{analytics.expected_guests}</strong>
                  </div>
                </div>
                {analytics.checked_in_total > 0 && (
                  <p className="ev-an-checkin">
                    Checked in: <strong>{analytics.checked_in_single}</strong> single ·{' '}
                    <strong>{analytics.checked_in_double}</strong> double ·{' '}
                    <strong>{analytics.checked_in_total}</strong> invitations ·{' '}
                    <strong>{analytics.checked_in_guests}</strong> guests present
                  </p>
                )}
              </>
            ) : (
              <p className="ev-an-checkin">
                Single / Double breakdown unavailable — the <code>card_type</code> column is missing.
                Total invitations: <strong>{analytics.total}</strong>.
              </p>
            )}
          </div>
        )}

        {/* ── Event info ── */}
        <div className="ev-info-grid">
          <div className="ev-info-card">
            <h3>{isContribution ? 'Campaign Details' : 'Event Details'}</h3>
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
                  {!isContribution && (
                    <div className="ev-info-edit-row">
                      <label>Time</label>
                      <input value={form.event_time || ''} onChange={e => setForm(f => ({ ...f, event_time: e.target.value }))} placeholder="e.g. 5:00 PM" />
                    </div>
                  )}
                  {!isContribution && (
                    <div className="ev-info-edit-row">
                      <label>Venue</label>
                      <input value={form.venue || ''} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} placeholder="Venue" />
                    </div>
                  )}
                  {!isContribution && (
                    <div className="ev-info-edit-row">
                      <label>Maps Link</label>
                      <input value={form.maps_link || ''} onChange={e => setForm(f => ({ ...f, maps_link: e.target.value }))} placeholder="Google Maps URL" />
                    </div>
                  )}
                  <div className="ev-info-edit-row">
                    <label>Contact Name</label>
                    <input value={form.contact_name || ''} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="Event Coordinator" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Contact Phone</label>
                    <input type="tel" value={form.contact_phone || ''} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="+255754123456" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>SMS Template</label>
                    <div className="sms-template-wrap">
                      <textarea
                        className="sms-template-textarea"
                        rows={8}
                        value={form.sms_template || ''}
                        onChange={e => setForm(f => ({ ...f, sms_template: e.target.value }))}
                        placeholder={`Habari {guest_name},\n\nLeave empty to use the default Swahili template…`}
                      />
                      <span className="sms-template-hint">
                        Placeholders: {'{guest_name}'} &nbsp;{'{event_name}'} &nbsp;{'{venue}'} &nbsp;{'{event_date}'} &nbsp;{'{event_time}'} &nbsp;{'{invitation_code}'}
                      </span>
                    </div>
                  </div>
                  {!isContribution && canAssignVerifier && (
                    <div className="ev-info-edit-row">
                      <label htmlFor="ev-verifier">Event Verifier</label>
                      <select
                        id="ev-verifier"
                        value={assignedValue}
                        onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                      >
                        <option value="">No Verifier</option>
                        {currentAssignee && (
                          <option value={String(currentAssignee.id)}>
                            {currentAssignee.name} (current{currentAssignee.role === 'event_manager' ? ' — Manager' : ''})
                          </option>
                        )}
                        {verifierOptions.map(u => (
                          <option key={u.id} value={String(u.id)}>{u.name}</option>
                        ))}
                      </select>
                      <span className="ev-verifier-hint">
                        {currentAssignee?.role === 'event_manager' && assignedValue === String(currentAssignee.id)
                          ? 'This event is assigned to a manager. Choosing a verifier replaces that assignment.'
                          : 'Only this user can check guests in for this event. Past check-ins keep their original verifier.'}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {ev?.event_date && <div className="ev-info-row"><Calendar size={15}/><span>{formatDate(ev.event_date)}</span></div>}
                  {!isContribution && ev?.event_time && <div className="ev-info-row"><span style={{width:15,textAlign:'center'}}>🕒</span><span>{ev.event_time}</span></div>}
                  {!isContribution && ev?.venue && <div className="ev-info-row"><MapPin size={15}/><span>{ev.venue}</span></div>}
                  {!isContribution && ev?.maps_link && (
                    <div className="ev-info-row">
                      <Map size={15}/>
                      <a href={ev.maps_link} target="_blank" rel="noreferrer" className="ev-maps-link">Open Directions</a>
                    </div>
                  )}
                  {ev?.contact_phone && (
                    <div className="ev-info-row">
                      <span style={{width:15,textAlign:'center'}}>📞</span>
                      <a href={`tel:${ev.contact_phone}`} className="ev-maps-link">{ev.contact_name || ev.contact_phone}</a>
                    </div>
                  )}
                  {!isContribution && (
                    <div className="ev-info-row"><Shield size={15}/><span>{assigneeLabel(ev)}</span></div>
                  )}
                  {!ev?.event_date && !ev?.venue && <p className="ev-info-empty">No details added</p>}
                </>
              )}
            </div>
          </div>

          {/* Dress Code — invitation events only */}
          {!isContribution && (
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
          )}
        </div>

        {/* ── Post-event thank-you SMS — managers/admins, invitation events ── */}
        {!isContribution && canSendSms && (
          <div className="ev-inv-section ty-section" style={{ marginTop: '1.5rem' }}>
            <div className="ev-inv-head">
              <h2><Heart size={17} /> Post-Event Thank You</h2>
              {tyInfo && <span className="log-count">{tyCounts.with_phone} with phone</span>}
            </div>

            {!tyInfo ? (
              <div className="ty-body">
                {tyLoading ? (
                  <p className="ty-hint">Loading thank-you details…</p>
                ) : (
                  <>
                    <p className="ty-warn ty-warn--stop">{tyError || 'Could not load the thank-you details.'}</p>
                    <p className="ty-hint">
                      The thank-you message and recipient counts come from the server. If this keeps failing,
                      the API may not be running the latest version yet.
                    </p>
                    <div className="ty-actions">
                      <button className="btn-outline" onClick={loadThankYou}>Retry</button>
                    </div>
                  </>
                )}
              </div>
            ) : (
            <div className="ty-body">
              <label className="ty-label" htmlFor={tyEditing ? 'ty-message' : undefined}>Thank You Message</label>

              {tyEditing ? (
                <textarea
                  id="ty-message"
                  className="ty-textarea"
                  rows={6}
                  value={tyDraft}
                  onChange={e => setTyDraft(e.target.value)}
                  placeholder="Thank-you message…"
                  autoFocus
                />
              ) : (
                <p className="ty-saved" data-testid="ty-saved-message">{tyMessage}</p>
              )}

              <div className="ty-meta">
                <span className={tyTooLong || tySms.segments > 2 ? 'ty-meta-warn' : ''}>
                  {tySms.chars} / {tyMaxChars} characters · {tySms.segments} SMS {tySms.segments === 1 ? 'segment' : 'segments'}
                </span>
                {tyEditing ? (
                  <button type="button" className="ty-reset" onClick={() => setTyDraft(tyInfo.default_template || tyInfo.template || '')}>
                    Reset to default
                  </button>
                ) : (
                  <span className="ty-saved-state">
                    {tyInfo.saved_template ? 'Saved for this event' : 'Default message — not yet saved'}
                  </span>
                )}
              </div>

              <div className="ty-edit-actions">
                {tyEditing ? (
                  <>
                    <button className="btn-outline" onClick={cancelTyEdit} disabled={tySaving}>
                      <X size={14} /> Cancel
                    </button>
                    <button className="btn-gold" onClick={saveTyMessage} disabled={tySaving || tyTooLong || !tyDraft.trim()}>
                      <Save size={14} /> {tySaving ? 'Saving…' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button className="btn-outline" onClick={startTyEdit} disabled={tyBusy}>
                    <Pencil size={14} /> Edit Message
                  </button>
                )}
              </div>
              {tyTooLong && (
                <p className="ty-warn ty-warn--stop">
                  Too long to send: {tySms.chars} characters, maximum {tyMaxChars}. Shorten the message by{' '}
                  {tySms.chars - tyMaxChars} character{tySms.chars - tyMaxChars !== 1 ? 's' : ''}.
                </p>
              )}
              {!tyTooLong && tySms.segments > 2 && (
                <p className="ty-warn">
                  This message will be sent as {tySms.segments} SMS segments per guest — each segment is charged separately.
                </p>
              )}
              {tySms.unsupported && (
                <p className="ty-warn">
                  Some characters are outside the standard SMS alphabet and may not display correctly on every phone.
                </p>
              )}
              <p className="ty-hint">
                {'{guest_name}'} is replaced with each guest&apos;s name. Saving keeps this wording for this
                event; the invitation SMS template is separate and is not affected.
              </p>

              <fieldset className="ty-recipients">
                <legend>Recipients</legend>
                <label className={`ty-radio${tyGroup === 'checked_in' ? ' is-active' : ''}`}>
                  <input type="radio" name="ty-group" value="checked_in"
                    checked={tyGroup === 'checked_in'} onChange={() => setTyGroup('checked_in')} />
                  <span>Checked-in guests
                    <em>{tyInfo.counts.checked_in.with_phone} with phone of {tyInfo.counts.checked_in.total}</em>
                  </span>
                </label>
                <label className={`ty-radio${tyGroup === 'all' ? ' is-active' : ''}`}>
                  <input type="radio" name="ty-group" value="all"
                    checked={tyGroup === 'all'} onChange={() => setTyGroup('all')} />
                  <span>All invited guests
                    <em>{tyInfo.counts.all.with_phone} with phone of {tyInfo.counts.all.total}</em>
                  </span>
                </label>
              </fieldset>

              {tyInfo.tracking_available && tyAlready > 0 && (
                <label className="ty-resend">
                  <input type="checkbox" checked={tyResend} onChange={e => setTyResend(e.target.checked)} />
                  <span>Send again to {tyAlready} guest{tyAlready !== 1 ? 's' : ''} already thanked</span>
                </label>
              )}

              <div className="ty-actions">
                <button
                  className="btn-gold ty-send-btn"
                  onClick={() => setTyStep('count')}
                  disabled={tyBusy || tyEditing || tyQueued === 0 || tySms.chars === 0 || tyTooLong}
                >
                  <Heart size={15} className="ty-send-icon" />
                  {tyBusy ? 'Sending…' : `Send Thank You to All (${tyQueued})`}
                </button>
                {tyEditing ? (
                  <span className="ty-skip-note">Save or cancel your changes before sending</span>
                ) : tySkipped > 0 && (
                  <span className="ty-skip-note">{tySkipped} without phone number will be skipped</span>
                )}
              </div>

            </div>
            )}
          </div>
        )}

        {/* ── WhatsApp (separate channel, separate provider, separate logs) ── */}
        {canSendSms && !isContribution && (
          <WhatsAppPanel
            refreshKey={waRefresh}
            eventId={id}
            selectedIds={selectedIds}
            onClearSelection={() => setSelectedIds([])}
          />
        )}

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
                    <List size={18} />
                  </button>
                  <button
                    className={`view-toggle-btn${invView === 'grid' ? ' active' : ''}`}
                    onClick={() => switchInvView('grid')}
                    title="Grid view"
                  >
                    <LayoutGrid size={18} />
                  </button>
                </div>
              )}
              {guestsWithPhone > 0 && !bulkJob && (
                <button className="btn-sms-bulk" onClick={() => setBulkSmsConfirm(true)}>
                  <MessageSquareText size={14} /> Send SMS/Text to All ({guestsWithPhone})
                </button>
              )}
              <button className="btn-gold" onClick={() => navigate(`/create?event=${id}`)}>
                <ImagePlus size={15} /> {isContribution ? 'Generate Cards' : 'Add Invitations'}
              </button>
            </div>

            {/* Bulk SMS progress */}
            {bulkJob && (
              <div className="sms-progress-wrap">
                {bulkJob.done ? (
                  <div className="sms-progress-done">
                    <span>SMS blast complete — <strong>{bulkJob.sent}</strong> sent, <strong>{bulkJob.failed}</strong> failed.</span>
                    <button className="sms-progress-close" onClick={() => setBulkJob(null)}>✕</button>
                  </div>
                ) : (
                  <div className="sms-progress-running">
                    <div className="sms-progress-bar-track">
                      <div
                        className="sms-progress-bar-fill"
                        style={{ width: `${Math.round(((bulkJob.sent + bulkJob.failed) / bulkJob.total) * 100)}%` }}
                      />
                    </div>
                    <span className="sms-progress-text">
                      Sending {bulkJob.sent + bulkJob.failed} of {bulkJob.total}…
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {invs.length > 0 && (
            <div className="card-search" role="search">
              <Search size={18} className="card-search-icon" aria-hidden="true" />
              <input
                type="search"
                value={cardQuery}
                onChange={(e) => setCardQuery(e.target.value)}
                placeholder="Search guest name or invitation code…"
                aria-label="Search this event's cards by guest name or invitation code"
                autoComplete="off"
                spellCheck={false}
              />
              {cardQuery && (
                <button type="button" className="card-search-clear" onClick={() => setCardQuery('')} aria-label="Clear search">
                  <X size={16} />
                </button>
              )}
              {cardQuery.trim() && (
                <p className="card-search-count" aria-live="polite">
                  {shownInvs.length} of {invs.length} {shownInvs.length === 1 ? 'card' : 'cards'} match
                </p>
              )}
            </div>
          )}

          {invs.length > 0 && shownInvs.length === 0 ? (
            <p className="card-search-empty">No cards in this event match “{cardQuery.trim()}”.</p>
          ) : invs.length === 0 ? (
            <div className="events-empty" style={{ padding: '3rem 1rem' }}>
              <Users size={48} style={{ opacity: 0.25 }} />
              <h3>No {isContribution ? 'Contributors' : 'Invitations'} Yet</h3>
              <p>{isContribution ? 'Generate personalised contribution cards for your guests.' : 'Add invitations to start tracking guests.'}</p>
              <button className="btn-gold" onClick={() => navigate(`/create?event=${id}`)}>
                <ImagePlus size={15} /> {isContribution ? 'Generate First Card' : 'Create First Invitation'}
              </button>
            </div>
          ) : isContribution ? (
            /* ── CONTRIBUTION TABLE — Code / Name / Created / Actions ── */
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Card</th><th>Code</th><th>Guest Name</th><th>Created</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shownInvs.map(inv => (
                    <tr key={inv.id}>
                      <td>
                        {inv.image_url
                          ? <a href={inv.image_url} target="_blank" rel="noreferrer"><img src={inv.image_url} alt={inv.code} className="thumb" /></a>
                          : <span className="no-thumb">—</span>}
                      </td>
                      <td><span className="code-cell">{inv.code}</span></td>
                      <td><strong>{inv.guest_name}</strong></td>
                      <td className="date-cell">{formatDateTime(inv.created_at)}</td>
                      <td><ActionButtons inv={inv} /></td>
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
                    {canSendSms && (
                      <th className="inv-pick">
                        <input
                          type="checkbox"
                          aria-label="Select all guests with a phone number"
                          checked={selectableIds.length > 0 && selectedIds.length === selectableIds.length}
                          ref={(el) => { if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < selectableIds.length; }}
                          onChange={(e) => setSelectedIds(e.target.checked ? selectableIds : [])}
                        />
                      </th>
                    )}
                    <th>Card</th><th>Code</th><th>Guest Name</th><th>Phone</th>
                    <th>RSVP</th><th>Voice</th><th>Status</th><th>Created</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shownInvs.map(inv => (
                    <tr key={inv.id} className={selectedIds.includes(inv.id) ? 'inv-row--picked' : undefined}>
                      {canSendSms && (
                        <td className="inv-pick">
                          <input
                            type="checkbox"
                            aria-label={`Select ${inv.guest_name}`}
                            disabled={!inv.phone_number}
                            checked={selectedIds.includes(inv.id)}
                            onChange={(e) => setSelectedIds((ids) =>
                              e.target.checked ? [...ids, inv.id] : ids.filter((x) => x !== inv.id))}
                          />
                        </td>
                      )}
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
              {shownInvs.map(inv => (
                <div key={inv.id} className="inv-grid-card">
                  {/* Card image */}
                  <div className="inv-grid-img">
                    {inv.image_url
                      ? <img src={inv.image_url} alt={inv.code} />
                      : <div className="inv-grid-no-img"><ImagePlus size={28} /></div>
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
                            : <Trash2 size={14} />
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

        {/* ── SMS Logs section ── */}
        <div className="ev-inv-section" style={{ marginTop: '1.5rem' }}>
          <div className="ev-inv-head">
            <h2>SMS Logs</h2>
            <button
              className="btn-outline"
              onClick={() => { setShowLogs(s => !s); if (!showLogs) loadSmsLogs(); }}
              style={{ fontSize: '0.78rem', padding: '0.45rem 0.9rem' }}
            >
              {showLogs ? 'Hide' : 'View Logs'}
            </button>
          </div>

          {showLogs && (
            loadingLogs ? (
              <p style={{ textAlign: 'center', padding: '1.5rem 0', opacity: 0.5 }}>Loading…</p>
            ) : smsLogs.length === 0 ? (
              <p className="ev-info-empty" style={{ padding: '1.5rem 0', textAlign: 'center' }}>
                No SMS logs for this event yet.
              </p>
            ) : (
              <div className="table-scroll">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Guest</th><th>Phone</th><th>Status</th><th>Message ID</th><th>Sent At</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {smsLogs.map(log => (
                      <tr key={log.id}>
                        <td><strong>{log.guest_name || '—'}</strong></td>
                        <td>{log.phone_number}</td>
                        <td><span className={`sms-status sms-status--${log.status}`}>{log.status}</span></td>
                        <td style={{ fontSize: '0.75rem', opacity: 0.6 }}>{log.provider_message_id || '—'}</td>
                        <td className="date-cell">{formatDateTime(log.sent_at)}</td>
                        <td>
                          {log.status === 'failed' && (
                            <button
                              className="btn-action btn-sms"
                              onClick={() => handleRetry(log)}
                              disabled={retryingLogId === log.id}
                              title="Retry SMS"
                            >
                              {retryingLogId === log.id
                                ? <span className="sms-retry-spin" />
                                : <MessageSquareText size={14} />}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

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

      {/* SMS single confirm */}
      <ConfirmModal
        open={!!smsConfirm}
        title="Send SMS?"
        message={smsConfirm ? (
          <>Send invitation SMS to <strong>{smsConfirm.guest_name}</strong>?<br />
          <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{smsConfirm.phone_number}</span></>
        ) : ''}
        confirmLabel="Send"
        cancelLabel="Cancel"
        danger={false}
        onConfirm={() => handleSendSms(smsConfirm)}
        onCancel={() => setSmsConfirm(null)}
      />

      {/* Bulk thank-you progress — every number comes from the server's job state */}
      <SendProgressModal job={tyJob} speed={tySpeed} onClose={() => { setTyJob(null); setTySpeed(null); }} />

      {/* Thank-you — single guest */}
      <ConfirmModal
        open={!!tySingle}
        title="Send Thank You SMS?"
        message={tySingle ? (
          <>
            Send thank-you SMS to <strong>{tySingle.guest_name}</strong>?<br />
            <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{tySingle.phone_number}</span>
            {tySentIds.includes(tySingle.id) && (
              <><br /><span style={{ fontSize: '0.8rem', color: '#fbbf24' }}>This guest has already received a thank-you SMS.</span></>
            )}
            <pre className="ty-preview">{personalise(tyMessage, tySingle, ev)}</pre>
          </>
        ) : ''}
        confirmLabel="Send"
        cancelLabel="Cancel"
        danger={false}
        icon={<Heart size={26} />}
        onConfirm={() => handleThankYouSingle(tySingle)}
        onCancel={() => setTySingle(null)}
      />

      {/* Thank-you — bulk, step 1: how many */}
      <ConfirmModal
        open={tyStep === 'count'}
        title="Send Thank You SMS"
        message={
          <>
            You are about to send a thank-you message to:<br />
            <strong style={{ fontSize: '1.4rem' }}>{tyQueued} guest{tyQueued !== 1 ? 's' : ''}</strong><br />
            <span style={{ fontSize: '0.82rem', opacity: 0.7 }}>
              {tyGroup === 'checked_in' ? 'Checked-in guests' : 'All invited guests'} · {tySms.segments} SMS per guest
              {tySkipped > 0 && <> · {tySkipped} skipped (no phone)</>}
              {!tyResend && tyAlready > 0 && <> · {tyAlready} already thanked</>}
            </span>
          </>
        }
        confirmLabel="Continue"
        cancelLabel="Cancel"
        danger={false}
        icon={<Heart size={26} />}
        onConfirm={() => setTyStep('preview')}
        onCancel={() => setTyStep(null)}
      />

      {/* Thank-you — bulk, step 2: final preview */}
      <ConfirmModal
        open={tyStep === 'preview'}
        title="Confirm Message"
        message={
          <>
            <span style={{ fontSize: '0.82rem', opacity: 0.75 }}>
              This message will be sent to {tyQueued} guest{tyQueued !== 1 ? 's' : ''}:
            </span>
            <pre className="ty-preview">{personalise(tyMessage, invs[0], ev)}</pre>
          </>
        }
        confirmLabel={tyBusy ? 'Sending…' : 'Send Now'}
        cancelLabel="Back"
        danger={false}
        icon={<Heart size={26} />}
        onConfirm={startThankYouBulk}
        onCancel={() => setTyStep('count')}
      />

      {/* SMS bulk confirm */}
      <ConfirmModal
        open={bulkSmsConfirm}
        title="Send SMS to All Guests?"
        message={
          <>Send an invitation SMS to <strong>{guestsWithPhone}</strong> guest{guestsWithPhone !== 1 ? 's' : ''} with phone numbers?</>
        }
        confirmLabel="Send All"
        cancelLabel="Cancel"
        danger={false}
        onConfirm={handleBulkSms}
        onCancel={() => setBulkSmsConfirm(false)}
      />
    </div>
  );
}
