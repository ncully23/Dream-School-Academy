// === Firebase Setup ===
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentUser = null;

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
  const signOutLink = document.getElementById("signout-link");

  if (authBtn) {
    authBtn.addEventListener("click", () => {
      if (auth.currentUser) {
        signOut(auth).catch(err => console.error("Sign-out error:", err));
      } else {
        signInWithPopup(auth, provider).catch(err => console.error("Sign-in error:", err));
      }
    });
  }

  if (signOutLink) {
    signOutLink.addEventListener("click", (e) => {
      e.preventDefault();
      signOut(auth).catch(err => console.error("Sign-out error:", err));
    });
  }
}

// === Monitor Auth State ===
function monitorAuthState() {
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
      prefillProfile(user);
    } else {
      currentUser = null;
      if (authBtn) authBtn.textContent = "Sign in with Google";
      if (userNameEl) userNameEl.textContent = "";
      if (profileForm) profileForm.style.display = "none";
    }
  });
}

// === Optional: Prefill Profile Form ===
function prefillProfile(user) {
  if (!user) return;
  const nameEl = document.getElementById("name");
  const emailEl = document.getElementById("email");

  if (nameEl) nameEl.value = user.displayName || "";
  if (emailEl) emailEl.value = user.email || "";
}
