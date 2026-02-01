async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function getQuizId() {
  return new URLSearchParams(location.search).get("quizId");
}

function fmtTime(seconds) {
  if (!seconds || typeof seconds !== "number") return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${String(s).padStart(2, "0")}s` : `${m}m`;
}

function getDraftKey(quizId) {
  // Step 6 standard key
  return `dsa:draft:${quizId}`;
}

function safeText(x, fallback = "—") {
  return (typeof x === "string" && x.trim()) ? x.trim() : fallback;
}

(async function init() {
  const err = document.getElementById("errorBox");
  const showError = (msg) => {
    err.textContent = msg;
    err.style.display = "block";
  };

  const quizId = getQuizId();
  if (!quizId) {
    showError("Missing ?quizId=... in the URL.");
    return;
  }

  let registry;
  try {
    registry = await loadJson("/assets/configs/quizzes.json");
  } catch (e) {
    showError(`Could not load quizzes registry. ${e.message}`);
    return;
  }

  const meta = registry[quizId];
  if (!meta) {
    showError(`Unknown quizId: ${quizId}`);
    return;
  }

  // Elements
  const titleEl = document.getElementById("title");
  const descEl = document.getElementById("desc");
  const pillsEl = document.getElementById("pills");
  const qCountEl = document.getElementById("qCount");
  const timeEl = document.getElementById("timeLimit");
  const diffEl = document.getElementById("difficulty");
  const skillsEl = document.getElementById("skills");

  const startBtn = document.getElementById("startBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const resetBtn = document.getElementById("resetBtn");
  const studyBtn = document.getElementById("studyBtn");
  const noteEl = document.getElementById("note");

  // Populate core copy
  titleEl.textContent = safeText(meta.previewTitle || meta.title || meta.sectionTitle || "Quiz Preview");
  descEl.textContent = safeText(meta.previewDescription || meta.description || "Practice this skill set with a timed quiz.");

  // Pills (optional)
  const pills = [];
  if (meta.section) pills.push(`Section: ${meta.section}`);
  if (meta.topic) pills.push(`Topic: ${meta.topic}`);
  if (meta.skillTag) pills.push(meta.skillTag);

  pillsEl.innerHTML = pills.map((p) => `<span class="pill">${p}</span>`).join("");

  // Load bank just to count questions (fast enough now; later you can store count in registry)
  let bank = null;
  try {
    if (meta.bank) bank = await loadJson(meta.bank);
  } catch (e) {
    // not fatal; we can still render the preview without a bank
  }

  const qCount = bank?.questions?.length ?? meta.questionCount ?? "—";
  qCountEl.textContent = String(qCount);
  timeEl.textContent = fmtTime(meta.timeLimitSec);
  diffEl.textContent = safeText(meta.difficulty || "—");

  // Skills list
  const skills = Array.isArray(meta.skills) ? meta.skills : [];
  skillsEl.innerHTML = skills.length
    ? `<ul>${skills.map((s) => `<li>${s}</li>`).join("")}</ul>`
    : `<span class="muted">No skills listed yet.</span>`;

  // Study link (optional)
  if (meta.studyHref) {
    studyBtn.href = meta.studyHref;
    studyBtn.style.display = "";
  }

  // Start route
  const quizHref = `/pages/quiz.html?quizId=${encodeURIComponent(quizId)}`;
  startBtn.href = quizHref;

  // Draft detection for Resume/Reset
  const draftKey = getDraftKey(quizId);
  const hasDraft = (() => {
    try {
      return !!localStorage.getItem(draftKey);
    } catch {
      return false;
    }
  })();

  if (hasDraft) {
    resumeBtn.style.display = "";
    resetBtn.style.display = "";
    noteEl.textContent = "You have an unfinished attempt saved on this device.";
  } else {
    noteEl.textContent = "Tip: if you leave mid-quiz, your progress can be resumed later.";
  }

  resumeBtn.addEventListener("click", () => {
    location.href = quizHref;
  });

  resetBtn.addEventListener("click", () => {
    const ok = window.confirm("Reset your saved attempt for this quiz?");
    if (!ok) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    location.href = quizHref; // start fresh
  });
})().catch((e) => {
  const err = document.getElementById("errorBox");
  err.textContent = `Preview failed: ${e.message}`;
  err.style.display = "block";
});
