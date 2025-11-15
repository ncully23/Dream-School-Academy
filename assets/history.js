// /assets/history.js
import { auth, db } from "/assets/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const listEl = document.getElementById("attempts-list");

function renderEmpty() {
  listEl.innerHTML = `<p>You haven't taken any quizzes yet.</p>`;
}

function renderAttempts(docs) {
  const items = docs.map(d => {
    const data = d.data();
    const label = data.examType || "Quiz";
    const pct   = data.scorePercent ?? null;
    const when  = data.completedAt?.toDate
      ? data.completedAt.toDate().toLocaleString()
      : "";

    return `
      <article class="attempt-card">
        <div class="attempt-main">
          <h2>${label}</h2>
          <p>${data.numCorrect ?? "–"} / ${data.numQuestions ?? "–"} correct${pct != null ? ` (${pct}%)` : ""}</p>
        </div>
        <div class="attempt-meta">
          <span>${when}</span>
        </div>
      </article>
    `;
  });
  listEl.innerHTML = items.join("");
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // if not logged in, send to login
    window.location.href = "/login.html";
    return;
  }

  try {
    const q = query(
      collection(db, "users", user.uid, "attempts"),
      orderBy("completedAt", "desc")
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      renderEmpty();
      return;
    }
    renderAttempts(snap.docs);
  } catch (e) {
    console.error("Failed to load attempts:", e);
    listEl.innerHTML = `<p>Sorry, we couldn't load your history.</p>`;
  }
});
