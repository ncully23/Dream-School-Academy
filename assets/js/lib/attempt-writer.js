// /assets/js/lib/attempt-writer.js
// Unified attempt writer:
// - Validates attempt schema (enough to prevent "topic saves but random doesn't" style bugs)
// - Writes to Firestore: users/{uid}/attempts/{attemptId}
// - Always writes local fallback: dsa:attempt:{attemptId}
// - Returns a structured result so callers can block redirect + show retry UI
//
// Usage:
//   import { saveAttempt, loadAttemptLocal, getLastWriteInfo } from "/assets/js/lib/attempt-writer.js";
//   const res = await saveAttempt(attempt);
//   if (!res.ok) { ... } else { location.href = routes.review(attempt.attemptId) }

const FIRESTORE_SUBCOLLECTION = "attempts";
const LOCAL_ATTEMPT_PREFIX = "dsa:attempt:";
const LOCAL_LAST_WRITE_KEY = "dsa:lastWrite";

function nowIso() {
  return new Date().toISOString();
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

function safeSetLocal(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeGetLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function attemptLocalKey(attemptId) {
  return `${LOCAL_ATTEMPT_PREFIX}${String(attemptId)}`;
}

function normalizeAttemptType(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "topic" || s === "random") return s;
  return null;
}

function validateAttemptShape(attempt) {
  // Returns { ok: true } or { ok:false, code, message, path }
  if (!attempt || typeof attempt !== "object") {
    return { ok: false, code: "invalid-arg", message: "Attempt must be an object.", path: "" };
  }

  if (!isNonEmptyString(attempt.attemptId)) {
    return { ok: false, code: "missing-field", message: "Missing attemptId.", path: "attemptId" };
  }

  if (!isNonEmptyString(attempt.quizId) && !isNonEmptyString(attempt.sectionId)) {
    return {
      ok: false,
      code: "missing-field",
      message: "Missing quizId/sectionId (at least one required).",
      path: "quizId|sectionId",
    };
  }

  // If caller only provides sectionId, mirror it into quizId for consistency
  if (!isNonEmptyString(attempt.quizId) && isNonEmptyString(attempt.sectionId)) {
    attempt.quizId = attempt.sectionId;
  }
  if (!isNonEmptyString(attempt.sectionId) && isNonEmptyString(attempt.quizId)) {
    attempt.sectionId = attempt.quizId;
  }

  const attemptType = normalizeAttemptType(attempt.attemptType);
  if (!attemptType) {
    return {
      ok: false,
      code: "missing-field",
      message: 'Missing/invalid attemptType (must be "topic" or "random").',
      path: "attemptType",
    };
  }
  attempt.attemptType = attemptType;

  if (!isNonEmptyString(attempt.title)) {
    // title isn't strictly required, but it's super useful; fill if missing
    attempt.title = attempt.quizId || attempt.sectionId || "Practice";
  }

  // Timestamps
  if (!isNonEmptyString(attempt.generatedAt)) attempt.generatedAt = nowIso();

  // Totals
  const totals = attempt.totals || {};
  const total = Number(totals.total);
  const correct = Number(totals.correct);
  const answered = Number(totals.answered);
  const timeSpentSec = Number(totals.timeSpentSec);

  if (!Number.isInteger(total) || total < 1) {
    return { ok: false, code: "invalid-field", message: "totals.total must be >= 1.", path: "totals.total" };
  }
  if (!Number.isInteger(correct) || correct < 0 || correct > total) {
    return {
      ok: false,
      code: "invalid-field",
      message: "totals.correct must be between 0 and totals.total.",
      path: "totals.correct",
    };
  }
  if (!Number.isInteger(answered) || answered < 0 || answered > total) {
    return {
      ok: false,
      code: "invalid-field",
      message: "totals.answered must be between 0 and totals.total.",
      path: "totals.answered",
    };
  }
  if (!Number.isInteger(timeSpentSec) || timeSpentSec < 0) {
    return {
      ok: false,
      code: "invalid-field",
      message: "totals.timeSpentSec must be an integer >= 0.",
      path: "totals.timeSpentSec",
    };
  }

  // Ensure scorePercent exists
  if (!isFiniteNumber(totals.scorePercent)) {
    totals.scorePercent = total > 0 ? Math.round((correct / total) * 100) : 0;
  } else {
    totals.scorePercent = Math.max(0, Math.min(100, totals.scorePercent));
  }
  attempt.totals = totals;

  // Items
  if (!Array.isArray(attempt.items) || attempt.items.length !== total) {
    return {
      ok: false,
      code: "invalid-field",
      message: "items must be an array and its length must equal totals.total.",
      path: "items",
    };
  }

  for (let i = 0; i < attempt.items.length; i++) {
    const it = attempt.items[i];
    const basePath = `items[${i}]`;

    if (!it || typeof it !== "object") {
      return { ok: false, code: "invalid-field", message: "Item must be an object.", path: basePath };
    }
    if (!isNonEmptyString(it.questionId) && !isNonEmptyString(it.id)) {
      return { ok: false, code: "missing-field", message: "Missing questionId.", path: `${basePath}.questionId` };
    }
    if (!Array.isArray(it.choices) || it.choices.length < 2) {
      return { ok: false, code: "invalid-field", message: "Invalid choices array.", path: `${basePath}.choices` };
    }
    if (!Number.isInteger(it.correctIndex) || it.correctIndex < 0 || it.correctIndex >= it.choices.length) {
      return {
        ok: false,
        code: "invalid-field",
        message: "Invalid correctIndex.",
        path: `${basePath}.correctIndex`,
      };
    }
    const chosen = it.chosenIndex;
    if (!(chosen === null || Number.isInteger(chosen))) {
      return {
        ok: false,
        code: "invalid-field",
        message: "chosenIndex must be null or integer.",
        path: `${basePath}.chosenIndex`,
      };
    }
    if (Number.isInteger(chosen) && (chosen < 0 || chosen >= it.choices.length)) {
      return {
        ok: false,
        code: "invalid-field",
        message: "chosenIndex out of range.",
        path: `${basePath}.chosenIndex`,
      };
    }
  }

  // Random-only metadata (recommended). If missing, don't hard-fail, but flag.
  if (attemptType === "random") {
    if (!attempt.pick || typeof attempt.pick !== "object") {
      attempt.pick = {
        pickCount: total,
        seedMode: null,
        seedValue: null,
        picked: attempt.items.map((it) => ({
          questionId: it.questionId || it.id || null,
          version: it.version ?? 1,
        })),
      };
    } else {
      if (!Number.isInteger(attempt.pick.pickCount) || attempt.pick.pickCount < 1) attempt.pick.pickCount = total;
      if (!Array.isArray(attempt.pick.picked) || attempt.pick.picked.length !== total) {
        attempt.pick.picked = attempt.items.map((it) => ({
          questionId: it.questionId || it.id || null,
          version: it.version ?? 1,
        }));
      }
    }
  }

  // Bank metadata (not required, but normalize)
  if (attempt.bank && typeof attempt.bank === "object") {
    if (!isNonEmptyString(attempt.bank.title) && isNonEmptyString(attempt.title)) {
      attempt.bank.title = attempt.title;
    }
  }

  return { ok: true };
}

function buildFirestorePayload(attempt, uid) {
  // Keep a stable, queryable top-level schema
  return {
    attemptId: attempt.attemptId,
    uid,

    quizId: attempt.quizId || null,
    sectionId: attempt.sectionId || null,
    title: attempt.title || null,
    attemptType: attempt.attemptType || null,

    bank: attempt.bank || null,
    pick: attempt.pick || null,

    // timestamps
    createdAt: null, // serverTimestamp() injected in writer
    generatedAt: attempt.generatedAt || null,

    // totals + content
    totals: attempt.totals || null,
    items: Array.isArray(attempt.items) ? attempt.items : [],

    // telemetry (optional)
    uiState: attempt.uiState || null,
    sessionMeta: attempt.sessionMeta || null,
  };
}

async function writeAttemptFirestore(attempt) {
  // Returns { ok:true } or { ok:false, code, message }
  const { auth, db, authReady } = await import("/assets/js/firebase-init.js");
  await authReady;

  const user = auth.currentUser;
  if (!user) {
    return { ok: false, code: "auth/no-current-user", message: "Not signed in." };
  }

  const fs = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
  const { doc, setDoc, serverTimestamp } = fs;

  const ref = doc(db, "users", user.uid, FIRESTORE_SUBCOLLECTION, String(attempt.attemptId));
  const payload = buildFirestorePayload(attempt, user.uid);
  payload.createdAt = serverTimestamp();

  try {
    await setDoc(ref, payload, { merge: true });
    return { ok: true };
  } catch (err) {
    const code = String(err?.code || "").toLowerCase() || "firestore/write-failed";
    const message = String(err?.message || err || "Firestore write failed");
    return { ok: false, code, message, err };
  }
}

/**
 * Save attempt in a robust way:
 * 1) validate attempt
 * 2) ALWAYS write local fallback
 * 3) try Firestore write (requires signed-in user)
 *
 * Returns:
 *  { ok:true, attemptId }
 *  { ok:false, code, message, attemptId, localSaved:boolean }
 */
export async function saveAttempt(attempt) {
  const attemptId = String(attempt?.attemptId || "");

  // Validate (also normalizes some fields in-place)
  const v = validateAttemptShape(attempt);
  if (!v.ok) {
    // Still try to stash locally for debugging if possible
    let localSaved = false;
    const json = safeJsonStringify(attempt);
    if (attemptId && json) localSaved = safeSetLocal(attemptLocalKey(attemptId), json);

    try {
      safeSetLocal(
        LOCAL_LAST_WRITE_KEY,
        safeJsonStringify({
          attemptId: attemptId || null,
          ok: false,
          code: v.code,
          message: v.message,
          path: v.path || null,
          localSaved,
          at: nowIso(),
        }) || ""
      );
    } catch {}

    return {
      ok: false,
      attemptId: attemptId || null,
      code: v.code,
      message: v.message,
      path: v.path || null,
      localSaved,
    };
  }

  // Always save local fallback first (so you never "lose" random attempts)
  const json = safeJsonStringify(attempt);
  const localSaved = !!(attemptId && json && safeSetLocal(attemptLocalKey(attemptId), json));

  // Try Firestore
  const w = await writeAttemptFirestore(attempt);

  // Record last write info for debugging/progress banners
  try {
    safeSetLocal(
      LOCAL_LAST_WRITE_KEY,
      safeJsonStringify({
        attemptId,
        ok: !!w.ok,
        code: w.ok ? null : w.code || null,
        message: w.ok ? null : w.message || null,
        localSaved,
        at: nowIso(),
      }) || ""
    );
  } catch {}

  if (!w.ok) {
    return {
      ok: false,
      attemptId,
      code: w.code || "firestore/write-failed",
      message: w.message || "Firestore write failed",
      localSaved,
    };
  }

  return { ok: true, attemptId, localSaved };
}

/**
 * Load an attempt from localStorage fallback.
 * Returns parsed object or null.
 */
export function loadAttemptLocal(attemptId) {
  const raw = safeGetLocal(attemptLocalKey(attemptId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read last write diagnostic info stored by saveAttempt().
 */
export function getLastWriteInfo() {
  const raw = safeGetLocal(LOCAL_LAST_WRITE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Expose the validator for dev/debugging (optional).
 */
export function validateAttempt(attempt) {
  return validateAttemptShape(attempt);
}
