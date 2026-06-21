import { useState, useEffect } from 'react';
import {
  MdPeople, MdAdd, MdEdit, MdDelete, MdClose,
  MdVisibility, MdVisibilityOff, MdAdminPanelSettings, MdShield,
  MdPersonOff, MdPersonAddAlt1, MdRefresh,
} from 'react-icons/md';
import {
  listUsers, createUser, updateUser, toggleUserStatus, deleteUser,
} from '../utils/api';
import { getUserId } from '../utils/auth';
import { useToast } from '../context/ToastContext';
import '../styles/users.css';

/* ── Role label helpers ───────────────────────────────────────────────── */

const ROLE_LABELS = {
  admin:         'Admin',
  event_manager: 'Manager',
  verifier:      'Verifier',
};

const ROLE_ICONS = {
  admin:         <MdAdminPanelSettings size={11} />,
  event_manager: <MdPeople size={11} />,
  verifier:      <MdShield size={11} />,
};

function RoleBadge({ role }) {
  return (
    <span className={`user-role-badge user-role-badge--${role}`}>
      {ROLE_ICONS[role]} {ROLE_LABELS[role] || role}
    </span>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`user-status-badge user-status-badge--${status}`}>
      {status === 'active' ? 'Active' : 'Disabled'}
    </span>
  );
}

function formatDate(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Empty form ───────────────────────────────────────────────────────── */

const EMPTY_FORM = { name: '', email: '', password: '', role: 'verifier' };

/* ── User form modal ──────────────────────────────────────────────────── */

function UserModal({ user, onClose, onSaved }) {
  const isEdit = !!user;
  const [form,    setForm]    = useState(
    isEdit ? { name: user.name, email: user.email, role: user.role, password: '' } : EMPTY_FORM
  );
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [showPw,  setShowPw]  = useState(false);
  const { showToast } = useToast();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    if (!isEdit && !form.password) {
      setError('Password is required for new users.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { name: form.name, email: form.email, role: form.role };
      if (form.password) payload.password = form.password;

      const { data } = isEdit
        ? await updateUser(user.id, payload)
        : await createUser(payload);

      showToast(`User ${isEdit ? 'updated' : 'created'} successfully.`, 'success');
      onSaved(data.user, isEdit);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || `Failed to ${isEdit ? 'update' : 'create'} user.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="user-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="user-modal">
        <div className="user-modal-header">
          <h2 className="user-modal-title">{isEdit ? 'Edit User' : 'Add User'}</h2>
          <button className="user-modal-close" onClick={onClose} aria-label="Close"><MdClose /></button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="user-modal-field">
            <label>Full Name</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. John Doe"
              required
              disabled={saving}
            />
          </div>

          <div className="user-modal-field">
            <label>Email Address</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="john@example.com"
              required
              disabled={saving}
            />
          </div>

          <div className="user-modal-field">
            <label>{isEdit ? 'New Password (leave blank to keep current)' : 'Password'}</label>
            <div className="user-modal-pw-wrap">
              <input
                name="password"
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange}
                placeholder={isEdit ? '••••••••' : 'Min. 6 characters'}
                disabled={saving}
              />
              <button
                type="button"
                className="user-modal-pw-toggle"
                onClick={() => setShowPw(v => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <MdVisibilityOff /> : <MdVisibility />}
              </button>
            </div>
            {isEdit && <p className="user-modal-hint">Leave blank to keep the current password.</p>}
          </div>

          <div className="user-modal-field">
            <label>Role</label>
            <select name="role" value={form.role} onChange={handleChange} disabled={saving}>
              <option value="verifier">Verifier — scan QR only</option>
              <option value="event_manager">Event Manager — manage assigned events</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>

          {error && <p className="users-error" style={{ margin: '0.5rem 0' }}>{error}</p>}

          <div className="user-modal-footer">
            <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-gold" disabled={saving}>
              {saving ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save Changes' : 'Create User')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */

export default function UsersPage() {
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [modal,     setModal]     = useState(null); // null | 'add' | user-object
  const [busyId,    setBusyId]    = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const { showToast } = useToast();
  const myId = getUserId();

  const load = () => {
    setLoading(true);
    setError('');
    listUsers()
      .then(({ data }) => setUsers(data.users || []))
      .catch(() => setError('Failed to load users.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSaved = (savedUser, isEdit) => {
    if (isEdit) {
      setUsers(prev => prev.map(u => (u.id === savedUser.id ? savedUser : u)));
    } else {
      setUsers(prev => [savedUser, ...prev]);
    }
  };

  const handleToggle = async (user) => {
    if (busyId) return;
    setBusyId(user.id);
    try {
      const { data } = await toggleUserStatus(user.id);
      setUsers(prev => prev.map(u => (u.id === user.id ? data.user : u)));
      showToast(`${user.name} ${data.user.status === 'active' ? 'enabled' : 'disabled'}.`, 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update status.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (user) => {
    setConfirmDel(null);
    setBusyId(user.id);
    try {
      await deleteUser(user.id);
      setUsers(prev => prev.filter(u => u.id !== user.id));
      showToast(`${user.name} deleted.`, 'success');
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to delete user.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  /* stats row */
  const total    = users.length;
  const active   = users.filter(u => u.status === 'active').length;
  const disabled = total - active;
  const admins   = users.filter(u => u.role === 'admin').length;
  const managers = users.filter(u => u.role === 'event_manager').length;
  const verifiers = users.filter(u => u.role === 'verifier').length;

  return (
    <div className="users-page page-enter">
      <div className="users-container">

        {/* ── Header ── */}
        <div className="users-header">
          <div>
            <span className="events-ornament">— User Management —</span>
            <h1>Users</h1>
            <p>Create and manage system accounts and role assignments.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
            <button className="btn-outline" onClick={load} disabled={loading} style={{ fontSize: '0.82rem', padding: '0.55rem 1.1rem' }}>
              <MdRefresh size={15} /> Refresh
            </button>
            <button className="btn-gold" onClick={() => setModal('add')} style={{ fontSize: '0.82rem', padding: '0.55rem 1.1rem' }}>
              <MdAdd size={16} /> Add User
            </button>
          </div>
        </div>

        {error && <p className="users-error">{error}</p>}

        {/* ── Stats row ── */}
        {!loading && (
          <div className="users-stats-row">
            <div className="users-stat-chip"><strong>{total}</strong> Total</div>
            <div className="users-stat-chip"><strong style={{ color: '#4ade80' }}>{active}</strong> Active</div>
            <div className="users-stat-chip"><strong style={{ color: '#f87171' }}>{disabled}</strong> Disabled</div>
            <div className="users-stat-chip"><strong style={{ color: 'var(--gold)' }}>{admins}</strong> Admins</div>
            <div className="users-stat-chip"><strong style={{ color: '#60a5fa' }}>{managers}</strong> Managers</div>
            <div className="users-stat-chip"><strong style={{ color: '#4ade80' }}>{verifiers}</strong> Verifiers</div>
          </div>
        )}

        {/* ── Table ── */}
        {loading ? (
          <div className="users-loading"><div className="ev-spinner" /> Loading users…</div>
        ) : users.length === 0 ? (
          <div className="users-empty">
            <MdPeople size={48} />
            <p>No users yet — click "Add User" to create one.</p>
          </div>
        ) : (
          <div className="users-table-card">
            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSelf = myId && Number(myId) === user.id;
                    const busy   = busyId === user.id;
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className="user-name-cell">
                            <span className="user-name-text">{user.name}{isSelf ? ' (you)' : ''}</span>
                            <span className="user-email-text">{user.email}</span>
                          </div>
                        </td>
                        <td><RoleBadge role={user.role} /></td>
                        <td><StatusBadge status={user.status} /></td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{formatDate(user.created_at)}</td>
                        <td>
                          <div className="user-actions">
                            <button
                              className="user-action-btn"
                              onClick={() => setModal(user)}
                              disabled={busy}
                              title="Edit user"
                            >
                              <MdEdit size={14} /> Edit
                            </button>
                            <button
                              className={`user-action-btn user-action-btn--toggle-${user.status === 'active' ? 'off' : 'on'}`}
                              onClick={() => handleToggle(user)}
                              disabled={busy || isSelf}
                              title={isSelf ? 'Cannot change own status' : user.status === 'active' ? 'Disable' : 'Enable'}
                            >
                              {user.status === 'active'
                                ? <><MdPersonOff size={14} /> Disable</>
                                : <><MdPersonAddAlt1 size={14} /> Enable</>
                              }
                            </button>
                            <button
                              className="user-action-btn user-action-btn--danger"
                              onClick={() => setConfirmDel(user)}
                              disabled={busy || isSelf}
                              title={isSelf ? 'Cannot delete own account' : 'Delete user'}
                            >
                              <MdDelete size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Add / Edit modal ── */}
      {modal && (
        <UserModal
          user={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {/* ── Delete confirm modal ── */}
      {confirmDel && (
        <div className="user-modal-overlay" onClick={(e) => e.target === e.currentTarget && setConfirmDel(null)}>
          <div className="user-modal" style={{ maxWidth: 380 }}>
            <div className="user-modal-header">
              <h2 className="user-modal-title">Delete User</h2>
              <button className="user-modal-close" onClick={() => setConfirmDel(null)}><MdClose /></button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Delete <strong style={{ color: 'var(--white)' }}>{confirmDel.name}</strong>?
              This cannot be undone.
            </p>
            <div className="user-modal-footer">
              <button className="btn-outline" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button
                className="btn-gold"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}
                onClick={() => handleDelete(confirmDel)}
              >
                <MdDelete size={15} /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
