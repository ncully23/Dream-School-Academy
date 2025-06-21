// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.appspot.com",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:c3d59ab2c2f065a2277324",
  measurementId: "G-HJCW8VZKZX"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUserRef = null;
let originalValues = {};

auth.onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/home.html";
  } else {
    currentUserRef = db.collection("userProfiles").doc(user.uid);
    currentUserRef.get().then(doc => {
      const data = doc.exists ? doc.data() : {
        name: user.displayName || "",
        gradYear: "",
        dreamSchools: "",
        safetySchools: "",
        satGoal: "",
        classes: "",
        extracurriculars: ""
      };
      currentUserRef.set(data, { merge: true });
      loadProfile(data);
    }).catch(err => {
      console.error("Error fetching profile:", err);
    });
  }
});

function loadProfile(data) {
  for (const key in data) {
    const el = document.getElementById(key);
    if (el) {
      el.value = data[key];
      originalValues[key] = data[key];
    }
  }
  setupFieldHandlers();
}

function setupFieldHandlers() {
  const fields = [
    "name", "gradYear", "dreamSchools", "safetySchools",
    "satGoal", "classes", "extracurriculars"
  ];

  fields.forEach(field => {
    const input = document.getElementById(field);
    const editBtn = document.getElementById(`${field}-edit`);
    const saveBtn = document.getElementById(`${field}-save`);
    const cancelBtn = document.getElementById(`${field}-cancel`);
    const status = document.getElementById(`${field}-status`);

    if (editBtn && saveBtn && cancelBtn && input) {
      editBtn.addEventListener("click", () => {
        input.disabled = false;
        editBtn.style.display = "none";
        saveBtn.style.display = "inline-block";
        cancelBtn.style.display = "inline-block";
        status.textContent = "";
      });

      cancelBtn.addEventListener("click", () => {
        input.value = originalValues[field] || "";
        input.disabled = true;
        saveBtn.style.display = "none";
        cancelBtn.style.display = "none";
        editBtn.style.display = "inline-block";
        status.textContent = "";
      });

      saveBtn.addEventListener("click", () => {
        const newValue = input.value;
        const updateObj = { [field]: newValue };

        currentUserRef.set(updateObj, { merge: true }).then(() => {
          input.disabled = true;
          originalValues[field] = newValue;
          saveBtn.style.display = "none";
          cancelBtn.style.display = "none";
          editBtn.style.display = "inline-block";
          status.textContent = "✅ Saved!";
          setTimeout(() => status.textContent = "", 2000);
        }).catch(err => {
          console.error(`Error saving ${field}:`, err);
          status.textContent = "❌ Error saving";
        });
      });
    }
  });
}
