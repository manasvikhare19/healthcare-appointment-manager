import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import { Banner } from '../../components/Shared.jsx';

const DAY_OPTIONS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export default function AdminPanel() {
  const [tab, setTab] = useState('doctors');
  return (
    <div className="main fade-in">
      <h1>Admin</h1>
      <div className="tabs">
        <div className={`tab ${tab === 'doctors' ? 'active' : ''}`} onClick={() => setTab('doctors')}>Doctors & leave</div>
        <div className={`tab ${tab === 'emails' ? 'active' : ''}`} onClick={() => setTab('emails')}>Notification log</div>
      </div>
      {tab === 'doctors' ? <DoctorsTab /> : <EmailLogTab />}
    </div>
  );
}

function DoctorsTab() {
  const [doctors, setDoctors] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const { data } = await api.get('/admin/doctors');
      setDoctors(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <Banner>{error}</Banner>
      <Banner type="success">{success}</Banner>
      <div className="row between" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0 }}>{doctors.length} doctor(s) on record</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>+ Add doctor</button>
      </div>

      {doctors.map((d) => (
        <div className="card" key={d.id}>
          <div className="row between wrap">
            <div>
              <h3>Dr. {d.user.name}</h3>
              <p className="muted" style={{ marginBottom: 0 }}>{d.specialisation} · {d.slotDurationMinutes}-min slots · {d.workingDays}</p>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => setLeaveTarget(d)}>Manage leave</button>
          </div>
          {d.leaves?.length > 0 && (
            <>
              <hr className="divider" />
              <p className="hint" style={{ marginBottom: 6 }}>Upcoming leave</p>
              <div className="row wrap">
                {d.leaves.map((l) => (
                  <span key={l.date} className="badge status-CANCELLED">{l.date}{l.reason ? ` — ${l.reason}` : ''}</span>
                ))}
              </div>
            </>
          )}
        </div>
      ))}

      {showCreate && (
        <CreateDoctorModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setSuccess('Doctor account created.');
            load();
          }}
        />
      )}
      {leaveTarget && (
        <LeaveModal
          doctor={leaveTarget}
          onClose={() => setLeaveTarget(null)}
          onSaved={(msg) => {
            setLeaveTarget(null);
            setSuccess(msg);
            load();
          }}
        />
      )}
    </>
  );
}

function CreateDoctorModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', email: '', password: '', specialisation: '', bio: '',
    slotDurationMinutes: 30, workStartMinutes: 540, workEndMinutes: 1020,
    workingDays: 'MON,TUE,WED,THU,FRI',
  });
  const [selectedDays, setSelectedDays] = useState(['MON', 'TUE', 'WED', 'THU', 'FRI']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function toggleDay(day) {
    setSelectedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post('/admin/doctors', { ...form, workingDays: selectedDays.join(',') });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} className="fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Add a doctor</h2>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>
        <Banner>{error}</Banner>
        <form onSubmit={handleSubmit}>
          <div className="grid cols-2">
            <div className="field">
              <label>Full name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Specialisation</label>
              <input required value={form.specialisation} onChange={(e) => setForm({ ...form, specialisation: e.target.value })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label>Temporary password</label>
              <input type="text" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="field">
              <label>Slot duration (min)</label>
              <input type="number" min={5} max={240} value={form.slotDurationMinutes} onChange={(e) => setForm({ ...form, slotDurationMinutes: Number(e.target.value) })} />
            </div>
          </div>
          <div className="field">
            <label>Bio (optional)</label>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </div>
          <div className="field">
            <label>Working days</label>
            <div className="row wrap">
              {DAY_OPTIONS.map((d) => (
                <button
                  type="button"
                  key={d}
                  className={`slot-btn ${selectedDays.includes(d) ? 'selected' : ''}`}
                  style={{ padding: '6px 10px' }}
                  onClick={() => toggleDay(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Create doctor account'}
          </button>
        </form>
      </div>
    </div>
  );
}

function LeaveModal({ doctor, onClose, onSaved }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/admin/doctors/${doctor.id}/leave`, { date, reason });
      onSaved(
        data.affectedAppointments > 0
          ? `Leave recorded. ${data.affectedAppointments} affected patient(s) notified and rebooked slots freed.`
          : 'Leave recorded.'
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} className="fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Mark leave — Dr. {doctor.user.name}</h2>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="hint">Any existing bookings that day are automatically cancelled and the patients notified by email.</p>
        <Banner>{error}</Banner>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Reason (optional)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Confirm leave'}
          </button>
        </form>
      </div>
    </div>
  );
}

function EmailLogTab() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [emailStatus, setEmailStatus] = useState(null);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [retryingId, setRetryingId] = useState(null);

  useEffect(() => {
    loadLogs();
    checkStatus();
  }, []);

  async function loadLogs() {
    try {
      const { data } = await api.get('/admin/email-logs');
      setLogs(data);
    } catch (e) {
      setError(e.message);
    }
  }

  async function checkStatus() {
    try {
      const { data } = await api.get('/admin/email-status');
      setEmailStatus(data);
    } catch (e) {
      // non-fatal
    }
  }

  async function handleSendTest(e) {
    e.preventDefault();
    if (!testEmail) return;
    setSendingTest(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post('/admin/test-email', { toEmail: testEmail });
      setSuccess(`Test email sent to ${testEmail}! (Status: ${data.log?.status})`);
      loadLogs();
    } catch (err) {
      setError(err.message || 'Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  }

  async function handleRetry(id) {
    setRetryingId(id);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post(`/admin/email-logs/${id}/retry`);
      setSuccess(`Retry completed. Status: ${data.log?.status}`);
      loadLogs();
    } catch (err) {
      setError(err.message || 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <>
      <Banner>{error}</Banner>
      <Banner type="success">{success}</Banner>

      {/* Email Integration Status Card */}
      <div className="card" style={{ marginBottom: 20, background: 'var(--paper-card)' }}>
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>📧 Email Provider Diagnostics</h3>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 13.5 }}>
              Provider:{' '}
              <strong>{emailStatus?.provider || 'Configured in backend/.env'}</strong>
            </p>
            <p style={{ fontSize: 13, margin: 0, color: emailStatus?.success ? '#15803d' : '#92400e' }}>
              {emailStatus?.message || 'Checking email provider connectivity…'}
            </p>
          </div>

          <form onSubmit={handleSendTest} className="row wrap" style={{ gap: 8, marginTop: 8 }}>
            <input
              type="email"
              placeholder="recipient@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13 }}
              required
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={sendingTest}>
              {sendingTest ? 'Sending…' : 'Send Test Email'}
            </button>
          </form>
        </div>
      </div>

      <div className="row between" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          Recent Notifications &bull; All outgoing emails with automatic retry on failure
        </p>
        <button className="btn btn-outline btn-sm" onClick={loadLogs}>
          🔄 Refresh
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="empty-state card">
          <h3>No notifications logged yet</h3>
          <p>Bookings, cancellations, and reminders will appear here automatically.</p>
        </div>
      ) : (
        logs.map((l) => (
          <div className="card" key={l.id} style={{ marginBottom: 12 }}>
            <div className="row between wrap">
              <div>
                <h3 style={{ fontSize: 14, marginBottom: 2 }}>{l.subject}</h3>
                <p className="mono muted" style={{ marginBottom: 0, fontSize: 12.5 }}>
                  {l.toEmail} &bull; {l.type} &bull; {new Date(l.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span
                  className={`badge status-${l.status === 'SENT' ? 'CONFIRMED' : l.status === 'FAILED' ? 'CANCELLED' : 'HELD'}`}
                >
                  {l.status} &bull; {l.attempts} attempt(s)
                </span>
                {l.status === 'FAILED' && (
                  <button
                    className="btn btn-outline btn-sm"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => handleRetry(l.id)}
                    disabled={retryingId === l.id}
                  >
                    {retryingId === l.id ? 'Retrying…' : 'Retry Now'}
                  </button>
                )}
              </div>
            </div>
            {l.lastError && (
              <p className="hint" style={{ color: 'var(--urgency-high)', marginTop: 6, marginBottom: 0 }}>
                <strong>Error:</strong> {l.lastError}
              </p>
            )}
          </div>
        ))
      )}
    </>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(16, 35, 31, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
};
const modalStyle = {
  background: 'var(--paper-card)', borderRadius: 14, padding: 26, width: '100%', maxWidth: 560,
  maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow-md)',
};
