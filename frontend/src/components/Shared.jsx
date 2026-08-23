import React from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const linksByRole = {
    PATIENT: [
      { to: '/patient/dashboard', label: 'Dashboard' },
      { to: '/patient/find', label: 'Find a Doctor' },
      { to: '/patient/appointments', label: 'My Appointments' },
    ],
    DOCTOR: [{ to: '/doctor/dashboard', label: 'Dashboard' }],
    ADMIN: [{ to: '/admin', label: 'Admin' }],
  };

  return (
    <header className="topnav">
      <Link to="/" className="brand" aria-label="Meridian Clinic">
        <span className="brand-mark">
          <Plus size={18} strokeWidth={3} />
        </span>
        <span>Meridian <i>Clinic</i></span>
      </Link>
      <nav className="nav-links">
        {user &&
          (linksByRole[user.role] || []).map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={location.pathname.startsWith(l.to) ? 'active' : ''}
            >
              {l.label}
            </Link>
          ))}
        {user && (
          <Link to="/settings" className={location.pathname.startsWith('/settings') ? 'active' : ''}>
            Settings
          </Link>
        )}
        {user ? (
          <>
            <span className="role-pill">{user.role}</span>
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link to="/login">Sign in</Link>
            <Link to="/register">
              <button className="btn btn-primary btn-sm">Register</button>
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

export function ProtectedRoute({ roles, children }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export function Banner({ type = 'error', children }) {
  if (!children) return null;
  return (
    <div className={`toast-banner ${type}`} role={type === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function UrgencyBadge({ urgency }) {
  if (!urgency) return null;
  return <span className={`badge ${urgency}`}>{urgency} urgency</span>;
}

export function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{status.replace('_', ' ')}</span>;
}

/* Optional helpers the redesign uses — safe to import anywhere. */
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="row between wrap" style={{ marginBottom: 24, alignItems: 'flex-end' }}>
      <div>
        <h1>{title}</h1>
        {subtitle && <p style={{ marginBottom: 0, maxWidth: '62ch' }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function SearchBar({ value, onChange, onSubmit, placeholder }) {
  return (
    <form
      className="searchbar"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="submit" className="btn btn-primary btn-sm">
        Search
      </button>
    </form>
  );
}
