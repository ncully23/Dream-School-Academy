// /assets/js/quiz-data.js
// Central Firebase + quiz persistence layer (modular SDK).
//
// - Does NOT define window.examConfig (each quiz page must do that).
// - Exposes window.quizData with helpers used by:
//   * quiz-engine.js  → appendAttempt(), saveSessionProgress(), etc.
//   * progress.js     → loadAllResultsForUser()
//   * legacy pages    → recordTestResult(), exportAttempts()
//
// IMPORTANT:
// - Uses modular Firebase via firebase-init.js (shared with shell.js).
// - Do NOT include firebase-app-compat/auth-compat/firestore-compat in HTML.
// - Instead, load this file as a module AFTER firebase-init.js and shell.js.

// Pulls the pre-configured auth and db instances from our local Firebase init file.
// These are shared across the whole app so we always talk to the same project.
import { auth, db } from "./firebase-init.js";

// Imports the specific Firestore functions this file needs, directly from Google's CDN.
// Importing only what we use keeps the bundle small and the intent clear.
import {
  collection,    // builds a reference to a Firestore collection (a folder of docs)
  doc,           // builds a reference to a single Firestore document
  getDoc,        // reads one document
  getDocs,       // reads many documents (the result of a query)
  setDoc,        // writes/overwrites a document (with optional merge)
  deleteDoc,     // deletes a document
  query,         // composes query constraints together
  where,         // adds a filter constraint (e.g., where("sectionId", "==", "math"))
  orderBy,       // adds a sort constraint
  limit,         // caps the number of returned docs
  writeBatch,    // groups multiple writes into one atomic operation
  serverTimestamp // a placeholder that Firestore replaces with the server's clock time
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Imports just the auth listener function from Firebase Auth.
import {
  onAuthStateChanged // fires a callback whenever the signed-in user changes (or initial load completes)
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const DEBUG = false; // master switch to turn diagnostic logging on/off without deleting log statements
// Tiny helper that only logs when DEBUG is true — handy for temporary debugging without console spam in production.
function dbg(...args) {
  if (DEBUG) console.log("[quiz-data]", ...args); // prefix logs with "[quiz-data]" so they're easy to spot
}

// -----------------------------------
// 2. Local recorder-style store (backup only)
// -----------------------------------
const LOCAL_ATTEMPT_KEY = "dreamschool:attempts:v1"; // single localStorage key under which all local backup attempts live; the ":v1" lets us migrate later if the format changes

// Reads the array of locally-stored quiz attempts from localStorage.
// Returns an empty array if nothing is stored or if reading fails — never throws.
function loadLocalAttempts() {
  try {
    const raw = localStorage.getItem(LOCAL_ATTEMPT_KEY); // get the raw JSON string
    return raw ? JSON.parse(raw) : []; // parse it if present, otherwise return an empty list
  } catch (e) {
    console.warn("quiz-data: failed to load local attempts", e); // warn but don't crash the app
    return []; // safe fallback so callers always get an array
  }
}

// Saves the given list of attempts back to localStorage as a JSON string.
// Wrapped in try/catch because localStorage can throw in private mode or when full.
function saveLocalAttempts(list) {
  try {
    localStorage.setItem(LOCAL_ATTEMPT_KEY, JSON.stringify(list)); // serialize and write
  } catch (e) {
    console.warn("quiz-data: failed to save local attempts", e); // log without crashing
  }
}

// Removes the entire local attempts store from this device.
// Useful for clearing test data or after a successful sync.
function clearLocalAttempts() {
  try {
    localStorage.removeItem(LOCAL_ATTEMPT_KEY); // delete the key
  } catch (e) {
    console.warn("quiz-data: failed to clear local attempts", e);
  }
}

// Generates a fairly unique ID for a new attempt by combining the current timestamp
// with a random number — collisions are extremely unlikely in normal user activity.
function createAttemptId() {
  return "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000); // e.g., "t_1736700000000_4821"
}

// Builds a compact "core" record from a normalized attempt summary.
// This is the slimmed-down shape used for local storage and quick stats —
// it strips out everything we don't need for export/diagnostics.
function buildCoreRecordFromSummary(normalized, attemptId) {
  const totals = normalized.totals || {}; // safe alias for the totals sub-object
  const score = typeof totals.correct === "number" ? totals.correct : 0; // number of correct answers, default 0
  const total = typeof totals.total === "number" ? totals.total : 0; // total questions, default 0

  // Use the stored percent if present, otherwise compute it from score/total, defaulting to 0.
  const scorePercent =
    typeof totals.scorePercent === "number"
      ? totals.scorePercent
      : total > 0
      ? Math.round((score / total) * 100)
      : 0;

  // How long the user spent on this attempt, in seconds (0 if not tracked).
  const durationSeconds =
    typeof totals.timeSpentSec === "number" ? totals.timeSpentSec : 0;

  // Use the original timestamp if available; otherwise stamp it as right-now.
  const timestamp = normalized.generatedAt || new Date().toISOString();
  const sectionId = normalized.sectionId || null; // which quiz/section this attempt belongs to
  const title = normalized.title || null; // human-readable title

  // Reduce the per-question items down to just the fields we need to replay/inspect later.
  const answers = Array.isArray(normalized.items)
    ? normalized.items.map((item) => ({
        number: item.number || null, // question number (1, 2, 3...)
        id: item.id || null, // unique question ID
        chosenIndex:
          typeof item.chosenIndex === "number" ? item.chosenIndex : null, // which option the user picked
        correctIndex:
          typeof item.correctIndex === "number" ? item.correctIndex : null, // which option was correct
        correct: !!item.correct // boolean: did the user get it right?
      }))
    : [];

  // Return the assembled compact record.
  return {
    id: attemptId,
    sectionId,
    title,
    timestamp,
    score,
    total,
    scorePercent,
    durationSeconds,
    answers
  };
}

// Inserts or updates ("upserts") a local attempt record from a normalized summary.
// Also tracks whether this attempt has been successfully synced to Firestore.
function upsertLocalAttemptFromSummary(normalized, options) {
  // Use any existing ID, or create a new one so every attempt has a stable identifier.
  const attemptId =
    normalized.attemptId || normalized.id || createAttemptId();

  normalized.attemptId = attemptId; // attach the ID back onto the normalized object for downstream use

  const core = buildCoreRecordFromSummary(normalized, attemptId); // build the slim record
  const synced = !!(options && options.synced); // coerce options.synced to a true/false boolean

  const list = loadLocalAttempts(); // load all existing local attempts
  const idx = list.findIndex((r) => r.id === attemptId); // see if this attempt already exists

  // Merge any existing fields with the new core data, plus the synced flag.
  // Spreading the existing record first means new fields override old ones.
  const record = {
    ...(idx >= 0 ? list[idx] : {}),
    ...core,
    synced
  };

  if (idx >= 0) {
    list[idx] = record; // replace existing
  } else {
    list.push(record); // append new
  }

  saveLocalAttempts(list); // persist the updated list
  return record; // hand the saved record back to the caller
}

// -----------------------------------
// 3. examConfig helpers
// -----------------------------------

// Returns the current page's examConfig object (or an empty object if the page didn't define one).
// Each quiz page is expected to set window.examConfig with at least { sectionId, sectionTitle }.
function getExamConfig() {
  return typeof window !== "undefined" && window.examConfig
    ? window.examConfig
    : {};
}

// Reads the section ID from examConfig, returning null if it's missing or empty.
// .trim() guards against accidental whitespace.
function getDefaultSectionId() {
  const exam = getExamConfig();
  if (exam && typeof exam.sectionId === "string" && exam.sectionId.trim()) {
    return exam.sectionId.trim();
  }
  return null;
}

// Reads the human-readable section title from examConfig, or null if absent.
function getDefaultTitle() {
  const exam = getExamConfig();
  if (exam && typeof exam.sectionTitle === "string" && exam.sectionTitle.trim()) {
    return exam.sectionTitle;
  }
  return null;
}

// -----------------------------------
// 4. Auth helpers (modular)
// -----------------------------------

// Returns the currently signed-in user, or rejects with "Not signed in" if no one is.
// If currentUser is briefly null (auth still initializing), it waits for the first auth event before deciding.
async function requireUser() {
  const current = auth.currentUser; // fast path: user already known
  if (current) return current;

  // Slow path: wait for Firebase to fire its first auth state event.
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub(); // detach the listener immediately — we only need the first event
      if (user) resolve(user);
      else reject(new Error("Not signed in"));
    });
  });
}

// Like requireUser(), but never rejects — resolves with null when no user is signed in.
// Use this when "no user" is a valid, expected outcome rather than an error.
function waitForAuthReady() {
  return new Promise((resolve) => {
    const existing = auth.currentUser;
    if (existing) {
      resolve(existing); // fast path
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub(); // one-shot listener
      resolve(user || null); // null is a perfectly valid result here
    });
  });
}

// -----------------------------------
// 5. Scoring / summary normalization
// -----------------------------------

// Walks an array of question items and computes overall totals (answered, correct, total, time, percent).
// Used as a fallback when the saved summary doesn't already include these numbers.
function computeTotalsFromItems(items) {
  // Empty/invalid input → return a zeroed-out totals object so callers don't have to special-case it.
  if (!Array.isArray(items) || items.length === 0) {
    return {
      answered: 0,
      correct: 0,
      total: 0,
      timeSpentSec: 0,
      scorePercent: 0
    };
  }

  let answered = 0; // count of questions the user attempted
  let correct = 0; // count they got right
  const total = items.length; // total number of questions
  let timeSpentSec = 0; // running sum of per-question time

  items.forEach((item) => {
    // Treat anything other than null/undefined/empty-string as an answer.
    const hasAnswer =
      item.chosenIndex !== null &&
      item.chosenIndex !== undefined &&
      item.chosenIndex !== "";

    if (hasAnswer) answered += 1;

    // Determine correctness either from an explicit boolean or by comparing chosen vs. correct index.
    let isCorrect = false;
    if (typeof item.correct === "boolean") {
      isCorrect = item.correct;
    } else if (
      typeof item.correctIndex === "number" &&
      typeof item.chosenIndex === "number"
    ) {
      isCorrect = item.chosenIndex === item.correctIndex;
    }
    if (isCorrect) correct += 1;

    // Add this question's time to the running total, if tracked.
    if (typeof item.timeSpentSec === "number") {
      timeSpentSec += item.timeSpentSec;
    }
  });

  // Final percent, rounded to a whole number; 0 when there are no questions to avoid divide-by-zero.
  const scorePercent =
    total > 0 ? Math.round((correct / total) * 100) : 0;

  return { answered, correct, total, timeSpentSec, scorePercent };
}

// Takes a raw attempt summary and fills in any missing or default fields,
// returning a clean object that the rest of the code can rely on.
function normalizeAttemptSummary(summary) {
  const safe = summary || {}; // never operate on null/undefined
  const defaultSectionId = getDefaultSectionId(); // fall back to examConfig values if needed
  const defaultTitle = getDefaultTitle();

  const sectionId = safe.sectionId || defaultSectionId || null;
  const title = safe.title || defaultTitle || null;
  const items = Array.isArray(safe.items) ? safe.items : []; // always an array

  let totals = safe.totals || {}; // start with whatever totals were provided
  // If any of the core counts are missing, recompute everything from items.
  if (
    typeof totals.answered !== "number" ||
    typeof totals.correct !== "number" ||
    typeof totals.total !== "number"
  ) {
    totals = computeTotalsFromItems(items);
  } else {
    // Otherwise, fill in just the optional fields if they're missing.
    const computed = computeTotalsFromItems(items);
    if (typeof totals.timeSpentSec !== "number") {
      totals.timeSpentSec = computed.timeSpentSec;
    }
    if (typeof totals.scorePercent !== "number") {
      totals.scorePercent = computed.scorePercent;
    }
  }

  // Normalize UI state flags so they always exist with a sensible default.
  // Supports both flat fields (safe.timerHidden) and nested ones (safe.uiState.timerHidden).
  const uiState = {
    timerHidden:
      typeof safe.timerHidden === "boolean"
        ? safe.timerHidden
        : !!(safe.uiState && safe.uiState.timerHidden),
    reviewMode:
      typeof safe.reviewMode === "boolean"
        ? safe.reviewMode
        : !!(safe.uiState && safe.uiState.reviewMode),
    lastQuestionIndex:
      typeof safe.lastQuestionIndex === "number"
        ? safe.lastQuestionIndex
        : (safe.uiState && safe.uiState.lastQuestionIndex) ?? null
  };

  // Spread the original first so we keep any extra fields, then override with normalized ones.
  return {
    ...safe,
    sectionId,
    title,
    items,
    totals,
    uiState
  };
}

// -----------------------------------
// 6. Firestore – completed attempts
// -----------------------------------
// Collection path: users/{uid}/examAttempts/{autoId}

// Saves a completed quiz attempt to both localStorage (always) and Firestore (if signed in).
// Returns an object indicating whether the sync succeeded — never throws on Firestore failures.
async function appendAttempt(summary) {
  const normalized = normalizeAttemptSummary(summary); // clean up the input first

  // Local backup (for export/offline tools only)
  // Save locally with synced=false; we'll flip it to true if Firestore succeeds.
  const localRecord = upsertLocalAttemptFromSummary(normalized, {
    synced: false
  });

  const attemptId = localRecord.id; // use the ID from the local record
  normalized.attemptId = attemptId; // make sure the normalized object also carries it

  const sectionId = normalized.sectionId || getDefaultSectionId(); // fallback chain
  const title = normalized.title || getDefaultTitle();

  // Warn (but don't fail) if no section ID was provided — analytics will be limited without it.
  if (!sectionId) {
    console.warn(
      "quiz-data.appendAttempt: No sectionId found. " +
        "Set summary.sectionId or window.examConfig.sectionId."
    );
  }

  // Pull these out of the local record so they're consistent with what's stored locally.
  const timestamp = localRecord.timestamp;
  const scorePercent = localRecord.scorePercent;
  const durationSeconds = localRecord.durationSeconds;

  let user;
  try {
    user = await requireUser(); // need an authenticated user to write to Firestore
  } catch (e) {
    // Not signed in → keep the local copy and report localOnly status.
    console.warn(
      "quiz-data.appendAttempt: no user signed in, keeping local only.",
      e
    );
    return {
      attemptId,
      synced: false,
      localOnly: true
    };
  }

  try {
    // Build the full Firestore payload including server-side bookkeeping fields.
    const payload = {
      ...normalized,
      attemptId,
      sectionId: sectionId || null,
      title: title || null,
      userId: user.uid, // helps queries and rules
      timestamp,
      scorePercent,
      durationSeconds,
      createdAt: serverTimestamp() // server-side timestamp for accurate ordering
    };

    const attemptsCol = collection(db, "users", user.uid, "examAttempts"); // path: users/{uid}/examAttempts
    const ref = doc(attemptsCol); // generate an auto-ID document reference

    await setDoc(ref, payload); // perform the actual write

    // Mark local copy synced
    upsertLocalAttemptFromSummary(normalized, { synced: true }); // flip the synced flag

    return {
      attemptId,
      synced: true,
      docId: ref.id // expose the Firestore-assigned ID for callers that want to deep-link
    };
  } catch (e) {
    // Firestore write failed → keep the local copy with synced=false so it can be retried/exported.
    console.warn(
      "quiz-data.appendAttempt: Firestore write failed, local record kept as synced:false",
      e
    );
    return {
      attemptId,
      synced: false,
      error: e && e.message ? e.message : String(e) // pass back the error string for diagnostics
    };
  }
}

// Loads all attempt documents for one specific section (newest first), from Firestore.
// Throws if no sectionId is available, since "all attempts for [no section]" makes no sense.
async function loadResultsForSection(sectionId) {
  const user = await requireUser();
  const effectiveSectionId = sectionId || getDefaultSectionId(); // explicit arg wins, otherwise fall back to examConfig

  if (!effectiveSectionId) {
    throw new Error(
      "quiz-data.loadResultsForSection: No sectionId provided and none found in examConfig."
    );
  }

  const attemptsCol = collection(db, "users", user.uid, "examAttempts");
  // Build a query: only docs for this section, sorted newest-first.
  const q = query(
    attemptsCol,
    where("sectionId", "==", effectiveSectionId),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q); // execute the query
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })); // flatten doc snapshot to plain objects
}

// Used by progress.js
// Loads ALL attempts for the current user across every section (newest first).
async function loadAllResultsForUser() {
  const user = await requireUser();

  const attemptsCol = collection(db, "users", user.uid, "examAttempts");
  const q = query(attemptsCol, orderBy("createdAt", "desc")); // no `where` — fetch everything

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// -----------------------------------
// 7. Firestore – in-progress sessions
// -----------------------------------
// Collection path: users/{uid}/examSessions/{sectionId}

// Saves the user's in-progress quiz state so they can resume later from any device.
// Uses { merge: true } so partial updates don't wipe out other fields.
async function saveSessionProgress(progressState) {
  if (!progressState) return; // nothing to save → bail out

  const user = await requireUser();
  const exam = getExamConfig();

  // Resolve the section ID from the state, then examConfig, then null.
  const sectionId =
    progressState.sectionId || (exam && exam.sectionId) || null;
  const title = progressState.title || (exam && exam.sectionTitle) || null;

  if (!sectionId) {
    console.warn(
      "quiz-data.saveSessionProgress: No sectionId found. " +
        "Set progressState.sectionId or window.examConfig.sectionId."
    );
    return; // can't save without a section ID — it's the document's key
  }

  // Build the saved-session payload with safe defaults for every field.
  const payload = {
    sectionId,
    title,
    lastQuestionId: progressState.lastQuestionId ?? null, // ?? returns the right side ONLY for null/undefined
    lastQuestionIndex:
      typeof progressState.lastQuestionIndex === "number"
        ? progressState.lastQuestionIndex
        : null,
    lastScreenIndex:
      typeof progressState.lastScreenIndex === "number"
        ? progressState.lastScreenIndex
        : null,
    timerHidden: !!progressState.timerHidden, // coerce to strict boolean
    questionCountHidden: !!progressState.questionCountHidden,
    reviewMode: !!progressState.reviewMode,
    answers: progressState.answers || {}, // always an object
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp() // overwritten on subsequent saves; merge:true keeps the original
  };

  // Use sectionId as the doc ID so each section has at most one in-progress record per user.
  const ref = doc(db, "users", user.uid, "examSessions", sectionId);
  await setDoc(ref, payload, { merge: true }); // merge prevents wiping existing fields not in payload
  return ref.id;
}

// Loads the saved in-progress session for one section, or null if there isn't one.
async function loadSessionProgress(sectionId) {
  const user = await requireUser();
  const effectiveSectionId = sectionId || getDefaultSectionId();

  if (!effectiveSectionId) {
    throw new Error(
      "quiz-data.loadSessionProgress: No sectionId provided and none found in examConfig."
    );
  }

  const ref = doc(db, "users", user.uid, "examSessions", effectiveSectionId);
  const snap = await getDoc(ref); // single-doc read
  if (!snap.exists()) return null; // no saved session → return null
  return { id: snap.id, ...snap.data() }; // flatten to a plain object with id
}

// Deletes the saved in-progress session for one section (e.g., after the user finishes or restarts).
async function clearSessionProgress(sectionId) {
  const user = await requireUser();
  const effectiveSectionId = sectionId || getDefaultSectionId();

  if (!effectiveSectionId) {
    console.warn(
      "quiz-data.clearSessionProgress: No sectionId provided and none found in examConfig."
    );
    return;
  }

  const ref = doc(db, "users", user.uid, "examSessions", effectiveSectionId);
  await deleteDoc(ref); // remove the document
}

// Logs every answer change a user makes in review mode, as individual sub-documents.
// Uses a writeBatch to commit them all atomically — either every change is saved or none are.
async function logReviewChanges(sectionId, changes) {
  const user = await requireUser();
  if (!Array.isArray(changes) || changes.length === 0) return; // nothing to log

  const effectiveSectionId = sectionId || getDefaultSectionId();
  if (!effectiveSectionId) {
    console.warn(
      "quiz-data.logReviewChanges: No sectionId provided and none found in examConfig."
    );
    return;
  }

  const batch = writeBatch(db); // start a batched write

  changes.forEach((change) => {
    // Each change becomes its own doc inside the session's "reviewChanges" subcollection.
    const ref = doc(
      collection(
        db,
        "users",
        user.uid,
        "examSessions",
        effectiveSectionId,
        "reviewChanges"
      )
    );

    // Defensive payload: every field has an explicit value or null.
    const payload = {
      questionId: change.questionId || null,
      subQuestionId: change.subQuestionId || null,
      oldAnswerIndex:
        typeof change.oldAnswerIndex === "number"
          ? change.oldAnswerIndex
          : null,
      newAnswerIndex:
        typeof change.newAnswerIndex === "number"
          ? change.newAnswerIndex
          : null,
      durationSeconds:
        typeof change.durationSeconds === "number"
          ? change.durationSeconds
          : null,
      changedAt: serverTimestamp() // accurate server-side timestamp
    };

    batch.set(ref, payload); // queue the write into the batch
  });

  await batch.commit(); // send all queued writes as one atomic operation
}

// -----------------------------------
// 8. Export attempts (local + remote)
// -----------------------------------

// Triggers a JSON file download containing both local and remote attempts.
// Useful for backups, migrations, or technical support.
async function exportAttempts() {
  const local = loadLocalAttempts(); // grab everything stored on this device
  let remote = []; // remote will stay empty if the fetch fails

  try {
    remote = await loadAllResultsForUser(); // attempt to grab everything from Firestore
  } catch (e) {
    console.warn(
      "quiz-data.exportAttempts: could not load remote results, exporting local only",
      e
    );
  }

  // Wrap both lists with a generation timestamp so the export is self-describing.
  const data = {
    generatedAt: new Date().toISOString(),
    localAttempts: local,
    remoteAttempts: remote
  };

  try {
    const json = JSON.stringify(data, null, 2); // pretty-print with 2-space indent
    const blob = new Blob([json], { type: "application/json" }); // wrap in a Blob for download
    const url = URL.createObjectURL(blob); // create a temporary URL pointing at the blob
    const a = document.createElement("a"); // build an invisible anchor to trigger the download
    a.href = url;
    a.download = "dreamschool-attempts-export.json"; // the suggested filename
    document.body.appendChild(a); // must be in the DOM to be clickable in some browsers
    a.click(); // programmatically click → browser starts the download
    a.remove(); // clean up the DOM
    URL.revokeObjectURL(url); // free the temporary URL → release memory
  } catch (e) {
    console.warn("quiz-data.exportAttempts: failed to export", e);
  }
}

// -----------------------------------
// 9. Section stats / latest attempt
// -----------------------------------

// Computes summary statistics (count, best %, average %, last %, last date) from a list of attempts.
// Returns an object full of nulls when the list is empty so callers don't need to check first.
function computeStatsFromAttemptList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return {
      count: 0,
      bestPercent: null,
      avgPercent: null,
      lastPercent: null,
      lastTakenAt: null
    };
  }

  const count = list.length;
  let bestPercent = null;
  let sumPercent = 0;
  let lastPercent = null;
  let lastTakenAt = null;

  list.forEach((r, idx) => {
    const p = typeof r.scorePercent === "number" ? r.scorePercent : null; // skip non-numeric values
    if (p !== null) {
      if (bestPercent === null || p > bestPercent) bestPercent = p; // running max
      sumPercent += p;
      if (idx === 0) lastPercent = p; // assumes the list is already sorted newest-first
    }
    if (idx === 0 && r.timestamp) lastTakenAt = r.timestamp; // first item = most recent
  });

  // Average is null if no valid percents were found; otherwise rounded to a whole number.
  const avgPercent =
    bestPercent === null ? null : Math.round(sumPercent / count);

  return {
    count,
    bestPercent,
    avgPercent,
    lastPercent,
    lastTakenAt
  };
}

// Loads stats for one section, preferring Firestore but gracefully falling back to localStorage.
// Always returns a consistent shape; the `source` field tells callers where the data came from.
async function loadSectionStats(sectionId) {
  const effectiveSectionId = sectionId || getDefaultSectionId();
  if (!effectiveSectionId) {
    // No section to look up → return a safe "nothing to show" object.
    return {
      sectionId: null,
      source: "none",
      count: 0,
      bestPercent: null,
      avgPercent: null,
      lastPercent: null,
      lastTakenAt: null
    };
  }

  let remote = [];
  let remoteError = null; // track whether remote failed so we can label the source accordingly

  try {
    const user = await requireUser();
    const attemptsCol = collection(db, "users", user.uid, "examAttempts");
    const q = query(
      attemptsCol,
      where("sectionId", "==", effectiveSectionId),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    remote = snap.docs.map((d) => d.data()); // strip doc IDs — stats only need data
  } catch (e) {
    remoteError = e;
    dbg("loadSectionStats: remote fetch failed, will try local", e); // diagnostic log only when DEBUG is on
  }

  // If we got remote data, use it.
  if (remote && remote.length > 0) {
    const stats = computeStatsFromAttemptList(remote);
    return {
      sectionId: effectiveSectionId,
      source: "remote",
      ...stats
    };
  }

  // Otherwise, filter local attempts down to this section and sort newest-first.
  const local = loadLocalAttempts()
    .filter((a) => a.sectionId === effectiveSectionId)
    .sort((a, b) => {
      const ta = a.timestamp || "";
      const tb = b.timestamp || "";
      return ta < tb ? 1 : ta > tb ? -1 : 0; // descending sort by ISO timestamp string
    });

  const stats = computeStatsFromAttemptList(local);
  return {
    sectionId: effectiveSectionId,
    // "local-offline" if remote failed, "local" if remote simply had no data — useful for the UI to know.
    source: remoteError ? "local-offline" : "local",
    ...stats
  };
}

// Returns the most recent attempt for a section, preferring remote but falling back to local.
// Returns null if no attempts exist anywhere.
async function loadLatestAttemptForSection(sectionId) {
  const effectiveSectionId = sectionId || getDefaultSectionId();
  if (!effectiveSectionId) return null;

  try {
    const user = await requireUser();
    const attemptsCol = collection(db, "users", user.uid, "examAttempts");
    // Limit to 1 — Firestore is more efficient when you only ask for what you need.
    const q = query(
      attemptsCol,
      where("sectionId", "==", effectiveSectionId),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      const docSnap = snap.docs[0]; // grab the single result
      return { id: docSnap.id, source: "remote", ...docSnap.data() };
    }
  } catch (e) {
    dbg("loadLatestAttemptForSection: remote failed, trying local", e);
  }

  // Same local-fallback pattern as loadSectionStats.
  const local = loadLocalAttempts()
    .filter((a) => a.sectionId === effectiveSectionId)
    .sort((a, b) => {
      const ta = a.timestamp || "";
      const tb = b.timestamp || "";
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });

  if (local.length === 0) return null;
  return { source: "local", ...local[0] }; // return the newest local entry
}

// -----------------------------------
// 10. Legacy: recordTestResult helper
// -----------------------------------

// Older API kept for backward compatibility with pages that haven't migrated to appendAttempt yet.
// Accepts a simpler shape (score/total/answers) and converts it into the modern summary format
// before delegating to appendAttempt.
async function recordTestResult({
  score,
  total,
  durationSeconds = 0, // default values via destructuring
  category = "General",
  answers = []
} = {}) { // the trailing = {} lets callers invoke recordTestResult() with no args at all
  if (typeof score !== "number" || typeof total !== "number") {
    throw new Error("recordTestResult: score and total must be numbers"); // strict input validation
  }

  const scorePercent = total > 0 ? Math.round((score / total) * 100) : 0;

  // Convert the legacy "answers" shape into the modern "items" shape one entry at a time.
  const items = Array.isArray(answers)
    ? answers.map((a, idx) => {
        // Support both `chosenIndex` (modern) and `answer` (legacy) field names.
        const chosen =
          typeof a.chosenIndex === "number"
            ? a.chosenIndex
            : typeof a.answer === "number"
            ? a.answer
            : null;
        const correctIndex =
          typeof a.correctIndex === "number" ? a.correctIndex : null;

        // Derive correctness from explicit boolean OR by comparing indexes.
        let correctFlag = false;
        if (typeof a.correct === "boolean") {
          correctFlag = a.correct;
        } else if (chosen !== null && correctIndex !== null) {
          correctFlag = chosen === correctIndex;
        }

        return {
          number: idx + 1, // 1-based question number
          id: a.qid || "q" + (idx + 1), // use provided ID or build one
          correctIndex,
          chosenIndex: chosen,
          correct: correctFlag
        };
      })
    : [];

  // Build the modern summary shape that appendAttempt expects.
  const summary = {
    attemptId: createAttemptId(),
    sectionId: category, // legacy callers used "category" instead of "sectionId"
    title: category,
    generatedAt: new Date().toISOString(),
    totals: {
      answered: total, // legacy assumes every question was answered
      correct: score,
      total,
      timeSpentSec: durationSeconds,
      scorePercent
    },
    items,
    uiState: {
      timerHidden: false,
      reviewMode: false,
      lastQuestionIndex: items.length - 1
    }
  };

  return appendAttempt(summary); // hand off to the modern path
}

// -----------------------------------
// 11. Public API
// -----------------------------------

// Expose a curated public API on window.quizData so other scripts (and legacy pages) can use it
// without needing to import this module directly. This is the script's "front door".
window.quizData = {
  VERSION: "2.0.0", // useful for debugging which version is loaded
  auth, // raw Firebase auth instance, in case advanced callers need it
  db, // raw Firestore db instance
  requireUser, // throws if no user
  waitForAuthReady, // resolves with null if no user

  // Finished attempts
  appendAttempt,
  loadResultsForSection,
  loadAllResultsForUser,
  loadSectionStats,
  loadLatestAttemptForSection,

  // In-progress sessions
  saveSessionProgress,
  loadSessionProgress,
  clearSessionProgress,
  logReviewChanges,

  // Recorder helpers (backup / exports only)
  exportAttempts,
  getLocalAttempts: loadLocalAttempts, // exposed under a friendlier external name
  clearLocalAttempts,

  // Legacy helper
  recordTestResult
};
