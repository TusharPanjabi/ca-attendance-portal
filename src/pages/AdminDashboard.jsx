import React, { useState, useEffect } from "react";
import {
  collection, onSnapshot, doc, updateDoc, setDoc, orderBy, query
} from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth, db, firebaseConfig } from "../firebase";
import {
  Users, Download, Smartphone, Save, IndianRupee,
  UserPlus, LogOut, BellRing
} from "lucide-react";

export default function AdminDashboard() {
  const [staffList, setStaffList] = useState([]);
  const [logs, setLogs] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    role: "INTERN",
    rate: 0,
    overtimeMultiplier: 1.5,
    shiftStartTime: "10:00",
    shiftEndTime: "18:00"
  });

  // Admin-Only Checkout Salary Popup State
  const [salaryPopup, setSalaryPopup] = useState(null);

  // New Staff Onboarding State with Custom Schedule
  const [newStaff, setNewStaff] = useState({
    name: "",
    email: "",
    password: "",
    role: "INTERN",
    rate: 150,
    overtimeMultiplier: 1.5,
    shiftStartTime: "10:00",
    shiftEndTime: "18:00"
  });
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setStaffList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const qLogs = query(collection(db, "attendance_logs"), orderBy("checkIn", "desc"));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      const updatedLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLogs(updatedLogs);

      // Trigger Admin-Only Salary Popup for newly completed checkouts
      const unnotifiedCheckout = updatedLogs.find(
        (l) => l.checkOut !== null && l.adminNotified === false
      );
      if (unnotifiedCheckout) {
        setSalaryPopup(unnotifiedCheckout);
      }
    });

    return () => {
      unsubUsers();
      unsubLogs();
    };
  }, []);

  const dismissSalaryPopup = async () => {
    if (salaryPopup) {
      await updateDoc(doc(db, "attendance_logs", salaryPopup.id), {
        adminNotified: true
      });
      setSalaryPopup(null);
    }
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    setCreating(true);
    const secondaryApp = initializeApp(firebaseConfig, "SecondaryOnboardingApp");
    const secondaryAuth = getAuth(secondaryApp);
    try {
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        newStaff.email,
        newStaff.password
      );
      await setDoc(doc(db, "users", cred.user.uid), {
        name: newStaff.name,
        email: newStaff.email,
        role: newStaff.role,
        shiftStartTime: newStaff.shiftStartTime,
        shiftEndTime: newStaff.shiftEndTime,
        boundDeviceId: null,
        payConfig: {
          type: newStaff.role === "INTERN" ? "HOURLY" : "MONTHLY_PRO_RATA",
          rate: Number(newStaff.rate),
          standardDailyHours: 8,
          overtimeMultiplier: Number(newStaff.overtimeMultiplier)
        }
      });
      await signOut(secondaryAuth);
      setNewStaff({
        name: "",
        email: "",
        password: "",
        role: "INTERN",
        rate: 150,
        overtimeMultiplier: 1.5,
        shiftStartTime: "10:00",
        shiftEndTime: "18:00"
      });
      alert("Staff account & schedule created!");
    } catch (err) {
      alert("Error creating staff: " + err.message);
    } finally {
      await deleteApp(secondaryApp);
      setCreating(false);
    }
  };

  const handleEditClick = (staff) => {
    setEditingId(staff.id);
    setEditForm({
      role: staff.role || "INTERN",
      rate: staff.payConfig?.rate || 0,
      overtimeMultiplier: staff.payConfig?.overtimeMultiplier || 1.5,
      shiftStartTime: staff.shiftStartTime || "10:00",
      shiftEndTime: staff.shiftEndTime || "18:00"
    });
  };

  const handleSavePayConfig = async (staffId) => {
    await updateDoc(doc(db, "users", staffId), {
      role: editForm.role,
      shiftStartTime: editForm.shiftStartTime,
      shiftEndTime: editForm.shiftEndTime,
      payConfig: {
        type: editForm.role === "INTERN" ? "HOURLY" : "MONTHLY_PRO_RATA",
        rate: Number(editForm.rate),
        standardDailyHours: 8,
        overtimeMultiplier: Number(editForm.overtimeMultiplier)
      }
    });
    setEditingId(null);
  };

  const resetDeviceLock = async (staffId) => {
    await updateDoc(doc(db, "users", staffId), { boundDeviceId: null });
    alert("Device lock cleared.");
  };

  const exportCSV = () => {
    const headers = ["Date,Name,Category,Late Minutes,Minutes Worked,Calculated Salary (INR)"];
    const rows = logs.map(
      (l) =>
        `${l.date},"${l.userName}",${l.role},${l.lateMinutes || 0},${l.totalMinutes},${l.calculatedPay}`
    );
    const blob = new Blob([headers.concat(rows).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CA_Firm_Payroll_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  const totalPayrollOutflow = logs.reduce((sum, item) => sum + (item.calculatedPay || 0), 0);

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      {/* ADMIN-ONLY SALARY CALCULATION POPUP */}
      {salaryPopup && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border-2 border-emerald-500 text-center">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-3">
              <BellRing className="w-6 h-6" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Admin-Only Payroll Alert
            </span>
            <h3 className="text-xl font-bold text-slate-900 mt-1">
              {salaryPopup.userName} Checked Out
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Category: {salaryPopup.role} • Worked: {salaryPopup.totalMinutes} mins
            </p>
            <div className="my-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <span className="text-xs text-emerald-700 block font-semibold">
                Calculated Variable Salary (Hidden from Staff)
              </span>
              <span className="text-3xl font-extrabold text-emerald-900">
                ₹{salaryPopup.calculatedPay?.toFixed(2)}
              </span>
            </div>
            <button
              onClick={dismissSalaryPopup}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-sm"
            >
              Confirm & Close
            </button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap justify-between items-center bg-white p-6 rounded-2xl shadow-sm border">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">CA Firm Attendance & Variable Payroll</h1>
            <p className="text-sm text-slate-500">Admin-Only Salary Visibility • Custom Staff Schedules</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl">
              <span className="text-xs text-emerald-700 block font-semibold">Total Calculated Payable</span>
              <span className="text-xl font-bold text-emerald-900">₹{totalPayrollOutflow.toFixed(2)}</span>
            </div>
            <button
              onClick={exportCSV}
              className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
            <button
              onClick={() => signOut(auth).then(() => navigate("/login"))}
              className="p-2.5 text-slate-500 hover:text-red-600 border rounded-xl"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Register New Staff with Custom Shift Timing */}
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <div className="flex items-center gap-2 font-bold text-slate-800 mb-4">
            <UserPlus className="w-5 h-5 text-indigo-600" />
            <span>Register New Intern / Full-Time Staff & Schedule</span>
          </div>
          <form onSubmit={handleCreateStaff} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="text"
              required
              placeholder="Full Name"
              value={newStaff.name}
              onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
              className="border rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="email"
              required
              placeholder="Email"
              value={newStaff.email}
              onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
              className="border rounded-xl px-3 py-2 text-sm"
            />
            <input
              type="password"
              required
              placeholder="Temp Password (6+ chars)"
              value={newStaff.password}
              onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
              className="border rounded-xl px-3 py-2 text-sm"
            />
            <select
              value={newStaff.role}
              onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
              className="border rounded-xl px-3 py-2 text-sm bg-white"
            >
              <option value="INTERN">Option 1: Intern (Hourly)</option>
              <option value="EMPLOYEE">Option 2: Full-Time Job</option>
            </select>

            <div className="flex items-center gap-2 border rounded-xl px-3 py-1.5 text-sm">
              <span className="text-xs text-slate-500">Start:</span>
              <input
                type="time"
                required
                value={newStaff.shiftStartTime}
                onChange={(e) => setNewStaff({ ...newStaff, shiftStartTime: e.target.value })}
                className="w-full focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 border rounded-xl px-3 py-1.5 text-sm">
              <span className="text-xs text-slate-500">End:</span>
              <input
                type="time"
                required
                value={newStaff.shiftEndTime}
                onChange={(e) => setNewStaff({ ...newStaff, shiftEndTime: e.target.value })}
                className="w-full focus:outline-none"
              />
            </div>

            <input
              type="number"
              required
              placeholder={newStaff.role === "INTERN" ? "Hourly Rate (₹)" : "Monthly Salary (₹)"}
              value={newStaff.rate}
              onChange={(e) => setNewStaff({ ...newStaff, rate: e.target.value })}
              className="border rounded-xl px-3 py-2 text-sm"
            />

            <button
              type="submit"
              disabled={creating}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl px-4 py-2 text-sm"
            >
              {creating ? "Adding..." : "+ Add Staff & Schedule"}
            </button>
          </form>
        </div>

        {/* Staff Configuration Table */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="p-5 border-b flex items-center gap-2 font-bold text-slate-800">
            <Users className="w-5 h-5 text-indigo-600" />
            <span>Staff Schedules & Variable Compensation Rules</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b">
                <tr>
                  <th className="p-4">Staff Name</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Shift Schedule</th>
                  <th className="p-4">Variable Rate</th>
                  <th className="p-4">Device</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {staffList.filter((s) => s.role !== "ADMIN").map((staff) => (
                  <tr key={staff.id} className="hover:bg-slate-50">
                    <td className="p-4 font-semibold text-slate-900">{staff.name}</td>
                    <td className="p-4">
                      {editingId === staff.id ? (
                        <select
                          value={editForm.role}
                          onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                          className="border rounded-lg px-2 py-1 bg-white"
                        >
                          <option value="INTERN">Option 1: Intern</option>
                          <option value="EMPLOYEE">Option 2: Full-Time</option>
                        </select>
                      ) : (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            staff.role === "INTERN"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-indigo-100 text-indigo-800"
                          }`}
                        >
                          {staff.role === "INTERN" ? "Intern" : "Full-Time"}
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      {editingId === staff.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="time"
                            value={editForm.shiftStartTime}
                            onChange={(e) =>
                              setEditForm({ ...editForm, shiftStartTime: e.target.value })
                            }
                            className="border rounded px-1.5 py-1 text-xs"
                          />
                          <span>-</span>
                          <input
                            type="time"
                            value={editForm.shiftEndTime}
                            onChange={(e) =>
                              setEditForm({ ...editForm, shiftEndTime: e.target.value })
                            }
                            className="border rounded px-1.5 py-1 text-xs"
                          />
                        </div>
                      ) : (
                        <span className="font-medium text-slate-700">
                          {staff.shiftStartTime || "10:00"} – {staff.shiftEndTime || "18:00"}
                        </span>
                      )}
                    </td>
                    <td className="p-4 font-medium">
                      {editingId === staff.id ? (
                        <input
                          type="number"
                          value={editForm.rate}
                          onChange={(e) => setEditForm({ ...editForm, rate: e.target.value })}
                          className="border rounded-lg px-2 py-1 w-24"
                        />
                      ) : (
                        <span className="flex items-center">
                          <IndianRupee className="w-3.5 h-3.5" />
                          {staff.payConfig?.rate || 0}
                          <span className="text-slate-400 text-xs ml-1">
                            {staff.role === "INTERN" ? "/ hr" : "/ mo"}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => resetDeviceLock(staff.id)}
                        className="text-xs text-slate-600 hover:text-red-600 flex items-center gap-1 underline"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        {staff.boundDeviceId ? "Reset" : "Unbound"}
                      </button>
                    </td>
                    <td className="p-4 text-right">
                      {editingId === staff.id ? (
                        <button
                          onClick={() => handleSavePayConfig(staff.id)}
                          className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <Save className="w-3.5 h-3.5" /> Save
                        </button>
                      ) : (
                        <button
                          onClick={() => handleEditClick(staff)}
                          className="text-indigo-600 hover:text-indigo-800 font-semibold text-xs"
                        >
                          Edit Schedule & Pay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Attendance, Punctuality & Salary Logs */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="p-5 border-b font-bold text-slate-800">
            Live Attendance, Late Status & Admin Payroll Log
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b">
                <tr>
                  <th className="p-4">Date</th>
                  <th className="p-4">Staff Member</th>
                  <th className="p-4">Punctuality</th>
                  <th className="p-4">Duration</th>
                  <th className="p-4">Calculated Variable Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="p-4 text-slate-600">{log.date}</td>
                    <td className="p-4 font-semibold">{log.userName}</td>
                    <td className="p-4">
                      {log.lateMinutes > 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          Late by {log.lateMinutes} mins
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          On Time
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      {log.checkOut ? (
                        `${log.totalMinutes} mins`
                      ) : (
                        <span className="text-emerald-600 font-semibold">Active Shift...</span>
                      )}
                    </td>
                    <td className="p-4 font-bold text-slate-900">
                      {log.checkOut ? `₹${log.calculatedPay.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}