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
