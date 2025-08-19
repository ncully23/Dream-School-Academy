// /assets/shell.js
// Inject header/footer once, then highlight the active nav
(async function initShell(){
  function ensureMount(id, where = 'start'){
    if (!document.getElementById(id)) {
      const el = document.createElement('div');
      el.id = id;
      document.body.insertAdjacentElement(where === 'start' ? 'afterbegin' : 'beforeend', el);
    }
  }
  ensureMount('site-header', 'start');
  ensureMount('site-footer', 'end');

  try {
    const [header, footer] = await Promise.all([
      fetch('/assets/header.html', { cache: 'no-store' }).then(r => r.text()),
      fetch('/assets/footer.html', { cache: 'no-store' }).then(r => r.text()),
    ]);
    document.getElementById('site-header').innerHTML = header;
    document.getElementById('site-footer').innerHTML = footer;

    // Highlight active tab (prefer data-page, else path map)
    const page = document.documentElement.getAttribute('data-page'); // e.g., "home"
    const map = {
      "/": "home",
      "/index.html": "home",
      "/study.html": "study",
      "/practice.html": "practice",
      "/pricing.html": "pricing",
      "/contactus.html": "contact",
      "/login.html": "login"
    };
    const key = page || map[(location.pathname || "/").toLowerCase()];
    if (key){
      document.querySelectorAll('.site-nav a[data-nav]').forEach(a => {
        a.classList.toggle('active', a.getAttribute('data-nav') === key);
      });
    }
  } catch (e) {
    console.error('Header/footer inject failed:', e);
  }
})();
