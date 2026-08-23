import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { NavBar, ProtectedRoute } from './components/Shared.jsx';
import ChatWidget from './components/ChatWidget.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/patient/Dashboard.jsx';
import FindDoctor from './pages/patient/FindDoctor.jsx';
import MyAppointments from './pages/patient/MyAppointments.jsx';
import DoctorDashboard from './pages/doctor/DoctorDashboard.jsx';
import AdminPanel from './pages/admin/AdminPanel.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <div className="app-shell">
      <NavBar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          path="/patient"
          element={
            <ProtectedRoute roles={['PATIENT']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patient/dashboard"
          element={
            <ProtectedRoute roles={['PATIENT']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patient/find"
          element={
            <ProtectedRoute roles={['PATIENT']}>
              <FindDoctor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patient/appointments"
          element={
            <ProtectedRoute roles={['PATIENT']}>
              <MyAppointments />
            </ProtectedRoute>
          }
        />

        <Route
          path="/doctor/dashboard"
          element={
            <ProtectedRoute roles={['DOCTOR']}>
              <DoctorDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['ADMIN']}>
              <AdminPanel />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <ProtectedRoute roles={['PATIENT', 'DOCTOR', 'ADMIN']}>
              <Settings />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Landing />} />
      </Routes>
      <ChatWidget />
    </div>
  );
}