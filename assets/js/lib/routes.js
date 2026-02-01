// assets/js/lib/routes.js
// Central place for ALL app URLs. No other file should hardcode /pages/... paths.

function getBaseHref() {
  // If you later add <base href="..."> in <head>, this will respect it.
  const baseTag = document.querySelector("base");
  let href = baseTag ? baseTag.getAttribute("href") : "/";

  // Normalize: ensure it starts with "/" and ends with "/"
  if (!href) href = "/";
  if (!href.startsWith("/")) href = "/" + href;
  if (!href.endsWith("/")) href = href + "/";

  return href;
}

// Builds a same-origin URL path (string) that works under a base href (GitHub Pages-friendly).
function path(p) {
  const base = getBaseHref(); // e.g. "/" or "/myrepo/"
  const clean = String(p || "").replace(/^\//, ""); // remove leading "/"
  return base + clean;
}

export const routes = {
  // Pages
  quiz: (quizId) => path(`pages/quiz.html?quizId=${encodeURIComponent(quizId)}`),
  review: (attemptId) => path(`pages/review.html?attemptId=${encodeURIComponent(attemptId)}`),

  // Optional (if/when you add them)
  practice: () => path("pages/practice.html"),
  home: () => path("index.html")
};
