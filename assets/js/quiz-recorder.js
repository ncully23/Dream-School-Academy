// Lightweight recorder for storing quiz results in localStorage
// Usage: recordTestResult({ score, total, durationSeconds, category, answers })
(function (global) {
  const STORAGE_KEY = 'dreamschool:practiceTests:v1';

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load practice test results:', e);
      return [];
    }
  }

  function _save(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('Failed to save practice test results:', e);
    }
  }

  // result object fields:
  // { id, timestamp, score, total, durationSeconds, category, answers }
  function recordTestResult({ score, total, durationSeconds = 0, category = 'General', answers = [] } = {}) {
    if (typeof score !== 'number' || typeof total !== 'number') {
      throw new Error('score and total must be numbers');
    }
    const list = _load();
    const record = {
      id: 't_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      timestamp: new Date().toISOString(),
      score,
      total,
      percent: total > 0 ? Math.round((score / total) * 10000) / 100 : 0,
      durationSeconds,
      category,
      answers, // optional: array of { qid, answer, correct }
    };
    list.push(record);
    _save(list);
    return record;
  }

  function getAllResults() {
    return _load();
  }

  function clearAllResults() {
    _save([]);
  }

  function exportResults() {
    const data = JSON.stringify(_load(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dreamschool-practice-tests.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Allow swapping to server storage by replacing this function with an async fetch() call
  async function pushToServer(record) {
    // Example:
    // return fetch('/api/practice-tests', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(record) });
    return Promise.resolve({ ok: false, message: 'No server configured' });
  }

  global.DreamSchoolRecorder = {
    recordTestResult,
    getAllResults,
    clearAllResults,
    exportResults,
    pushToServer,
  };
})(window);


// Renders progress summary and history table using DreamSchoolRecorder
document.addEventListener('DOMContentLoaded', function () {
  const summaryEl = document.getElementById('summary');
  const historyBody = document.getElementById('historyBody');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');

  function secToHMS(s) {
    if (!s || s <= 0) return '-';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (sec ? sec + 's' : '');
  }

  function renderSummary(list) {
    if (!list.length) {
      summaryEl.innerHTML = '<p>No practice tests recorded yet. Take a practice test and it will appear here.</p>';
      return;
    }
    // compute stats
    const totalTests = list.length;
    const avgPercent = Math.round((list.reduce((s, r) => s + r.percent, 0) / totalTests) * 100) / 100;
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
    // newest first
    const rows = list.slice().reverse().map(r => {
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
    }).join('');
    historyBody.innerHTML = rows || '<tr><td colspan="7">No tests yet</td></tr>';
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  function attachRowListeners(list) {
    document.querySelectorAll('.details-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const rec = list.find(r => r.id === id);
        if (!rec) return alert('Record not found');
        // Show a simple modal-like prompt with answer summary
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
        alert(details.join('\n'));
      });
    });
  }

  function refresh() {
    const list = (window.DreamSchoolRecorder && DreamSchoolRecorder.getAllResults()) || [];
    renderSummary(list);
    renderTable(list);
    attachRowListeners(list);
  }

  exportBtn.addEventListener('click', function () {
    if (window.DreamSchoolRecorder && DreamSchoolRecorder.exportResults) {
      DreamSchoolRecorder.exportResults();
    }
  });

  clearBtn.addEventListener('click', function () {
    if (!confirm('Clear all recorded practice tests? This action cannot be undone.')) return;
    if (window.DreamSchoolRecorder && DreamSchoolRecorder.clearAllResults) {
      DreamSchoolRecorder.clearAllResults();
      refresh();
    }
  });

  refresh();
});
