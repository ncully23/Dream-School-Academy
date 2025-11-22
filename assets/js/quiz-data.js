// quiz-data.js
// Handles Firebase persistence for results, statistics,
// in-progress session state, and a recorder-style local history.
//
// UNIVERSAL: it does NOT define window.examConfig.
// Each quiz page should define its own examConfig, for example:
//
// <script>window.examConfig = { ... }</script>
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
// <script src="/assets/js/quiz-data.js"></script>
// <script src="/assets/js/quiz-engine.js"></script>

(function () {
  // Simple debug flag – flip to true when you want console logging
  const DEBUG = false;
  function dbg(...args) {
    if (DEBUG) console.log("[quiz-data]", ...args);
  }

  // -----------------------------
  // 1. Firebase setup
  // -----------------------------

  const firebaseConfig = {
    apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
    authDomain: "dream-school-academy.firebaseapp.com",
    projectId: "dream-school-academy",
    storageBucket: "dream-school-academy.firebasestorage.app",
    messagingSenderId: "665412130733",
    appId: "1:665412130733:web:c3d59ab2c20f65a2277324",
    measurementId: "G-HCJWBWZXKZ"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  // -----------------------------
  // 2. Local recorder-style store
  // -----------------------------

  const LOCAL_ATTEMPT_KEY = "dreamschool:attempts:v1";

  function loadLocalAttempts() {
    try {
      const raw = localStorage.getItem(LOCAL_ATTEMPT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn("quiz-data: failed to load local attempts", e);
      return [];
    }
  }

  function saveLocalAttempts(list) {
    try {
      localStorage.setItem(LOCAL_ATTEMPT_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("quiz-data: failed to save local attempts", e);
    }
  }

  function clearLocalAttempts() {
    try {
      localStorage.removeItem(LOCAL_ATTEMPT_KEY);
    } catch (e) {
      console.warn("quiz-data: failed to clear local attempts", e);
    }
  }

  function createAttemptId() {
    return "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  }

  // Build the "recorder-style" core record from a normalized summary
  function buildCoreRecordFromSummary(normalized, attemptId) {
    const totals = normalized.totals || {};
    const score = typeof totals.correct === "number" ? totals.correct : 0;
    const total = typeof totals.total === "number" ? totals.total : 0;

    const scorePercent =
      typeof totals.scorePercent === "number"
        ? totals.scorePercent
        : total > 0
        ? Math.round((score / total) * 100)
        : 0;

    const durationSeconds =
      typeof totals.timeSpentSec === "number" ? totals.timeSpentSec : 0;

    const timestamp =
      normalized.generatedAt || new Date().toISOString();

    const sectionId = normalized.sectionId || null;
    const title = normalized.title || null;

    const answers = Array.isArray(normalized.items)
      ? normalized.items.map((item) => ({
          number: item.number || null,
          id: item.id || null,
          chosenIndex:
            typeof item.chosenIndex === "number"
              ? item.chosenIndex
              : null,
          correctIndex:
            typeof item.correctIndex === "number"
              ? item.correctIndex
              : null,
          correct: !!item.correct
        }))
      : [];

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

  // Upsert core record into local store, marking synced true/false
  function upsertLocalAttemptFromSummary(normalized, options) {
    const attemptId =
      normalized.attemptId ||
      normalized.id ||
      createAttemptId();

    normalized.attemptId = attemptId;

    const core = buildCoreRecordFromSummary(normalized, attemptId);
    const synced = !!(options && options.synced);

    const list = loadLocalAttempts();
    const idx = list.findIndex((r) => r.id === attemptId);

    const record = {
      ...(idx >= 0 ? list[idx] : {}),
      ...core,
      synced
    };

    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }

    saveLocalAttempts(list);
    return record;
  }

  // -----------------------------
  // 3. Helper: examConfig access
  // -----------------------------

  function getExamConfig() {
    return typeof window !== "undefined" && window.examConfig
      ? window.examConfig
      : {};
  }

  function getDefaultSectionId() {
    const exam = getExamConfig();
    if (exam && typeof exam.sectionId === "string" && exam.sectionId.trim()) {
      return exam.sectionId.trim();
    }
    return null;
  }

  function getDefaultTitle() {
    const exam = getExamConfig();
    if (exam && typeof exam.sectionTitle === "string" && exam.sectionTitle.trim()) {
      return exam.sectionTitle;
    }
    return null;
  }

  // -----------------------------
  // 4. Helper: ensure we have a logged-in user
  // -----------------------------
  async function requireUser() {
    const current = auth.currentUser;
    if (current) return current;

    return new Promise((resolve, reject) => {
      const unsub = auth.onAuthStateChanged((user) => {
        unsub();
        if (user) resolve(user);
        else reject(new Error("Not signed in"));
      });
    });
  }

  // A tiny helper if you just want to await auth state (user or null)
  function waitForAuthReady() {
    return new Promise((resolve) => {
      const existing = auth.currentUser;
      if (existing) {
        resolve(existing);
        return;
      }
      const unsub = auth.onAuthStateChanged((user) => {
        unsub();
        resolve(user || null);
      });
    });
  }

  // -----------------------------
  // 5. Helpers for scoring/summary normalization
  // -----------------------------

  function computeTotalsFromItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        answered: 0,
        correct: 0,
        total: 0,
        timeSpentSec: 0,
        scorePercent: 0
      };
    }

    let answered = 0;
    let correct = 0;
    const total = items.length;
    let timeSpentSec = 0;

    items.forEach((item) => {
      const hasAnswer =
        item.chosenIndex !== null &&
        item.chosenIndex !== undefined &&
        item.chosenIndex !== "";

      if (hasAnswer) {
        answered += 1;
      }

      let isCorrect = false;
      if (typeof item.correct === "boolean") {
        isCorrect = item.correct;
      } else if (
        typeof item.correctIndex === "number" &&
        typeof item.chosenIndex === "number"
      ) {
        isCorrect = item.chosenIndex === item.correctIndex;
      }
      if (isCorrect) {
        correct += 1;
      }

      if (typeof item.timeSpentSec === "number") {
        timeSpentSec += item.timeSpentSec;
      }
    });

    const scorePercent =
      total > 0 ? Math.round((correct / total) * 100) : 0;

    return { answered, correct, total, timeSpentSec, scorePercent };
  }

  function normalizeAttemptSummary(summary) {
    const safe = summary || {};
    const defaultSectionId = getDefaultSectionId();
    const defaultTitle = getDefaultTitle();

    const sectionId = safe.sectionId || defaultSectionId || null;
    const title = safe.title || defaultTitle || null;
    const items = Array.isArray(safe.items) ? safe.items : [];

    // Normalize totals
    let totals = safe.totals || {};
    if (
      typeof totals.answered !== "number" ||
      typeof totals.correct !== "number" ||
      typeof totals.total !== "number"
    ) {
      totals = computeTotalsFromItems(items);
    } else {
      const computed = computeTotalsFromItems(items);
      if (typeof totals.timeSpentSec !== "number") {
        totals.timeSpentSec = computed.timeSpentSec;
      }
      if (typeof totals.scorePercent !== "number") {
        totals.scorePercent = computed.scorePercent;
      }
    }

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

    return {
      ...safe,
      sectionId,
      title,
      items,
      totals,
      uiState
    };
  }

  // -----------------------------
  // 6. Firestore helpers — completed attempts
  // -----------------------------
  //
  // Firestore document shape:
  // users/{uid}/examAttempts/{autoId}
  //   attemptId: "t_..."
  //   sectionId: "...",
  //   title: "...",
  //   timestamp: "ISO string"
  //   scorePercent: number
  //   durationSeconds: number
  //   totals: { answered, correct, total, timeSpentSec, scorePercent }
  //   items:  [ { number, id, correctIndex, chosenIndex, correct, ... } ]
  //   uiState: { timerHidden, reviewMode, lastQuestionIndex }
  //   userId: uid
  //   createdAt: serverTimestamp()
  //

  async function appendAttempt(summary) {
    // Normalize and always log a local record.
    const normalized = normalizeAttemptSummary(summary);

    const localRecord = upsertLocalAttemptFromSummary(normalized, {
      synced: false
    });

    const attemptId = localRecord.id;
    normalized.attemptId = attemptId;

    const sectionId = normalized.sectionId || getDefaultSectionId();
    const title = normalized.title || getDefaultTitle();

    if (!sectionId) {
      console.warn(
        "quiz-data.appendAttempt: No sectionId found. " +
          "Set summary.sectionId or window.examConfig.sectionId."
      );
    }

    // Enrich with core recorder fields for Firestore
    const timestamp = localRecord.timestamp;
    const scorePercent = localRecord.scorePercent;
    const durationSeconds = localRecord.durationSeconds;

    let user;
    try {
      user = await requireUser();
    } catch (e) {
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
      const payload = {
        ...normalized,
        attemptId,
        sectionId: sectionId || null,
        title: title || null,
        userId: user.uid,
        timestamp,
        scorePercent,
        durationSeconds,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      const ref = db
        .collection("users")
        .doc(user.uid)
        .collection("examAttempts")
        .doc(); // auto id

      await ref.set(payload);

      // Mark local record as synced:true
      upsertLocalAttemptFromSummary(normalized, { synced: true });

      return {
        attemptId,
        synced: true,
        docId: ref.id
      };
    } catch (e) {
      console.warn(
        "quiz-data.appendAttempt: Firestore write failed, local record kept as synced:false",
        e
      );
      return {
        attemptId,
        synced: false,
        error: e && e.message ? e.message : String(e)
      };
    }
  }

  async function loadResultsForSection(sectionId) {
    const user = await requireUser();
    const effectiveSectionId = sectionId || getDefaultSectionId();

    if (!effectiveSectionId) {
      throw new Error(
        "quiz-data.loadResultsForSection: No sectionId provided and none found in examConfig."
      );
    }

    const snap = await db
      .collection("users")
      .doc(user.uid)
      .collection("examAttempts")
      .where("sectionId", "==", effectiveSectionId)
      .orderBy("createdAt", "desc")
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function loadAllResultsForUser() {
    const user = await requireUser();

    const snap = await db
      .collection("users")
      .doc(user.uid)
      .collection("examAttempts")
      .orderBy("createdAt", "desc")
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // -----------------------------
  // 7. Firestore helpers — in-progress session
  // -----------------------------

  async function saveSessionProgress(progressState) {
    if (!progressState) return;

    const user = await requireUser();
    const exam = getExamConfig();

    const sectionId =
      progressState.sectionId ||
      (exam && exam.sectionId) ||
      null;
    const title =
      progressState.title ||
      (exam && exam.sectionTitle) ||
      null;

    if (!sectionId) {
      console.warn(
        "quiz-data.saveSessionProgress: No sectionId found. " +
          "Set progressState.sectionId or window.examConfig.sectionId."
      );
      return;
    }

    const payload = {
      sectionId,
      title,
      lastQuestionId: progressState.lastQuestionId ?? null,
      lastQuestionIndex:
        typeof progressState.lastQuestionIndex === "number"
          ? progressState.lastQuestionIndex
          : null,
      lastScreenIndex:
        typeof progressState.lastScreenIndex === "number"
          ? progressState.lastScreenIndex
          : null,
      timerHidden: !!progressState.timerHidden,
      questionCountHidden: !!progressState.questionCountHidden,
      reviewMode: !!progressState.reviewMode,
      answers: progressState.answers || {},
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const ref = db
      .collection("users")
      .doc(user.uid)
      .collection("examSessions")
      .doc(sectionId);

    await ref.set(payload, { merge: true });
    return ref.id;
  }

  async function loadSessionProgress(sectionId) {
    const user = await requireUser();
    const effectiveSectionId = sectionId || getDefaultSectionId();

    if (!effectiveSectionId) {
      throw new Error(
        "quiz-data.loadSessionProgress: No sectionId provided and none found in examConfig."
      );
    }

    const ref = db
      .collection("users")
      .doc(user.uid)
      .collection("examSessions")
      .doc(effectiveSectionId);

    const snap = await ref.get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  async function clearSessionProgress(sectionId) {
    const user = await requireUser();
    const effectiveSectionId = sectionId || getDefaultSectionId();

    if (!effectiveSectionId) {
      console.warn(
        "quiz-data.clearSessionProgress: No sectionId provided and none found in examConfig."
      );
      return;
    }

    const ref = db
      .collection("users")
      .doc(user.uid)
      .collection("examSessions")
      .doc(effectiveSectionId);

    await ref.delete();
  }

  async function logReviewChanges(sectionId, changes) {
    const user = await requireUser();
    if (!Array.isArray(changes) || changes.length === 0) return;

    const effectiveSectionId = sectionId || getDefaultSectionId();
    if (!effectiveSectionId) {
      console.warn(
        "quiz-data.logReviewChanges: No sectionId provided and none found in examConfig."
      );
      return;
    }

    const batch = db.batch();

    changes.forEach((change) => {
      const ref = db
        .collection("users")
        .doc(user.uid)
        .collection("examSessions")
        .doc(effectiveSectionId)
        .collection("reviewChanges")
        .doc();

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
        changedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      batch.set(ref, payload);
    });

    await batch.commit();
  }

  // -----------------------------
  // 8. Export attempts (local + remote)
  // -----------------------------

  async function exportAttempts() {
    const local = loadLocalAttempts();
    let remote = [];

    try {
      remote = await loadAllResultsForUser();
    } catch (e) {
      console.warn(
        "quiz-data.exportAttempts: could not load remote results, exporting local only",
        e
      );
    }

    const data = {
      generatedAt: new Date().toISOString(),
      localAttempts: local,
      remoteAttempts: remote
    };

    try {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dreamschool-attempts-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("quiz-data.exportAttempts: failed to export", e);
    }
  }

  // -----------------------------
  // 9. Section stats / latest attempt helpers
  // -----------------------------
  // These are for preview/progress pages.

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
      const p = typeof r.scorePercent === "number" ? r.scorePercent : null;
      if (p !== null) {
        if (bestPercent === null || p > bestPercent) bestPercent = p;
        sumPercent += p;
        lastPercent = idx === 0 ? p : lastPercent; // assume sorted newest first if you pass it that way
      }
      if (idx === 0 && r.timestamp) {
        lastTakenAt = r.timestamp;
      }
    });

    const avgPercent = bestPercent === null ? null : Math.round(sumPercent / count);

    return {
      count,
      bestPercent,
      avgPercent,
      lastPercent,
      lastTakenAt
    };
  }

  async function loadSectionStats(sectionId) {
    const effectiveSectionId = sectionId || getDefaultSectionId();
    if (!effectiveSectionId) {
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

    // Try remote first; fall back to local if not signed in or no remote data.
    let remote = [];
    let remoteError = null;

    try {
      const user = await requireUser();
      const snap = await db
        .collection("users")
        .doc(user.uid)
        .collection("examAttempts")
        .where("sectionId", "==", effectiveSectionId)
        .orderBy("createdAt", "desc")
        .get();

      remote = snap.docs.map((d) => d.data());
    } catch (e) {
      remoteError = e;
      dbg("loadSectionStats: remote fetch failed, will try local", e);
    }

    if (remote && remote.length > 0) {
      const stats = computeStatsFromAttemptList(remote);
      return {
        sectionId: effectiveSectionId,
        source: "remote",
        ...stats
      };
    }

    // Local fallback
    const local = loadLocalAttempts()
      .filter((a) => a.sectionId === effectiveSectionId)
      .sort((a, b) => {
        const ta = a.timestamp || "";
        const tb = b.timestamp || "";
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });

    const stats = computeStatsFromAttemptList(local);
    return {
      sectionId: effectiveSectionId,
      source: remoteError ? "local-offline" : "local",
      ...stats
    };
  }

  async function loadLatestAttemptForSection(sectionId) {
    const effectiveSectionId = sectionId || getDefaultSectionId();
    if (!effectiveSectionId) return null;

    // Remote first
    try {
      const user = await requireUser();
      const snap = await db
        .collection("users")
        .doc(user.uid)
        .collection("examAttempts")
        .where("sectionId", "==", effectiveSectionId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      if (!snap.empty) {
        const doc = snap.docs[0];
        return { id: doc.id, source: "remote", ...doc.data() };
      }
    } catch (e) {
      dbg("loadLatestAttemptForSection: remote failed, trying local", e);
    }

    // Fallback to local history
    const local = loadLocalAttempts()
      .filter((a) => a.sectionId === effectiveSectionId)
      .sort((a, b) => {
        const ta = a.timestamp || "";
        const tb = b.timestamp || "";
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });

    if (local.length === 0) return null;

    return { source: "local", ...local[0] };
  }

  // -----------------------------
  // 10. Compatibility API: recordTestResult
  // -----------------------------
  //
  // Thin wrapper so legacy pages can call:
  // quizData.recordTestResult({ score, total, durationSeconds, category, answers })
  // and it will go through the new appendAttempt pipeline.

  async function recordTestResult({
    score,
    total,
    durationSeconds = 0,
    category = "General",
    answers = []
  } = {}) {
    if (typeof score !== "number" || typeof total !== "number") {
      throw new Error("recordTestResult: score and total must be numbers");
    }

    const scorePercent =
      total > 0 ? Math.round((score / total) * 100) : 0;

    const items = Array.isArray(answers)
      ? answers.map((a, idx) => {
          const chosen =
            typeof a.chosenIndex === "number"
              ? a.chosenIndex
              : typeof a.answer === "number"
              ? a.answer
              : null;
          const correctIndex =
            typeof a.correctIndex === "number"
              ? a.correctIndex
              : null;
          let correctFlag = false;
          if (typeof a.correct === "boolean") {
            correctFlag = a.correct;
          } else if (
            chosen !== null &&
            correctIndex !== null
          ) {
            correctFlag = chosen === correctIndex;
          }

          return {
            number: idx + 1,
            id: a.qid || "q" + (idx + 1),
            correctIndex,
            chosenIndex: chosen,
            correct: correctFlag
          };
        })
      : [];

    const summary = {
      attemptId: createAttemptId(),
      sectionId: category,
      title: category,
      generatedAt: new Date().toISOString(),
      totals: {
        answered: total,
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

    return appendAttempt(summary);
  }

  // -----------------------------
  // 11. Expose API
  // -----------------------------
  //
  // quiz-engine.js can use:
  //   quizData.appendAttempt(summary)
  //   quizData.saveSessionProgress(progressState)
  //   quizData.loadSessionProgress(sectionId?)
  //   quizData.clearSessionProgress(sectionId?)
  //   quizData.logReviewChanges(sectionId?, changes)
  //
  // Practice / preview / debug pages can use:
  //   quizData.loadResultsForSection(sectionId?)
  //   quizData.loadAllResultsForUser()
  //   quizData.loadSectionStats(sectionId?)
  //   quizData.loadLatestAttemptForSection(sectionId?)
  //   quizData.getLocalAttempts()
  //   quizData.clearLocalAttempts()
  //   quizData.exportAttempts()
  //
  // Legacy-style:
  //   quizData.recordTestResult({ score, total, ... })

  window.quizData = {
    VERSION: "1.1.0",
    auth,
    db,
    requireUser,
    waitForAuthReady,

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

    // Recorder-style helpers
    exportAttempts,
    getLocalAttempts: loadLocalAttempts,
    clearLocalAttempts,

    // Legacy
    recordTestResult
  };
})();
