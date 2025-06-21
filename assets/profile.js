// profile.js

const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
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
    currentUserRef = db.collection("users").doc(user.uid);
    currentUserRef.get().then(doc => {
      if (doc.exists) {
        const data = doc.data();
        for (const key in data) {
          const el = document.getElementById(key);
          if (el) {
            if (el.tagName === "SELECT") {
              el.value = data[key];
            } else {
              el.value = data[key];
            }
            originalValues[key] = data[key];
          }
        }
        setupFieldHandlers();
      }
    });
  }
});

function setupFieldHandlers() {
  const fieldContainers = document.querySelectorAll(".profile-field");

  fieldContainers.forEach(container => {
    const field = container.getAttribute("data-field");
    const input = document.getElementById(field);
    const editBtn = container.querySelector(".edit-btn");
    const saveBtn = container.querySelector(".save-btn");
    const cancelBtn = container.querySelector(".cancel-btn");
    const status = container.querySelector(".status");

    if (!input || !editBtn || !saveBtn || !cancelBtn) return;

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
      const updateObj = {};
      updateObj[field] = newValue;

      currentUserRef.update(updateObj).then(() => {
        input.disabled = true;
        originalValues[field] = newValue;
        saveBtn.style.display = "none";
        cancelBtn.style.display = "none";
        editBtn.style.display = "inline-block";
        status.textContent = "✅ Saved!";
        setTimeout(() => (status.textContent = ""), 2000);
      }).catch(err => {
        console.error(`Error saving ${field}:`, err);
        status.textContent = "❌ Error saving";
      });
    });
  });
}
