// === Firebase Setup (Assumes Firebase scripts already loaded) ===
let currentUser = null;
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Your Firebase config object from Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:c3d59ab2c2f065a2277324",
  measurementId: "G-HJCW8VZKZX"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// === DOM Ready ===
document.addEventListener("DOMContentLoaded", () => {
  setupModal();
  setupAuthButtons();
  monitorAuthState();
});

// === Modal Logic ===
function setupModal() {
  const modal = document.getElementById("signupModal");
  const openBtn = document.querySelector(".signup-button");
  const closeBtn = document.querySelector(".close");

  if (openBtn && modal) {
    openBtn.onclick = () => {
      modal.style.display = "block";
      document.body.classList.add("modal-open");
    };
  }

  if (closeBtn && modal) {
    closeBtn.onclick = () => closeModal(modal);
  }

  window.onclick = event => {
    if (event.target === modal) closeModal(modal);
  };

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.style.display === "block") {
      closeModal(modal);
    }
  });
}

function closeModal(modal) {
  modal.style.display = "none";
  document.body.classList.remove("modal-open");
}

// === Auth Buttons ===
function setupAuthButtons() {
  const authBtn = document.getElementById("auth-btn");

  if (authBtn) {
    authBtn.addEventListener("click", () => {
      if (auth.currentUser) {
        signOut(auth);
      } else {
        signInWithPopup(auth, provider).catch(err => console.error("Login Error:", err));
      }
    });
  }
}

// === Monitor Auth State ===
function monitorAuthState() {
  const authBtn = document.getElementById("auth-btn");
  const userNameEl = document.getElementById("user-name");

onAuthStateChanged(auth, user => {
  const authBtn = document.getElementById("auth-btn");
  const userNameEl = document.getElementById("user-name");
  const profileForm = document.getElementById("profile-form");

  if (user) {
    currentUser = user;
    const firstName = user.displayName?.split(" ")[0] || "Friend";
    if (authBtn) authBtn.textContent = "Sign Out";
    if (userNameEl) userNameEl.textContent = `${firstName}! Chase your dreams!`;
    if (profileForm) profileForm.style.display = "block";
    prefillProfile(user); // Fill form if data exists
  } else {
    currentUser = null;
    if (authBtn) authBtn.textContent = "Sign in with Google";
    if (userNameEl) userNameEl.textContent = "";
    if (profileForm) profileForm.style.display = "none";
  }
});

function handleProfileSubmit(event) {
  event.preventDefault();

  const profileData = {
    name: document.getElementById("name").value,
    gradYear: document.getElementById("grad-year").value,
    dreamSchools: document.getElementById("dream-schools").value,
    safetySchools: document.getElementById("safety-schools").value,
    satGoal: document.getElementById("sat-goal").value,
    classes: document.getElementById("classes").value,
    extracurriculars: document.getElementById("extracurriculars").value
  };

  console.log("Profile Saved:", profileData);

  // Optionally: Save to Firestore here
  alert("Profile saved! (Not stored permanently yet)");
}

function prefillProfile(user) {
  document.getElementById("name").value = user.displayName || "";
  document.getElementById("email").value = user.email || "";
}
