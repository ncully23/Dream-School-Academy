// /assets/shell.js
// Inject header/footer, highlight active tab, and render greeting using Firebase Auth + Firestore
(async function initShell() {
  // ---------- 1) Ensure header/footer mount points ----------
  function ensureMount(id, where = 'start') {
    if (!document.getElementById(id)) {
      const el = document.createElement('div');
      el.id = id;
      document.body.insertAdjacentElement(
        where === 'start' ? 'afterbegin' : 'beforeend',
        el
      );
    }
  }
  ensureMount('site-header', 'start');
  ensureMount('site-footer', 'end');

  // ---------- 2) Inject header + footer ----------
  try {
    const [header, footer] = await Promise.all([
      fetch('/assets/header.html', { cache: 'no-store' }).then(r => r.text()),
      fetch('/assets/footer.html', { cache: 'no-store' }).then(r => r.text()),
    ]);
    document.getElementById('site-header').innerHTML = header;
    document.getElementById('site-footer').innerHTML = footer;
  } catch (e) {
    console.error('Header/footer inject failed:', e);
  }

  // ---------- 3) Highlight active nav ----------
  try {
    const page = document.documentElement.getAttribute('data-page'); // e.g. "home"
    const map = {
      "/": "home",
      "/index.html": "home",
      "/study.html": "study",
      "/practice.html": "practice",
      "/pricing.html": "pricing",
      "/contactus.html": "contact",
      "/login.html": "login",
    };
    const key = page || map[(location.pathname || "/").toLowerCase()];
    if (key) {
      document.querySelectorAll('.site-nav a[data-nav]').forEach(a => {
        a.classList.toggle('active', a.getAttribute('data-nav') === key);
      });
    }
  } catch (e) {
    console.warn('Nav highlight failed:', e);
  }

  // ---------- 4) Auth greeting + sign out ----------
  try {
    // Guard: only proceed if header exists (after inject)
    if (!document.querySelector('.site-header')) return;

    // Lazy import Firebase (no globals)
    const { initializeApp, getApps } =
      await import('https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js');
    const { getAuth, onAuthStateChanged, signOut } =
      await import('https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js');
    const { getFirestore, doc, getDoc } =
      await import('https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js');

    // SAME config as in login.html
    const firebaseConfig = {
      apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
      authDomain: "dream-school-academy.firebaseapp.com",
      projectId: "dream-school-academy",
      storageBucket: "dream-school-academy.firebasestorage.app",
      messagingSenderId: "665412130733",
      appId: "1:665412130733:web:fc73f3ed574ffb6d277324",
      measurementId: "G-7LY2V2HQ4G"
    };

    // Init once per tab
    const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db   = getFirestore(app);

    // Helpers
    const $ = (sel) => document.querySelector(sel);

    const showState = (signedIn) => {
      document.querySelectorAll('[data-when="signed-in"]').forEach(el => {
        el.style.display = signedIn ? '' : 'none';
      });
      document.querySelectorAll('[data-when="signed-out"]').forEach(el => {
        el.style.display = signedIn ? 'none' : '';
      });
    };

    const deriveFromEmail = (email) =>
      (email || '')
        .split('@')[0]
        .split(/[._-]/)[0]
        .replace(/^\w/, c => c.toUpperCase()) || 'there';

    function renderGreeting(name) {
      const el = $('#greeting-name');
      if (el) el.textContent = name || 'there';
    }

    async function getFirstName(user) {
      if (!user) return null;

      // 1) Try Firestore profile: users/{uid}.name
      try {
        const ref = doc(db, 'users', user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          if (data && data.name) {
            return String(data.name).split(/\s+/)[0];
          }
        }
      } catch (e) {
        console.warn('Failed to load profile from Firestore:', e);
      }

      // 2) Fallback to displayName
      if (user.displayName) {
        return user.displayName.trim().split(/\s+/)[0];
      }

      // 3) Fallback to email
      if (user.email) {
        return deriveFromEmail(user.email);
      }

      return 'there';
    }

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        const stored = localStorage.getItem('dsa:firstName');
        let first = stored;

        // Refresh from Firestore/Auth if not stored yet
        if (!first) {
          first = await getFirstName(user);
          localStorage.setItem('dsa:firstName', first);
        }

        renderGreeting(first);
        showState(true);
      } else {
        renderGreeting('there');
        showState(false);
        localStorage.removeItem('dsa:firstName');
      }
    });

    // Sign out button/link (in header.html)
    $('#signout-link')?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await signOut(auth);
      } catch (e2) {
        console.warn('Sign out failed:', e2);
      }
      localStorage.removeItem('dsa:firstName');
      location.href = '/';
    });
  } catch (e) {
    console.warn('Auth greeting init failed:', e);
  }
})();
