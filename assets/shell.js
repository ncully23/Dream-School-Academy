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
