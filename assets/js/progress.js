// /assets/js/progress.js
// "My Progress" page:
//
// Primary source of truth: Firestore attempts saved by attempt-writer.js:
//   users/{uid}/attempts/{attemptId}
//
// Diagnostics only:
// - Counts localStorage keys dsa:attempt:* (unsynced attempts)
// - Reads dsa:lastWrite (last write error/status written by attempt-writer)
//
// UI:
// - Hyperlink on quiz title -> /pages/review.html?attemptId=...
// - Renders 7 columns by default (adds Type badge):
//   Date | Type | Quiz | Score | Total | % Correct | Duration
//
// If your table is still 6 columns, set INCLUDE_TYPE_COL=false below
// or update your HTML header to include the Type column.



// IIFE: function is defined & executed immediately
// helps organize code by keeping initialization logic self-contained and controlled
(function () {
  "use strict"; // creates a private scope: variables inside it don't affect or conflict with other scripts

  if (window.__dsa_progress_initialized) return; // prevents the script from running more than once
  window.__dsa_progress_initialized = true; // sets a global flag so future executions know the script already ran
/*
protects against duplicate initialization, which can happen if the script is loaded multiple times
Everything inside the IIFE runs immediately after the file is loaded, before waiting for DOM events.
*/

  // ---------
  // Config
  // ---------
  const INCLUDE_TYPE_COL = true; // set false if your HTML table has only 6 columns
  // defines a constant flag that controls whether the "Type" column is shown in the table
  // because it is true, the script will include that column when rendering
  const PRIMARY_SUBCOL = "attempts"; // defines the main Firestore subcollection name where the script expects to find user attempt data (users/{uid}/attempts).
  const FALLBACK_SUBCOLS = ["examAttempts", "results"]; // legacy/optional subcollection names checked only if the primary one returns no data — useful for older accounts with data stored under different names
  const MAX_DOCS = 300; // sets a limit on how many documents (attempts) the script will fetch from Firestore to avoid loading too much data at once.

  document.addEventListener("DOMContentLoaded", function () { // tells the browser to run the enclosed function only after the HTML document has fully loaded and the DOM is ready
    const summaryEl = document.getElementById("summary");  // finds the HTML element with ID "summary" and stores a reference to it for later use when rendering summary data
    const historyTable = document.getElementById("historyTable"); // finds the HTML element with ID "historyTable" and stores a reference to it — this is the table that will display the user's quiz history
    const historyBody = // tries to find the <tbody> element where rows will be inserted
      document.getElementById("historyBody") ||    // first attempts to grab a tbody by its explicit ID "historyBody"
      (historyTable ? historyTable.querySelector("tbody") : null); // if that does not exist, it falls back to finding the <tbody> inside historyTable, or null if historyTable itself is missing.
    
    const loadingEl = document.getElementById("progressLoading"); // gets the element used to show a loading indicator while data is being fetched.
    const bannerEl = document.getElementById("unsyncedBanner"); // gets the element used to display messages or warnings to the user (such as errors or unsynced data).

    if (!summaryEl || !historyBody) return; // safety check: if either of the essential elements is missing from the page, stop running because there's nothing to render into

    const state = { attempts: [] }; // creates a local state object that stores an array of attempts, which will later be filled with data from Firestore and used for rendering.

    // -----------------------------
    // UI helpers
    // -----------------------------

    function showBanner(kind, text) { // defines a function that takes a style type (kind) and a message (text) as inputs
      if (!bannerEl) return; // checks if the banner element exists, and stops the function if it does not to prevent errors
      bannerEl.classList.remove("warning", "success", "info", "error"); // removes any existing status classes so old styles do not remain on the element
      if (kind) bannerEl.classList.add(kind); // adds a new class to the banner if a kind value is provided
      bannerEl.textContent = text || ""; // sets the visible text of the banner, using an empty string if no text is provided
      bannerEl.style.display = text ? "block" : "none"; // shows the banner if text exists and hides it if there is no text.
    }

    function setLoading(isLoading) { // defines a function that takes a boolean value to control loading visibility
      if (!loadingEl) return; // checks if the loading element exists and stops execution if it does not.
      loadingEl.style.display = isLoading ? "block" : "none"; // shows the loading indicator when isLoading is true and hides it when false.
    }

    function escapeHtml(str) { // defines a helper function that converts unsafe characters into HTML entities to prevent cross-site-scripting (XSS) when injecting user data into innerHTML
      if (str == null) return ""; // checks if the input is null or undefined and returns an empty string if so
      return String(str).replace(/[&<>"']/g, (m) => { // converts the input to a string and replaces all special HTML characters using a regular expression.
        return { // looks up each matched character in this small mapping object to find its HTML-safe equivalent
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m]; // returns the correct escaped value based on the matched character
      }); // completes the replace operation and returns the fully escaped string
    }

    function buildReviewHref(attemptId) { // builds the URL string used to link a quiz row to its detailed review page
      return `/pages/review.html?attemptId=${encodeURIComponent(attemptId)}`; // uses encodeURIComponent so any special characters in the attemptId are safely encoded for use in a URL
    }

    function toDateMaybe(ts) { // converts many possible "timestamp" formats into a real JavaScript Date object, returning null if conversion fails
      if (!ts) return null; // if the input is missing/falsy, return null immediately
      if (ts instanceof Date) return ts; // if it's already a Date object, return it as-is

      if (typeof ts === "string") { // handles ISO date strings like "2025-01-15T10:30:00Z"
        const d = new Date(ts); // attempt to parse the string into a Date
        return Number.isNaN(d.getTime()) ? null : d; // if parsing produced an invalid date, return null; otherwise return the Date
      }

      // Firestore Timestamp
      if (typeof ts?.toDate === "function") { // Firestore returns special Timestamp objects that have a .toDate() method to convert them into native Dates
        try {
          const d = ts.toDate(); // attempt the conversion
          return d instanceof Date ? d : null; // verify the result is actually a Date before returning
        } catch {
          return null; // swallow any errors during conversion and return null
        }
      }

      // Some code stores ms epoch
      if (typeof ts === "number") { // handles cases where the timestamp is stored as a number of milliseconds since 1970
        const d = new Date(ts); // build a Date directly from that number
        return Number.isNaN(d.getTime()) ? null : d; // validate before returning
      }

      return null; // fallback: if none of the above formats matched, give up and return null
    }

    function secToHMS(sec) { // converts a number of seconds into a human-readable "Xh Ym Zs" formatted string
      const n = Number(sec); // coerce the input to a number in case it came in as a string
      if (!Number.isFinite(n) || n <= 0) return "—"; // if the value isn't a real positive number, show an em-dash placeholder
      const h = Math.floor(n / 3600); // calculate whole hours
      const m = Math.floor((n % 3600) / 60); // calculate remaining whole minutes
      const s = Math.floor(n % 60); // calculate remaining whole seconds
      if (h) return `${h}h ${m}m ${s}s`; // if there are hours, format with all three units
      if (m) return `${m}m ${String(s).padStart(2, "0")}s`; // if only minutes, pad seconds with a leading zero for a clean look
      return `${s}s`; // for very short durations, just show seconds
    }

    function computePercent(correct, total) { // calculates a percentage from "correct out of total" while guarding against bad inputs
      const c = Number(correct); // coerce correct to a number
      const t = Number(total); // coerce total to a number
      if (!Number.isFinite(t) || t <= 0) return 0; // can't divide by zero or non-numbers — return 0% as a safe default
      if (!Number.isFinite(c) || c < 0) return 0; // negative or invalid correct counts also default to 0%
      return Math.round((c / t) * 1000) / 10; // multiply by 1000 then divide by 10 to get a percentage rounded to one decimal place
    }

    function isPermissionDenied(err) { // detects whether a thrown error came from Firestore security rules blocking access
      const msg = String((err && err.message) || "").toLowerCase(); // safely grab and lowercase the error message
      const code = String((err && err.code) || "").toLowerCase(); // safely grab and lowercase the error code
      return ( // return true if any of these signature patterns match
        code === "permission-denied" ||
        msg.includes("missing or insufficient permissions") ||
        msg.includes("permission denied")
      );
    }

    function isNotSignedIn(err) { // detects whether a thrown error indicates the user isn't authenticated
      const msg = String((err && err.message) || "").toLowerCase(); // same defensive lowercasing pattern as above
      const code = String((err && err.code) || "").toLowerCase();
      return ( // return true on any of these auth-related signatures
        code === "auth/no-current-user" ||
        code === "auth/unauthorized" ||
        msg.includes("not signed in") ||
        msg.includes("no user")
      );
    }

    // -----------------------------
    // Local diagnostics (unsynced attempts + last write error)
    // -----------------------------

    function countLocalAttemptKeys() { // counts how many quiz attempts are stored only in this browser's localStorage (i.e., not yet synced to Firestore)
      try {
        let n = 0; // running tally
        for (let i = 0; i < localStorage.length; i++) { // iterate over every key in localStorage
          const k = localStorage.key(i); // get the key at index i
          if (k && k.startsWith("dsa:attempt:")) n++; // count it if it matches the app's attempt-key naming convention
        }
        return n;
      } catch {
        return 0; // if localStorage access throws (e.g., private browsing), just report zero
      }
    }

    function readLastWrite() { // reads diagnostic info that attempt-writer.js leaves behind about its most recent save attempt
      // attempt-writer.js should set something like:
      // localStorage.setItem("dsa:lastWrite", JSON.stringify({ ok, code, message, at, attemptId }))
      try {
        const raw = localStorage.getItem("dsa:lastWrite"); // grab the raw JSON string from localStorage
        if (!raw) return null; // nothing recorded yet
        const obj = JSON.parse(raw); // parse the JSON into an object
        if (!obj || typeof obj !== "object") return null; // sanity-check that we actually got an object
        return obj;
      } catch {
        return null; // if anything fails (corrupted JSON, no access), return null
      }
    }

    // -----------------------------
    // Firebase bootstrap
    // -----------------------------

    async function getFirebaseApis() { // async helper that loads and bundles all Firebase functionality this page needs
      const mod = await import("/assets/js/firebase-init.js"); // uses a dynamic import to asynchronously load the local JavaScript module at the path /assets/js/firebase-init.js, pausing execution until the module is fully loaded, and then assigns the entire module namespace object to the constant mod.
      const { auth, db, authReady } = mod; // destructure the three exports we need: the Auth instance, the Firestore DB instance, and a Promise that resolves once auth has finished initializing

      const fs = await import( // dynamically load the Firestore SDK from Google's CDN
        "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js"
      );
      const { // pull out only the Firestore functions this script actually uses
        collection,
        getDocs,
        orderBy,
        limit,
        query,
      } = fs;

      return { auth, db, authReady, collection, getDocs, orderBy, limit, query }; // return everything as a single tidy object so the rest of the code has one place to grab Firebase tools
    }

    async function requireSignedInUserOrThrow(firebase) { // gatekeeper function that ensures a user is signed in before continuing
      await firebase.authReady; // wait for Firebase auth to finish restoring any existing session — prevents false "no user" results
      const user = firebase.auth.currentUser; // grab the current user once auth is ready
      if (user) return user; // happy path: user is signed in, return them
      const e = new Error("Not signed in"); // otherwise build an error object
      e.code = "auth/no-current-user"; // attach a Firebase-style code so callers can identify this specific failure
      throw e; // throw it — this also rejects the Promise this async function returns
    }

    // -----------------------------
    // Attempt normalization (match attempt-writer schema)
    // -----------------------------

    function normalizeAttempt(raw, fallbackDocId) { // converts a raw Firestore document into a consistent shape the rest of the code can rely on, gracefully handling old/new schema differences
      const a = raw || {}; // safe alias — if raw is null/undefined, use an empty object
      const totals = a.totals || {}; // newer schema groups score data under a "totals" object
      const items = Array.isArray(a.items) ? a.items : []; // newer schema includes per-question items in an array

      const total = Number.isFinite(totals.total) // prefer totals.total if it's a real number
        ? totals.total
        : (Number(a.total ?? a.numQuestions ?? items.length) || 0); // otherwise fall back through several legacy field names, finally defaulting to 0

      const correct = Number.isFinite(totals.correct) // same prefer-then-fallback pattern for the count of correct answers
        ? totals.correct
        : (Number(a.correct ?? a.numCorrect ?? a.score) || 0);

      const answered = Number.isFinite(totals.answered) // count of questions the user actually answered (not skipped)
        ? totals.answered
        : (Number(a.answered ?? items.length) || items.length);

      const durationSeconds = Number.isFinite(totals.timeSpentSec) // how long the quiz took
        ? totals.timeSpentSec
        : (Number(a.timeSpentSec ?? a.durationSeconds ?? a.durationSec) || 0);

      const percent = Number.isFinite(totals.scorePercent) // the score as a percentage
        ? totals.scorePercent
        : (Number.isFinite(a.scorePercent) ? a.scorePercent : computePercent(correct, total)); // if no stored percent, compute one from correct/total

      const attemptId = String(a.attemptId || a.id || fallbackDocId || ""); // unique ID for the attempt — try several locations, finally falling back to the Firestore document ID

      const quizId = String(a.quizId || a.sectionId || a.examType || ""); // identifier for which quiz/section/exam was taken
      const title = String(a.title || a.sectionTitle || quizId || "Practice"); // human-readable quiz title with multiple fallbacks

      const attemptType = String(a.attemptType || (a.mode === "random" ? "random" : "topic") || ""); // either "random" or "topic" mode — derived from older "mode" field if needed

      const createdLike = // try several common timestamp field names since older docs may use different ones
        a.createdAt ||
        a.generatedAt ||
        a.completedAt ||
        a.timestamp ||
        a.updatedAt ||
        null;

      const dateObj = toDateMaybe(createdLike); // convert whatever timestamp format we got into a real Date object

      return { // return the normalized, predictable shape that the rest of the code consumes
        attemptId,
        quizId,
        title,
        attemptType,
        timestamp: dateObj || new Date(0), // if no date was found, use the epoch (1970) so sorting still works
        score: correct,
        answered,
        total,
        percent,
        durationSeconds,
      };
    }

    // -----------------------------
    // Firestore fetch logic
    // -----------------------------

    async function fetchFromSubcollection(firebase, uid, subcolName) { // fetches all attempt documents from a given subcollection under users/{uid}/{subcolName}
      const colRef = firebase.collection(firebase.db, "users", uid, subcolName); // build a reference to that specific subcollection path

      // Best case: server-side order by createdAt desc
      try {
        const q = firebase.query( // build a Firestore query
          colRef,
          firebase.orderBy("createdAt", "desc"), // ask Firestore to sort newest-first
          firebase.limit(MAX_DOCS) // cap results so we don't pull thousands of docs
        );
        const snap = await firebase.getDocs(q); // execute the query and wait for the snapshot
        const rows = []; // collect normalized rows here
        snap.forEach((docSnap) => rows.push(normalizeAttempt(docSnap.data(), docSnap.id))); // normalize each doc and push it into rows
        return rows;
      } catch (e) {
        // Fallback: no orderBy (works if field missing / index issues)
        const snap = await firebase.getDocs(colRef); // simpler unordered fetch — works even if the createdAt field is missing or no index exists
        const rows = [];
        snap.forEach((docSnap) => rows.push(normalizeAttempt(docSnap.data(), docSnap.id)));
        return rows;
      }
    }

    async function fetchAttempts(firebase) { // top-level fetch: tries the primary subcollection first, then any legacy fallbacks
      const user = await requireSignedInUserOrThrow(firebase); // ensure a signed-in user exists before touching Firestore

      // Writer path first
      const ordered = [PRIMARY_SUBCOL].concat(FALLBACK_SUBCOLS); // build the priority-ordered list: ["attempts", "examAttempts", "results"]

      for (const subcol of ordered) { // try each subcollection in order
        const rows = await fetchFromSubcollection(firebase, user.uid, subcol); // fetch from this subcollection
        if (rows && rows.length) { // if it returned anything, stop searching
          rows.sort((x, y) => (y.timestamp?.getTime?.() || 0) - (x.timestamp?.getTime?.() || 0)); // client-side sort newest-first as a safety net (in case the server-side orderBy failed)
          return { rows, foundIn: subcol }; // return both the data and which subcollection it came from (for diagnostics)
        }
      }

      return { rows: [], foundIn: PRIMARY_SUBCOL }; // nothing found anywhere — return empty result
    }

    // -----------------------------
    // Rendering
    // -----------------------------

    function renderEmptyState(message) { // displays a friendly "no data" message in both the summary and the history table
      summaryEl.innerHTML = `
        <div class="empty-state">
          <h2>Progress unavailable</h2>
          <p>${escapeHtml(message || "No data available.")}</p>
        </div>
      `; // inject the empty-state HTML, escaping the message so user-influenced text can't break the markup

      const colspan = INCLUDE_TYPE_COL ? 7 : 6; // pick the right colspan based on whether the Type column exists
      historyBody.innerHTML = `<tr><td colspan="${colspan}">No data to display.</td></tr>`; // single placeholder row spanning all columns
    }

    function renderSummary(list) { // renders the four summary cards (total quizzes, average score, best score, total time) at the top of the page
      if (!list || !list.length) { // if there's no data, show a friendlier "get started" message instead
        summaryEl.innerHTML = `
          <div class="empty-state">
            <h2>No practice data yet</h2>
            <p>Complete a quiz while signed in, then return here to see your progress.</p>
          </div>
        `;
        return; // early exit — nothing more to do
      }

      const totalTests = list.length; // count of attempts

      let totalQuestions = 0; // running total of all questions across all attempts
      let totalCorrect = 0; // running total of correct answers across all attempts
      let bestPercent = 0; // best single-quiz percentage seen
      let totalTime = 0; // sum of durations across all attempts

      list.forEach((r) => { // walk every attempt to accumulate stats
        const s = Number(r.score || 0); // this attempt's correct count
        const t = Number(r.total || 0); // this attempt's total questions
        const p = computePercent(s, t); // this attempt's percentage

        totalQuestions += t;
        totalCorrect += s;
        totalTime += Number(r.durationSeconds || 0);
        if (p > bestPercent) bestPercent = p; // update the best score if this attempt beats it
      });

      const avgPercent = computePercent(totalCorrect, totalQuestions); // average is computed from totals (more accurate than averaging individual percentages)

      summaryEl.innerHTML = `
        <div class="summary-grid">
          <div class="summary-card">
            <div class="label">Total quizzes</div>
            <div class="value">${totalTests}</div>
            <div class="hint">Each completed attempt counts once.</div>
          </div>

          <div class="summary-card">
            <div class="label">Average score</div>
            <div class="value">${avgPercent.toFixed(1)}%</div>
            <div class="hint">Across all questions answered.</div>
          </div>

          <div class="summary-card">
            <div class="label">Best score</div>
            <div class="value">${bestPercent.toFixed(1)}%</div>
            <div class="hint">Highest score on any quiz.</div>
          </div>

          <div class="summary-card">
            <div class="label">Total time</div>
            <div class="value">${secToHMS(totalTime)}</div>
            <div class="hint">Approximate time spent practicing.</div>
          </div>
        </div>
      `; // single innerHTML write paints all four cards at once
    }

    function typeBadgeHtml(type) { // builds the small colored "Random" or "Topic" pill shown in the Type column
      const t = String(type || "").toLowerCase(); // normalize to a lowercase string
      const label = t === "random" ? "Random" : "Topic"; // pick the human-friendly label
      const cls = t === "random" ? "type-pill type-random" : "type-pill type-topic"; // pick the CSS class for color/styling
      return `<span class="${cls}">${escapeHtml(label)}</span>`; // assemble the HTML, escaping the label defensively
    }

    function renderHistory(list) { // renders the full quiz history table from an array of normalized attempts
      if (historyTable) historyTable.style.display = ""; // make sure the table is visible (clear any "display: none")

      const colspan = INCLUDE_TYPE_COL ? 7 : 6; // colspan for the empty-row case

      if (!list || !list.length) { // empty case
        historyBody.innerHTML = `<tr><td colspan="${colspan}">No quizzes recorded yet.</td></tr>`;
        return;
      }

      historyBody.innerHTML = list // build all the table rows in one go using map+join (faster than appending one-by-one)
        .map((r) => {
          const dateStr = r.timestamp ? r.timestamp.toLocaleString() : "—"; // format the timestamp using the user's locale, or em-dash if missing
          const pctStr = `${Number(r.percent || 0).toFixed(1)}%`; // pre-format the percentage string with one decimal

          const href = r.attemptId ? buildReviewHref(r.attemptId) : null; // build the review-page URL only if we have an attemptId
          const titleHtml = href // if we have a link, wrap the title in an anchor; otherwise show plain escaped text
            ? `<a class="history-link" href="${href}">${escapeHtml(r.title || "Practice")}</a>`
            : escapeHtml(r.title || "Practice");

          const cells = []; // collect cell HTML strings for this row

          cells.push(`<td class="cell-date">${escapeHtml(dateStr)}</td>`); // Date column

          if (INCLUDE_TYPE_COL) { // conditionally add the Type column based on the config flag
            cells.push(`<td class="cell-type">${typeBadgeHtml(r.attemptType)}</td>`);
          }

          cells.push(`<td class="cell-title">${titleHtml}</td>`); // Quiz title (clickable)
          cells.push(`<td class="cell-score"><span class="score-pill">${escapeHtml(pctStr)}</span></td>`); // Score pill
          cells.push(`<td class="cell-total">${Number(r.score || 0)} / ${Number(r.total || 0)}</td>`); // Raw "correct / total"
          cells.push(`<td class="cell-pct">${escapeHtml(pctStr)}</td>`); // Percent column
          cells.push(`<td class="cell-time">${escapeHtml(secToHMS(r.durationSeconds))}</td>`); // Duration formatted as h/m/s

          return `<tr>${cells.join("")}</tr>`; // assemble the row by joining its cells
        })
        .join(""); // join all rows into one big HTML string for a single DOM write
    }

    function renderSignedOut(localCount) { // shows a "please log in" state, optionally noting any local-only attempts
      const extra = // craft an extra sentence about local attempts only if there are any
        localCount > 0
          ? ` (Note: ${localCount} local attempt${localCount === 1 ? "" : "s"} exist on this device but aren't saved to your account.)`
          : "";

      showBanner("warning", `Sign in to your account to see your saved progress${extra}`); // top banner

      const colspan = INCLUDE_TYPE_COL ? 7 : 6;

      summaryEl.innerHTML = `
        <div class="empty-state">
          <h2>Progress unavailable</h2>
          <p>Sign in to your account to see your saved progress${escapeHtml(extra)}</p>
          <p><a class="btn" href="/profile/login.html">Log in / Sign up</a></p>
        </div>
      `; // empty-state with a login button

      historyBody.innerHTML = `<tr><td colspan="${colspan}">No data to display.</td></tr>`;
    }

    function renderPermissionDenied(localCount, lastWrite) { // shown when the user IS signed in but Firestore security rules reject the read
      const extra = // optional note about local attempts
        localCount > 0
          ? ` Local attempts exist (${localCount}) but Firestore access is blocked.`
          : "";

      let lw = ""; // optional note about the most recent write failure
      if (lastWrite && lastWrite.ok === false) {
        const code = lastWrite.code ? ` (${lastWrite.code})` : ""; // include the error code in parentheses if present
        lw = ` Last write error${code}: ${lastWrite.message || "Unknown error"}.`;
      }

      showBanner( // surface a warning banner explaining the situation
        "warning",
        `Signed in, but Firestore rules are blocking access to your progress (permission denied).${extra}${lw}`
      );

      const colspan = INCLUDE_TYPE_COL ? 7 : 6;

      summaryEl.innerHTML = `
        <div class="empty-state">
          <h2>Progress unavailable</h2>
          <p>Your account is signed in, but Firestore rules are blocking access to your progress.</p>
          <p class="muted">
            Fix: allow the signed-in user to read <code>users/{uid}/${escapeHtml(PRIMARY_SUBCOL)}</code>.
          </p>
        </div>
      `; // technical hint for the developer/admin

      historyBody.innerHTML = `<tr><td colspan="${colspan}">No data to display.</td></tr>`;
    }

    function maybeShowLocalDiagnostics(rows, localCount, lastWrite) { // decides what informational banner to show when no Firestore rows were returned
      // If we have Firestore rows, keep banner focused on success.
      if (rows && rows.length) return; // bail out — caller already showed a success banner

      if (localCount > 0) { // there are local attempts but no synced ones — likely a sync failure
        let msg =
          `No Firestore attempts found, but ${localCount} local attempt${localCount === 1 ? "" : "s"} exist on this device. ` +
          `This usually means the quiz couldn't write to Firestore (rules) or you weren't signed in when finishing.`;

        if (lastWrite && lastWrite.ok === false) { // append the most recent write error if available
          const code = lastWrite.code ? ` (${lastWrite.code})` : "";
          msg += ` Last write error${code}: ${lastWrite.message || "Unknown error"}.`;
        }

        showBanner("info", msg);
      } else { // genuinely no attempts anywhere — show a gentle starter message
        showBanner("info", "No attempts recorded yet. Complete a quiz while signed in to start tracking progress.");
      }
    }

    // -----------------------------
    // Main refresh
    // -----------------------------

    async function refresh() { // the main orchestrator — runs the whole load-and-render cycle
      const localCount = countLocalAttemptKeys(); // collect diagnostic info up front
      const lastWrite = readLastWrite();

      try {
        setLoading(true); // show the spinner
        showBanner(null, ""); // clear any stale banner

        const firebase = await getFirebaseApis(); // load Firebase tools
        await requireSignedInUserOrThrow(firebase); // require an authenticated user

        const { rows, foundIn } = await fetchAttempts(firebase); // fetch the attempts (and which subcollection they came from)
        state.attempts = rows; // cache them in state for any future use

        renderSummary(rows); // paint the summary cards
        renderHistory(rows); // paint the history table

        if (rows.length) { // success path with data
          showBanner(
            "success",
            `Loaded ${rows.length} attempt${rows.length === 1 ? "" : "s"} from Firestore (${foundIn}).`
          );
        } else { // success path but no data — show a helpful diagnostic banner
          maybeShowLocalDiagnostics(rows, localCount, lastWrite);
        }
      } catch (err) { // any error during the try block lands here
        console.error("progress.js: refresh failed", err); // always log to the console for debugging

        const localCount2 = countLocalAttemptKeys(); // re-check diagnostics in case they changed during the failed attempt
        const lastWrite2 = readLastWrite();

        if (isNotSignedIn(err)) { // specific handling for missing-auth errors
          renderSignedOut(localCount2);
          return;
        }

        if (isPermissionDenied(err)) { // specific handling for Firestore rule rejections
          renderPermissionDenied(localCount2, lastWrite2);
          return;
        }

        const msg = // generic error message, with bonus info about local attempts if any exist
          localCount2 > 0
            ? `Could not load your progress from Firestore. (${localCount2} local attempt${localCount2 === 1 ? "" : "s"} exist on this device.)`
            : "Could not load your progress. Please try again later.";

        // Include last write if available
        let msg2 = msg; // start from the generic message and append more context
        if (lastWrite2 && lastWrite2.ok === false) {
          const code = lastWrite2.code ? ` (${lastWrite2.code})` : "";
          msg2 += ` Last write error${code}: ${lastWrite2.message || "Unknown error"}.`;
        }

        showBanner("warning", msg2); // show the combined message in a warning banner
        renderEmptyState(msg2); // and reflect it in the empty-state UI too
      } finally {
        setLoading(false); // ALWAYS hide the spinner — runs whether the try succeeded or the catch handled an error
      }
    }

    refresh().catch((err) => console.error("progress.js: initial refresh failed", err)); // kick off the first load when the DOM is ready, with a final safety-net log if even refresh's own error handling somehow fails
  });
})();
