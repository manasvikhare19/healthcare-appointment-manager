import React, { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Banner } from '../components/Shared.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get('sessionExpired') === '1';
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
          <p className="muted">Use one of the seeded demo accounts, or your own.</p>
          <div className="demo-creds">
            patient@example.com
            <br />
            dr.mehta@clinic.local
            <br />
            admin@clinic.local
            <br />
            password: password123
          </div>
          {sessionExpired && !error && <Banner>Your session expired — please sign in again.</Banner>}
          <Banner>{error}</Banner>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Email</label>
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
            <button className="btn btn-primary btn-block" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Sign in'}
            </button>
          </form>
          <p className="muted" style={{ marginTop: 16, marginBottom: 0 }}>
            New patient? <Link to="/register">Register here</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
