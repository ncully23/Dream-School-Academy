const fields = [
  { id: "name", label: "Nickname" },
  { id: "gradYear", label: "Graduation Year" },
  { id: "dreamSchools", label: "Dream Schools" },
  { id: "safetySchools", label: "Safety Schools" },
  { id: "satGoal", label: "SAT Goal" },
  { id: "classes", label: "Current Classes" },
  { id: "extracurriculars", label: "Extracurriculars" },
];

function ProfilePage() {
  const [user, setUser] = React.useState(null);
  const [profile, setProfile] = React.useState({});
  const [editing, setEditing] = React.useState({});
  const [status, setStatus] = React.useState({});

  React.useEffect(() => {
    const auth = firebase.auth();
    const db = firebase.firestore();

    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (!firebaseUser) {
        window.location.href = "/home.html";
        return;
      }
      setUser(firebaseUser);
      const ref = db.collection("userProfiles").doc(firebaseUser.uid);
      const snap = await ref.get();
      const data = snap.exists ? snap.data() : {};
      if (!snap.exists) await ref.set({});
      setProfile(data);
    });

    return () => unsubscribe();
  }, []);

  const handleEdit = (field) => {
    setEditing((prev) => ({ ...prev, [field]: true }));
  };

  const handleCancel = (field) => {
    setEditing((prev) => ({ ...prev, [field]: false }));
  };

  const handleChange = (field, value) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (field) => {
    const db = firebase.firestore();
    if (!user) return;
    const ref = db.collection("userProfiles").doc(user.uid);
    await ref.set({ [field]: profile[field] }, { merge: true });
    setEditing((prev) => ({ ...prev, [field]: false }));
    setStatus((prev) => ({ ...prev, [field]: "✅ Saved!" }));
    setTimeout(() => {
      setStatus((prev) => ({ ...prev, [field]: "" }));
    }, 2000);
  };

  return (
    <div style={{ padding: "40px", color: "white", fontFamily: "Poppins, sans-serif" }}>
      <h2 style={{ fontSize: "2.2rem", color: "#f0c948", marginBottom: "20px" }}>Your Profile</h2>
      <div style={{ backgroundColor: "#121212", padding: "30px", borderRadius: "12px", maxWidth: "700px", margin: "auto" }}>
        {fields.map(({ id, label }) => (
          <div key={id} style={{ marginBottom: "20px" }}>
            <label style={{ fontWeight: "bold", display: "block", marginBottom: "5px" }}>{label}</label>
            {id === "gradYear" ? (
              <select
                value={profile[id] || ""}
                disabled={!editing[id]}
                onChange={(e) => handleChange(id, e.target.value)}
                style={{ width: "100%", padding: "14px", borderRadius: "6px", backgroundColor: "#1a1a1a", color: "white" }}
              >
                <option value="">Select Year</option>
                {[2024, 2025, 2026, 2027, 2028, 2029].map((yr) => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={profile[id] || ""}
                disabled={!editing[id]}
                onChange={(e) => handleChange(id, e.target.value)}
                style={{ width: "100%", padding: "14px", borderRadius: "6px", backgroundColor: "#1a1a1a", color: "white" }}
              />
            )}
            <div style={{ marginTop: "8px" }}>
              {!editing[id] ? (
                <button onClick={() => handleEdit(id)} style={{ backgroundColor: "#f0c948", color: "black", borderRadius: "20px", padding: "8px 16px", marginRight: "6px" }}>Edit</button>
              ) : (
                <>
                  <button onClick={() => handleSave(id)} style={{ backgroundColor: "#3399ff", color: "white", borderRadius: "20px", padding: "8px 16px", marginRight: "6px" }}>Save</button>
                  <button onClick={() => handleCancel(id)} style={{ backgroundColor: "#444", color: "white", borderRadius: "20px", padding: "8px 16px" }}>Cancel</button>
                </>
              )}
              <span style={{ marginLeft: "10px", fontSize: "0.9rem", color: "#8bc34a" }}>{status[id]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mount React component
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<ProfilePage />);
