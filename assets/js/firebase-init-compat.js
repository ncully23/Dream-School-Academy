// /assets/js/firebase-init-compat.js
(function () {
  "use strict";

  // Prevent double initialization (important if scripts load twice)
  if (window.firebase && firebase.apps && firebase.apps.length) {
    return;
  }

  // Firebase configuration

const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:fc73f3ed574ffb6d277324",
  measurementId: "G-7LY2V2HQ4G"
};

  try {
    firebase.initializeApp(firebaseConfig);
  } catch (err) {
    // Ignore duplicate-app errors but surface real ones
    if (!/already exists/i.test(err.message)) {
      console.error("[firebase-init-compat] init failed:", err);
      throw err;
    }
  }

  // Optional sanity check logs (remove later if you want)
  if (typeof firebase.auth !== "function") {
    console.error("[firebase-init-compat] firebase.auth() missing");
  }

  if (typeof firebase.firestore !== "function") {
    console.error("[firebase-init-compat] firebase.firestore() missing");
  }
})();
