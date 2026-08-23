import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import { Banner, StatusBadge, UrgencyBadge } from '../../components/Shared.jsx';

import { CalendarDays, Clock3, Plus } from 'lucide-react';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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

function getGoogleCalendarUrl(appointment) {
  const startStr = new Date(appointment.slotStart).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const endStr = new Date(appointment.slotEnd).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    text: `Appointment: Dr. ${appointment.doctor.user.name}`,
    dates: `${startStr}/${endStr}`,
    details: `Doctor: Dr. ${appointment.doctor.user.name} (${appointment.doctor.specialisation})\nUrgency: ${appointment.urgencyLevel || 'Standard'}\n${appointment.symptomsText ? `Symptoms: ${appointment.symptomsText}` : ''}`,
    location: 'Meridian Clinic & Consultation Suite',
  });
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&${params.toString()}`;
}

function VisitSummary({ summary }) {
  const { summary: text, keyTakeaways, medicationSchedule, followUpSteps, dietAndLifestyle, warningSigns } = summary;
  return (
    <>
      <hr className="divider" />
      <p className="hint" style={{ marginBottom: 8 }}>🩺 Your visit summary</p>
      <p style={{ fontSize: 13.5 }}>{text}</p>

      {keyTakeaways?.length > 0 && (
        <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13.5 }}>
          {keyTakeaways.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}

      {medicationSchedule?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="hint" style={{ marginBottom: 4 }}>💊 Medication</p>
          <table style={{ width: '100%', fontSize: 13.5, borderCollapse: 'collapse' }}>
            <tbody>
              {medicationSchedule.map((m, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>{m.medication}</td>
                  <td style={{ padding: '4px 0', color: 'var(--muted)' }}>{m.instructions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {followUpSteps?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="hint" style={{ marginBottom: 4 }}>📅 Follow-up steps</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: 'var(--muted)' }}>
            {followUpSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {dietAndLifestyle?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="hint" style={{ marginBottom: 4 }}>🥗 Diet &amp; lifestyle</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: 'var(--muted)' }}>
            {dietAndLifestyle.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {warningSigns?.length > 0 && (
        <div className="card" style={{ background: 'var(--sage-50)', margin: 0, padding: 12 }}>
          <p className="hint" style={{ marginBottom: 4 }}>⚠️ Seek urgent care if you notice</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
            {warningSigns.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export default function MyAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [rescheduling, setRescheduling] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
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
    if (!confirm('Cancel this appointment? This will release the slot and notify the doctor.')) return;
    setError('');
    setSuccess('');
    try {
      await api.post(`/appointments/${id}/cancel`);
      setSuccess('Appointment cancelled successfully.');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="main fade-in">
      <h1>My appointments</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Track your consultation history, pre-visit summaries, prescriptions, and calendar entries.
      </p>

      {success && <Banner type="success">{success}</Banner>}
      {error && <Banner>{error}</Banner>}

      {loading ? (
        <p className="muted">Loading appointments…</p>
      ) : appointments.length === 0 ? (
        <div className="empty-state card">
          <h3>No appointments found</h3>
          <p>Head to "Find a Doctor" to book your consultation.</p>
        </div>
      ) : (
        appointments.map((a) => {
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
                    <CalendarDays size={15} /> {new Date(a.slotStart).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>

                {a.preVisitSummary && (
                  <div style={{ marginTop: 12, background: 'var(--sage-50)', padding: '10px 14px', borderRadius: 8 }}>
                    <p className="hint" style={{ marginBottom: 4, fontWeight: 600, color: 'var(--teal-900)' }}>
                      What you told the doctor:
                    </p>
                    <p style={{ fontSize: 13, margin: 0 }}>{a.symptomsText}</p>
                  </div>
                )}

                {a.postVisitSummary && <VisitSummary summary={a.postVisitSummary} />}

                {a.status === 'CONFIRMED' && (
                  <div style={{ marginTop: 14 }}>
                    <a
                      href={getGoogleCalendarUrl(a)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link"
                      style={{ color: 'var(--teal-700)', fontSize: 13 }}
                    >
                      📅 Add to Google Calendar &rarr;
                    </a>
                  </div>
                )}
              </div>

              <div className="appointment-actions">
                {a.status === 'CONFIRMED' && (
                  <>
                    <button className="outline-button" style={{ justifyContent: 'center' }} onClick={() => setRescheduling(a)}>
                      Reschedule
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleCancel(a.id)}>
                      Cancel
                    </button>
                  </>
                )}
                {a.status === 'HELD' && (
                  <button className="btn btn-danger btn-sm" onClick={() => handleCancel(a.id)}>
                    Release hold
                  </button>
                )}
              </div>
            </article>
          );
        })
      )}

      {rescheduling && (
        <RescheduleModal
          appointment={rescheduling}
          onClose={() => setRescheduling(null)}
          onRescheduled={(msg) => {
            setRescheduling(null);
            setSuccess(msg);
            load();
          }}
        />
      )}
    </div>
  );
}

function RescheduleModal({ appointment, onClose, onRescheduled }) {
  const [date, setDate] = useState(todayStr());
  const [slotsResult, setSlotsResult] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSlots(date);
  }, [date]);

  async function loadSlots(d) {
    setSlotsLoading(true);
    setError('');
    setSelectedSlot(null);
    try {
      const { data } = await api.get(`/doctors/${appointment.doctorId}/slots`, { params: { date: d } });
      setSlotsResult(data);
    } catch (err) {
      setError(err.message || 'Failed to fetch doctor slots');
    } finally {
      setSlotsLoading(false);
    }
  }

  async function handleConfirmReschedule() {
    if (!selectedSlot) return;
    setLoading(true);
    setError('');
    try {
      await api.post(`/appointments/${appointment.id}/reschedule`, { newSlotStart: selectedSlot });
      onRescheduled('Appointment rescheduled successfully! Calendar and email notifications have been updated.');
    } catch (err) {
      setError(err.message || 'Reschedule failed');
      loadSlots(date); // reload in case slot was just taken
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} className="fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Reschedule with Dr. {appointment.doctor.user.name}</h2>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="hint">
          Current time: <strong>{new Date(appointment.slotStart).toLocaleString()}</strong>
        </p>

        <Banner>{error}</Banner>

        <div className="field">
          <label>Select New Date</label>
          <input type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} />
        </div>

        {slotsLoading ? (
          <p className="muted">Loading open slots…</p>
        ) : slotsResult?.onLeave ? (
          <div className="card" style={{ background: 'var(--sage-50)', padding: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              Dr. {appointment.doctor.user.name} is on leave on this date{slotsResult.reason ? `: ${slotsResult.reason}` : '.'}
            </p>
          </div>
        ) : slotsResult && slotsResult.slots.length === 0 ? (
          <p className="muted">No available slots on this date. Please pick another day.</p>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 6 }}>Pick a new time slot:</p>
            <div className="slot-grid" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {(slotsResult?.slots || []).map((s) => (
                <button
                  key={s.start}
                  type="button"
                  className={`slot-btn ${selectedSlot === s.start ? 'selected' : ''}`}
                  onClick={() => setSelectedSlot(s.start)}
                >
                  {new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 20 }}
          disabled={!selectedSlot || loading}
          onClick={handleConfirmReschedule}
        >
          {loading ? <span className="spinner" /> : 'Confirm New Time'}
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
  background: 'var(--paper-card)', borderRadius: 14, padding: 26, width: '100%', maxWidth: 480,
  maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow-md)',
};