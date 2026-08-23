import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { Banner } from '../components/Shared.jsx';

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const [searchParams] = useSearchParams();
  const calendarParam = searchParams.get('calendar');
  const urlMessage = searchParams.get('message');

  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [error, setError] = useState(urlMessage ? decodeURIComponent(urlMessage) : '');
  const [success, setSuccess] = useState(
    calendarParam === 'connected' ? 'Google Calendar connected successfully. Upcoming appointments synced.' : ''
  );
  const [calStatus, setCalStatus] = useState(null);

  const [showCalModal, setShowCalModal] = useState(false);

  useEffect(() => {
    if (calendarParam === 'connected') {
      refreshUser();
    }
    // Check if calendar is configured on backend
    api
      .get('/calendar/status')
      .then((res) => setCalStatus(res.data))
      .catch(() => {});
  }, [calendarParam]);

  async function handleConnect() {
    setError('');
    setSuccess('');

    // If OAuth is not configured in backend/.env, open the guide modal instead of throwing error
    if (calStatus && !calStatus.configured) {
      setShowCalModal(true);
      return;
    }

    setConnecting(true);
    try {
      const { data } = await api.get('/calendar/oauth/start');
      window.location.href = data.url; // hand off to Google's consent screen
    } catch (err) {
      setShowCalModal(true);
      setConnecting(false);
    }
  }

  async function handleSync() {
    setError('');
    setSuccess('');
    setSyncing(true);
    try {
      const { data } = await api.post('/calendar/sync');
      setSuccess(data.message || 'Calendar synced successfully.');
    } catch (err) {
      setError(err.message || 'Calendar sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Google Calendar from your account?')) return;
    setError('');
    setSuccess('');
    setDisconnecting(true);
    try {
      await api.post('/calendar/disconnect');
      await refreshUser();
      setSuccess('Google Calendar disconnected.');
    } catch (err) {
      setError(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSendTest() {
    setError('');
    setSuccess('');
    setSendingTest(true);
    try {
      const { data } = await api.post('/auth/test-email', { toEmail: user?.email });
      setSuccess(`Test email sent to ${user?.email}! Check your inbox (or terminal console in dev mode).`);
    } catch (err) {
      setError(err.message || 'Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div className="main fade-in">
      <h1>Settings</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        Manage external integrations and communication preferences.
      </p>

      {success && <Banner type="success">{success}</Banner>}
      {error && <Banner>{error}</Banner>}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 260, marginRight: 16 }}>
            <h3 style={{ marginBottom: 4 }}>📅 Google Calendar Integration</h3>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 13.5 }}>
              Sync your healthcare appointments directly to your personal Google Calendar.
              Events are automatically added on booking, updated on reschedule, and removed on cancellation.
            </p>
            {user?.calendarConnected ? (
              <p style={{ margin: 0, fontSize: 13, color: '#15803d', fontWeight: 500 }}>
                ✓ Your Google account is connected. Automatic two-way calendar sync is active.
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                Direct 1-click &ldquo;Add to Google Calendar&rdquo; links are also included on all your appointment cards and confirmation emails.
              </p>
            )}
          </div>

          <div style={{ textAlign: 'right', marginTop: 4 }}>
            {user?.calendarConnected ? (
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="badge" style={{ background: 'var(--sage-100)', color: 'var(--teal-900)', padding: '8px 14px' }}>
                  ✓ Connected
                </span>
                <button className="btn btn-outline btn-sm" onClick={handleSync} disabled={syncing}>
                  {syncing ? 'Syncing…' : '🔄 Sync Appointments'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={handleDisconnect} disabled={disconnecting}>
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? 'Redirecting to Google…' : '🔗 Connect Google Calendar'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>📧 Email Notifications &amp; Care Updates</h3>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 13.5 }}>
              All booking confirmations, visit summaries, medication reminders, and schedule updates are sent to:
            </p>
            <p className="mono" style={{ background: 'var(--sage-50)', padding: '8px 14px', borderRadius: 6, display: 'inline-block', margin: '0 0 8px', fontWeight: 600 }}>
              {user?.email}
            </p>
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={handleSendTest} disabled={sendingTest}>
              {sendingTest ? 'Sending…' : '📨 Send Test Email to Me'}
            </button>
          </div>
        </div>
      </div>

      {showCalModal && (
        <CalendarSetupModal onClose={() => setShowCalModal(false)} />
      )}
    </div>
  );
}

function CalendarSetupModal({ onClose }) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} className="fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>📅 Google Calendar Integration</h2>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 14, margin: '14px 0' }}>
          <p style={{ margin: 0, fontWeight: 600, color: '#166534', fontSize: 14 }}>
            ✓ Direct 1-Click Calendar Links are already active!
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#15803d' }}>
            Whenever you book or reschedule an appointment, a <strong>&ldquo;📅 Add to Google Calendar&rdquo;</strong> button is automatically generated in your confirmation emails and on your <strong>My Appointments</strong> cards.
          </p>
        </div>

        <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Want Automatic Background OAuth Sync?</h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
          To sync events automatically without clicking the web links, add your Google Cloud credentials to <code>backend/.env</code>:
        </p>
        <ol style={{ fontSize: 13, color: 'var(--muted)', paddingLeft: 18, margin: '0 0 16px', lineHeight: 1.6 }}>
          <li>Open <strong>Google Cloud Console</strong> &rarr; Create an OAuth 2.0 Web Client ID.</li>
          <li>Set redirect URI to: <code>http://localhost:4000/api/calendar/oauth/callback</code></li>
          <li>In <code>backend/.env</code>, set <code>CALENDAR_ENABLED=true</code>, <code>GOOGLE_CLIENT_ID</code>, and <code>GOOGLE_CLIENT_SECRET</code>.</li>
        </ol>

        <button className="btn btn-primary btn-block" onClick={onClose}>
          Got it!
        </button>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(16, 35, 31, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
};
const modalStyle = {
  background: 'var(--paper-card)', borderRadius: 14, padding: 26, width: '100%', maxWidth: 520,
  maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow-md)',
};

