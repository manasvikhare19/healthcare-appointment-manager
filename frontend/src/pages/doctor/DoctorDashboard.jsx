import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import { Banner } from '../../components/Shared.jsx';

export default function DoctorDashboard() {
  const [appointments, setAppointments] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(null); // appointment being wrapped up
  const [messaging, setMessaging] = useState(null);   // appointment patient being messaged

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/doctors/me/appointments', { params: { status: 'CONFIRMED' } });
      setAppointments(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="main fade-in">
      <h1>Today's queue</h1>
      <p className="muted">Sorted by urgency — the coloured rail on each card is the priority signal.</p>
      <Banner>{error}</Banner>
      <Banner type="success">{success}</Banner>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : appointments.length === 0 ? (
        <div className="empty-state card">
          <h3>No confirmed appointments right now</h3>
          <p>Completed visits move out of this queue automatically.</p>
        </div>
      ) : (
        appointments.map((a) => (
          <div className="triage-card" key={a.id}>
            <div className={`triage-rail ${a.urgencyLevel || 'Low'}`} />
            <div className="triage-body">
              <div className="row between wrap">
                <div>
                  <h3>{a.patient.name}</h3>
                  <p className="mono muted" style={{ marginBottom: 0 }}>{new Date(a.slotStart).toLocaleString()}</p>
                </div>
                <span className={`badge ${a.urgencyLevel || 'Low'}`}>{a.urgencyLevel || 'Low'} urgency</span>
              </div>

              {a.preVisitSummary && (
                <>
                  <hr className="divider" />
                  <p style={{ fontSize: 13.5, marginBottom: 6 }}>
                    <b>Chief complaint:</b> {a.preVisitSummary.chiefComplaint}
                  </p>
                  {a.preVisitSummary.suggestedQuestions?.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: 'var(--muted)' }}>
                      {a.preVisitSummary.suggestedQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              <hr className="divider" />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => setCompleting(a)}>Complete visit</button>
                <button className="btn btn-outline btn-sm" onClick={() => setMessaging(a)}>✉️ Message patient</button>
              </div>
            </div>
          </div>
        ))
      )}

      {completing && (
        <CompleteVisitModal
          appointment={completing}
          onClose={() => setCompleting(null)}
          onDone={() => {
            setCompleting(null);
            setSuccess('Visit completed. Post-visit summary generated and medication reminders scheduled.');
            load();
          }}
        />
      )}

      {messaging && (
        <MessagePatientModal
          appointment={messaging}
          onClose={() => setMessaging(null)}
          onSent={(msg) => {
            setMessaging(null);
            setSuccess(msg);
          }}
        />
      )}
    </div>
  );
}

function MessagePatientModal({ appointment, onClose, onSent }) {
  const [subject, setSubject] = useState(`Care update from your doctor`);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSend(e) {
    e.preventDefault();
    if (!message.trim()) {
      setError('Please enter a message for the patient.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/doctors/me/appointments/${appointment.id}/message`, { subject, message });
      onSent(data.message || `Email sent successfully to ${appointment.patient.email}`);
    } catch (err) {
      setError(err.message || 'Failed to send email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} className="fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Message Patient — {appointment.patient.name}</h2>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="hint">
          Recipient: <strong>{appointment.patient.email}</strong> {appointment.patient.phone ? `(${appointment.patient.phone})` : ''}
        </p>
        <Banner>{error}</Banner>
        <form onSubmit={handleSend}>
          <div className="field">
            <label>Subject</label>
            <input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Message</label>
            <textarea
              required
              rows={4}
              placeholder="e.g. Please bring your previous blood test reports to our consultation tomorrow."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <span className="spinner" /> : '🚀 Send Email to Patient'}
          </button>
        </form>
      </div>
    </div>
  );
}

function CompleteVisitModal({ appointment, onClose, onDone }) {
  const [doctorNotes, setDoctorNotes] = useState('');
  const [prescriptionText, setPrescriptionText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (doctorNotes.trim().length < 3) {
      setError('Add a few notes about the visit before completing.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post(`/doctors/me/appointments/${appointment.id}/complete`, { doctorNotes, prescriptionText });
      onDone();
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
          <h2>Complete visit — {appointment.patient.name}</h2>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="hint">Notes and prescription are converted into a patient-friendly summary automatically, and medication reminders are scheduled from the prescription's stated frequency.</p>
        <Banner>{error}</Banner>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Clinical notes</label>
            <textarea
              autoFocus
              placeholder="e.g. Viral upper respiratory infection, mild. No signs of bacterial infection."
              value={doctorNotes}
              onChange={(e) => setDoctorNotes(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Prescription (optional)</label>
            <textarea
              placeholder="e.g. Paracetamol 500mg, every 8 hours for 3 days. Rest and fluids."
              value={prescriptionText}
              onChange={(e) => setPrescriptionText(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Generate summary & complete visit'}
          </button>
        </form>
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
