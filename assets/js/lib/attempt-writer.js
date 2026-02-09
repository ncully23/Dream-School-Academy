// /assets/js/lib/attempt-writer.js
// Unified attempt writer:
// - Validates attempt schema (enough to prevent "topic saves but random doesn't" style bugs)
// - Rejects Firestore-invalid values (undefined / NaN / Infinity / functions / symbols) with a precise path
// - Sanitizes payload for Firestore (drops undefined keys/array entries; converts NaN/Infinity -> null)
// - Writes to Firestore: users/{uid}/attempts/{attemptId}
// - Always writes local fallback: dsa:attempt:{attemptId}
// - Returns a structured result so callers can block redirect + show retry UI
//
// Usage:
//   import { saveAttempt, loadAttemptLocal, getLastWriteInfo } from "/assets/js/lib/attempt-writer.js";
//   const res = await saveAttempt(attempt);
//   if (!res.ok) { ... } else { location.href = `/pages/review.html?attemptId=${attempt.attemptId}` }

const FIRESTORE_SUBCOLLECTION = "attempts";
const LOCAL_ATTEMPT_PREFIX = "dsa:attempt:";
const LOCAL_LAST_WRITE_KEY = "dsa:lastWrite";

/* -----------------------------
   Firestore invalid-value detection + sanitization
------------------------------ */

function findInvalidFirestoreValue(x, path = "") {
  // Firestore rejects: undefined, NaN, Infinity, functions, symbols
  if (x === undefined) return { path, value: x, reason: "undefined" };
  if (typeof x === "number" && !Number.isFinite(x)) return { path, value: x, reason: "non-finite number" };
  if (typeof x === "function") return { path, value: x, reason: "function" };
  if (typeof x === "symbol") return { path, value: x, reason: "symbol" };

  if (!x || typeof x !== "object") return null;

  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) {
      const r = findInvalidFirestoreValue(x[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }

  for (const k of Object.keys(x)) {
    const r = findInvalidFirestoreValue(x[k], path ? `${path}.${k}` : k);
    if (r) return r;
  }
  return null;
}

function sanitizeForFirestore(x) {
  // Removes undefined; converts NaN/Infinity to null; deep-sanitizes objects/arrays.
  if (x === undefined) return undefined; // caller will drop keys
  if (typeof x === "number" && !Number.isFinite(x)) return null;
  if (x === null) return null;
  if (typeof x !== "object") return x;

  if (Array.isArray(x)) {
    const out = [];
    for (const v of x) {
      const sv = sanitizeForFirestore(v);
      // Firestore does not allow undefined entries inside arrays either → drop them
      if (sv !== undefined) out.push(sv);
    }
    return out;
  }

  const out = {};
  for (const [k, v] of Object.entries(x)) {
    const sv = sanitizeForFirestore(v);
    if (sv !== undefined) out[k] = sv; // drop undefined keys
  }
  return out;
}

/* -----------------------------
   Small utils
------------------------------ */

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

function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  const x = Math.floor(n);
  return Math.max(lo, Math.min(hi, x));
}

function computePercent(correct, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(correct) || correct < 0) return 0;
  return Math.round((correct / total) * 1000) / 10;
}

function recordLastWrite(info) {
  const payload = { ...info, at: nowIso() };
  const json = safeJsonStringify(payload);
  if (!json) return;
  safeSetLocal(LOCAL_LAST_WRITE_KEY, json);
}

/* -----------------------------
   Validation
------------------------------ */

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

  // Normalize quizId/sectionId
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
    attempt.title = attempt.quizId || attempt.sectionId || "Practice";
  }

  // Timestamps
  // Accept either createdAt or generatedAt; store both if needed
  if (!isNonEmptyString(attempt.generatedAt) && isNonEmptyString(attempt.createdAt)) {
    attempt.generatedAt = attempt.createdAt;
  }
  if (!isNonEmptyString(attempt.generatedAt)) attempt.generatedAt = nowIso();

  // Totals
  const totals = (attempt.totals && typeof attempt.totals === "object") ? attempt.totals : {};
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

  // Ensure scorePercent exists and is finite
  if (!isFiniteNumber(totals.scorePercent)) {
    totals.scorePercent = computePercent(correct, total);
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

    // Normalize questionId/id
    if (!isNonEmptyString(it.questionId) && isNonEmptyString(it.id)) it.questionId = it.id;

    if (!isNonEmptyString(it.questionId)) {
      return { ok: false, code: "missing-field", message: "Missing questionId.", path: `${basePath}.questionId` };
    }

    // Normalize version (ensure integer)
    if (!Number.isInteger(it.version)) it.version = 1;

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

    // chosenIndex can be null or integer
    const chosen = it.chosenIndex;
    if (!(chosen === null || chosen === undefined || Number.isInteger(chosen))) {
      return {
        ok: false,
        code: "invalid-field",
        message: "chosenIndex must be null or integer.",
        path: `${basePath}.chosenIndex`,
      };
    }

    // Normalize chosenIndex: undefined => null (Firestore-safe and semantically correct)
    if (chosen === undefined) it.chosenIndex = null;

    if (Number.isInteger(it.chosenIndex) && (it.chosenIndex < 0 || it.chosenIndex >= it.choices.length)) {
      return {
        ok: false,
        code: "invalid-field",
        message: "chosenIndex out of range.",
        path: `${basePath}.chosenIndex`,
      };
    }

    // Normalize boolean correct (do not require it, but set if missing)
    if (typeof it.correct !== "boolean") {
      it.correct = (it.chosenIndex != null && it.chosenIndex === it.correctIndex);
    }

    // Normalize explanation: Firestore must not see undefined anywhere
    if (it.explanation === undefined) it.explanation = null;
  }

  // Random-only metadata (recommended). If missing, build it.
  if (attemptType === "random") {
    if (!attempt.pick || typeof attempt.pick !== "object") {
      attempt.pick = {
        pickCount: total,
        seedMode: null,
        seedValue: null,
        picked: attempt.items.map((it) => ({
          questionId: it.questionId,
          version: it.version ?? 1,
        })),
      };
    } else {
      // Normalize pickCount
      if (!Number.isInteger(attempt.pick.pickCount) || attempt.pick.pickCount < 1) {
        attempt.pick.pickCount = total;
      }
      // Normalize seed fields
      if (attempt.pick.seedMode === undefined) attempt.pick.seedMode = null;
      if (attempt.pick.seedValue === undefined) attempt.pick.seedValue = null;

      // Normalize picked list to be Firestore-safe
      if (!Array.isArray(attempt.pick.picked) || attempt.pick.picked.length !== total) {
        attempt.pick.picked = attempt.items.map((it) => ({
          questionId: it.questionId,
          version: it.version ?? 1,
        }));
      } else {
        for (let i = 0; i < attempt.pick.picked.length; i++) {
          const p = attempt.pick.picked[i] || {};
          if (!isNonEmptyString(p.questionId)) p.questionId = attempt.items[i]?.questionId || null;
          if (!Number.isInteger(p.version)) p.version = attempt.items[i]?.version ?? 1;
          // Ensure no undefined slips into arrays
          attempt.pick.picked[i] = {
            questionId: p.questionId ?? null,
            version: p.version ?? 1,
          };
        }
      }
    }
  }

  // Bank metadata (normalize object, remove undefineds later via sanitizer)
  if (attempt.bank && typeof attempt.bank === "object") {
    if (!isNonEmptyString(attempt.bank.title) && isNonEmptyString(attempt.title)) {
      attempt.bank.title = attempt.title;
    }
    if (attempt.bank.bankVersion === undefined) attempt.bank.bankVersion = null;
  }

  // Final: make sure the attempt object itself doesn’t contain Firestore-invalid values
  const bad = findInvalidFirestoreValue(attempt);
  if (bad) {
    return {
      ok: false,
      code: "invalid-argument",
      message: `Attempt contains invalid Firestore value at "${bad.path}" (${bad.reason}).`,
      path: bad.path || "",
    };
  }

  return { ok: true };
}

/* -----------------------------
   Payload shaping
------------------------------ */

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
  const mod = await import("/assets/js/firebase-init.js");
  const { auth, db, authReady } = mod;
  await authReady;

  const user = auth.currentUser;
  if (!user) {
    return { ok: false, code: "auth/no-current-user", message: "Not signed in." };
  }

  const fs = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
  const { doc, setDoc, serverTimestamp } = fs;

  const ref = doc(db, "users", user.uid, FIRESTORE_SUBCOLLECTION, String(attempt.attemptId));

  // Build + sanitize payload for Firestore
  const payload = buildFirestorePayload(attempt, user.uid);
  payload.createdAt = serverTimestamp();

  // Defense-in-depth: sanitize payload (drops undefined keys/array entries)
  const clean = sanitizeForFirestore(payload);

  // Final guard: find invalid values in the clean payload too (should be none)
  const bad = findInvalidFirestoreValue(clean);
  if (bad) {
    return {
      ok: false,
      code: "invalid-argument",
      message: `Firestore payload still contains invalid value at "${bad.path}" (${bad.reason}).`,
      err: bad,
    };
  }

  try {
    // merge:true is ok here since attemptId is stable and you may enrich later
    await setDoc(ref, clean, { merge: true });
    return { ok: true };
  } catch (err) {
    const code = String(err?.code || "").toLowerCase() || "firestore/write-failed";
    const message = String(err?.message || err || "Firestore write failed");
    return { ok: false, code, message, err };
  }
}

/* -----------------------------
   Public API
------------------------------ */

/**
 * Save attempt in a robust way:
 * 1) validate attempt (also normalizes in-place)
 * 2) ALWAYS write local fallback (raw attempt)
 * 3) sanitize + try Firestore write (requires signed-in user)
 *
 * Returns:
 *  { ok:true, attemptId, localSaved:true }
 *  { ok:false, code, message, attemptId, localSaved:boolean, path? }
 */
export async function saveAttempt(attempt) {
  const attemptId = String(attempt?.attemptId || "");

  // Validate (and normalize)
  const v = validateAttemptShape(attempt);
  if (!v.ok) {
    // Still try to stash locally for debugging if possible
    let localSaved = false;
    const json = safeJsonStringify(attempt);
    if (attemptId && json) localSaved = safeSetLocal(attemptLocalKey(attemptId), json);

    recordLastWrite({
      attemptId: attemptId || null,
      ok: false,
      code: v.code,
      message: v.message,
      path: v.path || null,
      localSaved,
    });

    return {
      ok: false,
      attemptId: attemptId || null,
      code: v.code,
      message: v.message,
      path: v.path || null,
      localSaved,
    };
  }

  // Always save local fallback first (so you never lose attempts)
  const json = safeJsonStringify(attempt);
  const localSaved = !!(attemptId && json && safeSetLocal(attemptLocalKey(attemptId), json));

  // Try Firestore
  const w = await writeAttemptFirestore(attempt);

  recordLastWrite({
    attemptId,
    ok: !!w.ok,
    code: w.ok ? null : w.code || null,
    message: w.ok ? null : w.message || null,
    localSaved,
  });

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
