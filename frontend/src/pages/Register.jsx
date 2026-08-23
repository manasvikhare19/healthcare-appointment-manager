import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Banner } from '../components/Shared.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      navigate('/patient/find');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap fade-in">
      <aside className="auth-aside">
        <h2>Describe it once. Everyone who needs it sees it.</h2>
        <p>
          Create a patient account to book visits, share symptoms ahead of time, and keep every visit
          summary and medication schedule in one place.
        </p>
        <div className="auth-quote">
          Doctor and admin accounts are provisioned by the clinic from the admin panel.
        </div>
      </aside>

      <div className="auth-panel">
        <div className="card">
          <h2>Create your account</h2>
          <p className="muted">Takes under a minute.</p>
          <Banner>{error}</Banner>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full name</label>
              <input
                required
                placeholder="Asha Menon"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
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
              <label>Phone (optional)</label>
              <input
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                required
                minLength={6}
                placeholder="At least 6 characters"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <button className="btn btn-primary btn-block" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Create account'}
            </button>
          </form>
          <p className="muted" style={{ marginTop: 16, marginBottom: 0 }}>
            Already registered? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
