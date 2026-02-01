async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function pickFeatured(registry) {
  // Simple rule: show items that have featured=true, otherwise first 6.
  const entries = Object.values(registry || {});
  const featured = entries.filter((m) => m && m.featured === true);
  return (featured.length ? featured : entries).slice(0, 6);
}

function safe(x, fallback = "") {
  return (typeof x === "string" && x.trim()) ? x.trim() : fallback;
}

(function(){
  const grid = document.getElementById("featuredGrid");
  if (!grid) return;

  loadJson("/assets/configs/quizzes.json")
    .then((registry) => {
      const items = pickFeatured(registry);

      if (!items.length) {
        grid.innerHTML = `<div class="card" style="grid-column:span 12"><h3>No quizzes yet</h3><p>Add quizzes to /assets/configs/quizzes.json.</p></div>`;
        return;
      }

      grid.innerHTML = items.map((m) => {
        const quizId = m.quizId;
        const title = safe(m.title || m.previewTitle || m.sectionTitle, quizId);
        const desc  = safe(m.previewDescription || m.description, "Timed SAT practice set.");
        const difficulty = safe(m.difficulty, "—");
        const count = (typeof m.questionCount === "number") ? `${m.questionCount} questions` : "";
        const href = `/pages/preview.html?quizId=${encodeURIComponent(quizId)}`;

        return `
          <div class="card">
            <h3>${title}</h3>
            <p>${desc}</p>
            <div class="row">
              <span class="pill">${difficulty}</span>
              <span class="pill">${count || "practice set"}</span>
              <a class="btn secondary" href="${href}" style="padding:8px 12px;border-radius:10px;">Open</a>
            </div>
          </div>
        `;
      }).join("");
    })
    .catch((e) => {
      grid.innerHTML = `<div class="card" style="grid-column:span 12"><h3>Couldn’t load quizzes</h3><p>${e.message}</p></div>`;
      console.error(e);
    });
})();
