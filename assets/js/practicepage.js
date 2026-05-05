// /assets/js/pages/practicepage.js
// Renders Practice index from /assets/configs/quizzes.json
// Assumes:
//  - each quiz entry has: quizId, title/sectionTitle, subject ("math"|"rw"), kind ("topic"|"fulltest")
//  - optional: questionCount, timeLimitSec, difficulty, bank, tags
// Links:
//  - Preview: /pages/preview.html?quizId=...
//  - Quiz:    /pages/quiz.html?quizId=...



// fetches the JSON file from the server, checks that the request worked, and converts the response into JavaScript data.
async function loadJson(url) {
// A regular function runs normally and returns a value directly.
// An async function always returns a Promise. It lets you use await inside it to pause until asynchronous work finishes, like fetch() loading data from a serve
  const res = await fetch(url, { cache: "no-store" });
  /*
Use const so res is not be reassigned after the response is stored.
res stands for response because fetch() returns a Response object.
Use = because you are assigning a value to a variable.
      == and === are for comparison, meaning they ask whether two values are equal; they do not store anything in res.
await pauses this async function until fetch() finishes getting a response.
fetch is the browser function used to request data from a URL.
url is the input telling fetch() where to get the data from.
{ cache: "no-store" } is an options object that tells the browser not to use a cached copy.
cache is the option name for controlling browser caching behavior.
"no-store" means the browser should request a fresh copy instead of saving or reusing the response.
The whole line means: get fresh data from url, wait for the response, and store that response in res.
  */ 
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  /*
if starts a condition, meaning the code only runs if the condition is true.
res.ok checks whether the HTTP request succeeded, usually with a status code from 200 to 299.
!res.ok means “not successful,” so it catches failed responses.
) throw means if the condition is true, immediately throw an error.
new Error(...) creates a new JavaScript Error object with a custom message.
The backticks create a template literal, which lets you insert variables into text.
${url} inserts the actual URL that failed.
${res.status} inserts the HTTP status code, like 404 or 500.
The whole line means: if the request failed, stop and report which URL failed and what status code came back.
  */
  return res.json();
}
  /*
return sends a value back from the function.
res is the Response object returned by fetch().
.json() reads the response body and converts JSON text into JavaScript data.
res.json() returns a Promise, because reading and parsing the response takes time.
The whole line means: convert the fetched JSON response into JavaScript data and send it back from the function.
  */






// small shortcut that takes an element ID as input and returns the matching HTML element from the page. 
// "Give this function an ID name, and it finds the page element with that ID."
function qs(id) {
  return document.getElementById(id); // shortcut for document.getElementById(id)
}
/*
This function is a shortcut because it lets the script write qs("summary") instead of writing the longer command document.getElementById("summary") every time.
The script gives qs an ID name, such as "fullTestsGrid" or "topicGrid", and qs sends that ID into document.getElementById(id). Then it returns the matching HTML element. This makes the rest of the script shorter and easier to read.
*/


// turns text into lowercase trimmed text so search and comparisons are easier
function norm(s) {
  return String(s || "").trim().toLowerCase();
}


// turns seconds into minutes
function formatTime(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return "";
  const m = Math.round(n / 60);
  return `${m} min`;
}


// builds the small metadata line for each quiz, such as subject, question count, time limit, and difficulty
function formatMeta(q) {
  const subj = q.subject === "math" ? "Math" : q.subject === "rw" ? "Reading & Writing" : "";
  const count = Number.isFinite(Number(q.questionCount)) ? `${q.questionCount} questions` : "";
  const time = formatTime(q.timeLimitSec);
  const diff = q.difficulty ? String(q.difficulty) : "";

  // Prefer a compact, consistent ordering
  const bits = [subj, count, time, diff].filter(Boolean);
  return bits.join(" · ");
}


// chooses the best title available for a quiz
function titleFor(q) {
  return q.sectionTitle || q.title || q.quizId || "Quiz";
}


// creates one visible quiz card on the page
// It reads the quiz’s quizId, title, and metadata, then builds two links: one for previewing the quiz and one for starting the quiz.
// It uses encodeURIComponent(quizId) so the quiz ID is safe to place inside a URL.
// Then it creates a new <div>, gives it the class quiz-card, stores extra information on it using dataset, and fills it with HTML showing the title, meta line, Preview link, and Start link.
// It turns one quiz object from the JSON file into one clickable card on the Practice page.
function buildCard(q) {
  const quizId = q.quizId;
  const title = titleFor(q);
  const meta = formatMeta(q);

  const previewHref = `/pages/preview.html?quizId=${encodeURIComponent(quizId)}`;
  const quizHref = `/pages/quiz.html?quizId=${encodeURIComponent(quizId)}`;

  const card = document.createElement("div");
  card.className = "quiz-card";
  card.dataset.quizId = quizId;
  card.dataset.subject = q.subject || "";
  card.dataset.kind = q.kind || "";

  card.innerHTML = `
    <div class="quiz-title">${title}</div>
    <div class="quiz-meta">${meta || "&nbsp;"}</div>
    <div class="btn-row">
      <a class="pill-link" href="${previewHref}">Preview</a>
      <a class="pill-link secondary" href="${quizHref}">Start</a>
    </div>
  `;
  return card;
}

// function for cleaning and organizing the quiz registry
// allows the JSON file to be either an array of quiz objects or an object keyed by quiz ID, then converts either format into a normal array
function toArrayFromRegistry(registry) {
  // Supports either:
  //  A) object keyed by quizId: { "math.circles": {...}, ... }
  //  B) array: [ {...}, {...} ]
  if (Array.isArray(registry)) return registry;

  if (registry && typeof registry === "object") {
    return Object.keys(registry).map((k) => {
      const v = registry[k] || {};
      // ensure quizId exists even if only keyed
      if (!v.quizId) v.quizId = k;
      return v;
    });
  }
  return [];
}


// decides whether a quiz is a full test by checking q.kind or using a fallback rule based on the quiz ID
function isFullTest(q) {
  const k = norm(q.kind);
  if (k) return k === "fulltest";
  // fallback heuristic: modules
  const id = norm(q.quizId);
  return id.startsWith("test.") || id.includes("module");
}

// decides whether a quiz is a topic quiz.
function isTopic(q) {
  const k = norm(q.kind);
  if (k) return k === "topic";
  return !isFullTest(q);
}


// handles the search and subject filter by checking each topic card’s title, metadata, quiz ID, and subject, then showing or hiding the card with card.style.display
function applyFilters(cards, { search, subject }) {
  const q = norm(search);
  const subj = norm(subject);

  cards.forEach((card) => {
    const title = norm(card.querySelector(".quiz-title")?.textContent);
    const meta = norm(card.querySelector(".quiz-meta")?.textContent);
    const quizId = norm(card.dataset.quizId);
    const cardSubj = norm(card.dataset.subject);

    const hitSearch =
      !q ||
      title.includes(q) ||
      meta.includes(q) ||
      quizId.includes(q);

    const hitSubject =
      !subj ||
      cardSubj === subj;

    card.style.display = hitSearch && hitSubject ? "" : "none";
  });
}


/*
The main part of the script is the async IIFE initPracticePage.
It runs automatically when the file loads.
First, it finds the important HTML containers: fullTestsGrid, topicGrid, qSearch, and qSubject.
If the page is missing the full test grid or topic grid, it logs an error and stops.
Then it loads /assets/configs/quizzes.json.
Next, it converts the registry into an array, filters out invalid entries, and normalizes each quiz.
Normalizing means it checks each quiz has a quizId, tries to infer the subject from the quiz ID, and fills in the kind field as either "fulltest" or "topic" if it is missing.
*/

(async function initPracticePage() {
  const fullGrid = qs("fullTestsGrid");
  const topicGrid = qs("topicGrid");
  const searchEl = qs("qSearch");
  const subjectEl = qs("qSubject");

  if (!fullGrid || !topicGrid) {
    console.error("practicepage.js: missing #fullTestsGrid or #topicGrid in HTML.");
    return;
  }

  let registry;
  try {
    registry = await loadJson("/assets/configs/quizzes.json");
  } catch (e) {
    console.error("practicepage.js: failed to load quizzes registry", e);
    return;
  }

  const all = toArrayFromRegistry(registry)
    .filter((q) => q && (q.quizId || q.sectionId))
    .map((q) => {
      // normalize quizId
      if (!q.quizId) q.quizId = q.sectionId;
      // normalize subject if someone used "reading" etc.
      const s = norm(q.subject);
      if (!s && q.quizId) {
        const id = norm(q.quizId);
        if (id.startsWith("math.")) q.subject = "math";
        else if (id.startsWith("rw.") || id.startsWith("reading.") || id.startsWith("writing.")) q.subject = "rw";
      }
      // normalize kind if missing
      if (!q.kind) q.kind = isFullTest(q) ? "fulltest" : "topic";
      return q;
    });

  // Render

/*

After the quiz data is loaded and cleaned, the script renders the page.
It clears the full test grid and topic grid, creates empty arrays to track full test cards and topic cards, then loops through every quiz.
For each quiz, it calls buildCard(q). If the quiz is a full test, it adds the card to the full test grid.
Otherwise, it adds the card to the topic grid. Finally, it wires up the search box and subject dropdown so they filter only the topic cards while leaving the full tests visible.
At the end, it runs the filter once in case the search or subject input already has a value.
Overall, this file 1. takes a central quiz list, 2. turns it into a Practice page, 3. separates full tests from topic practice, and 4. lets the user search or filter topic quizzes.

*/
  
  fullGrid.innerHTML = "";
  topicGrid.innerHTML = "";

  const fullCards = [];
  const topicCards = [];

  all.forEach((q) => {
    const card = buildCard(q);
    if (isFullTest(q)) {
      fullCards.push(card);
      fullGrid.appendChild(card);
    } else {
      topicCards.push(card);
      topicGrid.appendChild(card);
    }
  });

  // Wire up filtering for topic section only (keep full tests always visible)
  /*
Connects the search box and subject dropdown to the topic quiz cards.
It creates a function called runFilter that calls applyFilters(...) using the current search text and selected subject.
Then it attaches that function to the search input and subject dropdown, so the topic cards update whenever the user types or changes the subject.
Finally, it runs the filter once immediately and catches any startup error from the larger async function.
  */
  const runFilter = () => {
    // Written as an arrow function (ie. shorter)
    // runs the filtering logic whenever the user searches or changes the subject filter
    applyFilters(topicCards, { // runFilter (higher order) function calls applyFilters
      // The second input starts with {, which means the code is creating an object that holds the filter settings
      search: searchEl ? searchEl.value : "",
      /*
      Creates a property named search inside the filter settings object.
      Uses a ternary operator, which means “if this is true, use this value; otherwise, use another value.”
      "If the search box exists, use what the user typed in it; if the search box does not exist, use an empty string."
      */
      subject: subjectEl ? subjectEl.value : ""
      /*
      creates a property named subject inside the same filter settings object.
      If "the subject dropdown exists, use the selected subject value; if the dropdown does not exist, use an empty string."
      Prevents errors if the page does not have a subject filter.
      */
    });
  };

/*
}); closes the applyFilters(...) function call. The } closes the filter settings object, the ) closes the function call, and the ; ends the statement.

}; closes the runFilter function. The } ends the function body, and the ; ends the variable assignment because runFilter was created with const.
*/


  
  if (searchEl) searchEl.addEventListener("input", runFilter);
  /*
hecks whether the search box exists.
If it does, the script attaches an event listener to it.
The "input" event happens whenever the user types, deletes, or changes text in the search box. When that happens, JavaScript runs runFilter, so the visible topic cards update immediately.
  */
  if (subjectEl) subjectEl.addEventListener("change", runFilter);
/*
checks whether the subject dropdown exists.
If it does, the script attaches an event listener to it.
The "change" event happens when the user selects a different subject.
When that happens, JavaScript runs runFilter, so the topic cards are filtered by the new subject.
*/

  
  // Initial filter (in case of prefilled inputs)
  runFilter();
  /*
runs the filter function immediately.
The page does not wait for the user to type or change the dropdown before applying the current filter settings
  */
})().catch((err) => console.error("practicepage.js init failed:", err));
/*
closes and immediately runs the larger async function that contains this code.
The .catch(...) part handles errors from that async setup.
If something fails while the Practice page is starting, the script logs "practicepage.js init failed:" and the actual error to the console.
*/



/*
This is organized this way because runFilter acts as a small reusable callback function that can be passed into multiple event listeners.
Instead of writing the same applyFilters(...) logic once for the search box and again for the subject dropdown, the script defines runFilter one time, then gives that same function to both addEventListener("input", runFilter) and addEventListener("change", runFilter).
That is the higher-order-function idea here: addEventListener is a function that receives another function as an input and calls it later when the event happens.
There are other options: you could write the filtering code directly inside each event listener, but that would duplicate code; you could define runFilter with normal function runFilter() { ... } syntax instead of an arrow function; or you could use one shared event listener on a parent container if there were many filter controls.
This version is clean because it keeps the filtering logic in one named place and reuses it for both user actions.
*/
