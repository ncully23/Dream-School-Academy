// Renders "My Progress" summary and history using DreamSchoolRecorder
(function () {
  // Prevent double initialization if script is loaded twice
  if (window.__dsa_my_progress_initialized) return;
  window.__dsa_my_progress_initialized = true;

  document.addEventListener('DOMContentLoaded', function () {
    const summaryEl = document.getElementById('summary');
    const historyBody = document.getElementById('historyBody');
    const exportBtn = document.getElementById('exportBtn');
    const clearBtn = document.getElementById('clearBtn');

    // If the page doesn't include the expected elements, bail quietly
    if (!summaryEl || !historyBody) return;


    // secToHMS converts seconds to human readable time.
    // If the input s is missing, zero, or negative, it simply returns '-' to indicate no valid duration.
    // Otherwise, it first calculates the number of whole hours by dividing by 3600, then uses the remainder to compute whole minutes, and finally takes the remaining seconds.
    // It returns a formatted string that only includes units that are non-zero—for example, 3725 becomes "1h 2m 5s", 125 becomes "2m 5s", and 7 becomes "7s".
    // This allows durations to display compactly without unnecessary zeros.
    function secToHMS(s) {
      if (!s || s <= 0) return '-';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (sec ? sec + 's' : '');
    }



    // escapeHtml ensures that any text you insert into the page is safe to display as plain text rather than being interpreted as HTML.
    // If the input s is missing or empty, it returns an empty string
    // Otherwise, it converts s to a string and replaces any characters that could be interpreted as HTML—specifically &, <, >, ", and '—with their corresponding HTML entity codes (like &lt; for < and &amp; for &).
    // This prevents injected text from accidentally breaking the page layout or enabling security issues such as HTML injection or XSS.
    // The result is a sanitized version of the input that displays exactly as written.
    function escapeHtml(s) {
      if (!s) return '';
      return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    }



// renderSummary builds the top summary panel for the My Progress page using the list of all recorded practice tests.
// If the list is empty or missing, it simply inserts a message telling the student they have no recorded tests yet and exits.
// Otherwise, it calculates four key statistics: the total number of tests taken, the average score percentage, the highest-scoring test, and the most recent test.
// It computes the average by summing all percent values (treating missing ones as 0), dividing by the number of tests, and rounding to two decimal places.
// It finds the best test by comparing each record’s percent score, and it gets the latest test by taking the last element of the list.
// After computing these values, the function injects an HTML block into summaryEl, displaying these statistics in a styled grid so the user can quickly see their overall progress.
    
    function renderSummary(list) {
      if (!list || !list.length) {
        summaryEl.innerHTML = '<p>No practice tests recorded yet. Take a practice test and it will appear here.</p>';
        return;
      }
      const totalTests = list.length;
      const avgPercent = Math.round((list.reduce((s, r) => s + (r.percent || 0), 0) / totalTests) * 100) / 100;
      const best = list.reduce((a, b) => (a.percent >= b.percent ? a : b));
      const last = list.slice(-1)[0];

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
            <div class="stat-value">${new Date(last.timestamp).toLocaleString()}</div>
            <div class="stat-label">Last taken</div>
          </div>
        </div>
      `;
    }

// renderTable constructs the full history table of all practice tests by transforming each record in the list into an HTML table row.
// It first makes a reversed copy of the list so the most recent test appears at the top.
// For each record r, it converts the stored timestamp into a readable date/time, escapes the category name for safety, and inserts the raw score, total questions, percentage, and formatted duration using secToHMS.
// It also generates a “View” button for each row, embedding the test’s unique ID in a data-id attribute so another function can later open detailed results for that specific test.
// All of these row strings are joined together and placed into the table’s <tbody> (historyBody).
// If no tests exist, the function instead inserts a single row with a message spanning all seven columns. This produces the scrollable test history students see on the My Progress page.
    
    function renderTable(list) {
      const rows = (list.slice().reverse().map(r => {
        const date = new Date(r.timestamp).toLocaleString();
        const detailsBtn = `<button class="details-btn" data-id="${r.id}">View</button>`;
        return `
          <tr>
            <td>${date}</td>
            <td>${escapeHtml(r.category)}</td>
            <td>${r.score}</td>
            <td>${r.total}</td>
            <td>${r.percent}%</td>
            <td>${secToHMS(r.durationSeconds)}</td>
            <td>${detailsBtn}</td>
          </tr>
        `;
      })).join('');
      historyBody.innerHTML = rows || '<tr><td colspan="7">No tests yet</td></tr>';
    }


// The first part of attachRowListeners ensures that each “View” button is free of any old or duplicated event listeners before new ones are added.
// It selects all elements with the class .details-btn—each one corresponding to a row in the test history—and for each button, it creates a clone (cloneNode(true)), which copies the button’s appearance and attributes but does not carry over previous event listeners.
// The script then replaces the original button with its clean clone.
// This defensive pattern prevents multiple click handlers from accumulating if the table is re-rendered—which happens whenever new results are saved or the page is refreshed—ensuring each button will have exactly one listener attached afterward.
    
    function attachRowListeners(list) {
      document.querySelectorAll('.details-btn').forEach(btn => {
        // remove existing listener by cloning the node (defensive if multiple loads)
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
      });

// Once the first part clears old listeners by cloning the buttons, this part attaches fresh, clean click handlers to every .details-btn.
// It selects all the newly cloned .details-btn buttons.
// For each button, it adds a single click event listener.
// When clicked: 1. It reads the record ID stored in data-id. 2. It finds the matching test record in list. 3. If no record matches, it alerts an error.
// 4. If the record exists, it builds a list of details: a. Date/time of test, b. Category (e.g., “Math Module 2”) c. Score, total, and percent; d. Duration in seconds e. Up to the first 50 answers, each showing: Question ID Student’s answer Whether it was correct All lines are joined into a clean block of text.
// The results are displayed using alert(...) (a modal could later replace this). This part is what actually makes the “View” button work, pulling data from list and showing a detailed summary for the selected test.
      
      document.querySelectorAll('.details-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const rec = list.find(r => r.id === id);
          if (!rec) return alert('Record not found');
          const details = [
            `Date: ${new Date(rec.timestamp).toLocaleString()}`,
            `Category: ${rec.category}`,
            `Score: ${rec.score} / ${rec.total} (${rec.percent}%)`,
            `Duration: ${rec.durationSeconds ? rec.durationSeconds + 's' : '—'}`,
          ];
          if (Array.isArray(rec.answers) && rec.answers.length) {
            details.push('', 'Answers:');
            rec.answers.slice(0, 50).forEach(a => {
              details.push(`Q ${a.qid}: answered="${a.answer}" correct=${a.correct}`);
            });
            if (rec.answers.length > 50) details.push('...truncated...');
          }
          // Replace alert with a modal if you prefer
          alert(details.join('\n'));
        });
      });
    }


// This block handles updating the page, wiring up the export/clear buttons, and ensures DreamSchoolRecorder is fully loaded before trying to display anything.
// The refresh() function is the central “update everything” routine:
// 1. it safely retrieves all stored test results from DreamSchoolRecorder (falling back to an empty list if the recorder isn’t ready)
// 2. then calls renderSummary, renderTable, and attachRowListeners to rebuild the entire progress page.
// Below that, the script adds click handlers to the optional Export and Clear buttons—export simply calls DreamSchoolRecorder.exportResults() if it exists, while clear asks for confirmation, calls clearAllResults(), and then reruns refresh() so the UI immediately shows no tests.
// Finally, the ensureRecorderReady() function is a small polling loop designed to handle situations where this script loads before the DreamSchoolRecorder script.
// It checks up to 10 times (every 120 ms) to see whether DreamSchoolRecorder.getAllResults is available.
// Once it is, it calls refresh() and stops. If all attempts fail, it renders empty UI sections instead of crashing.
// This ensures your progress page always initializes cleanly regardless of script load order.
    
    function refresh() {
      const list = (window.DreamSchoolRecorder && DreamSchoolRecorder.getAllResults && DreamSchoolRecorder.getAllResults()) || [];
      renderSummary(list);
      renderTable(list);
      attachRowListeners(list);
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (window.DreamSchoolRecorder && DreamSchoolRecorder.exportResults) {
          DreamSchoolRecorder.exportResults();
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!confirm('Clear all recorded practice tests? This action cannot be undone.')) return;
        if (window.DreamSchoolRecorder && DreamSchoolRecorder.clearAllResults) {
          DreamSchoolRecorder.clearAllResults();
          refresh();
        }
      });
    }

    // If recorder isn't present yet, poll briefly (handles script-order issues)
    (function ensureRecorderReady(attempts = 10) {
      if (window.DreamSchoolRecorder && typeof window.DreamSchoolRecorder.getAllResults === 'function') {
        refresh();
        return;
      }
      if (attempts <= 0) {
        // show empty UI
        renderSummary([]);
        renderTable([]);
        return;
      }
      setTimeout(() => ensureRecorderReady(attempts - 1), 120);
    })();
  });
})();
