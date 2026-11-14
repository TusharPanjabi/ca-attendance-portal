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
  LogOut, Camera, Clock, X
} from "lucide-react";

export default function StaffScanner() {
  const [userProfile, setUserProfile] = useState(null);
  const [activeLog, setActiveLog] = useState(null);
  const [status, setStatus] = useState({ type: "idle", msg: "" });
  const [scanning, setScanning] = useState(false);

  // Explicit Permission States for iOS/Android
  const [gpsGranted, setGpsGranted] = useState(false);
  const [camGranted, setCamGranted] = useState(false);

  // Late Arrival Popup Modal
  const [latePopup, setLatePopup] = useState(null);

  const html5QrRef = useRef(null);
  const navigate = useNavigate();
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    loadUserAndSession();

    return () => {
      stopScanner();
    };
  }, [user]);

  const stopScanner = async () => {
    if (html5QrRef.current) {
      try {
        if (html5QrRef.current.isScanning) {
          await html5QrRef.current.stop();
        }
        html5QrRef.current.clear();
      } catch (e) {
        console.warn("Scanner stop cleanup:", e);
      }
      html5QrRef.current = null;
    }
  };

  const loadUserAndSession = async () => {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const data = userSnap.data();
    const currentDeviceId = getOrCreateDeviceId();

    // Device Binding Check
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

    const today = new Date().toISOString().split("T")[0];
    const q = query(
      collection(db, "attendance_logs"),
      where("userId", "==", user.uid),
      where("date", "==", today),
      where("checkOut", "==", null)
    );
    const logSnap = await getDocs(q);
    if (!logSnap.empty) {
      setActiveLog({ id: logSnap.docs[0].id, ...logSnap.docs[0].data() });
    } else {
      setActiveLog(null);
    }
  };

  // Explicit Button 1: Request Location Access (Works on iPhone Safari)
  const requestLocationAccess = () => {
    setStatus({ type: "info", msg: "Requesting GPS location permission..." });
    navigator.geolocation.getCurrentPosition(
      () => {
        setGpsGranted(true);
        setStatus({ type: "success", msg: "Location access allowed!" });
      },
      (err) => {
        setGpsGranted(false);
        setStatus({
          type: "error",
          msg: "Location blocked. On iPhone: Settings > Privacy > Location Services > Safari Websites > While Using."
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Explicit Button 2: Request Camera Access (Works on iPhone Safari)
  const requestCameraAccess = async () => {
    try {
      setStatus({ type: "info", msg: "Requesting camera permission..." });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      stream.getTracks().forEach((track) => track.stop());
      setCamGranted(true);
      setStatus({ type: "success", msg: "Camera access allowed! Ready to scan." });
    } catch (err) {
      setCamGranted(false);
      setStatus({
        type: "error",
        msg: "Camera blocked. Tap 'aA' in iPhone Safari address bar > Website Settings > Camera > Allow."
      });
    }
  };

  // Start iOS-Safe Rear Camera QR Scanner
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
      } catch (err) {
        setScanning(false);
        setStatus({
          type: "error",
          msg: "Unable to open camera. Tap 'Allow Camera' button above first."
        });
      }
    }, 250);
  };

  // Calculate Late Minutes against User's Scheduled Start Time (e.g. "10:00")
  const calculateLateMinutes = (scheduleStartStr) => {
    if (!scheduleStartStr) return 0;
    const [schedH, schedM] = scheduleStartStr.split(":").map(Number);
    const now = new Date();
    const scheduledDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      schedH,
      schedM,
      0
    );
    const diffMs = now.getTime() - scheduledDate.getTime();
    return diffMs > 60000 ? Math.floor(diffMs / 60000) : 0;
  };

  const verifyAndMarkAttendance = async (qrText) => {
    try {
      setStatus({ type: "info", msg: "Verifying GPS Geofence & QR Signature..." });

      const officeSnap = await getDoc(doc(db, "office_settings", "main_branch"));
      const office = officeSnap.data();

      if (!validateQRPayload(qrText, office.qrSecretKey)) {
        setStatus({
          type: "error",
          msg: "EXPIRED OR INVALID QR: Scan directly from the live Kiosk screen."
        });
        return;
      }

      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        })
      );
      setGpsGranted(true);

      const geoCheck = isWithinOfficeRadius(
        position.coords.latitude,
        position.coords.longitude,
        office.lat,
        office.lng,
        office.allowedRadiusMeters
      );

      if (!geoCheck.allowed) {
        setStatus({
          type: "error",
          msg: `OUTSIDE OFFICE GEOFENCE: You are ${geoCheck.distance}m away (Max allowed: ${office.allowedRadiusMeters}m).`
        });
        return;
      }

      const today = new Date().toISOString().split("T")[0];

      if (!activeLog) {
        // CHECK-IN + LATE TIMING CHECK
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
          locationVerified: true
        });

        if (lateByMinutes > 0) {
          setLatePopup({
            minutes: lateByMinutes,
            scheduled: userProfile.shiftStartTime || "10:00"
          });
        }

        setStatus({
          type: "success",
          msg: lateByMinutes > 0
            ? `Checked In (Late by ${lateByMinutes} mins).`
            : "Checked In On Time! Shift started."
        });
      } else {
        // CHECK-OUT (Salary calculated & stored in DB, NOT shown to staff)
        const checkInMillis = activeLog.checkIn.toMillis();
        const nowMillis = Date.now();
        const totalMinutes = Math.max(1, Math.round((nowMillis - checkInMillis) / 60000));
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
      {/* LATE ARRIVAL POPUP MODAL */}
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
        {/* Top Bar */}
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

        {/* Schedule & Shift Status (No Salary Shown) */}
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

        {/* EXPLICIT PERMISSION BUTTONS (Camera & Location) */}
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

        {/* Step 2: Scan QR Button or Live Camera Feed */}
        {!scanning ? (
          <button
            onClick={startScan}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow transition flex items-center justify-center gap-2"
          >
            <Camera className="w-5 h-5" />
            {activeLog ? "Scan Kiosk QR to Check-Out" : "Scan Kiosk QR to Check-In"}
          </button>
        ) : (
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