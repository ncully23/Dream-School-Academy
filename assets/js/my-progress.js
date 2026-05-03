// "My Progress" page: shows combined results from Firestore (quizData)
// and local fallback (DreamSchoolRecorder), with summary + history table.

(function () {
  // If there is a truthy value named __dsa_my_progress_initialized on the window object, stop this function immediately and do nothing else
  if (window.__dsa_my_progress_initialized) return;
  // mark this script as already initialized.
  window.__dsa_my_progress_initialized = true;

// It is important because running this script twice could attach the same click handlers twice, render duplicate table rows, show repeated alerts, or run duplicate data loading/export logic.
// It is not that JavaScript literally cannot run it twice; it is that running it twice can create bugs, so this guard makes the script run only once on purpose.
// In browser JavaScript, window is the global object that represents the browser tab or page.
// It contains things the browser gives your code access to, such as the page document (window.document), the URL (window.location), timers (window.setTimeout), and custom values you add, like window.__dsa_my_progress_initialized.


  // document is the browser’s JavaScript object that represents the HTML page itself.
  document.addEventListener('DOMContentLoaded', function () { // use the document’s .addEventListener() method to listen for the DOMContentLoaded event, and when that event happens, run the function.
    const summaryEl = document.getElementById('summary'); // find the HTML element with the ID summary and save it in a variable named summaryEl.
    const historyBody = document.getElementById('historyBody'); // find the HTML element with the ID historyBody and save it in a variable named historyBody.
    const exportBtn = document.getElementById('exportBtn'); // find the HTML button or element with the ID exportBtn and save it in a variable named exportBtn.
    const clearBtn = document.getElementById('clearBtn'); // find the HTML button or element with the ID clearBtn and save it in a variable named clearBtn
    const loadingEl = document.getElementById('progressLoading');   // optional; find the HTML element with the ID progressLoading and save it in a variable named loadingEl.
    const unsyncedEl = document.getElementById('unsyncedBanner');   // optional; find the HTML element with the ID unsyncedBanner and save it in a variable named unsyncedEl

    // Optional modal elements for nicer details UI
    const detailsModal = document.getElementById('detailsModal'); // find the HTML element with the ID detailsModal and save it in a variable named detailsModal. This is probably the pop-up box that shows more information about a test attempt
    const detailsBody = document.getElementById('detailsBody'); // find the HTML element with the ID detailsBody and save it in a variable named detailsBody. This is probably the area inside the pop-up where the test details are displayed.
    const detailsClose = document.getElementById('detailsClose'); // find the HTML element with the ID detailsClose and save it in a variable named detailsClose. This is probably the button the user clicks to close the details pop-up.


    // If the page doesn't include the expected elements, bail quietly
    if (!summaryEl || !historyBody) return; // if the script cannot find the summary area or the history table body, stop running immediately
    // This prevents errors because those two page elements are required for the My Progress page to work.

    
    // Helpers
    function secToHMS(s) {
      if (!s || s <= 0) return '-'; // if the value is missing, zero, or negative, return '-'
      // In JavaScript, the ! operator means logical NOT, so JavaScript first converts s into a Boolean value, then flips i
      // !s = Is s NOT truthy?
      // it catches values like undefined, null, 0, "", or false.
      // || = OR
      const h = Math.floor(s / 3600); // calculates the number of full hours.
      const m = Math.floor((s % 3600) / 60); // calculates the remaining full minutes after hours are removed.
      const sec = s % 60; // calculates the remaining seconds after hours and minutes are removed.
      return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (sec ? sec + 's' : '');
    }


    // Makes it safe to put text into HTML
    // It is called escapeHtml because it escapes special HTML characters so the browser treats them as plain text instead of HTML code.
    // For example, it changes < into &lt;, so the browser displays < instead of reading it as the start of an HTML tag.
 
    // When it finds one, it replaces it with a safe HTML code, such as changing < into &lt;, so the browser displays it as text instead of treating it like real HTML code
    function escapeHtml(str) {
      if (!str) return ''; // If str is empty, missing, or false-like, it returns an empty string.
      return String(str).replace(/[&<>"']/g, m => ({
        // Otherwise, String(str) converts the input into text, and .replace(/[&<>"']/g, ...) searches for dangerous HTML characters like &, <, >, ", and '.
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
        // In this object, the colon means “this key maps to this value.”
      }[m]));
    }



    // This function tries to turn ts into a normal JavaScript Date. 
    // ts is the function’s input parameter, and it stands for something like timestamp.
    // In this script, ts could be a missing value, a JavaScript Date, a date string, or a Firestore Timestamp, so the function checks what kind of timestamp it received and converts it into a normal JavaScript Date.
    function toDateMaybe(ts) {
      if (!ts) return new Date(); // if ts is missing or false-like, it returns the current date and time with new Date()
      if (ts instanceof Date) return ts; // if ts is already a JavaScript Date object, return it as-is.
      if (typeof ts === 'string') return new Date(ts);     // If ts is a string, it tries to convert that string into a date with new Date(ts).
      if (typeof ts.toDate === 'function') return ts.toDate(); // Firestore Timestamp: If ts has a .toDate() function, like a Firestore Timestamp, it calls that function to convert it into a JavaScript Date.
      return new Date();     // If none of those cases work, it returns the current date and time as a safe fallback.
    }


    
    function computePercent(score, total) {
      if (!total || total <= 0) return 0; // if total is missing, false-like, zero, or negative, return 0 so the code does not divide by a bad number
      return Math.round((score / total) * 10000) / 100; // First, score / total gives the decimal score. For example, 2 / 3 gives 0.6666.... Multiplying by 10000 does two things at once: it turns the score into a percent and shifts the decimal two extra places.
      // So 0.6666... * 10000 becomes 6666.666.... Then Math.round(...) rounds that to 6667. Finally, dividing by 100 turns it into 66.67
    }

    /**
     * Normalize both Firestore attempts and old DreamSchoolRecorder records
     * into a common shape:
     *
     * {
     *   id: string,
     *   timestamp: Date,
     *   score: number,
     *   total: number,
     *   percent: number,
     *   durationSeconds: number,
     *   category: string,
     *   answers: Array<...>,
     *   synced: boolean      // true if from Firestore, false if only local
     * }
     */
    function normalizeAttempt(raw, opts) {
      const options = opts || {};
      const fromFirestore = !!options.fromFirestore;

      // Case 1: Firestore "attempt" (quiz-data.appendAttempt)
      if (raw && raw.totals && Array.isArray(raw.items)) {
        const totals = raw.totals;
        const items = raw.items;

        const score = typeof totals.correct === 'number' ? totals.correct : 0;
        const total = typeof totals.total === 'number' ? totals.total : items.length;
        const percent =
          typeof totals.scorePercent === 'number'
            ? totals.scorePercent
            : computePercent(score, total);

        const durationSeconds =
          typeof totals.timeSpentSec === 'number' ? totals.timeSpentSec : 0;

        const timestamp = toDateMaybe(raw.createdAt || raw.timestamp);

        const category = raw.sectionId || raw.title || 'Practice';

        // Simplify answers if needed
        const answers = items.map(it => ({
          qid: it.id || it.number || null,
          answerIndex: typeof it.chosenIndex === 'number' ? it.chosenIndex : null,
          correctIndex: typeof it.correctIndex === 'number' ? it.correctIndex : null,
          correct: !!it.correct
        }));

        return {
          id: raw.id || raw.attemptId || 'fs_' + (timestamp.getTime()),
          timestamp,
          score,
          total,
          percent,
          durationSeconds,
          category,
          answers,
          synced: true
        };
      }

      // Case 2: Old DreamSchoolRecorder records
      if (raw && typeof raw.score === 'number' && typeof raw.total === 'number') {
        const score = raw.score;
        const total = raw.total;
        const percent =
          typeof raw.percent === 'number' ? raw.percent : computePercent(score, total);
        const durationSeconds =
          typeof raw.durationSeconds === 'number' ? raw.durationSeconds : 0;
        const timestamp = toDateMaybe(raw.timestamp);
        const category = raw.category || 'General';

        return {
          id: raw.id || 'local_' + timestamp.getTime(),
          timestamp,
          score,
          total,
          percent,
          durationSeconds,
          category,
          answers: Array.isArray(raw.answers) ? raw.answers : [],
          synced: false
        };
      }

      // Fallback: very minimal
      const fallbackTime = toDateMaybe(raw && raw.timestamp);
      return {
        id: (raw && raw.id) || 'unknown_' + fallbackTime.getTime(),
        timestamp: fallbackTime,
        score: raw && typeof raw.score === 'number' ? raw.score : 0,
        total: raw && typeof raw.total === 'number' ? raw.total : 0,
        percent: 0,
        durationSeconds: 0,
        category: (raw && raw.category) || 'Unknown',
        answers: [],
        synced: !!fromFirestore
      };
    }

    // -----------------------------
    // Data loading: Firestore + local fallback
    // -----------------------------

    async function fetchAllResults() {
      let firestoreAttempts = [];
      let localAttempts = [];
      let hasUnsynced = false;
      let source = 'none';

      // 1) Try Firestore via quizData
      if (window.quizData && typeof window.quizData.loadAllResultsForUser === 'function') {
        try {
          const fsRaw = await window.quizData.loadAllResultsForUser();
          firestoreAttempts = (fsRaw || []).map(r =>
            normalizeAttempt(r, { fromFirestore: true })
          );
          if (firestoreAttempts.length) {
            source = 'firestore';
          }
        } catch (err) {
          console.error('MyProgress: failed to load Firestore attempts', err);
        }
      }

      // 2) Local fallback via DreamSchoolRecorder
      if (window.DreamSchoolRecorder && typeof DreamSchoolRecorder.getAllResults === 'function') {
        try {
          const recRaw = DreamSchoolRecorder.getAllResults() || [];
          localAttempts = recRaw.map(r => normalizeAttempt(r, { fromFirestore: false }));
          if (localAttempts.length && source === 'none') {
            source = 'local';
          } else if (localAttempts.length && firestoreAttempts.length) {
            source = 'mixed';
          }
        } catch (err) {
          console.error('MyProgress: failed to load local recorder attempts', err);
        }
      }

      const all = [...firestoreAttempts, ...localAttempts];

      // sort newest → oldest
      all.sort((a, b) => b.timestamp - a.timestamp);

      hasUnsynced = localAttempts.some(r => !r.synced) || all.some(r => r.synced === false);

      return {
        list: all,
        source,
        hasUnsynced
      };
    }

    // -----------------------------
    // Rendering
    // -----------------------------

    function renderSummary(list) {
      if (!list || !list.length) {
        summaryEl.innerHTML = `
          <p>No practice tests recorded yet.</p>
          <p>Once you take a practice exam while signed in, your results will appear here.</p>
        `;
        return;
      }

      const totalTests = list.length;
      const avgPercent =
        Math.round(
          (list.reduce((sum, r) => sum + (r.percent || 0), 0) / totalTests) * 100
        ) / 100;
      const best = list.reduce((a, b) => (a.percent >= b.percent ? a : b));
      const last = list[0]; // list is sorted newest → oldest

      summaryEl.innerHTML = `
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-value">${totalTests}</div>
            <div class="stat-label">Tests taken</div>
          </div>
          <div class="stat">
            <div class="stat-value">${avgPercent}%</div>
            <div class="stat-label">Average score</div>
          </div>
          <div class="stat">
            <div class="stat-value">${best.percent}%</div>
            <div class="stat-label">Best score</div>
          </div>
          <div class="stat">
            <div class="stat-value">${last.timestamp.toLocaleString()}</div>
            <div class="stat-label">Last taken</div>
          </div>
        </div>
      `;
    }

    function renderTable(list) {
      if (!list || !list.length) {
        historyBody.innerHTML = '<tr><td colspan="7">No tests yet</td></tr>';
        return;
      }

      // Group by category/section
      const groups = {};
      list.forEach(r => {
        const key = r.category || 'General';
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });

      const categories = Object.keys(groups).sort();

      const rows = [];

      categories.forEach(cat => {
        const group = groups[cat];

        // Group header row
        rows.push(`
          <tr class="group-row">
            <td colspan="7">${escapeHtml(cat)}</td>
          </tr>
        `);

        group.forEach(r => {
          const dateStr = r.timestamp.toLocaleString();
          const unsyncedIcon = r.synced ? '' : ' ⚠';
          const detailsBtn = `<button class="details-btn" data-id="${escapeHtml(r.id)}">View</button>`;

          rows.push(`
            <tr>
              <td>${escapeHtml(dateStr)}</td>
              <td>${escapeHtml(r.category)}${unsyncedIcon}</td>
              <td>${r.score}</td>
              <td>${r.total}</td>
              <td>${r.percent}%</td>
              <td>${secToHMS(r.durationSeconds)}</td>
              <td>${detailsBtn}</td>
            </tr>
          `);
        });
      });

      historyBody.innerHTML = rows.join('');
    }

    // -----------------------------
    // Details view (modal or alert)
    // -----------------------------

    function openDetailsModal(record) {
      if (!detailsModal || !detailsBody) {
        // Fallback: simple alert
        const lines = buildDetailsLines(record);
        alert(lines.join('\n'));
        return;
      }

      const lines = buildDetailsLines(record);
      detailsBody.textContent = lines.join('\n');

      if (typeof detailsModal.showModal === 'function') {
        // <dialog> element
        detailsModal.showModal();
      } else {
        // Fallback display via CSS class
        detailsModal.style.display = 'block';
      }
    }

    function closeDetailsModal() {
      if (!detailsModal) return;
      if (typeof detailsModal.close === 'function') {
        try { detailsModal.close(); } catch (e) {}
      } else {
        detailsModal.style.display = 'none';
      }
    }

    function buildDetailsLines(rec) {
      const lines = [
        `Date: ${rec.timestamp.toLocaleString()}`,
        `Category: ${rec.category}`,
        `Score: ${rec.score} / ${rec.total} (${rec.percent}%)`,
        `Duration: ${rec.durationSeconds ? rec.durationSeconds + 's' : '—'}`
      ];
      if (Array.isArray(rec.answers) && rec.answers.length) {
        lines.push('', 'Answers:');
        rec.answers.slice(0, 50).forEach((a, idx) => {
          const qid = a.qid != null ? a.qid : (idx + 1);
          const ans = a.answerIndex != null ? a.answerIndex : a.answer;
          lines.push(`Q ${qid}: answer="${ans}" correct=${!!a.correct}`);
        });
        if (rec.answers.length > 50) lines.push('...truncated...');
      }
      return lines;
    }

    if (detailsClose) {
      detailsClose.addEventListener('click', closeDetailsModal);
    }
    if (detailsModal) {
      detailsModal.addEventListener('click', (e) => {
        // Close if clicking backdrop on <dialog> or outside content in custom modal
        if (e.target === detailsModal) {
          closeDetailsModal();
        }
      });
    }

    // -----------------------------
    // Event delegation for "View" buttons
    // -----------------------------

    let lastResultsList = []; // keep last loaded list for lookup

    if (historyBody) {
      historyBody.addEventListener('click', (e) => {
        const btn = e.target.closest('.details-btn');
        if (!btn) return;

        const id = btn.dataset.id;
        const rec = lastResultsList.find(r => r.id === id);
        if (!rec) {
          alert('Record not found.');
          return;
        }
        openDetailsModal(rec);
      });
    }

    // -----------------------------
    // Export + Clear handlers
    // -----------------------------

    async function exportAllResults() {
      const { list } = await fetchAllResults();
      const data = JSON.stringify(list, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dreamschool-progress-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        exportAllResults().catch(err => {
          console.error('MyProgress: export failed', err);
          alert('Failed to export results.');
        });
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!confirm('Clear all locally stored practice tests? Cloud-saved results in your account will not be deleted.')) {
          return;
        }
        if (window.DreamSchoolRecorder && typeof DreamSchoolRecorder.clearAllResults === 'function') {
          DreamSchoolRecorder.clearAllResults();
        }
        // We intentionally do NOT delete Firestore attempts from here.
        refresh().catch(() => {});
      });
    }

    // -----------------------------
    // Main refresh
    // -----------------------------

    async function refresh() {
      try {
        if (loadingEl) loadingEl.style.display = 'block';
        if (unsyncedEl) unsyncedEl.style.display = 'none';

        const { list, hasUnsynced } = await fetchAllResults();
        lastResultsList = list;

        renderSummary(list);
        renderTable(list);

        if (unsyncedEl) {
          unsyncedEl.style.display = hasUnsynced ? 'block' : 'none';
        }
      } catch (err) {
        console.error('MyProgress: refresh failed', err);
        summaryEl.innerHTML = '<p>Could not load your progress. Please try again later.</p>';
        historyBody.innerHTML = '<tr><td colspan="7">Error loading results</td></tr>';
      } finally {
        if (loadingEl) loadingEl.style.display = 'none';
      }
    }

    // Initial load
    refresh();
  });
})();
