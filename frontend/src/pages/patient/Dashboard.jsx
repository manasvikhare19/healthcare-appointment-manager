import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Clock3, Plus, Sparkles } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { Banner, StatusBadge, UrgencyBadge } from '../../components/Shared.jsx';

function todayFormatted() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function parseDateBlock(iso) {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return { day, month };
}

function formatTimeRange(startIso, endIso) {
  const s = new Date(startIso);
  const startTime = s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!endIso) return startTime;
  const e = new Date(endIso);
  const endTime = e.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${startTime} – ${endTime}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [careNoteDismissed, setCareNoteDismissed] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/appointments/mine');
      setAppointments(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(id) {
    if (!confirm('Cancel this appointment?')) return;
    try {
      await api.post(`/appointments/${id}/cancel`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const { nextAppt, upcoming, completedCount, prescriptionCount } = useMemo(() => {
    const now = new Date();
    const isUpcoming = (a) => ['HELD', 'CONFIRMED'].includes(a.status) && new Date(a.slotStart) >= now;

    const upcoming = appointments
      .filter(isUpcoming)
      .sort((a, b) => new Date(a.slotStart) - new Date(b.slotStart));

    const completedCount = appointments.filter((a) => a.status === 'COMPLETED').length;
    const prescriptionCount = appointments.filter(
      (a) => a.prescriptionText || a.postVisitSummary?.medicationSchedule?.length > 0
    ).length;

    return { nextAppt: upcoming[0] || null, upcoming, completedCount, prescriptionCount };
  }, [appointments]);

  if (loading) {
    return (
      <div className="main fade-in">
        <div className="skeleton-line" style={{ width: 220, height: 28, marginBottom: 22 }} />
        <div className="skeleton-card" style={{ height: 120, marginBottom: 20 }} />
        <div className="grid cols-3" style={{ marginBottom: 24 }}>
          <div className="skeleton-card" style={{ height: 70 }} />
          <div className="skeleton-card" style={{ height: 70 }} />
          <div className="skeleton-card" style={{ height: 70 }} />
        </div>
        <div className="skeleton-card" style={{ height: 80 }} />
      </div>
    );
  }

  return (
    <div className="main fade-in">
      <div className="eyebrow">
        <span className="eyebrow-dot" /> Your care, beautifully organized
      </div>

      <div className="hero-row">
        <div>
          <p className="kicker">{todayFormatted()}</p>
          <h1>
            Care that keeps<br />
            <em>you</em> moving.
          </h1>
          <p className="hero-copy">
            Welcome back, {user?.name?.split(' ')[0]}. Your health is a conversation — stay close to the people and appointments that help you feel your best.
          </p>
        </div>

        {nextAppt ? (
          <div className="next-visit">
            <div className="visit-label">
              <span className="live-dot" /> Next on your calendar
            </div>
            <p className="visit-time">
              {new Date(nextAppt.slotStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(' ', ' ')}
            </p>
            <p className="visit-doctor">
              with <strong>Dr. {nextAppt.doctor.user.name}</strong>
            </p>
            <Link to="/patient/appointments" className="text-link">
              View details <ChevronRight size={15} />
            </Link>
          </div>
        ) : (
          <div className="next-visit" style={{ background: 'linear-gradient(145deg, #164e46, #0e3731)' }}>
            <div className="visit-label">
              <span className="live-dot" /> Calendar Status
            </div>
            <p className="visit-time" style={{ fontSize: 28, margin: '20px 0 8px' }}>
              No Visits
            </p>
            <p className="visit-doctor">No upcoming visits booked</p>
            <Link to="/patient/find" className="text-link">
              Book a doctor <ChevronRight size={15} />
            </Link>
          </div>
        )}
      </div>

      <Banner>{error}</Banner>

      {/* Stat Tiles */}
      <div className="grid cols-3 stat-row" style={{ marginBottom: 28 }}>
        <div className="stat-tile">
          <p className="stat-number">{upcoming.length}</p>
          <p className="stat-label">Upcoming Visits</p>
        </div>
        <div className="stat-tile">
          <p className="stat-number">{completedCount}</p>
          <p className="stat-label">Completed Consultations</p>
        </div>
        <div className="stat-tile">
          <p className="stat-number">{prescriptionCount}</p>
          <p className="stat-label">Active Prescriptions</p>
        </div>
      </div>

      {/* Timeline Section */}
      <div className="section-heading" id="appointments">
        <div>
          <p className="kicker">Your care timeline</p>
          <h2>My appointments</h2>
        </div>
        <Link className="outline-button" to="/patient/find">
          <Plus size={16} /> Book a visit
        </Link>
      </div>

      {upcoming.length === 0 ? (
        <div className="empty-state card">
          <h3>No appointments on your timeline</h3>
          <p>Book a consultation with one of our specialized physicians today.</p>
          <Link to="/patient/find">
            <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
              Find a Doctor
            </button>
          </Link>
        </div>
      ) : (
        upcoming.map((a) => {
          const { day, month } = parseDateBlock(a.slotStart);
          return (
            <article className="appointment-card" key={a.id}>
              <div className="date-block">
                <span>{day}</span>
                <small>{month}</small>
              </div>
              <div className="appointment-info">
                <div className="appointment-top">
                  <StatusBadge status={a.status} />
                  <UrgencyBadge urgency={a.urgencyLevel} />
                </div>
                <h3>Dr. {a.doctor.user.name}</h3>
                <p>
                  {a.doctor.specialisation} <span>·</span> Meridian Clinic &amp; Consultation Suite
                </p>
                <div className="appointment-meta">
                  <span>
                    <Clock3 size={15} /> {formatTimeRange(a.slotStart, a.slotEnd)}
                  </span>
                  <span>
                    <CalendarDays size={15} /> {new Date(a.slotStart).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                  </span>
                </div>
              </div>
              <div className="appointment-actions">
                <Link to="/patient/appointments" className="outline-button" style={{ justifyContent: 'center' }}>
                  Manage
                </Link>
                <button className="btn btn-danger btn-sm" onClick={() => handleCancel(a.id)}>
                  Cancel
                </button>
              </div>
            </article>
          );
        })
      )}

      {/* Care Note Banner */}
      {!careNoteDismissed && (
        <div className="care-note">
          <Sparkles size={20} style={{ flexShrink: 0, marginTop: 2, color: 'var(--teal-700)' }} />
          <div style={{ flex: 1 }}>
            <strong>A little preparation goes a long way.</strong>
            <p>Write down any questions or symptoms you want to discuss with your doctor before your visit.</p>
          </div>
          <button
            onClick={() => setCareNoteDismissed(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16 }}
            aria-label="Dismiss note"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}