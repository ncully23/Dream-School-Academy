// /assets/js/pages/previewpage.js
// Universal preview renderer for /pages/preview.html?quizId=...
// Reads registry from /assets/configs/quizzes.json (object keyed by quizId).
// Uses Step 6 draft key convention: dsa:draft:{quizId}

async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function getQuizId() {
  const id = new URLSearchParams(location.search).get("quizId");
  return (typeof id === "string" && id.trim()) ? id.trim() : null;
}

function fmtTime(seconds) {
  if (seconds === 0) return "0s";
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (!m) return `${s}s`;
  return s ? `${m}m ${String(s).padStart(2, "0")}s` : `${m}m`;
}

function getDraftKey(quizId) {
  // Step 6 standard key
  return `dsa:draft:${quizId}`;
}

function safeText(x, fallback = "—") {
  return (typeof x === "string" && x.trim()) ? x.trim() : fallback;
}

function safeArr(x) {
  return Array.isArray(x) ? x.filter(Boolean) : [];
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function $(id) {
  return document.getElementById(id);
}

function setVisible(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

function setPills(pillsEl, pills) {
  if (!pillsEl) return;
  const html = safeArr(pills)
    .map((p) => `<span class="pill">${escapeHtml(p)}</span>`)
    .join("");
  pillsEl.innerHTML = html;
}

function setSkills(skillsEl, skills) {
  if (!skillsEl) return;

  const clean = safeArr(skills).map((s) => String(s).trim()).filter(Boolean);
  if (!clean.length) {
    skillsEl.innerHTML = `<span class="muted">No skills listed yet.</span>`;
    return;
  }

  skillsEl.innerHTML = `<ul>${clean.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`;
}

function hasLocalStorageItem(key) {
  try {
    return !!localStorage.getItem(key);
  } catch {
    return false;
  }
}

function removeLocalStorageItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function inferQuestionCount(bank) {
  const n = bank?.questions?.length;
  return Number.isFinite(n) ? n : null;
}

function inferDifficulty(bank) {
  // Optional: compute mode difficulty from bank if registry doesn't provide.
  const qs = bank?.questions;
  if (!Array.isArray(qs) || !qs.length) return null;

  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const q of qs) {
    const d = String(q?.difficulty || "").toLowerCase();
    if (d in counts) counts[d]++;
  }
  const total = counts.easy + counts.medium + counts.hard;
  if (!total) return null;

  const mode = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!mode) return null;

  // Keep it compact; your UI already has a dedicated difficulty line.
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

(async function init() {
  const errEl = $("errorBox");
  const showError = (msg) => {
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.style.display = "block";
  };

  const quizId = getQuizId();
  if (!quizId) {
    showError("Missing ?quizId=... in the URL.");
    return;
  }

  // Elements
  const titleEl = $("title");
  const descEl = $("desc");
  const pillsEl = $("pills");
  const qCountEl = $("qCount");
  const timeEl = $("timeLimit");
  const diffEl = $("difficulty");
  const skillsEl = $("skills");

  const startBtn = $("startBtn");
  const resumeBtn = $("resumeBtn");
  const resetBtn = $("resetBtn");
  const studyBtn = $("studyBtn");
  const noteEl = $("note");

  // Hide error initially (in case cached HTML left it visible)
  if (errEl) errEl.style.display = "none";

  // Load registry
  let registry;
  try {
    registry = await loadJson("/assets/configs/quizzes.json");
  } catch (e) {
    showError(`Could not load quizzes registry. ${e.message}`);
    return;
  }

  const meta = registry?.[quizId];
  if (!meta) {
    const known = registry && typeof registry === "object"
      ? Object.keys(registry).slice(0, 12)
      : [];
    const hint = known.length ? `\n\nExample known quizIds:\n- ${known.join("\n- ")}` : "";
    showError(`Unknown quizId: ${quizId}${hint}`);
    return;
  }

  // Populate core copy
  if (titleEl) {
    titleEl.textContent = safeText(
      meta.previewTitle || meta.title || meta.sectionTitle || "Quiz Preview",
      "Quiz Preview"
    );
  }

  if (descEl) {
    descEl.textContent = safeText(
      meta.previewDescription || meta.description || "Practice this skill set with a timed quiz.",
      "Practice this skill set with a timed quiz."
    );
  }

  // Pills (optional)
  const pills = [];
  if (meta.section) pills.push(`Section: ${meta.section}`);
  if (meta.topic) pills.push(`Topic: ${meta.topic}`);
  if (meta.skillTag) pills.push(String(meta.skillTag));
  setPills(pillsEl, pills);

  // Load bank (optional but useful)
  let bank = null;
  if (meta.bank) {
    try {
      bank = await loadJson(meta.bank);
    } catch {
      // Not fatal; preview can still render from registry
      bank = null;
    }
  }

  // Question count
  const qCount =
    inferQuestionCount(bank) ??
    (Number.isFinite(meta.questionCount) ? meta.questionCount : null) ??
    "—";
  if (qCountEl) qCountEl.textContent = String(qCount);

  // Time limit
  const timeLimit = fmtTime(meta.timeLimitSec);
  if (timeEl) timeEl.textContent = timeLimit;

  // Difficulty: registry value first, else infer from bank
  const inferred = inferDifficulty(bank);
  const diffText = safeText(meta.difficulty, inferred || "—");
  if (diffEl) diffEl.textContent = diffText;

  // Skills list (prefer registry)
  setSkills(skillsEl, safeArr(meta.skills));

  // Study link (optional)
  if (studyBtn) {
    if (meta.studyHref) {
      studyBtn.href = meta.studyHref;
      setVisible(studyBtn, true);
    } else {
      setVisible(studyBtn, false);
    }
  }

  // Start route
  const quizHref = `/pages/quiz.html?quizId=${encodeURIComponent(quizId)}`;
  if (startBtn) startBtn.href = quizHref;

  // Draft detection for Resume/Reset
  const draftKey = getDraftKey(quizId);
  const hasDraft = hasLocalStorageItem(draftKey);

  if (resumeBtn) setVisible(resumeBtn, hasDraft);
  if (resetBtn) setVisible(resetBtn, hasDraft);

  if (noteEl) {
    noteEl.textContent = hasDraft
      ? "You have an unfinished attempt saved on this device."
      : "Tip: if you leave mid-quiz, your progress can be resumed later.";
  }

  // Wire actions
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      // If your quiz runner needs a resume flag later, add it here.
      // For now, your engine should already detect dsa:draft:{quizId}.
      location.href = quizHref;
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const ok = window.confirm("Reset your saved attempt for this quiz?");
      if (!ok) return;
      removeLocalStorageItem(draftKey);
      location.href = quizHref; // start fresh
    });
  }
})().catch((e) => {
  const err = document.getElementById("errorBox");
  if (err) {
    err.textContent = `Preview failed: ${e.message}`;
    err.style.display = "block";
  }
});
