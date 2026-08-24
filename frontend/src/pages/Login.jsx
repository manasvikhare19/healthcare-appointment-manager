import React, { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Banner } from '../components/Shared.jsx';
import { User, Stethoscope, ShieldCheck } from 'lucide-react';

const DEMO_ROLES = [
  {
    key: 'PATIENT',
    label: 'Patient Portal',
    icon: User,
    email: 'patient@example.com',
    password: 'password123',
    badge: '👤 Patient Account',
    desc: 'Book slots, input symptoms & view prescriptions',
    color: '#0e7490',
  },
  {
    key: 'DOCTOR',
    label: 'Doctor Portal',
    icon: Stethoscope,
    email: 'dr.mehta@clinic.local',
    password: 'password123',
    badge: '🩺 Doctor · Dr. Aisha Mehta',
    desc: 'Live triage queue, patient notes & AI summaries',
    color: '#047857',
  },
  {
    key: 'ADMIN',
    label: 'Admin Portal',
    icon: ShieldCheck,
    email: 'admin@clinic.local',
    password: 'password123',
    badge: '👑 Clinic Administrator',
    desc: 'Doctor management, leave schedules & email logs',
    color: '#4338ca',
  },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get('sessionExpired') === '1';

  const [selectedRole, setSelectedRole] = useState('PATIENT');
  const [form, setForm] = useState({ email: 'patient@example.com', password: 'password123' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function selectRole(roleKey) {
    setSelectedRole(roleKey);
    const r = DEMO_ROLES.find((d) => d.key === roleKey);
    if (r) {
      setForm({ email: r.email, password: r.password });
    }
  }

  // Detect role based on typed email
  const currentRoleInfo =
    DEMO_ROLES.find((d) => d.email.toLowerCase() === form.email.toLowerCase()) ||
    (form.email.includes('admin')
      ? DEMO_ROLES[2]
      : form.email.includes('dr.') || form.email.includes('doctor')
      ? DEMO_ROLES[1]
      : DEMO_ROLES[0]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(form.email, form.password);
      if (user.role === 'PATIENT') navigate('/patient/dashboard');
      else if (user.role === 'DOCTOR') navigate('/doctor/dashboard');
      else navigate('/admin');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap fade-in">
      <aside className="auth-aside">
        <h2>The visit starts before the waiting room.</h2>
        <p>
          Sign in to pick up your queue, your bookings, or the clinic's schedule — exactly where you
          left it.
        </p>
        <div className="auth-quote">
          Meridian Clinic · Appointment &amp; Follow-up Manager
        </div>
      </aside>

      <div className="auth-panel">
        <div className="card">
          <h2>Sign in</h2>
          <p className="muted" style={{ marginBottom: 14 }}>
            Select a portal to auto-fill demo credentials, or sign in with your own account:
          </p>

          {/* Interactive Role Switcher Tabs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
            {DEMO_ROLES.map((r) => {
              const Icon = r.icon;
              const isSelected = selectedRole === r.key && form.email === r.email;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => selectRole(r.key)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '10px 6px',
                    borderRadius: 10,
                    border: isSelected ? `2px solid ${r.color}` : '1px solid var(--line)',
                    background: isSelected ? 'var(--sage-50)' : '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Icon size={18} color={r.color} />
                  <span style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: 'var(--ink)' }}>
                    {r.label.split(' ')[0]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active Portal Target Indicator */}
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'var(--sage-50)',
              borderLeft: `4px solid ${currentRoleInfo.color}`,
              marginBottom: 16,
              fontSize: 12.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <strong style={{ color: currentRoleInfo.color, display: 'block' }}>{currentRoleInfo.badge}</strong>
              <span className="muted" style={{ fontSize: 11.5 }}>{currentRoleInfo.desc}</span>
            </div>
          </div>

          {sessionExpired && !error && <Banner>Your session expired — please sign in again.</Banner>}
          <Banner>{error}</Banner>

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Email Address</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <button className="btn btn-primary btn-block" disabled={loading} style={{ height: 42, fontSize: 14.5 }}>
              {loading ? <span className="spinner" /> : `Sign in to ${currentRoleInfo.label}`}
            </button>
          </form>

          <p className="muted" style={{ marginTop: 16, marginBottom: 0, textAlign: 'center' }}>
            New patient? <Link to="/register" style={{ fontWeight: 600 }}>Create Patient Account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

