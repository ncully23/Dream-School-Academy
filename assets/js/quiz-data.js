// quiz-data.js
// Handles Firebase persistence for results, statistics,
// and in-progress session state (inspired by PR's progress script).
//
// This version is UNIVERSAL: it does NOT define window.examConfig.
// Each quiz page should define its own examConfig, for example:
//
// Then include:
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
// <script src="/assets/js/quiz-data.js"></script>
// <script src="/assets/js/quiz-engine.js"></script>

(function () {
  // -----------------------------
  // 1. Firebase setup
  // -----------------------------

  // Fill in your own config from the Firebase console:
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

  // Small helpers to pull section info from various places
  function getExamConfig() {
    return (typeof window !== "undefined" && window.examConfig) ? window.examConfig : {};
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
  // 3. Helper: ensure we have a logged-in user
  // -----------------------------
  // Returns a Promise that resolves with the current user.
  // Rejects if no one is signed in.
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

  // -----------------------------
  // 4. Helpers for scoring/summary normalization
  // -----------------------------
  // These helpers make sure that when quiz-engine passes a "summary",
  // your database always gets:
  // - totals (answered, correct, total, timeSpentSec, scorePercent)
  // - items[] with per-question correctness
  // - uiState captured in a consistent shape

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
    let total = items.length;
    let timeSpentSec = 0;

    items.forEach((item) => {
      const hasAnswer =
        item.chosenIndex !== null &&
        item.chosenIndex !== undefined &&
        item.chosenIndex !== "";
      if (hasAnswer) {
        answered += 1;
      }

      // Prefer explicit "correct" boolean if provided; otherwise infer
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

  /**
   * Normalize a raw summary from quiz-engine into a consistent shape.
   *
   * Expected input (quiz-engine builds this):
   * {
   *   sectionId?: string,
   *   title?: string,
   *   totals?: { answered, correct, total, timeSpentSec, scorePercent? },
   *   items: [
   *     {
   *       number: 1,
   *       id: "rw_q1",
   *       correctIndex: 1,
   *       chosenIndex: 1,
   *       correct: true,
   *       flagged: false,
   *       timeSpentSec: 12
   *     },
   *     ...
   *   ],
   *   uiState?: { timerHidden, reviewMode, lastQuestionIndex },
   *   // optional convenience fields quiz-engine might pass:
   *   timerHidden?: boolean,
   *   reviewMode?: boolean,
   *   lastQuestionIndex?: number
   * }
   */
  function normalizeAttemptSummary(summary) {
    const safe = summary || {};
    const exam = getExamConfig();
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
      // Ensure timeSpentSec and scorePercent exist even if quiz-engine didn't set them.
      const computed = computeTotalsFromItems(items);
      if (typeof totals.timeSpentSec !== "number") {
        totals.timeSpentSec = computed.timeSpentSec;
      }
      if (typeof totals.scorePercent !== "number") {
        totals.scorePercent = computed.scorePercent;
      }
    }

    // Normalize uiState: prefer explicit uiState if provided,
    // fall back to top-level fields if present.
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
  // 5. Firestore helpers — completed attempts
  // -----------------------------
  //
  // Structure used in Firestore for FINISHED attempts:
  //
  // users/{uid}/examAttempts/{autoId}
  //   sectionId: "s1_m1_reading_writing"
  //   title: "Section 1, Module 1: Reading and Writing"
  //   totals: { answered, correct, total, timeSpentSec, scorePercent }
  //   items:  [ { number, id, correctIndex, chosenIndex, correct, flagged, timeSpentSec, ... } ]
  //   uiState: { timerHidden, reviewMode, lastQuestionIndex }
  //   createdAt: serverTimestamp()
  //

  async function appendAttempt(summary) {
    const user = await requireUser();

    const normalized = normalizeAttemptSummary(summary);
    const exam = getExamConfig();

    const sectionId = normalized.sectionId || getDefaultSectionId();
    const title = normalized.title || getDefaultTitle();

    if (!sectionId) {
      console.warn(
        "quiz-data.appendAttempt: No sectionId found. " +
        "Set summary.sectionId or window.examConfig.sectionId."
      );
    }

    const payload = {
      ...normalized,
      sectionId: sectionId || null,
      title: title || null,
      userId: user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const ref = db
      .collection("users")
      .doc(user.uid)
      .collection("examAttempts")
      .doc(); // auto id

    await ref.set(payload);
    return ref.id;
  }

  // Load all attempts for THIS section for the logged-in user
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

  // Load ALL exam attempts for this user (for a big progress dashboard)
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
  // 6. Firestore helpers — in-progress session (PR-style progress)
  // -----------------------------
  //
  // Structure for IN-PROGRESS sessions:
  //
  // users/{uid}/examSessions/{sectionId}
  //   sectionId: "s1_m1_reading_writing"
  //   title: "Section 1, Module 1: Reading and Writing"
  //   lastQuestionId: "rw_q3"
  //   lastQuestionIndex: 2
  //   lastScreenIndex: 0
  //   timerHidden: false
  //   questionCountHidden: false
  //   reviewMode: false
  //   answers: { ... }
  //   updatedAt: serverTimestamp()
  //   createdAt: serverTimestamp()
  //

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
      // answers should be a plain object map; we merge it.
      answers: progressState.answers || {},
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      // only set createdAt on first write (merge will preserve existing)
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const ref = db
      .collection("users")
      .doc(user.uid)
      .collection("examSessions")
      .doc(sectionId);

    // merge: do not wipe out older fields if you only send partial updates
    await ref.set(payload, { merge: true });
    return ref.id;
  }

  /**
   * Load in-progress session progress for this section (or any given sectionId).
   * Returns the document data or null if none exists.
   */
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

  /**
   * Clear/remove the in-progress session doc when the exam is finished
   * (optional, but keeps things tidy if you want sessions only while active).
   */
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

  /**
   * Log one or more "review changes" (old vs new answer with time spent),
   * inspired by PR's _updateQuestionReviewTime.
   */
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
        .doc(); // auto id

      const payload = {
        questionId: change.questionId || null,
        subQuestionId: change.subQuestionId || null, // optional hook if you ever support sub-questions
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
  // 7. Expose an API for quiz-engine + progress pages
  // -----------------------------
  //
  // quiz-engine.js can use:
  //   quizData.appendAttempt(summary)
  //   quizData.saveSessionProgress(progressState)
  //   quizData.loadSessionProgress(sectionId?)
  //   quizData.clearSessionProgress(sectionId?)
  //   quizData.logReviewChanges(sectionId?, changes)
  //
  // Progress pages can use:
  //   quizData.loadResultsForSection(sectionId?)
  //   quizData.loadAllResultsForUser()
  //
  window.quizData = {
    auth,
    db,
    requireUser,

    // Finished attempts
    appendAttempt,
    loadResultsForSection,
    loadAllResultsForUser,

    // In-progress sessions
    saveSessionProgress,
    loadSessionProgress,
    clearSessionProgress,
    logReviewChanges
  };
})();
