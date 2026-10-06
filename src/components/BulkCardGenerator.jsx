import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Draggable from 'react-draggable';
import QRCode from 'qrcode';
import {
  MdUploadFile, MdCheckCircle, MdError, MdWarning, MdArrowForward, MdArrowBack,
  MdDownload, MdRefresh, MdTableRows, MdImage,
} from 'react-icons/md';
import {
  listEvents, validateGuestSheet, startBulkCardGeneration,
  getBulkCardProgress, retryBulkCards, downloadImportTemplate,
} from '../utils/api';
import { useToast } from '../context/ToastContext';
import '../styles/bulk-generate.css';

/* ── Canvas geometry — identical to CardGenerator so a bulk card and a single
     card drawn at the same positions come out the same ──────────────────── */
const QR_SIZE  = 260;
const QR_PAD   = 16;
const QR_BLOCK = QR_SIZE + QR_PAD * 2;
const ANCHOR_R = 7;

const STEPS = ['Event', 'Upload', 'Review', 'Preview', 'Generate'];

/* Shown in the preview in place of a real CN. No code is reserved until the
   invitations are actually created, so previewing cannot burn a CN number. */
const SAMPLE_CODE = 'CN-000';

/**
 * Turn an axios failure into something that names the actual problem.
 * A plain "could not start" hides the two cases that matter most: the request
 * never reached the application (a proxy refused the upload first), or it
 * reached it and the application said why.
 */
function describeError(err, fallback) {
  const res = err.response;
  if (!res) {
    return err.code === 'ECONNABORTED'
      ? 'The request timed out before the server answered.'
      : `${fallback} The server could not be reached (${err.message}).`;
  }
  const data = res.data;
  if (data && typeof data === 'object' && data.message) return data.message;
  if (res.status === 413) {
    return 'The upload was rejected as too large before it reached the application — the web server\'s upload limit (nginx client_max_body_size) is smaller than the card design.';
  }
  // an HTML error page, an empty body, a gateway error — say what came back
  const body = typeof data === 'string' ? data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  return `${fallback} Server replied HTTP ${res.status}${body ? `: ${body}` : '.'}`;
}

export default function BulkCardGenerator() {
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);

  // 1 — event
  const [events,  setEvents]  = useState([]);
  const [eventId, setEventId] = useState('');

  // 2/3 — spreadsheet
  const [sheetFile,  setSheetFile]  = useState(null);
  const [validating, setValidating] = useState(false);
  const [report,     setReport]     = useState(null);   // server validation result
  const [sheetError, setSheetError] = useState('');
  const [dragOver,   setDragOver]   = useState(false);
  const sheetRef = useRef(null);

  // 4 — card design + layout
  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [natural,      setNatural]      = useState({ w: 0, h: 0 });
  const [pos,          setPos]          = useState(null);
  const [canvasH,      setCanvasH]      = useState(1350);
  const [outputCardW,  setOutputCardW]  = useState(1200);
  const [overlayW,     setOverlayW]     = useState(400);
  const [nameColor, setNameColor] = useState('#111111');
  const [cnColor,   setCnColor]   = useState('#222222');
  const [typeColor, setTypeColor] = useState('#d4af37');
  const [nameFontSizeStr, setNameFontSizeStr] = useState('');
  const [cnFontSizeStr,   setCnFontSizeStr]   = useState('');
  const [typeFontSizeStr, setTypeFontSizeStr] = useState('');
  const [showQR,   setShowQR]   = useState(true);
  const [showCN,   setShowCN]   = useState(true);
  const [showType, setShowType] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const imageRef   = useRef(null);
  const overlayRef = useRef(null);
  const nameAnchorRef = useRef(null);
  const cnAnchorRef   = useRef(null);
  const typeAnchorRef = useRef(null);
  const qrBoxRef      = useRef(null);

  // 5 — the run
  const [starting,   setStarting]   = useState(false);
  const [startError, setStartError] = useState('');
  const [job,      setJob]      = useState(null);      // live progress payload
  const [jobId,    setJobId]    = useState(null);
  const [retrying, setRetrying] = useState(false);
  const startGuard = useRef(false);                     // one click = one run

  const [downloading, setDownloading] = useState(false);
  const [imageError,  setImageError]  = useState('');

  const selectedEvent = events.find((e) => String(e.id) === String(eventId)) || null;
  // The card is previewed with the first guest actually in the file, so what is
  // positioned is a real name of a real length — not a placeholder that fits.
  const sampleGuest = report?.guests?.[0] || null;
  const sampleType  = sampleGuest?.card_type === 'double' ? 'Double' : 'Single';

  const handleDownloadTemplate = async (format) => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res  = await downloadImportTemplate(format);
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: `bulk-invitations.${format}` });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(describeError(err, 'Could not download the template.'), 'error');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    listEvents()
      .then(({ data }) => setEvents(data.events || []))
      .catch(() => showToast('Could not load your events.', 'error'));
  }, [showToast]);

  /* A real QR in the preview — same library, options and payload (the bare code)
     as the card the server renders, so what is positioned is what is printed. */
  useEffect(() => {
    QRCode.toDataURL(SAMPLE_CODE, { errorCorrectionLevel: 'M', margin: 1, width: 400 })
      .then(setQrDataUrl).catch(() => setQrDataUrl(''));
  }, []);

  /* Release the previous object URL only once a NEW one has replaced it, and the
     current one only when the component goes away. Revoking the URL that is
     still set on <img> is what turns the preview into a broken image. */
  useEffect(() => {
    if (!imagePreview) return undefined;
    return () => URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  /* ── geometry ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setOverlayW(entry.contentRect.width));
    ro.observe(el);
    setOverlayW(el.offsetWidth || 400);
    return () => ro.disconnect();
  }, [imagePreview, step]);

  const posScale  = overlayW / 1080;
  const fontScale = overlayW / outputCardW;
  const overlayH  = Math.round(canvasH * posScale);
  const qrBoxPx   = Math.round(QR_BLOCK * posScale);

  const nameFontSize = nameFontSizeStr !== '' ? Math.max(1, parseInt(nameFontSizeStr, 10) || 1) : null;
  const cnFontSize   = cnFontSizeStr   !== '' ? Math.max(1, parseInt(cnFontSizeStr,   10) || 1) : null;
  const typeFontSize = typeFontSizeStr !== '' ? Math.max(1, parseInt(typeFontSizeStr, 10) || 1) : null;

  const onImgLoad = useCallback((e) => {
    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
    setNatural({ w: nw, h: nh });
    const ch = Math.round(1080 * nh / nw);
    setCanvasH(ch);
    setOutputCardW(Math.max(nw, 1200));
    setOverlayW(overlayRef.current?.offsetWidth || 400);
    setPos((prev) => {
      if (prev) return prev;
      const qrTop  = Math.round(ch * 0.52);
      const qrLeft = Math.round((1080 - QR_BLOCK) / 2);
      const nameY  = Math.round(qrTop + QR_BLOCK + ch * 0.06);
      const codeY  = Math.round(nameY + ch * 0.07);
      const typeY  = Math.round(codeY + ch * 0.05);
      return { nameX: 540, nameY, codeX: 540, codeY, qrLeft, qrTop, typeX: 540, typeY };
    });
  }, []);

  const updatePos = useCallback((patch) => setPos((p) => ({ ...p, ...patch })), []);
  const onNameStop = useCallback((_, d) => updatePos({ nameX: Math.round((d.x + ANCHOR_R) / posScale), nameY: Math.round((d.y + ANCHOR_R) / posScale) }), [posScale, updatePos]);
  const onCnStop   = useCallback((_, d) => updatePos({ codeX: Math.round((d.x + ANCHOR_R) / posScale), codeY: Math.round((d.y + ANCHOR_R) / posScale) }), [posScale, updatePos]);
  const onTypeStop = useCallback((_, d) => updatePos({ typeX: Math.round((d.x + ANCHOR_R) / posScale), typeY: Math.round((d.y + ANCHOR_R) / posScale) }), [posScale, updatePos]);
  const onQrStop   = useCallback((_, d) => updatePos({ qrLeft: Math.max(0, Math.round(d.x / posScale)), qrTop: Math.max(0, Math.round(d.y / posScale)) }), [posScale, updatePos]);

  /* ── 2: spreadsheet → server validation ───────────────────────────────── */
  const handleSheet = async (file) => {
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setSheetError('Upload a .xlsx or .csv file. (The old .xls format is not supported — re-save it as .xlsx.)');
      setReport(null);
      return;
    }
    setSheetError('');
    setSheetFile(file);
    setReport(null);
    setValidating(true);
    try {
      const { data } = await validateGuestSheet(file, eventId);
      setReport(data);
      setStep(2);
    } catch (err) {
      const data = err.response?.data;
      if (data?.invalidRows || data?.total) setReport(data);
      setSheetError(describeError(err, 'Could not read that file.'));
      if (data?.invalidRows?.length) setStep(2);
    } finally {
      setValidating(false);
    }
  };

  const resetSheet = () => {
    setSheetFile(null);
    setReport(null);
    setSheetError('');
    setStep(1);
  };

  /* ── 4: card design ───────────────────────────────────────────────────── */
  const handleImage = (file) => {
    if (!file) return;
    setImageError('');

    // Some pickers (notably Android galleries and a few desktop file managers)
    // hand over a file with an empty or generic MIME type. Judging only by
    // file.type silently refused perfectly good images, leaving the preview
    // looking as if nothing had been chosen — so fall back to the extension.
    const looksLikeImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name || '');
    if (!looksLikeImage) {
      setImageError(`"${file.name || 'That file'}" is not a PNG, JPG or WebP image.`);
      showToast('The card design must be a PNG, JPG or WebP image.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImageError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. The card design must be under 10 MB.`);
      showToast('The card design must be under 10 MB.', 'error');
      return;
    }

    setImageFile(file);
    // Revoking happens in the effect below, not inside the updater: a state
    // updater must stay pure, or React may run it twice and revoke a URL that
    // is still on screen.
    setImagePreview(URL.createObjectURL(file));
    setNatural({ w: 0, h: 0 });
    setPos(null);
  };

  const layoutPayload = () => ({
    name_color: nameColor,
    cn_color:   cnColor,
    type_color: typeColor,
    name_font_size: nameFontSize ?? undefined,
    cn_font_size:   cnFontSize   ?? undefined,
    type_font_size: typeFontSize ?? undefined,
    show_qr:   showQR   ? '1' : '0',
    show_cn:   showCN   ? '1' : '0',
    show_type: showType ? '1' : '0',
    natural_w: natural.w || undefined,
    natural_h: natural.h || undefined,
    ...(pos ? {
      pos_name_x: pos.nameX, pos_name_y: pos.nameY,
      pos_code_x: pos.codeX, pos_code_y: pos.codeY,
      pos_qr_left: pos.qrLeft, pos_qr_top: pos.qrTop,
      pos_type_x: pos.typeX, pos_type_y: pos.typeY,
    } : {}),
  });

  /* ── 5: generate ──────────────────────────────────────────────────────── */
  const handleGenerate = async () => {
    if (startGuard.current) return;             // a second click must not start a second batch
    // Each of these has its own message: "nothing happened" is never an answer.
    if (!eventId)   { showToast('No event selected. Go back to step 1.', 'error'); return; }
    if (!sheetFile) { showToast('The guest list is no longer loaded. Upload it again.', 'error'); return; }
    if (!imageFile) { showToast('Upload the card design first.', 'error'); return; }

    startGuard.current = true;
    setStarting(true);
    setStartError('');
    try {
      const { data } = await startBulkCardGeneration(eventId, {
        sheet: sheetFile, image: imageFile, layout: layoutPayload(),
      });
      setJobId(data.job_id);
      setJob({ total: data.total, completed: 0, generated: 0, failed: 0, percent: 0,
               finished: false, failures: [], stage: 'preparing', prepared: 0 });
      setStep(4);
    } catch (err) {
      const data = err.response?.data;
      const message = describeError(err, 'Could not start generation.');
      // Rows that went stale between preview and generate send the user back to
      // the review screen with the reasons, rather than a dead end.
      if (data?.invalidRows?.length) { setReport(data); setStep(2); }
      else setStartError(message);
      showToast(message, 'error');
      // the full failure stays in the console for support
      console.error('[bulk] generation did not start:', err.response?.status, err.response?.data || err.message);
      startGuard.current = false;
    } finally {
      setStarting(false);
    }
  };

  /* Poll the real job state. No timers drive the bar — every number here was
     reported by the backend after a card actually finished. */
  useEffect(() => {
    if (!jobId || job?.finished) return;
    let alive = true;
    const tick = async () => {
      try {
        const { data } = await getBulkCardProgress(jobId);
        if (!alive) return;
        setJob(data);
        if (data.finished) {
          startGuard.current = false;
          showToast(
            data.error  ? data.error
              : data.failed ? `${data.generated} cards generated, ${data.failed} failed.`
                : `All ${data.generated} cards generated.`,
            data.failed || data.error ? 'error' : 'success'
          );
        }
      } catch {
        if (alive) { setJob((j) => ({ ...(j || {}), finished: true, lost: true })); startGuard.current = false; }
      }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => { alive = false; clearInterval(id); };
  }, [jobId, job?.finished, showToast]);

  const handleRetry = async () => {
    if (!jobId || !imageFile || retrying) return;
    setRetrying(true);
    try {
      const { data } = await retryBulkCards(jobId, imageFile);
      setJob((j) => ({ ...j, finished: false, total: (j.total || 0) + data.retrying }));
      showToast(`Retrying ${data.retrying} card${data.retrying > 1 ? 's' : ''}…`, 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not retry.', 'error');
    } finally {
      setRetrying(false);
    }
  };

  const startOver = () => {
    setStep(0); setSheetFile(null); setReport(null); setSheetError('');
    setJob(null); setJobId(null); startGuard.current = false;
  };

  /* ── render helpers ───────────────────────────────────────────────────── */
  const previewNamePx = Math.max(4, Math.round((nameFontSize ?? 150) * fontScale));
  const previewCnPx   = Math.max(3, Math.round((cnFontSize   ?? 100) * fontScale));
  const previewTypePx = Math.max(3, Math.round((typeFontSize ?? 70)  * fontScale));
  const dragReady     = !!(imagePreview && pos && overlayW > 50);

  const canLeaveEvent  = !!eventId;
  const canLeaveReview = !!report && report.valid > 0 && report.invalid === 0;
  const canGenerate    = canLeaveReview && !!imageFile;

  return (
    <div className="bcg">
      {/* ── stepper ── */}
      <ol className="bcg-steps" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`bcg-step${i === step ? ' bcg-step--on' : ''}${i < step ? ' bcg-step--done' : ''}`}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="bcg-step-dot">{i < step ? '✓' : i + 1}</span>
            <span className="bcg-step-label">{label}</span>
          </li>
        ))}
      </ol>

      {/* ══ STEP 1 — event ══════════════════════════════════════════════ */}
      {step === 0 && (
        <section className="bcg-panel">
          <h2 className="bcg-h2">Which event are these invitations for?</h2>
          <p className="bcg-sub">Every guest in the file will be created under this event.</p>

          <label className="bcg-field">
            <span>Select Event <i className="bcg-req">*</i></span>
            <select value={eventId} onChange={(e) => { setEventId(e.target.value); setReport(null); }}>
              <option value="">— Select an event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.event_name}{ev.event_date ? ` — ${new Date(ev.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                </option>
              ))}
            </select>
          </label>

          {events.length === 0 && (
            <p className="bcg-note">You have no events yet. Create one first, then come back here.</p>
          )}

          <div className="bcg-actions">
            <button className="btn-gold" disabled={!canLeaveEvent} onClick={() => setStep(1)}>
              Continue <MdArrowForward size={15} />
            </button>
          </div>
        </section>
      )}

      {/* ══ STEP 2 — upload ═════════════════════════════════════════════ */}
      {step === 1 && (
        <section className="bcg-panel">
          <div className="bcg-panel-head">
            <div>
              <h2 className="bcg-h2">Upload the guest list</h2>
              <p className="bcg-sub">
                Three columns: <strong>name</strong>, <strong>phone</strong>, <strong>type</strong> (Single or Double).
                CN numbers and QR codes are created automatically — leave them out.
              </p>
            </div>
            <div className="bcg-templates">
              <button className="btn-outline" disabled={downloading} onClick={() => handleDownloadTemplate('xlsx')}>
                <MdDownload size={15} /> Template .xlsx
              </button>
              <button className="btn-outline" disabled={downloading} onClick={() => handleDownloadTemplate('csv')}>
                <MdDownload size={15} /> .csv
              </button>
            </div>
          </div>

          <div className="bcg-example">
            <table>
              <thead><tr><th>name</th><th>phone</th><th>type</th></tr></thead>
              <tbody>
                <tr><td>John Doe</td><td>0712345678</td><td>Double</td></tr>
                <tr><td>Mary John</td><td>0755555555</td><td>Single</td></tr>
              </tbody>
            </table>
          </div>

          <div
            className={`bcg-drop${dragOver ? ' bcg-drop--over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleSheet(e.dataTransfer.files[0]); }}
            onClick={() => sheetRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && sheetRef.current?.click()}
          >
            <input
              ref={sheetRef}
              type="file"
              accept=".xlsx,.csv"
              style={{ display: 'none' }}
              onChange={(e) => handleSheet(e.target.files[0])}
            />
            {validating ? (
              <><span className="bcg-spinner" /><p className="bcg-drop-title">Checking the file…</p></>
            ) : (
              <>
                <MdUploadFile className="bcg-drop-icon" />
                <p className="bcg-drop-title">Drop the Excel file here, or click to browse</p>
                <p className="bcg-drop-sub">.xlsx or .csv &nbsp;·&nbsp; up to 1000 guests</p>
              </>
            )}
          </div>

          {sheetError && !report?.invalidRows?.length && (
            <p className="bcg-alert bcg-alert--error"><MdError size={17} /> {sheetError}</p>
          )}

          <div className="bcg-actions">
            <button className="btn-outline" onClick={() => setStep(0)}><MdArrowBack size={15} /> Back</button>
          </div>
        </section>
      )}

      {/* ══ STEP 3 — review ═════════════════════════════════════════════ */}
      {step === 2 && report && (
        <section className="bcg-panel">
          <h2 className="bcg-h2">Review the guest list</h2>
          <p className="bcg-sub">
            {report.file?.name ? <><strong>{report.file.name}</strong> · </> : null}
            {selectedEvent?.event_name}
          </p>

          <div className="bcg-tiles">
            <div className="bcg-tile"><span className="bcg-tile-n">{report.total ?? 0}</span><span className="bcg-tile-l">Total rows</span></div>
            <div className="bcg-tile bcg-tile--ok"><span className="bcg-tile-n">{report.valid ?? 0}</span><span className="bcg-tile-l">Valid</span></div>
            <div className={`bcg-tile${report.invalid ? ' bcg-tile--bad' : ''}`}><span className="bcg-tile-n">{report.invalid ?? 0}</span><span className="bcg-tile-l">Invalid</span></div>
            <div className="bcg-tile"><span className="bcg-tile-n">{report.counts?.single ?? 0}</span><span className="bcg-tile-l">Single</span></div>
            <div className="bcg-tile"><span className="bcg-tile-n">{report.counts?.double ?? 0}</span><span className="bcg-tile-l">Double</span></div>
          </div>

          {report.invalid > 0 && (
            <div className="bcg-alert bcg-alert--error bcg-alert--block">
              <p><MdError size={17} /> <strong>{report.invalid} row{report.invalid > 1 ? 's' : ''} must be fixed before any card is generated.</strong></p>
              <ul className="bcg-rowerrors">
                {report.invalidRows.map((r) => (
                  <li key={r.row}>
                    <span className="bcg-rownum">Row {r.row}</span>
                    <span className="bcg-rowname">{r.guest_name || <em>no name</em>}</span>
                    <span className="bcg-rowmsg">{r.errors.join('; ')}</span>
                  </li>
                ))}
              </ul>
              <p className="bcg-note">Correct the file and upload it again. Nothing has been created.</p>
            </div>
          )}

          {report.warnings?.length > 0 && (
            <div className="bcg-alert bcg-alert--warn bcg-alert--block">
              <p><MdWarning size={17} /> {report.warnings.length} row{report.warnings.length > 1 ? 's' : ''} share a phone number with another row — these will still be imported.</p>
              <ul className="bcg-rowerrors">
                {report.warnings.slice(0, 8).map((w) => (
                  <li key={w.row}><span className="bcg-rownum">Row {w.row}</span><span className="bcg-rowmsg">{w.message}</span></li>
                ))}
              </ul>
            </div>
          )}

          {report.valid > 0 && (
            <div className="bcg-table-wrap">
              <table className="bcg-table">
                <thead><tr><th>Row</th><th>Guest</th><th>Phone</th><th>Type</th></tr></thead>
                <tbody>
                  {report.guests.slice(0, 50).map((g) => (
                    <tr key={g.row}>
                      <td className="bcg-dim">{g.row}</td>
                      <td>{g.guest_name}</td>
                      <td className="bcg-mono">{g.phone_number}</td>
                      <td><span className={`bcg-type bcg-type--${g.card_type}`}>{g.card_type === 'double' ? 'Double' : 'Single'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.guests.length > 50 && (
                <p className="bcg-note">Showing the first 50 of {report.guests.length} valid guests.</p>
              )}
            </div>
          )}

          <div className="bcg-actions">
            <button className="btn-outline" onClick={resetSheet}><MdArrowBack size={15} /> Upload a different file</button>
            <button className="btn-gold" disabled={!canLeaveReview} onClick={() => setStep(3)}>
              Continue <MdArrowForward size={15} />
            </button>
          </div>
        </section>
      )}

      {/* ══ STEP 4 — layout ═════════════════════════════════════════════ */}
      {step === 3 && (
        <section className="bcg-panel">
          <h2 className="bcg-h2">Preview &amp; position the card</h2>
          <p className="bcg-sub">Drag the guest name, QR code and CN where they should sit. Every card uses these same positions.</p>

          {/* What this preview represents — the real event, and the first guest in the file */}
          <div className="bcg-previewmeta">
            <div>
              <span>Event</span>
              <strong>{selectedEvent?.event_name || '—'}</strong>
            </div>
            <div>
              <span>Preview guest</span>
              <strong>{sampleGuest?.guest_name || '—'}</strong>
            </div>
            <div>
              <span>Phone</span>
              <strong className="bcg-mono">{sampleGuest?.phone_number || '—'}</strong>
            </div>
            <div>
              <span>Type</span>
              <strong><span className={`bcg-type bcg-type--${sampleGuest?.card_type || 'single'}`}>{sampleType}</span></strong>
            </div>
          </div>

          {/* The card design comes first and spans the width: nothing can be
              previewed until it is chosen, so it must not look like decoration
              tucked in beside the font-size boxes. */}
          <div className={`bcg-design${imagePreview ? ' bcg-design--has' : ''}`}>
            {imagePreview ? (
              <>
                <img className="bcg-design-thumb" src={imagePreview} alt="Chosen card design" />
                <div className="bcg-design-text">
                  <strong>{imageFile?.name || 'Card design'}</strong>
                  <small>
                    {natural.w ? `${natural.w} × ${natural.h}px` : 'loading…'}
                    {imageFile ? ` · ${(imageFile.size / 1024 / 1024).toFixed(1)} MB` : ''}
                  </small>
                </div>
                <button type="button" className="btn-outline" onClick={() => imageRef.current?.click()}>
                  Change design
                </button>
              </>
            ) : (
              <>
                <MdImage size={30} />
                <div className="bcg-design-text">
                  <strong>Choose the card design to preview</strong>
                  <small>The same image you use for a single invitation · PNG, JPG or WebP · max 10 MB</small>
                </div>
                <button type="button" className="btn-gold" onClick={() => imageRef.current?.click()}>
                  <MdUploadFile size={16} /> Choose card design
                </button>
              </>
            )}
          </div>
          <input
            ref={imageRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/*,.png,.jpg,.jpeg,.webp"
            style={{ display: 'none' }}
            onChange={(e) => { handleImage(e.target.files[0]); e.target.value = ''; }}
          />
          {imageError && <p className="bcg-alert bcg-alert--error"><MdError size={17} /> {imageError}</p>}

          <div className="bcg-layout">
            {/* controls */}
            <div className="bcg-controls">
              <div className="bcg-sizes">
                <label><span>Name size</span><input type="number" placeholder="150" value={nameFontSizeStr} onChange={(e) => setNameFontSizeStr(e.target.value)} /></label>
                <label><span>CN size</span><input type="number" placeholder="100" value={cnFontSizeStr} onChange={(e) => setCnFontSizeStr(e.target.value)} /></label>
                <label><span>Type size</span><input type="number" placeholder="70" value={typeFontSizeStr} onChange={(e) => setTypeFontSizeStr(e.target.value)} /></label>
              </div>

              <div className="bcg-colors">
                <label><span>Name</span><input type="color" value={nameColor} onChange={(e) => setNameColor(e.target.value)} /></label>
                <label><span>CN</span><input type="color" value={cnColor} onChange={(e) => setCnColor(e.target.value)} /></label>
                <label><span>Type</span><input type="color" value={typeColor} onChange={(e) => setTypeColor(e.target.value)} /></label>
              </div>

              <div className="bcg-toggles">
                <label><input type="checkbox" checked={showQR}   onChange={(e) => setShowQR(e.target.checked)} /> Show QR</label>
                <label><input type="checkbox" checked={showCN}   onChange={(e) => setShowCN(e.target.checked)} /> Show CN</label>
                <label><input type="checkbox" checked={showType} onChange={(e) => setShowType(e.target.checked)} /> Show Type</label>
              </div>

              <p className="bcg-note">
                <strong>{SAMPLE_CODE}</strong> is a sample. No invitation, CN or card is created by
                previewing — each guest gets their own CN when you generate.
              </p>
            </div>

            {/* canvas */}
            <div className="bcg-canvas-wrap">
              {imagePreview ? (
                <>
                  <div className="bcg-legend">
                    <span><i style={{ background: '#3b82f6' }} />Name</span>
                    {showCN   && <span><i style={{ background: '#10b981' }} />CN</span>}
                    {showType && <span><i style={{ background: '#d4af37' }} />Type</span>}
                    {showQR   && <span>QR (drag the box)</span>}
                  </div>

                  <div ref={overlayRef} className="bcg-canvas" style={{ touchAction: 'none' }}>
                    <img
                      src={imagePreview}
                      alt="Card design preview"
                      onLoad={onImgLoad}
                      onError={() => setImageError('That image could not be displayed. Try choosing the card design again, or re-save it as a PNG or JPG.')}
                      draggable={false}
                    />

                    {dragReady && (
                      <>
                        {showQR && (
                          <Draggable
                            nodeRef={qrBoxRef}
                            position={{ x: pos.qrLeft * posScale, y: pos.qrTop * posScale }}
                            bounds={{ top: 0, left: 0, right: overlayW - qrBoxPx, bottom: overlayH - qrBoxPx }}
                            onStop={onQrStop}
                          >
                            <div ref={qrBoxRef} className="bcg-qrbox" style={{ width: qrBoxPx, height: qrBoxPx }}>
                              {qrDataUrl
                                ? <img src={qrDataUrl} alt="QR sample" style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }} />
                                : 'QR'}
                            </div>
                          </Draggable>
                        )}

                        <svg className="bcg-canvas-svg" aria-hidden="true">
                          <text x={pos.nameX * posScale} y={pos.nameY * posScale} textAnchor="middle"
                                fontFamily="Georgia, serif" fontSize={previewNamePx} fontWeight="700"
                                fill={nameColor} letterSpacing="2">{sampleGuest?.guest_name || 'Guest Name'}</text>
                          {showCN && (
                            <text x={pos.codeX * posScale} y={pos.codeY * posScale} textAnchor="middle"
                                  fontFamily="Georgia, serif" fontSize={previewCnPx} fontWeight="600"
                                  fill={cnColor} letterSpacing="4">{SAMPLE_CODE}</text>
                          )}
                          {showType && (
                            <text x={pos.typeX * posScale} y={pos.typeY * posScale} textAnchor="middle"
                                  fontFamily="Georgia, serif" fontSize={previewTypePx} fontWeight="600"
                                  fill={typeColor} letterSpacing="3">{sampleType}</text>
                          )}
                        </svg>

                        <Draggable nodeRef={nameAnchorRef}
                          position={{ x: pos.nameX * posScale - ANCHOR_R, y: pos.nameY * posScale - ANCHOR_R }}
                          bounds={{ top: -ANCHOR_R, left: -ANCHOR_R, right: overlayW - ANCHOR_R, bottom: overlayH - ANCHOR_R }}
                          onStop={onNameStop}>
                          <div ref={nameAnchorRef} className="bcg-anchor"><i style={{ background: '#3b82f6' }} /></div>
                        </Draggable>

                        {showCN && (
                          <Draggable nodeRef={cnAnchorRef}
                            position={{ x: pos.codeX * posScale - ANCHOR_R, y: pos.codeY * posScale - ANCHOR_R }}
                            bounds={{ top: -ANCHOR_R, left: -ANCHOR_R, right: overlayW - ANCHOR_R, bottom: overlayH - ANCHOR_R }}
                            onStop={onCnStop}>
                            <div ref={cnAnchorRef} className="bcg-anchor"><i style={{ background: '#10b981' }} /></div>
                          </Draggable>
                        )}

                        {showType && (
                          <Draggable nodeRef={typeAnchorRef}
                            position={{ x: pos.typeX * posScale - ANCHOR_R, y: pos.typeY * posScale - ANCHOR_R }}
                            bounds={{ top: -ANCHOR_R, left: -ANCHOR_R, right: overlayW - ANCHOR_R, bottom: overlayH - ANCHOR_R }}
                            onStop={onTypeStop}>
                            <div ref={typeAnchorRef} className="bcg-anchor"><i style={{ background: '#d4af37' }} /></div>
                          </Draggable>
                        )}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="bcg-canvas-empty">
                  <MdImage size={34} />
                  <p><strong>Choose the card design above to see the preview</strong></p>
                  <p>Once it loads, {sampleGuest?.guest_name || 'the guest name'}, the QR code and
                    CN appear on the card and can be dragged into place.</p>
                  <button type="button" className="btn-gold" onClick={() => imageRef.current?.click()}>
                    <MdUploadFile size={16} /> Choose card design
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="bcg-confirm">
            <div className="bcg-confirm-rows">
              <div><span>Event</span><strong>{selectedEvent?.event_name || '—'}</strong></div>
              <div><span>Guests</span><strong>{report?.valid ?? 0}</strong></div>
              <div><span>Single</span><strong>{report?.counts?.single ?? 0}</strong></div>
              <div><span>Double</span><strong>{report?.counts?.double ?? 0}</strong></div>
            </div>
            <div className="bcg-actions">
              <button className="btn-outline" onClick={() => setStep(2)}><MdArrowBack size={15} /> Back</button>
              <button className="btn-gold" disabled={!canGenerate || starting} onClick={handleGenerate}>
                {starting ? <><span className="bcg-spinner bcg-spinner--sm" /> Starting…</> : `Generate All ${report?.valid ?? 0} Cards`}
              </button>
            </div>
            {!imageFile && <p className="bcg-note">Upload the card design to continue.</p>}
            {startError && (
              <p className="bcg-alert bcg-alert--error"><MdError size={17} /> {startError}</p>
            )}
          </div>
        </section>
      )}

      {/* ══ STEP 5 — progress / summary ═════════════════════════════════ */}
      {step === 4 && job && (
        <section className="bcg-panel">
          {!job.finished ? (
            <>
              <h2 className="bcg-h2">
                {job.stage === 'preparing' ? 'Creating invitations…' : 'Generating invitations…'}
              </h2>
              <p className="bcg-sub">{selectedEvent?.event_name}</p>

              <div className="bcg-progress">
                {job.stage === 'preparing' && (
                  <p className="bcg-note">
                    Issuing CN numbers for {job.total ?? 0} guests
                    {job.prepared ? ` — ${job.prepared} done` : ''}. Card rendering starts next.
                  </p>
                )}
                <div className="bcg-progress-count">
                  <strong>{job.completed ?? 0}</strong> / {job.total ?? 0}
                </div>
                <div
                  className="bcg-bar"
                  role="progressbar"
                  aria-valuenow={job.percent ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span style={{ width: `${job.percent ?? 0}%` }} />
                </div>
                <div className="bcg-progress-pct">{job.percent ?? 0}%</div>
                {job.current_guest && (
                  <p className="bcg-current">Current guest<strong>{job.current_guest}</strong></p>
                )}
                {job.failed > 0 && (
                  <p className="bcg-note bcg-note--warn">{job.failed} failed so far — the rest continue.</p>
                )}
                <p className="bcg-note">
                  Leaving this page will not stop the generation, but you will lose this progress view.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className={`bcg-done${job.failed ? ' bcg-done--partial' : ''}`}>
                {job.failed ? <MdWarning size={38} /> : <MdCheckCircle size={38} />}
                <div>
                  <h2 className="bcg-h2">Generation complete</h2>
                  <p className="bcg-sub">{selectedEvent?.event_name}</p>
                </div>
              </div>

              {job.lost && (
                <p className="bcg-alert bcg-alert--warn">
                  <MdWarning size={17} /> Lost contact with the job. Open the event to see which cards were created.
                </p>
              )}

              {job.error && (
                <p className="bcg-alert bcg-alert--error"><MdError size={17} /> {job.error}</p>
              )}

              <div className="bcg-tiles">
                <div className="bcg-tile"><span className="bcg-tile-n">{job.total ?? 0}</span><span className="bcg-tile-l">Total</span></div>
                <div className="bcg-tile bcg-tile--ok"><span className="bcg-tile-n">{job.generated ?? 0}</span><span className="bcg-tile-l">Generated</span></div>
                <div className={`bcg-tile${job.failed ? ' bcg-tile--bad' : ''}`}><span className="bcg-tile-n">{job.failed ?? 0}</span><span className="bcg-tile-l">Failed</span></div>
              </div>

              {job.failures?.length > 0 && (
                <div className="bcg-alert bcg-alert--error bcg-alert--block">
                  <p><MdError size={17} /> <strong>These cards did not render.</strong> The guests exist with their CN numbers — retrying only re-renders their cards, it does not create duplicates.</p>
                  <div className="bcg-table-wrap">
                    <table className="bcg-table">
                      <thead><tr><th>Row</th><th>Guest</th><th>Phone</th><th>CN</th><th>Reason</th></tr></thead>
                      <tbody>
                        {job.failures.map((f) => (
                          <tr key={f.invitation_id}>
                            <td className="bcg-dim">{f.row ?? '—'}</td>
                            <td>{f.guest_name}</td>
                            <td className="bcg-mono">{f.phone_number || '—'}</td>
                            <td className="bcg-mono">{f.code}</td>
                            <td className="bcg-rowmsg">{f.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="btn-outline" disabled={retrying || !imageFile} onClick={handleRetry}>
                    {retrying ? <><span className="bcg-spinner bcg-spinner--sm" /> Retrying…</> : <><MdRefresh size={15} /> Retry {job.failures.length} failed</>}
                  </button>
                </div>
              )}

              <div className="bcg-actions">
                <button className="btn-outline" onClick={startOver}>Import another list</button>
                <button className="btn-gold" onClick={() => navigate(`/events/${eventId}`)}>
                  <MdTableRows size={15} /> View Invitations
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
