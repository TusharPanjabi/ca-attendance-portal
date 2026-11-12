import React, { useState, useEffect } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";
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
import { MapPin, Smartphone, CheckCircle2, AlertTriangle, IndianRupee, LogOut } from "lucide-react";

export default function StaffScanner() {
  const [userProfile, setUserProfile] = useState(null);
  const [activeLog, setActiveLog] = useState(null);
  const [myLogs, setMyLogs] = useState([]);
  const [status, setStatus] = useState({ type: "idle", msg: "" });
  const [scanning, setScanning] = useState(false);
  const navigate = useNavigate();

  const user = auth.currentUser;

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    loadUserAndSession();
  }, [user]);

  const loadUserAndSession = async () => {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const data = userSnap.data();
    const currentDeviceId = getOrCreateDeviceId();

    // Security Check 1: Device Binding
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

    // Load user logs
    const allLogsQ = query(collection(db, "attendance_logs"), where("userId", "==", user.uid));
    const allSnap = await getDocs(allLogsQ);
    const records = allSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setMyLogs(records);

    const today = new Date().toISOString().split("T")[0];
    const openSession = records.find((r) => r.date === today && r.checkOut === null);
    setActiveLog(openSession || null);
  };

  const startScan = () => {
    setScanning(true);
    setStatus({ type: "info", msg: "Acquiring GPS & Camera..." });

    setTimeout(() => {
      const scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 });
      scanner.render(
        async (decodedText) => {
          scanner.clear();
          setScanning(false);
          await verifyAndMarkAttendance(decodedText);
        },
        () => {}
      );
    }, 200);
  };

  const verifyAndMarkAttendance = async (qrText) => {
    try {
      setStatus({ type: "info", msg: "Verifying GPS Geofence & QR Signature..." });

      const officeSnap = await getDoc(doc(db, "office_settings", "main_branch"));
      const office = officeSnap.data();

      // Security Check 2: Validate 15-Second Dynamic QR
      if (!validateQRPayload(qrText, office.qrSecretKey)) {
        setStatus({ type: "error", msg: "EXPIRED OR INVALID QR: Scan directly from the live Kiosk screen." });
        return;
      }

      // Security Check 3: GPS Geofence Verification
      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        })
      );

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
        await addDoc(collection(db, "attendance_logs"), {
          userId: user.uid,
          userName: userProfile.name,
          role: userProfile.role,
          date: today,
          checkIn: serverTimestamp(),
          checkOut: null,
          totalMinutes: 0,
          calculatedPay: 0,
          locationVerified: true
        });
        setStatus({ type: "success", msg: "Checked In Successfully! Timer started." });
      } else {
        const checkInMillis = activeLog.checkIn.toMillis();
        const nowMillis = Date.now();
        const totalMinutes = Math.max(1, Math.round((nowMillis - checkInMillis) / 60000));
        const earnedPay = calculateSessionPay(totalMinutes, userProfile.role, userProfile.payConfig);

        await updateDoc(doc(db, "attendance_logs", activeLog.id), {
          checkOut: serverTimestamp(),
          totalMinutes,
          calculatedPay: earnedPay
        });

        setStatus({
          type: "success",
          msg: `Checked Out! Worked ${totalMinutes} mins | Earned: ₹${earnedPay}`
        });
      }

      await loadUserAndSession();
    } catch (err) {
      setStatus({ type: "error", msg: "GPS Permission Denied or Network Error: " + err.message });
    }
  };

  const totalEarned = myLogs.reduce((acc, item) => acc + (item.calculatedPay || 0), 0);

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
      <div className="max-w-md w-full bg-white rounded-2xl shadow-md p-6 border border-slate-200 space-y-5">
        <div className="flex justify-between items-center border-b pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{userProfile?.name}</h2>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
              {userProfile?.role === "INTERN"
                ? "Option 1: Intern (Hourly Variable)"
                : "Option 2: Full-Time Job (Pro-Rata + OT)"}
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
            <p className="text-xs text-slate-500 uppercase font-semibold">Status</p>
            <p className="text-sm font-bold text-slate-800 mt-1">
              {activeLog ? "Clocked In" : "Not Checked In"}
            </p>
          </div>
          <div className="bg-emerald-50 rounded-xl p-3.5 border border-emerald-100">
            <p className="text-xs text-emerald-700 uppercase font-semibold">Total Earned</p>
            <p className="text-sm font-bold text-emerald-900 mt-1 flex items-center">
              <IndianRupee className="w-3.5 h-3.5" />
              {totalEarned.toFixed(2)}
            </p>
          </div>
        </div>

        {!scanning ? (
          <button
            onClick={startScan}
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow transition flex items-center justify-center gap-2"
          >
            <MapPin className="w-5 h-5" />
            {activeLog ? "Scan Kiosk QR to Check-Out" : "Scan Kiosk QR to Check-In"}
          </button>
        ) : (
          <div id="qr-reader" className="w-full rounded-xl overflow-hidden border" />
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
