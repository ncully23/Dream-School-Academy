// quiz-data.js
// Handles exam metadata AND Firebase persistence for results, statistics,
// and in-progress session state (inspired by PR's progress script).

(function () {
  // -----------------------------
  // 1. Firebase setup
  // -----------------------------
  //
  // REQUIREMENT in your HTML *before* this file:
  //
  // <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
  // <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
  // <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
  // <script src="/assets/js/quiz-data.js"></script>
  // <script src="/assets/js/quiz-engine.js"></script>
  //
  // Fill in your own config from the Firebase console:
  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  // -----------------------------
  // 2. Exam definition for this module
  // -----------------------------

  // Unique id for this section/module
  const SECTION_ID = "s1_m1_reading_writing";

  // This object is what quiz-engine.js consumes:
  // quiz-engine is responsible for:
  // - rendering questions
  // - tracking current index
  // - building progressState / summary objects
  window.examConfig = {
    sectionId: SECTION_ID,
    sectionTitle: "Section 1, Module 1: Reading and Writing",
    timeLimitSec: 32 * 60,                   // 32 minutes (or 35*60 if you prefer)
    storageKey: `quizState_${SECTION_ID}`,   // where quiz-engine saves state in localStorage
    summaryKey: `quizSummary_${SECTION_ID}`, // where finishExam() stores summary in localStorage
    summaryHref: "/progress/section1-module1.html", // redirect after Finish

    // Optional meta you can use in quiz-engine for UI:
    testType: "SAT",
    sectionType: "Normal",   // fits PR-style semantics if you ever generalize
    adaptive: false,

    // SAT-style questions
    questions: [
      {
        id: "rw_q1",
        prompt: `Although critics believed that customers would never agree to pay to pick their own produce on farms, such concerns didn’t _____ Booker T. Whatley’s efforts to promote the practice. Thanks in part to Whatley’s determined advocacy, farms that allow visitors to pick their own apples, pumpkins, and other produce can be found throughout the United States.`,
        choices: [
          "enhance",
          "hinder",
          "misrepresent",
          "aggravate"
        ],
        answerIndex: 1, // 0 = A, 1 = B, etc.
        explanation:
          "Critics’ concerns did not stop or obstruct his efforts, so “hinder” is the best fit."
      }

      // Add more questions here...
      // {
      //   id: "rw_q2",
      //   prompt: "…",
      //   choices: ["A", "B", "C", "D"],
      //   answerIndex: 2,
      //   explanation: "…"
      // }
    ]
  };

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
    const sectionId = safe.sectionId || SECTION_ID;
    const title = safe.title || window.examConfig.sectionTitle;
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

    // 🔹 New: normalize summary so your DB always has totals and uiState.
    const normalized = normalizeAttemptSummary(summary);

    const payload = {
      ...normalized,
      sectionId: normalized.sectionId || SECTION_ID,
      title: normalized.title || window.examConfig.sectionTitle,
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
  async function loadResultsForSection(sectionId = SECTION_ID) {
    const user = await requireUser();

    const snap = await db
      .collection("users")
      .doc(user.uid)
      .collection("examAttempts")
      .where("sectionId", "==", sectionId)
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
  // Here we mirror the "save progress / update time spent editing" ideas from PR,
  // but in a simpler SAT-focused way.
  //
  // Structure for IN-PROGRESS sessions:
  //
  // users/{uid}/examSessions/{sectionId}
  //   sectionId: "s1_m1_reading_writing"
  //   title: "Section 1, Module 1: Reading and Writing"
  //   lastQuestionId: "rw_q3"
  //   lastQuestionIndex: 2
  //   lastScreenIndex: 0              // if you ever use "screens"/pages
  //   timerHidden: false
  //   questionCountHidden: false      // hook if you want to hide question count UI
  //   reviewMode: false
  //   answers: {
  //     rw_q1: {
  //       chosenIndex: 1,
  //       correctIndex: 1,
  //       isCorrect: true,
  //       flagged: false,
  //       timeSpentSecTotal: 18,
  //       // optional: lastReviewDurationSec, lastUpdatedAt, etc.
  //     },
  //     ...
  //   }
  //   updatedAt: serverTimestamp()
  //   createdAt: serverTimestamp()
  //
  // And an OPTIONAL review-change log:
  //
  // users/{uid}/examSessions/{sectionId}/reviewChanges/{autoId}
  //   questionId: "rw_q1"
  //   oldAnswerIndex: 0
  //   newAnswerIndex: 1
  //   durationSeconds: 12
  //   changedAt: serverTimestamp()
  //

  /**
   * Save or update in-progress session state for this section.
   *
   * quiz-engine.js should build and pass a "progressState" object, e.g.:
   *
   * {
   *   sectionId: "s1_m1_reading_writing",
   *   title: "Section 1, Module 1: Reading and Writing",
   *   lastQuestionId: "rw_q5",
   *   lastQuestionIndex: 4,
   *   lastScreenIndex: 0,        // optional
   *   timerHidden: false,
   *   questionCountHidden: false,
   *   reviewMode: false,
   *   answers: {
   *     rw_q1: {
   *       chosenIndex: 1,
   *       flagged: false,
   *       correctIndex: 1,
   *       isCorrect: true,
   *       timeSpentSecTotal: 15
   *     },
   *     ...
   *   }
   * }
   */
  async function saveSessionProgress(progressState) {
    if (!progressState) return;

    const user = await requireUser();

    const sectionId = progressState.sectionId || SECTION_ID;
    const title = progressState.title || window.examConfig.sectionTitle;

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
  async function loadSessionProgress(sectionId = SECTION_ID) {
    const user = await requireUser();

    const ref = db
      .collection("users")
      .doc(user.uid)
      .collection("examSessions")
      .doc(sectionId);

    const snap = await ref.get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  }

  /**
   * Clear/remove the in-progress session doc when the exam is finished
   * (optional, but keeps things tidy if you want sessions only while active).
   */
  async function clearSessionProgress(sectionId = SECTION_ID) {
    const user = await requireUser();

    const ref = db
      .collection("users")
      .doc(user.uid)
      .collection("examSessions")
      .doc(sectionId);

    await ref.delete();
  }

  /**
   * Log one or more "review changes" (old vs new answer with time spent),
   * inspired by PR's _updateQuestionReviewTime.
   *
   * quiz-engine.js can call this with an array like:
   *
   * [
   *   {
   *     questionId: "rw_q1",
   *     oldAnswerIndex: 0,       // or null if no previous answer
   *     newAnswerIndex: 1,       // index of chosen option
   *     durationSeconds: 12
   *   },
   *   ...
   * ]
   */
  async function logReviewChanges(sectionId, changes) {
    const user = await requireUser();
    if (!Array.isArray(changes) || changes.length === 0) return;

    const effectiveSectionId = sectionId || SECTION_ID;

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
  //   quizData.loadSessionProgress()
  //   quizData.logReviewChanges(sectionId, changes)
  //
  // Progress pages can use:
  //   quizData.loadResultsForSection()
  //   quizData.loadAllResultsForUser()
  //
  window.quizData = {
    auth,
    db,
    SECTION_ID,
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
