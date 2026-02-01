// /assets/js/pages/loginpage.js
import { auth, db, googleProvider } from "/assets/js/firebase-init.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signInWithPopup,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

function nice(e) {
  return ({
    "auth/invalid-email":        "That email looks invalid.",
    "auth/missing-password":     "Enter your password.",
    "auth/weak-password":        "Use 6+ characters for your password.",
    "auth/email-already-in-use": "That email is already registered.",
    "auth/user-not-found":       "No account with that email.",
    "auth/wrong-password":       "Incorrect password.",
    "auth/popup-blocked":        "Popup blocked.",
    "auth/unauthorized-domain":  "Unauthorized domain in Firebase."
  }[e?.code] || e?.message || "Something went wrong.");
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function returnToDefault() {
  // If you pass ?returnTo=/pages/progress.html or similar, we'll go there.
  // Otherwise return home.
  const rt = qs("returnTo");
  if (rt && rt.startsWith("/")) return rt;
  return "/";
}

async function ensureProfile(u, first = "") {
  if (!u) return;

  const ref = doc(db, "users", u.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      userId: u.uid,
      email: u.email || "",
      name: (u.displayName || first || "").trim(),
      createdAt: serverTimestamp()
    });
  }
}

function el(id) { return document.getElementById(id); }

function setStatus(node, msg) {
  if (node) node.textContent = msg || "";
}

function setTab(tabLogin, tabSignup, loginForm, signupForm, mode) {
  const isLogin = mode === "login";

  tabLogin.classList.toggle("active", isLogin);
  tabSignup.classList.toggle("active", !isLogin);

  tabLogin.setAttribute("aria-selected", String(isLogin));
  tabSignup.setAttribute("aria-selected", String(!isLogin));

  loginForm.style.display = isLogin ? "block" : "none";
  signupForm.style.display = isLogin ? "none" : "block";

  // Clear errors when switching
  setStatus(el("login-status"), "");
  setStatus(el("signup-status"), "");
}

async function init() {
  const tabLogin    = el("tab-login");
  const tabSignup   = el("tab-signup");
  const loginForm   = el("login-form");
  const signupForm  = el("signup-form");

  const loginStatus  = el("login-status");
  const signupStatus = el("signup-status");

  const resetLink    = el("reset");
  const googleIn     = el("google-login");
  const googleUp     = el("google-signup");

  if (!tabLogin || !tabSignup || !loginForm || !signupForm) {
    console.warn("loginpage: missing expected DOM nodes.");
    return;
  }

  // Default tab
  setTab(tabLogin, tabSignup, loginForm, signupForm, "login");

  tabLogin.addEventListener("click", () => setTab(tabLogin, tabSignup, loginForm, signupForm, "login"));
  tabSignup.addEventListener("click", () => setTab(tabLogin, tabSignup, loginForm, signupForm, "signup"));

  // Handle Google redirect fallback (if you ever switch to redirect flow)
  try {
    const r = await getRedirectResult(auth);
    if (r?.user) {
      await ensureProfile(r.user);
      location.href = returnToDefault();
      return;
    }
  } catch (e) {
    console.warn("loginpage: redirect sign-in failed:", e);
  }

  // Login submit
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(loginStatus, "Signing in…");

    try {
      const email = el("login-email").value.trim();
      const pass  = el("login-password").value;

      const cred = await signInWithEmailAndPassword(auth, email, pass);
      await ensureProfile(cred.user);
      location.href = returnToDefault();
    } catch (err) {
      console.error(err);
      setStatus(loginStatus, nice(err));
    }
  });

  // Signup submit
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus(signupStatus, "Creating account…");

    try {
      const first = el("signup-first").value.trim();
      const email = el("signup-email").value.trim();
      const pass  = el("signup-password").value;

      const cred = await createUserWithEmailAndPassword(auth, email, pass);

      if (first) {
        try { await updateProfile(cred.user, { displayName: first }); } catch {}
      }

      await ensureProfile(cred.user, first);
      location.href = returnToDefault();
    } catch (err) {
      console.error(err);
      setStatus(signupStatus, nice(err));
    }
  });

  // Reset password
  if (resetLink) {
    resetLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = el("login-email").value.trim();

      if (!email) {
        setStatus(loginStatus, "Enter your email first.");
        return;
      }

      try {
        await sendPasswordResetEmail(auth, email);
        setStatus(loginStatus, "Password reset email sent.");
      } catch (err) {
        console.error(err);
        setStatus(loginStatus, nice(err));
      }
    });
  }

  // Google sign-in (popup)
  if (googleIn) {
    googleIn.addEventListener("click", async () => {
      setStatus(loginStatus, "Opening Google…");
      try {
        const res = await signInWithPopup(auth, googleProvider);
        await ensureProfile(res.user);
        location.href = returnToDefault();
      } catch (err) {
        console.error(err);
        setStatus(loginStatus, nice(err));
      }
    });
  }

  if (googleUp) {
    googleUp.addEventListener("click", async () => {
      setStatus(signupStatus, "Opening Google…");
      try {
        const res = await signInWithPopup(auth, googleProvider);
        await ensureProfile(res.user);
        location.href = returnToDefault();
      } catch (err) {
        console.error(err);
        setStatus(signupStatus, nice(err));
      }
    });
  }

  // Optional: if already signed in, you could redirect away.
  onAuthStateChanged(auth, (user) => {
    // If you want auto-redirect, uncomment:
    // if (user) location.href = returnToDefault();
  });
}

init();
