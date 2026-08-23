import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import { Banner, UrgencyBadge } from '../../components/Shared.jsx';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function FindDoctor() {
  const [specialisation, setSpecialisation] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(null); // doctor being booked, drives the modal

  useEffect(() => {
    loadDoctors();
  }, []);

  async function loadDoctors(spec) {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/doctors', { params: spec ? { specialisation: spec } : {} });
      setDoctors(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="main fade-in">
      <h1>Find a doctor</h1>
      <p>Search by specialisation, pick an open slot, and tell the doctor what's going on before you arrive.</p>

      <div className="row" style={{ marginBottom: 20 }}>
        <input
          placeholder="Specialisation, e.g. Dermatology"
          value={specialisation}
          onChange={(e) => setSpecialisation(e.target.value)}
          style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}
        />
        <button className="btn btn-outline" onClick={() => loadDoctors(specialisation)}>
          Search
        </button>
      </div>

      <Banner>{error}</Banner>

      {loading ? (
        <p className="muted">Loading doctors…</p>
      ) : doctors.length === 0 ? (
        <div className="empty-state card">
          <h3>No doctors match that search</h3>
          <p>Try a broader specialisation or clear the search box.</p>
        </div>
      ) : (
        <div className="grid cols-2">
          {doctors.map((d) => (
            <div className="card" key={d.id}>
              <h3> {d.user.name}</h3>
              <p className="muted">{d.specialisation}</p>
              {d.bio && <p style={{ fontSize: 13.5 }}>{d.bio}</p>}
              <p className="hint mono">{d.slotDurationMinutes}-min slots · {d.workingDays}</p>
              <button className="btn btn-primary btn-sm" onClick={() => setBooking(d)}>
                View availability
              </button>
            </div>
          ))}
        </div>
      )}

      {booking && <BookingModal doctor={booking} onClose={() => setBooking(null)} />}
    </div>
  );
}

function BookingModal({ doctor, onClose }) {
  const [step, setStep] = useState('slots'); // slots -> symptoms -> review -> done
  const [date, setDate] = useState(todayStr());
  const [slotsResult, setSlotsResult] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [appointment, setAppointment] = useState(null);
  const [symptoms, setSymptoms] = useState('');
  const [patientAnswers, setPatientAnswers] = useState('');
  const [preVisitSummary, setPreVisitSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSlots(date);
  }, [date]);

  async function loadSlots(d) {
    setError('');
    setSelectedSlot(null);
    try {
      const { data } = await api.get(`/doctors/${doctor.id}/slots`, { params: { date: d } });
      setSlotsResult(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleHold() {
    if (!selectedSlot) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/appointments/hold', { doctorId: doctor.id, slotStart: selectedSlot });
      setAppointment(data.appointment);
      setStep('symptoms');
    } catch (err) {
      setError(err.message);
      loadSlots(date); // slot was likely just taken — refresh availability
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateSummary() {
    if (symptoms.trim().length < 3) {
      setError('Please describe your symptoms in a bit more detail.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/appointments/${appointment.id}/pre-visit-summary`, { symptomsText: symptoms });
      setPreVisitSummary(data.preVisitSummary);
      setStep('review');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setError('');
    const combinedSymptoms = patientAnswers.trim()
      ? `${symptoms}\n\n[Patient notes/answers]: ${patientAnswers.trim()}`
      : symptoms;
    const finalSummary = {
      ...preVisitSummary,
      ...(patientAnswers.trim() ? { patientAnswers: patientAnswers.trim() } : {}),
    };
    try {
      await api.post(`/appointments/${appointment.id}/confirm`, { symptomsText: combinedSymptoms, preVisitSummary: finalSummary });
      setStep('done');
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
          <h2>Book with {doctor.user.name}</h2>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Close</button>
        </div>

        <Banner>{error}</Banner>

        {step === 'slots' && (
          <>
            <div className="field">
              <label>Date</label>
              <input type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} />
            </div>
            {slotsResult?.onLeave ? (
              <p className="muted"> {doctor.user.name} is on leave this day{slotsResult.reason ? `: ${slotsResult.reason}` : '.'}</p>
            ) : slotsResult && slotsResult.slots.length === 0 ? (
              <p className="muted">No open slots this day. Try another date.</p>
            ) : (
              <div className="slot-grid">
                {(slotsResult?.slots || []).map((s) => (
                  <button
                    key={s.start}
                    className={`slot-btn ${selectedSlot === s.start ? 'selected' : ''}`}
                    onClick={() => setSelectedSlot(s.start)}
                  >
                    {new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </button>
                ))}
              </div>
            )}
            <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={!selectedSlot || loading} onClick={handleHold}>
              {loading ? <span className="spinner" /> : 'Hold this slot'}
            </button>
          </>
        )}

        {step === 'symptoms' && (
          <>
            <p className="hint">Slot held for a few minutes — describe your symptoms to continue.</p>
            <div className="field">
              <label>Symptoms</label>
              <textarea
                autoFocus
                placeholder="e.g. Dry cough for 3 days, mild fever in the evenings, no shortness of breath"
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
              />
            </div>
            <button className="btn btn-primary btn-block" disabled={loading} onClick={handleGenerateSummary}>
              {loading ? <span className="spinner" /> : 'Continue to Pre-Visit Review'}
            </button>
          </>
        )}

        {step === 'review' && preVisitSummary && (
          <>
            <div className="card" style={{ background: 'var(--sage-50)' }}>
              <div className="row between" style={{ alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>📋 Pre-Visit Summary</h3>
                <UrgencyBadge urgency={preVisitSummary.urgency} />
              </div>
              <p style={{ fontSize: 13.5, margin: '8px 0 10px' }}>
                <strong>Chief complaint:</strong> {preVisitSummary.chiefComplaint}
              </p>
              {preVisitSummary.suggestedQuestions?.length > 0 && (
                <>
                  <p className="hint" style={{ marginBottom: 4, fontWeight: 600, color: 'var(--teal-900)' }}>
                    💡 Suggested questions for your consultation:
                  </p>
                  <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13.5, color: 'var(--muted)' }}>
                    {preVisitSummary.suggestedQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </>
              )}

              <div className="field" style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--teal-900)' }}>
                  ✍️ Add your answers or extra details for Dr. {doctor.user.name} (optional):
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Symptoms started 2 days ago, took paracetamol once, no previous allergies."
                  value={patientAnswers}
                  onChange={(e) => setPatientAnswers(e.target.value)}
                  style={{ fontSize: 13, background: '#ffffff', border: '1px solid var(--line)' }}
                />
              </div>

              {patientAnswers.trim().length > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ width: '100%', marginTop: 6 }}
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true);
                    setError('');
                    try {
                      const combined = `${symptoms}. Additional patient details: ${patientAnswers.trim()}`;
                      const { data } = await api.post(`/appointments/${appointment.id}/pre-visit-summary`, {
                        symptomsText: combined,
                      });
                      setPreVisitSummary(data.preVisitSummary);
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  🔄 Update AI assessment with my answers
                </button>
              )}
            </div>

            <div className="row" style={{ marginTop: 16, gap: 10 }}>
              <button
                type="button"
                className="btn btn-outline"
                style={{ flex: 1 }}
                onClick={() => setStep('symptoms')}
                disabled={loading}
              >
                &larr; Back
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 2 }}
                disabled={loading}
                onClick={handleConfirm}
              >
                {loading ? <span className="spinner" /> : 'Confirm appointment'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="empty-state">
            <h3>Appointment confirmed</h3>
            <p>A confirmation email is on its way, and the visit is on your calendar. See it under "My Appointments".</p>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
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
