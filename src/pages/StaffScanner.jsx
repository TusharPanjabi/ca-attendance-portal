import React, { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  doc, getDoc, updateDoc, collection, addDoc,
  query, where, getDocs, serverTimestamp
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { getOrCreateDeviceId } from "../utils/deviceLock";
import {
  isWithinOfficeRadius,
  validateQRPayload,
  calculateSessionPay
} from "../utils/securityAndPay";
import {
  MapPin, Smartphone, CheckCircle2, AlertTriangle,
  LogOut, Camera, Clock, X, Briefcase
} from "lucide-react";

export default function StaffScanner() {
  const [userProfile, setUserProfile] = useState(null);
  const [activeLog, setActiveLog] = useState(null);
  const [status, setStatus] = useState({ type: "idle", msg: "" });
  const [scanning, setScanning] = useState(false);

  const [gpsGranted, setGpsGranted] = useState(false);
  const [camGranted, setCamGranted] = useState(false);
  const [latePopup, setLatePopup] = useState(null);

  // Client Audit Visit Mode
  const [auditMode, setAuditMode] = useState(false);
  const [clientName, setClientName] = useState("");

  const html5QrRef = useRef(null);
  const navigate = useNavigate();
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    loadUserAndSession();
    return () => stopScanner();
  }, [user]);

  const stopScanner = async () => {
    if (html5QrRef.current) {
      try {
        if (html5QrRef.current.isScanning) await html5QrRef.current.stop();
        html5QrRef.current.clear();
      } catch {}
      html5QrRef.current = null;
    }
  };

  const loadUserAndSession = async () => {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const data = userSnap.data();
    const currentDeviceId = getOrCreateDeviceId();

    if (!data.boundDeviceId) {
      await updateDoc(userRef, { boundDeviceId: currentDeviceId });
      data.boundDeviceId = currentDeviceId;
    } else if (data.boundDeviceId !== currentDeviceId) {
      setStatus({
        type: "error",
        msg: "SECURITY BLOCK: Account locked to another phone. Contact CA Admin to reset device."
      });
      return;
    }

    setUserProfile(data);

    // Find any open sessions
    const q = query(
      collection(db, "attendance_logs"),
      where("userId", "==", user.uid),
      where("checkOut", "==", null)
    );
    const logSnap = await getDocs(q);
    const today = new Date().toISOString().split("T")[0];

    let todayOpen = null;
    for (const d of logSnap.docs) {
      const logData = d.data();
      if (logData.date < today) {
        // Auto-flag forgotten checkouts from previous days so staff aren't locked out today
        await updateDoc(doc(db, "attendance_logs", d.id), {
          status: "MISSED_CHECKOUT",
          checkOut: serverTimestamp(),
          totalMinutes: 0,
          calculatedPay: 0
        });
      } else if (logData.date === today) {
        todayOpen = { id: d.id, ...logData };
      }
    }
    setActiveLog(todayOpen);
  };

  const requestLocationAccess = () => {
    setStatus({ type: "info", msg: "Requesting GPS location permission..." });
    navigator.geolocation.getCurrentPosition(
      () => {
        setGpsGranted(true);
        setStatus({ type: "success", msg: "Location access allowed!" });
      },
      () => {
        setGpsGranted(false);
        setStatus({
          type: "error",
          msg: "Location blocked. Enable Location in browser/phone settings."
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const requestCameraAccess = async () => {
    try {
      setStatus({ type: "info", msg: "Requesting camera permission..." });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      stream.getTracks().forEach((track) => track.stop());
      setCamGranted(true);
      setStatus({ type: "success", msg: "Camera access allowed! Ready to scan." });
    } catch {
      setCamGranted(false);
      setStatus({
        type: "error",
        msg: "Camera blocked. Tap 'aA' in Safari address bar > Website Settings > Camera > Allow."
      });
    }
  };

  const startScan = async () => {
    setScanning(true);
    setStatus({ type: "info", msg: "Opening rear camera..." });

    setTimeout(async () => {
      try {
        const html5QrCode = new Html5Qrcode("qr-reader");
        html5QrRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1.0 },
          async (decodedText) => {
            await stopScanner();
            setScanning(false);
            await verifyAndMarkAttendance(decodedText);
          },
          () => {}
        );
        setCamGranted(true);
        setStatus({ type: "idle", msg: "" });
      } catch {
        setScanning(false);
        setStatus({
          type: "error",
          msg: "Unable to open camera. Tap 'Allow Camera' button above first."
        });
      }
    }, 250);
  };

  const calculateLateMinutes = (scheduleStartStr) => {
    if (!scheduleStartStr) return 0;
    const [schedH, schedM] = scheduleStartStr.split(":").map(Number);
    const now = new Date();
    const scheduledDate = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(), schedH, schedM, 0
    );
    const diffMs = now.getTime() - scheduledDate.getTime();
    return diffMs > 60000 ? Math.floor(diffMs / 60000) : 0;
  };

  // Client-Site Audit Visit Punch (Out-of-Office)
  const handleClientAuditPunch = async (e) => {
    e.preventDefault();
    if (!clientName.trim()) return;
    try {
      setStatus({ type: "info", msg: "Capturing GPS coordinates for Client Audit..." });
      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        })
      );
      setGpsGranted(true);

      const today = new Date().toISOString().split("T")[0];
      if (!activeLog) {
        const lateByMinutes = calculateLateMinutes(userProfile.shiftStartTime || "10:00");
        await addDoc(collection(db, "attendance_logs"), {
          userId: user.uid,
          userName: userProfile.name,
          role: userProfile.role,
          date: today,
          checkIn: serverTimestamp(),
          checkOut: null,
          totalMinutes: 0,
          calculatedPay: 0,
          lateMinutes: lateByMinutes,
          visitType: "CLIENT_AUDIT",
          clientLocationName: clientName.trim(),
          auditGps: `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`,
          status: "PENDING_APPROVAL",
          locationVerified: true
        });
        if (lateByMinutes > 0) {
          setLatePopup({ minutes: lateByMinutes, scheduled: userProfile.shiftStartTime || "10:00" });
        }
        setStatus({ type: "success", msg: `Client Audit Check-In logged at ${clientName}!` });
      } else {
        const checkInMillis = activeLog.checkIn.toMillis();
        const totalMinutes = Math.max(1, Math.round((Date.now() - checkInMillis) / 60000));
        const earnedPay = calculateSessionPay(totalMinutes, userProfile.role, userProfile.payConfig);

        await updateDoc(doc(db, "attendance_logs", activeLog.id), {
          checkOut: serverTimestamp(),
          totalMinutes,
          calculatedPay: earnedPay,
          adminNotified: false
        });
        setStatus({ type: "success", msg: `Client Audit Checked Out! Worked ${totalMinutes} mins.` });
      }
      setAuditMode(false);
      setClientName("");
      await loadUserAndSession();
    } catch (err) {
      setStatus({ type: "error", msg: "GPS required for Client Audit punch: " + err.message });
    }
  };

  const verifyAndMarkAttendance = async (qrText) => {
    try {
      setStatus({ type: "info", msg: "Verifying GPS Geofence & QR Signature..." });
      const officeSnap = await getDoc(doc(db, "office_settings", "main_branch"));
      const office = officeSnap.data();

      if (!validateQRPayload(qrText, office.qrSecretKey)) {
        setStatus({ type: "error", msg: "EXPIRED OR INVALID QR: Scan directly from the live Kiosk screen." });
        return;
      }

      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        })
      );
      setGpsGranted(true);

      const geoCheck = isWithinOfficeRadius(
        position,
        office.lat,
        office.lng,
        office.allowedRadiusMeters
      );

      if (!geoCheck.allowed) {
        setStatus({ type: "error", msg: geoCheck.reason });
        return;
      }

      const today = new Date().toISOString().split("T")[0];

      if (!activeLog) {
        const lateByMinutes = calculateLateMinutes(userProfile.shiftStartTime || "10:00");
        await addDoc(collection(db, "attendance_logs"), {
          userId: user.uid,
          userName: userProfile.name,
          role: userProfile.role,
          date: today,
          checkIn: serverTimestamp(),
          checkOut: null,
          totalMinutes: 0,
          calculatedPay: 0,
          lateMinutes: lateByMinutes,
          visitType: "OFFICE",
          status: "VERIFIED",
          locationVerified: true
        });

        if (lateByMinutes > 0) {
          setLatePopup({ minutes: lateByMinutes, scheduled: userProfile.shiftStartTime || "10:00" });
        }

        setStatus({
          type: "success",
          msg: lateByMinutes > 0
            ? `Checked In (Late by ${lateByMinutes} mins).`
            : "Checked In On Time! Shift started."
        });
      } else {
        const checkInMillis = activeLog.checkIn.toMillis();
        const totalMinutes = Math.max(1, Math.round((Date.now() - checkInMillis) / 60000));
        const earnedPay = calculateSessionPay(totalMinutes, userProfile.role, userProfile.payConfig);

        await updateDoc(doc(db, "attendance_logs", activeLog.id), {
          checkOut: serverTimestamp(),
          totalMinutes,
          calculatedPay: earnedPay,
          adminNotified: false
        });

        setStatus({
          type: "success",
          msg: `Checked Out Successfully! Total time worked today: ${totalMinutes} mins.`
        });
      }

      await loadUserAndSession();
    } catch (err) {
      setStatus({ type: "error", msg: "GPS or Network Error: " + err.message });
    }
  };

  if (!userProfile && status.type === "error") {
    return (
      <div className="p-6 max-w-md mx-auto mt-10 bg-red-950/90 border border-red-600 rounded-xl text-red-100">
        <AlertTriangle className="w-8 h-8 mb-2 text-red-400" />
        <p className="font-semibold">{status.msg}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 flex flex-col items-center">
      {/* LATE ARRIVAL POPUP */}
      {latePopup && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center shadow-2xl border-2 border-amber-500">
            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">Late Check-In Alert</h3>
            <p className="text-sm text-slate-600 mt-2">
              Your scheduled office time is <strong>{latePopup.scheduled}</strong>.
            </p>
            <div className="my-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <span className="text-lg font-extrabold text-amber-800">
                You are late by {latePopup.minutes} minutes
              </span>
            </div>
            <button
              onClick={() => setLatePopup(null)}
              className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded-xl text-sm"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}

      <div className="max-w-md w-full bg-white rounded-2xl shadow-md p-6 border border-slate-200 space-y-5">
        <div className="flex justify-between items-center border-b pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{userProfile?.name}</h2>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
              {userProfile?.role === "INTERN" ? "Intern" : "Full-Time Staff"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Smartphone className="w-5 h-5 text-emerald-600" title="Device Bound" />
            <button
              onClick={() => signOut(auth).then(() => navigate("/login"))}
              className="text-slate-400 hover:text-red-600"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-100 rounded-xl p-3.5">
            <p className="text-xs text-slate-500 uppercase font-semibold">Your Schedule</p>
            <p className="text-sm font-bold text-slate-800 mt-1">
              {userProfile?.shiftStartTime || "10:00"} – {userProfile?.shiftEndTime || "18:00"}
            </p>
          </div>
          <div className="bg-indigo-50 rounded-xl p-3.5 border border-indigo-100">
            <p className="text-xs text-indigo-700 uppercase font-semibold">Today's Status</p>
            <p className="text-sm font-bold text-indigo-900 mt-1">
              {activeLog ? "Clocked In" : "Not Checked In"}
            </p>
          </div>
        </div>

        {/* Permission Buttons */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-600 uppercase">
            Step 1: Enable Device Permissions
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={requestLocationAccess}
              className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition ${
                gpsGranted
                  ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                  : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <MapPin className="w-4 h-4" />
              {gpsGranted ? "Location Allowed" : "Allow Location"}
            </button>

            <button
              type="button"
              onClick={requestCameraAccess}
              className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition ${
                camGranted
                  ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                  : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <Camera className="w-4 h-4" />
              {camGranted ? "Camera Allowed" : "Allow Camera"}
            </button>
          </div>
        </div>

        {/* Main Office QR Scan OR Client Audit Mode */}
        {!scanning && !auditMode && (
          <div className="space-y-2.5">
            <button
              onClick={startScan}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow transition flex items-center justify-center gap-2"
            >
              <Camera className="w-5 h-5" />
              {activeLog ? "Scan Office QR to Check-Out" : "Scan Office QR to Check-In"}
            </button>

            <button
              onClick={() => setAuditMode(true)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 border border-slate-300"
            >
              <Briefcase className="w-4 h-4 text-indigo-600" />
              {activeLog?.visitType === "CLIENT_AUDIT"
                ? "Complete Client Audit Check-Out"
                : "On Client-Site Audit? Log Out-of-Office Punch"}
            </button>
          </div>
        )}

        {auditMode && (
          <form onSubmit={handleClientAuditPunch} className="bg-indigo-50/70 border border-indigo-200 p-4 rounded-xl space-y-3">
            <p className="text-xs font-bold text-indigo-900 uppercase">Client-Site Audit Punch (GPS Logged)</p>
            <input
              type="text"
              required
              placeholder="Enter Client / Company Name (e.g. ABC Pvt Ltd)"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold"
              >
                Confirm GPS Audit Punch
              </button>
              <button
                type="button"
                onClick={() => setAuditMode(false)}
                className="px-3 py-2 bg-white border rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {scanning && (
          <div className="space-y-2">
            <div
              id="qr-reader"
              className="w-full rounded-xl overflow-hidden border-2 border-indigo-500 bg-black"
            />
            <button
              onClick={async () => {
                await stopScanner();
                setScanning(false);
              }}
              className="w-full py-2 bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1"
            >
              <X className="w-4 h-4" /> Cancel Scan
            </button>
          </div>
        )}

        {status.msg && (
          <div
            className={`p-3.5 rounded-xl text-sm font-medium flex items-start gap-2 ${
              status.type === "error"
                ? "bg-red-50 text-red-700 border border-red-200"
                : status.type === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-blue-50 text-blue-700 border border-blue-200"
            }`}
          >
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{status.msg}</span>
          </div>
        )}
      </div>
    </div>
  );
}