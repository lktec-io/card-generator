import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MdUploadFile, MdTableRows, MdCheckCircle, MdError,
  MdDelete, MdArrowForward, MdDownload,
} from 'react-icons/md';
import { listEvents, bulkImport } from '../utils/api';
import { useToast } from '../context/ToastContext';
import '../styles/import.css';

/* ── CSV parser (no dependencies) ──────────────────────────────────────── */

function parseCSVLine(line) {
  const cols = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { cols.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[\s_]+/g, '_'));
  const nameIdx  = headers.findIndex(h => h.includes('name') || h.includes('jina') || h.includes('guest'));
  const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('simu') || h.includes('tel'));

  const rows = lines.slice(1)
    .map((line, i) => {
      const cols = parseCSVLine(line);
      const guest_name = nameIdx  >= 0 ? (cols[nameIdx]  || '').trim() : '';
      const phone      = phoneIdx >= 0 ? (cols[phoneIdx] || '').trim() : '';
      return { _row: i + 2, guest_name, phone };
    })
    .filter(r => r.guest_name);

  return { headers, rows, nameIdx, phoneIdx };
}

/* ── Template download ──────────────────────────────────────────────────── */

function downloadTemplate() {
  const csv  = 'Guest Name,Phone Number\nJohn Doe,+255712345678\nJane Smith,+255723456789\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'guest-list-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function ImportPage() {
  const [events,    setEvents]    = useState([]);
  const [eventId,   setEventId]   = useState('');
  const [parsed,    setParsed]    = useState(null);   // { rows, error }
  const [importing, setImporting] = useState(false);
  const [result,    setResult]    = useState(null);   // { created, errors }
  const [dragOver,  setDragOver]  = useState(false);
  const fileRef = useRef(null);
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    listEvents()
      .then(({ data }) => {
        const evs = data.events || [];
        setEvents(evs);
        if (evs.length === 1) setEventId(String(evs[0].id));
      })
      .catch(() => {});
  }, []);

  const handleFile = (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      setParsed({ rows: [], error: 'Please upload a .csv, .xlsx, or .xls file.' });
      return;
    }
    setResult(null);

    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const { rows, error } = parseCSV(e.target.result);
        if (!rows.length) {
          setParsed({ rows: [], error: error || 'No valid guest rows found. Ensure the file has a "Guest Name" column.' });
        } else {
          setParsed({ rows, error: null });
        }
      };
      reader.readAsText(file);
    } else {
      // XLSX — attempt dynamic import
      import('xlsx')
        .then(XLSX => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const wb   = XLSX.read(e.target.result, { type: 'array' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_csv(ws);
            const { rows, error } = parseCSV(data);
            if (!rows.length) {
              setParsed({ rows: [], error: error || 'No valid rows. Ensure a "Guest Name" column exists.' });
            } else {
              setParsed({ rows, error: null });
            }
          };
          reader.readAsArrayBuffer(file);
        })
        .catch(() => {
          setParsed({ rows: [], error: 'XLSX support requires running: npm install xlsx — or convert your file to CSV first.' });
        });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleImport = async () => {
    if (!parsed?.rows?.length) return;
    if (!eventId) { showToast('Please select an event first.', 'error'); return; }

    setImporting(true);
    try {
      const { data } = await bulkImport(parsed.rows, parseInt(eventId, 10));
      setResult(data);
      showToast(`${data.created.length} invitations created successfully!`, 'success');
      setParsed(null);
    } catch (err) {
      showToast(err.response?.data?.message || 'Import failed.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const removeRow = (idx) => {
    setParsed(prev => ({ ...prev, rows: prev.rows.filter((_, i) => i !== idx) }));
  };

  return (
    <div className="import-page page-enter">
      <div className="import-container">

        {/* ── Header ── */}
        <div className="import-header">
          <div>
            <span className="import-ornament">— Bulk Upload —</span>
            <h1>Import Guests</h1>
            <p>Upload a CSV or Excel file to create invitations in bulk</p>
          </div>
          <button className="btn-outline" onClick={downloadTemplate}>
            <MdDownload size={15} /> Download Template
          </button>
        </div>

        {/* ── Event selector ── */}
        <div className="import-event-select">
          <label>Assign to Event <span className="import-required">*</span></label>
          <select value={eventId} onChange={e => setEventId(e.target.value)}>
            <option value="">— Select an event —</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.event_name} ({ev.event_type})</option>
            ))}
          </select>
        </div>

        {/* ── Drop zone ── */}
        {!parsed && !result && (
          <div
            className={`import-dropzone${dragOver ? ' import-dropzone--over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <MdUploadFile className="import-drop-icon" />
            <p className="import-drop-title">Drop file here or click to browse</p>
            <p className="import-drop-sub">Supported: CSV, XLSX, XLS &nbsp;·&nbsp; Max 500 guests</p>
          </div>
        )}

        {/* ── Parse error ── */}
        {parsed?.error && (
          <div className="import-error">
            <MdError size={18} /> {parsed.error}
            <button className="import-retry" onClick={() => { setParsed(null); fileRef.current?.click(); }}>
              Try again
            </button>
          </div>
        )}

        {/* ── Preview table ── */}
        {parsed?.rows?.length > 0 && !result && (
          <div className="import-preview">
            <div className="import-preview-head">
              <div>
                <h3>{parsed.rows.length} guests found</h3>
                <p>Review and confirm before importing</p>
              </div>
              <div className="import-preview-actions">
                <button className="btn-outline" onClick={() => setParsed(null)}>
                  Cancel
                </button>
                <button
                  className="btn-gold"
                  onClick={handleImport}
                  disabled={importing || !eventId}
                >
                  {importing ? (
                    <><span className="import-spinner" /> Importing…</>
                  ) : (
                    <><MdArrowForward size={15} /> Import {parsed.rows.length} Guests</>
                  )}
                </button>
              </div>
            </div>

            <div className="import-table-wrap">
              <table className="import-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Guest Name</th>
                    <th>Phone</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((row, i) => (
                    <tr key={i}>
                      <td className="import-row-num">{i + 1}</td>
                      <td>
                        <strong>{row.guest_name}</strong>
                        {!row.guest_name && <span className="import-missing">Missing name</span>}
                      </td>
                      <td className="import-phone">{row.phone || '—'}</td>
                      <td>
                        <button
                          className="import-remove-btn"
                          onClick={() => removeRow(i)}
                          title="Remove row"
                        >
                          <MdDelete size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Result ── */}
        {result && (
          <div className="import-result">
            <div className="import-result-success">
              <MdCheckCircle size={40} />
              <div>
                <h3>{result.created.length} Invitations Created</h3>
                <p>All guests have been added successfully.</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="import-result-errors">
                <p><strong>{result.errors.length} rows had errors:</strong></p>
                <ul>
                  {result.errors.map((e, i) => (
                    <li key={i}>{e.input?.guest_name || 'Row'}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="import-result-actions">
              <button className="btn-outline" onClick={() => setResult(null)}>
                Import More
              </button>
              {eventId && (
                <button className="btn-gold" onClick={() => navigate(`/events/${eventId}`)}>
                  <MdTableRows size={15} /> View Event
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Instructions ── */}
        {!parsed && !result && (
          <div className="import-instructions">
            <h3>How it works</h3>
            <ol>
              <li>Download the CSV template above</li>
              <li>Fill in Guest Name and Phone Number columns</li>
              <li>Save as CSV (.csv) or Excel (.xlsx)</li>
              <li>Select the event and upload the file</li>
              <li>Review the preview and click Import</li>
            </ol>
            <p className="import-note">
              Each guest gets a unique CN code and invitation link automatically.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
