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

    function secToHMS(s) {
      if (!s || s <= 0) return '-';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (sec ? sec + 's' : '');
    }

    function escapeHtml(s) {
      if (!s) return '';
      return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    }

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

    function attachRowListeners(list) {
      document.querySelectorAll('.details-btn').forEach(btn => {
        // remove existing listener by cloning the node (defensive if multiple loads)
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
      });

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
