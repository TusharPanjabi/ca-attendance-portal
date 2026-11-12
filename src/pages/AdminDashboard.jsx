import React, { useState, useEffect } from "react";
import {
  collection, onSnapshot, doc, updateDoc, setDoc, orderBy, query
} from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth, db, firebaseConfig } from "../firebase";
import { Users, Download, Smartphone, Save, IndianRupee, UserPlus, LogOut } from "lucide-react";

export default function AdminDashboard() {
  const [staffList, setStaffList] = useState([]);
  const [logs, setLogs] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ role: "INTERN", rate: 0, overtimeMultiplier: 1.5 });

  // New Staff Onboarding State
  const [newStaff, setNewStaff] = useState({
    name: "",
    email: "",
    password: "",
    role: "INTERN",
    rate: 150,
    overtimeMultiplier: 1.5
  });
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setStaffList(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const qLogs = query(collection(db, "attendance_logs"), orderBy("checkIn", "desc"));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubUsers();
      unsubLogs();
    };
  }, []);

  // Create Staff Account via Secondary Firebase App (keeps Admin logged in)
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
        boundDeviceId: null,
        payConfig: {
          type: newStaff.role === "INTERN" ? "HOURLY" : "MONTHLY_PRO_RATA",
          rate: Number(newStaff.rate),
          standardDailyHours: 8,
          overtimeMultiplier: Number(newStaff.overtimeMultiplier)
        }
      });
      await signOut(secondaryAuth);
      setNewStaff({ name: "", email: "", password: "", role: "INTERN", rate: 150, overtimeMultiplier: 1.5 });
      alert("Staff account created successfully!");
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
      overtimeMultiplier: staff.payConfig?.overtimeMultiplier || 1.5
    });
  };

  const handleSavePayConfig = async (staffId) => {
    await updateDoc(doc(db, "users", staffId), {
      role: editForm.role,
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
    alert("Device lock cleared. Staff can bind their new phone on next login.");
  };

  const exportCSV = () => {
    const headers = ["Date,Name,Category,Minutes Worked,Calculated Salary (INR)"];
    const rows = logs.map(
      (l) => `${l.date},"${l.userName}",${l.role},${l.totalMinutes},${l.calculatedPay}`
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
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-wrap justify-between items-center bg-white p-6 rounded-2xl shadow-sm border">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">CA Firm Attendance & Variable Payroll</h1>
            <p className="text-sm text-slate-500">Manage Intern Stipends, Full-Time Salaries & Live Logs</p>
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

        {/* Add New Intern or Full-Time Employee */}
        <div className="bg-white rounded-2xl shadow-sm border p-6">
          <div className="flex items-center gap-2 font-bold text-slate-800 mb-4">
            <UserPlus className="w-5 h-5 text-indigo-600" />
            <span>Register New Intern / Full-Time Employee</span>
          </div>
          <form onSubmit={handleCreateStaff} className="grid grid-cols-1 md:grid-cols-6 gap-3">
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
              {creating ? "Adding..." : "+ Add Staff"}
            </button>
          </form>
        </div>

        {/* Staff Variable Salary Configuration Table */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="p-5 border-b flex items-center gap-2 font-bold text-slate-800">
            <Users className="w-5 h-5 text-indigo-600" />
            <span>Staff Compensation Configuration (Variable Pay Models)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b">
                <tr>
                  <th className="p-4">Staff Name</th>
                  <th className="p-4">Pay Category (Option 1 / Option 2)</th>
                  <th className="p-4">Variable Rate</th>
                  <th className="p-4">OT Multiplier</th>
                  <th className="p-4">Device Security</th>
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
                          className="border rounded-lg px-2.5 py-1.5 bg-white"
                        >
                          <option value="INTERN">Option 1: Intern (Hourly)</option>
                          <option value="EMPLOYEE">Option 2: Full-Time Job (Monthly)</option>
                        </select>
                      ) : (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            staff.role === "INTERN"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-indigo-100 text-indigo-800"
                          }`}
                        >
                          {staff.role === "INTERN" ? "Option 1: Intern" : "Option 2: Full-Time Job"}
                        </span>
                      )}
                    </td>
                    <td className="p-4 font-medium">
                      {editingId === staff.id ? (
                        <input
                          type="number"
                          value={editForm.rate}
                          onChange={(e) => setEditForm({ ...editForm, rate: e.target.value })}
                          className="border rounded-lg px-2.5 py-1 w-28"
                        />
                      ) : (
                        <span className="flex items-center">
                          <IndianRupee className="w-3.5 h-3.5" />
                          {staff.payConfig?.rate || 0}
                          <span className="text-slate-400 text-xs ml-1">
                            {staff.role === "INTERN" ? "/ hr" : "/ month"}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      {editingId === staff.id && editForm.role === "EMPLOYEE" ? (
                        <input
                          type="number"
                          step="0.1"
                          value={editForm.overtimeMultiplier}
                          onChange={(e) =>
                            setEditForm({ ...editForm, overtimeMultiplier: e.target.value })
                          }
                          className="border rounded-lg px-2.5 py-1 w-20"
                        />
                      ) : staff.role === "EMPLOYEE" ? (
                        `${staff.payConfig?.overtimeMultiplier || 1.5}x`
                      ) : (
                        <span className="text-slate-400">N/A</span>
                      )}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => resetDeviceLock(staff.id)}
                        className="text-xs text-slate-600 hover:text-red-600 flex items-center gap-1 underline"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        {staff.boundDeviceId ? "Reset Bound Phone" : "Unbound"}
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
                          Edit Pay Rules
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Attendance & Variable Salary Logs */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="p-5 border-b font-bold text-slate-800">Live Attendance & Calculated Earnings</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b">
                <tr>
                  <th className="p-4">Date</th>
                  <th className="p-4">Staff Member</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Duration</th>
                  <th className="p-4">Calculated Variable Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="p-4 text-slate-600">{log.date}</td>
                    <td className="p-4 font-semibold">{log.userName}</td>
                    <td className="p-4 text-xs font-semibold">{log.role}</td>
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
