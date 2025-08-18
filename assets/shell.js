// Inject shared header/footer, then highlight the active nav link.
// Usage: include this script on every page AFTER site.css.
(async function initShell(){
  // Ensure mount points exist (create if missing)
  function ensureMount(id, where = 'start'){
    if (!document.getElementById(id)) {
      const el = document.createElement('div');
      el.id = id;
      document.body.insertAdjacentElement(where === 'start' ? 'afterbegin' : 'beforeend', el);
    }
  }

  ensureMount('site-header', 'start');
  ensureMount('site-footer', 'end');

  // Fetch & inject partials
  const [header, footer] = await Promise.all([
    fetch('/assets/header.html').then(r => r.text()),
    fetch('/assets/footer.html').then(r => r.text()),
  ]);

  document.getElementById('site-header').innerHTML = header;
  document.getElementById('site-footer').innerHTML = footer;

  // Highlight active nav
  const map = {
    "/": "home",
    "/index.html": "home",
    "/study.html": "study",
    "/practice.html": "practice",
    "/contact.html": "contact",
    "/auth.html": "auth",
  };
  const key = map[(location.pathname || "/").toLowerCase()];
  if (key){
    document.querySelectorAll('nav a[data-nav]').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-nav') === key);
    });
  }

  // Optional: if you later add internal navigation without page reloads,
  // you can re-run the highlight logic here after route changes.
})();

(async function initShell() {
  const mount = document.getElementById('site-header');
  try {
    const res = await fetch('/assets/header.html', { cache: 'no-store' });
    const html = await res.text();

    if (mount) {
      mount.innerHTML = html;
    } else {
      // fallback: prepend to body if mount not found
      document.body.insertAdjacentHTML('afterbegin', html);
    }

    // highlight active tab
    const page = document.documentElement.getAttribute('data-page'); // e.g., "home"
    if (page) {
      const active = document.querySelector(`.site-nav a[data-nav="${page}"]`);
      active?.classList.add('active');
    }
  } catch (e) {
    console.error('Header inject failed:', e);
  }
})();

