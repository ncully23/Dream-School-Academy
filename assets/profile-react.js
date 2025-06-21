// ProfilePage.jsx
import React, { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const fields = [
  { id: "name", label: "Nickname" },
  { id: "gradYear", label: "Graduation Year" },
  { id: "dreamSchools", label: "Dream Schools" },
  { id: "safetySchools", label: "Safety Schools" },
  { id: "satGoal", label: "SAT Goal" },
  { id: "classes", label: "Current Classes" },
  { id: "extracurriculars", label: "Extracurriculars" },
];

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({});
  const [editing, setEditing] = useState({});
  const [status, setStatus] = useState({});

  const auth = getAuth();
  const db = getFirestore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        window.location.href = "/home.html";
        return;
      }
      setUser(firebaseUser);
      const ref = doc(db, "userProfiles", firebaseUser.uid);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data() : {};
      if (!snap.exists()) await setDoc(ref, {});
      setProfile(data);
    });
    return () => unsubscribe();
  }, []);

  const handleEdit = (field) => {
    setEditing({ ...editing, [field]: true });
  };

  const handleCancel = (field) => {
    setEditing({ ...editing, [field]: false });
  };

  const handleChange = (field, value) => {
    setProfile({ ...profile, [field]: value });
  };

  const handleSave = async (field) => {
    if (!user) return;
    const ref = doc(db, "userProfiles", user.uid);
    await setDoc(ref, { [field]: profile[field] }, { merge: true });
    setEditing({ ...editing, [field]: false });
    setStatus({ ...status, [field]: "✅ Saved!" });
    setTimeout(() => setStatus({ ...status, [field]: "" }), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-black text-white p-8">
      <h1 className="text-3xl font-bold text-yellow-400 mb-8">Your Profile</h1>
      <div className="max-w-3xl mx-auto bg-zinc-800 rounded-xl shadow-xl p-6 space-y-6">
        {fields.map(({ id, label }) => (
          <div key={id} className="space-y-1">
            <label className="font-semibold text-lg">{label}</label>
            {id === "gradYear" ? (
              <select
                className="w-full p-3 bg-zinc-700 text-white rounded-md"
                disabled={!editing[id]}
                value={profile[id] || ""}
                onChange={(e) => handleChange(id, e.target.value)}
              >
                <option value="">Select Year</option>
                {[2024, 2025, 2026, 2027, 2028, 2029].map((yr) => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="w-full p-3 bg-zinc-700 text-white rounded-md"
                disabled={!editing[id]}
                value={profile[id] || ""}
                onChange={(e) => handleChange(id, e.target.value)}
              />
            )}
            <div className="flex gap-2 mt-2">
              {!editing[id] ? (
                <button
                  className="bg-yellow-400 text-black px-4 py-1 rounded-full"
                  onClick={() => handleEdit(id)}
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    className="bg-blue-500 text-white px-4 py-1 rounded-full"
                    onClick={() => handleSave(id)}
                  >
                    Save
                  </button>
                  <button
                    className="bg-zinc-500 text-white px-4 py-1 rounded-full"
                    onClick={() => handleCancel(id)}
                  >
                    Cancel
                  </button>
                </>
              )}
              <span className="text-green-400 text-sm">{status[id]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
