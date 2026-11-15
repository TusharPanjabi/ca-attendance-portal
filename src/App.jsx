import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import LoginPage from "./pages/LoginPage";
import KioskScreen from "./pages/KioskScreen";
import StaffScanner from "./pages/StaffScanner";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  const [user, setUser] = useState(undefined);
  const [role, setRole] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const snap = await getDoc(doc(db, "users", u.uid));
        setRole(snap.exists() ? snap.data().role : "STAFF");
        setUser(u);
      } else {
        setRole(null);
        setUser(null);
      }
    });
    return () => unsub();
  }, []);

  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white font-semibold">
        Verifying Security Credentials...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/kiosk" element={<KioskScreen />} />
        <Route
          path="/scan"
          element={user ? <StaffScanner /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/admin"
          element={
            user && role === "ADMIN" ? (
              <AdminDashboard />
            ) : (
              <Navigate to={user ? "/scan" : "/login"} replace />
            )
          }
        />
        <Route
          path="*"
          element={<Navigate to={user ? (role === "ADMIN" ? "/admin" : "/scan") : "/login"} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}