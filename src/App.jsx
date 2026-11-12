import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import LoginPage from "./pages/LoginPage";
import KioskScreen from "./pages/KioskScreen";
import StaffScanner from "./pages/StaffScanner";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  if (user === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Loading Portal...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/kiosk" element={<KioskScreen />} />
        <Route path="/scan" element={user ? <StaffScanner /> : <Navigate to="/login" replace />} />
        <Route path="/admin" element={user ? <AdminDashboard /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to={user ? "/scan" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
