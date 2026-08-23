import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const FEATURES = [
  {
    title: 'Context before the consult',
    body: "Patients describe symptoms while booking. The visit opens with a chief complaint, an urgency read, and the questions worth asking.",
  },
  {
    title: 'A queue that sorts itself',
    body: 'Every appointment carries a coloured triage rail, so the day reads at a glance instead of row by row.',
  },
  {
    title: 'Follow-up that actually follows',
    body: 'Notes become a plain-language summary, medication reminders schedule themselves, and failed emails retry on their own.',
  },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="landing-hero fade-in">
      <span className="eyebrow">Appointments · Triage · Follow-up</span>

      <h1>
        One clear thread for <em>every visit</em>, from booking to follow-up.
      </h1>
      <p>
        Patients arrive already described. Doctors open the visit knowing the urgency. Everyone gets a
        calendar hold and an email that reflects what actually happened.
      </p>

      {!user && (
        <div className="row wrap">
          <Link to="/register">
            <button className="btn btn-primary">Book as a patient</button>
          </Link>
          <Link to="/login">
            <button className="btn btn-outline">Sign in</button>
          </Link>
        </div>
      )}
      {user?.role === 'PATIENT' && (
        <div className="row wrap" style={{ justifyContent: 'center', gap: 10 }}>
          <Link to="/patient/dashboard">
            <button className="btn btn-primary">Go to my dashboard</button>
          </Link>
          <Link to="/patient/find">
            <button className="btn btn-outline">Find a doctor</button>
          </Link>
        </div>
      )}
      {user?.role === 'DOCTOR' && (
        <Link to="/doctor/dashboard">
          <button className="btn btn-primary">Go to dashboard</button>
        </Link>
      )}
      {user?.role === 'ADMIN' && (
        <Link to="/admin">
          <button className="btn btn-primary">Go to admin panel</button>
        </Link>
      )}

      <div className="feature-grid">
        {FEATURES.map((f, i) => (
          <div className="feature" key={f.title}>
            <span className="feature-index">{String(i + 1).padStart(2, '0')}</span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-value">3</div>
          <div className="stat-label">Roles, one system</div>
        </div>
        <div className="stat">
          <div className="stat-value">&lt; 60s</div>
          <div className="stat-label">Book, describe, confirm</div>
        </div>
        <div className="stat">
          <div className="stat-value">0</div>
          <div className="stat-label">Reminders missed</div>
        </div>
      </div>
    </div>
  );
}
