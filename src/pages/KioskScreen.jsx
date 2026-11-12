import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { generateDynamicQRPayload } from "../utils/securityAndPay";
import { ShieldCheck, RefreshCw } from "lucide-react";

export default function KioskScreen() {
  const [qrPayload, setQrPayload] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(15);
  const [secretKey, setSecretKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchSecret = async () => {
      try {
        const snap = await getDoc(doc(db, "office_settings", "main_branch"));
        if (snap.exists()) {
          setSecretKey(snap.data().qrSecretKey);
        } else {
          setError("Missing 'office_settings/main_branch' document in Firestore.");
        }
      } catch (err) {
        setError("Ensure Kiosk browser is logged in or Firestore allows read: " + err.message);
      }
    };
    fetchSecret();
  }, []);

  useEffect(() => {
    if (!secretKey) return;

    const updateQR = () => {
      setQrPayload(generateDynamicQRPayload(secretKey));
      const elapsed = Math.floor((Date.now() / 1000) % 15);
      setSecondsLeft(15 - elapsed);
    };

    updateQR();
    const interval = setInterval(updateQR, 1000);
    return () => clearInterval(interval);
  }, [secretKey]);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
        <div className="flex items-center justify-center gap-2 text-emerald-400 mb-2">
          <ShieldCheck className="w-6 h-6" />
          <span className="text-sm font-semibold tracking-wider uppercase">
            CA Firm Secure Attendance Kiosk
          </span>
        </div>
        <h1 className="text-2xl font-bold mb-6">Scan to Check-In / Check-Out</h1>

        {error ? (
          <div className="p-4 bg-red-950/60 border border-red-700 rounded-xl text-xs text-red-200">
            {error}
          </div>
        ) : (
          <>
            <div className="bg-white p-6 rounded-xl inline-block shadow-inner">
              {qrPayload ? (
                <QRCodeSVG value={qrPayload} size={240} level="H" />
              ) : (
                <div className="w-60 h-60 flex items-center justify-center text-slate-500">
                  Loading Security Token...
                </div>
              )}
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-center gap-2 text-slate-400 text-sm mb-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>QR refreshes in {secondsLeft}s (Anti-Screenshot Active)</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-1000"
                  style={{ width: `${(secondsLeft / 15) * 100}%` }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
