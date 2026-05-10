// /assets/js/pages/quizpage.js // Main quiz loader that fetches questions from topic banks or random mode, normalizes data, and passes config to quiz-engine.js
// Dream School Academy — quiz loader (topic quizId + random mode) // Supports two loading modes: specific topic quizzes or randomized practice sessions
//
// Supports: // Two distinct URL patterns this script handles
// 1) Topic mode:  /pages/quiz.html?quizId=...  (or window.DSA_BOOT) // Load questions from a single predefined question bank by ID
// 2) Random mode: /pages/quiz.html?mode=random&section=math&count=10&difficulty=hard&untimed=1 // Generate a quiz by sampling questions across multiple banks with filters
//
// Random mode loads /assets/questionbank/math/banks.math.json and samples across all listed banks. // Registry file lists available bank URLs; script fetches all and pools questions
// Missing banks (404) are skipped. // Uses Promise.allSettled to tolerate individual bank fetch failures without crashing
//
// IMPORTANT (progress/attempt saving): // Metadata requirements for downstream attempt persistence
// - Always generates a unique attemptId per run. // Ensures each quiz session has a distinct database key for saving progress
// - Provides enough metadata for quiz-engine.js + attempt-writer.js to save a complete attempt payload. // Config object includes all fields needed for attempt schema validation
// - Random mode provides deterministic picking info via cfg.seedMode/seedValue + pick.picked list. // Enables reproducible question selection for review links and debugging

"use strict"; // Enable strict mode: catches common coding errors and prevents unsafe JavaScript features

/* -----------------------------
   Fetch helpers
------------------------------ */

// Generic async helper to fetch and parse JSON with error handling
async function loadJson(url) { // Declare async function that returns a Promise resolving to parsed JSON
  const res = await fetch(url, { cache: "no-store" }); // Fetch URL with no-cache directive to always get fresh data
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`); // Throw descriptive error if HTTP status indicates failure (4xx/5xx)
  return res.json(); // Parse response body as JSON and return the resulting object
}

/* -----------------------------
   URL helpers
------------------------------ */

// Parse query string parameters from current page URL
function getParams() { // Return URLSearchParams object for easy key/value access to ?foo=bar params
  return new URLSearchParams(location.search); // location.search contains the query string portion of the URL
}

// Extract quizId parameter from URL for topic-mode loading
function getQuizIdFromUrl() { // Return the value of the "quizId" query parameter or null if absent
  return getParams().get("quizId"); // .get() retrieves first value for given parameter name
}

// Detect if URL requests random-mode quiz generation
function isRandomMode(params) { // Return boolean: true if mode=random (case-insensitive), false otherwise
  return (params.get("mode") || "").toLowerCase() === "random"; // Normalize missing/empty values to empty string before comparison
}

// Parse and validate random-mode configuration from URL parameters
function getRandomSettings(params) { // Return object with section, count, difficulty, untimed properties with safe defaults
  const section = (params.get("section") || "math").toLowerCase(); // Default to "math" if section param missing; normalize case
  const countRaw = Number(params.get("count") || 10); // Convert count param to number; default to 10 if missing/invalid
  const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(50, countRaw)) : 10; // Clamp count between 1-50 questions; fallback to 10 if NaN
  const difficulty = (params.get("difficulty") || "").toLowerCase().trim(); // Normalize difficulty param: lowercase, trim whitespace, default empty
  const untimed = params.get("untimed") === "1"; // Boolean flag: true only if untimed parameter equals string "1"
  return { section, count, difficulty, untimed }; // Return validated settings object for downstream filtering logic
}

/* -----------------------------
   Minimal UI error (avoid "silent Loading...")
------------------------------ */

// Render user-facing error message in quiz UI elements when loading fails
function renderFatal(message) { // Display error in DOM elements and console; prevents infinite loading state
  console.error(message); // Log full error details to developer console for debugging
  const titleEl = document.getElementById("sectionTitle"); // Select DOM element that displays quiz section title
  if (titleEl) titleEl.textContent = "Quiz failed to load"; // Update title text if element exists; safe null-check
  const timeEl = document.getElementById("timeLeft"); // Select DOM element that displays countdown timer
  if (timeEl) timeEl.textContent = "--:--"; // Show placeholder timer value to indicate disabled state
  const qTitle = document.getElementById("qtitle"); // Select DOM element that displays current question text
  if (qTitle) qTitle.textContent = "Quiz failed to load"; // Update question area with error message
  const choices = document.getElementById("choices"); // Select DOM container for answer choice buttons
  if (choices) { // Only inject error HTML if choices container exists in DOM
    choices.innerHTML = ` // Replace choices with styled error message div using template literal
      <div class="load-error" style="padding:12px 14px;border:1px solid rgba(220,38,38,.35);border-radius:12px;"> // Error container with red-tinted border and rounded corners
        <div style="font-weight:800;margin-bottom:6px;">Couldn't start this quiz.</div> // Bold header text for error visibility
        <div style="opacity:.9;line-height:1.35">${String(message)}</div> // Display the actual error message with readable typography
        <div style="opacity:.7;margin-top:10px;font-size:.9rem"> // Subtle helper text for non-technical users
          Open DevTools → Console for details. // Instruct user where to find technical error details
        </div>
      </div>
    `; // Close template literal and assign to innerHTML
  } // End conditional check for choices element
} // End renderFatal function

/* -----------------------------
   IDs + timestamps
------------------------------ */

// Generate ISO-format date string (YYYY-MM-DD) for attempt metadata
function nowISODate() { // Return current date as zero-padded string for consistent sorting/storage
  const d = new Date(); // Create Date object representing current moment
  const y = d.getFullYear(); // Extract 4-digit year (e.g., 2026)
  const m = String(d.getMonth() + 1).padStart(2, "0"); // Extract month (0-indexed), add 1, pad to 2 digits
  const day = String(d.getDate()).padStart(2, "0"); // Extract day of month, pad to 2 digits with leading zero
  return `${y}-${m}-${day}`; // Concatenate components with hyphens into ISO date format
}

// Generate unique attempt identifier for database storage key
function makeAttemptId() { // Return cryptographically-secure or fallback unique string for attempt tracking
  try { // Attempt to use secure random UUID generator if available in environment
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID(); // Use native crypto.randomUUID() for best uniqueness guarantees
  } catch (_) {} // Silently catch any errors from crypto API and fall back to manual method
  return `att_${Date.now()}_${Math.random().toString(16).slice(2)}`; // Fallback: timestamp + hex-random string for uniqueness
}

/* -----------------------------
   Small utilities
------------------------------ */

// Convert single value or array to guaranteed array output
function asArray(x) { // Return array containing x if x is array, [x] if x is truthy non-array, or empty array if falsy
  return Array.isArray(x) ? x : x ? [x] : []; // Ternary chain handles all three cases concisely
}

// Safely convert any value to string, returning empty string for non-strings
function safeStr(x) { // Return x unchanged if it's already a string; otherwise return empty string to avoid type errors
  return typeof x === "string" ? x : ""; // Strict type check prevents accidental coercion of null/undefined/objects
}

/* -----------------------------
   Deterministic RNG for random picking
   (so pick list is reproducible given seedValue)
------------------------------ */

// FNV-1a 32-bit hash function for converting strings to numeric seeds
function hash32(str) { // Return 32-bit unsigned integer hash of input string for deterministic seeding
  // FNV-1a 32-bit // Comment indicating algorithm variant being implemented
  let h = 0x811c9dc5; // Initialize hash value to FNV offset basis constant
  for (let i = 0; i < str.length; i++) { // Iterate over each character in input string
    h ^= str.charCodeAt(i); // XOR current hash with character code (mixing step)
    h = Math.imul(h, 0x01000193); // Multiply by FNV prime using integer multiplication for overflow behavior
  } // End character iteration loop
  return h >>> 0; // Convert to unsigned 32-bit integer and return final hash value
}

// Mulberry32 PRNG: deterministic pseudo-random number generator from numeric seed
function mulberry32(seed) { // Return function that generates repeatable random floats given same seed input
  let a = seed >>> 0; // Convert seed to unsigned 32-bit integer for consistent bitwise operations
  return function () { // Return inner function that produces next random value when called
    a |= 0; // Ensure accumulator is treated as 32-bit integer (coercion for bitwise ops)
    a = (a + 0x6d2b79f5) | 0; // Add constant and force 32-bit wraparound via bitwise OR
    let t = Math.imul(a ^ (a >>> 15), 1 | a); // Complex mixing: XOR shifted value, multiply, force integer
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; // Additional mixing rounds for better distribution
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // Final mix, convert to unsigned, divide by 2^32 for [0,1) float
  }; // End inner random generator function
} // End mulberry32 factory function

// Fisher-Yates shuffle using provided deterministic random function
function shuffleInPlace(arr, rand) { // Randomly reorder array elements in-place using supplied rand() function
  for (let i = arr.length - 1; i > 0; i--) { // Iterate backwards from last index to index 1
    const j = Math.floor(rand() * (i + 1)); // Generate random index from 0 to i inclusive using provided RNG
    const tmp = arr[i]; // Store current element in temporary variable for swap
    arr[i] = arr[j]; // Move randomly-selected element to current position
    arr[j] = tmp; // Move original element to random position (complete swap)
  } // End shuffle loop
  return arr; // Return same array reference now in shuffled order (convenience for chaining)
}

/* -----------------------------
   Question normalization
------------------------------ */

// Generate stable fallback question ID when source data lacks explicit ID
function fallbackQuestionId(q) { // Return deterministic hex string ID derived from question content for consistency
  // Prefer stable fields; avoid randomness (so review links remain consistent) // Comment explaining design goal: reproducibility
  const base = // Build base string from most reliable available identifiers
    safeStr(q?.questionId) || // Use explicit questionId if present and string
    safeStr(q?.id) || // Fallback to generic id field if questionId missing
    `${safeStr(q?.topic)}|${safeStr(q?.skill)}|${safeStr(q?.prompt).slice(0, 80)}`; // Last resort: hash topic+skill+truncated prompt
  return `Q_${hash32(base).toString(16)}`; // Prefix with Q_, hash base string, convert to hex for readable unique ID
}

// Normalize question object to match quiz-engine expected schema
function normalizeQuestion(q, bankMeta) { // Return new question object with required fields standardized and metadata attached
  // Banks may use answerIndex; engine expects correctIndex. // Comment: handle legacy field name variation
  const correctIndex = // Determine correct answer index from either field name
    Number.isFinite(q?.correctIndex) ? q.correctIndex : // Prefer correctIndex if present and numeric
    Number.isFinite(q?.answerIndex) ? q.answerIndex : // Fallback to answerIndex for backward compatibility
    null; // Default to null if neither field exists (will fail isRunnableQuestion check)
  const questionId = safeStr(q?.questionId) || safeStr(q?.id) || fallbackQuestionId(q); // Ensure every question has stable string ID
  // Version is REQUIRED in attempt schema (questionId + version) // Comment: composite key requirement for database
  const version = // Determine question version for schema compliance
    Number.isFinite(q?.version) ? q.version : // Use question-level version if explicitly set
    Number.isFinite(bankMeta?.bankVersion) ? bankMeta.bankVersion : // Fallback to bank-level version
    1; // Default to version 1 if no version metadata anywhere
  const out = { // Create new output object with normalized fields
    ...q, // Spread original question properties first (preserve all existing data)
    questionId, // Override/ensure questionId field with normalized value
    version, // Override/ensure version field with normalized value
    correctIndex, // Override/ensure correctIndex field (may convert from answerIndex)
  }; // End output object literal
  // Carry source bank meta (useful for random mixed banks + review tooling) // Comment: attach provenance for debugging/analytics
  if (bankMeta) { // Only attach source metadata if bankMeta object was provided
    out.__sourceBankId = bankMeta.bankId || null; // Attach bank identifier with null fallback for missing values
    out.__sourceBankVersion = Number.isFinite(bankMeta.bankVersion) ? bankMeta.bankVersion : null; // Attach bank version with type check
    out.__sourceBankTitle = bankMeta.title || null; // Attach human-readable bank title for UI display
    out.__sourceBankUrl = bankMeta.__bankUrl || null; // Attach original fetch URL for debugging failed banks
  } // End conditional bank metadata attachment
  return out; // Return normalized question object ready for engine consumption
}

// Validate that question object has all required fields for quiz execution
function isRunnableQuestion(q) { // Return boolean: true if question has all mandatory properties for rendering/grading
  return ( // Return result of compound boolean expression checking all requirements
    typeof q?.prompt === "string" && // Prompt must be non-null string for display
    Array.isArray(q?.choices) && // Choices must be array for answer button generation
    q.choices.length >= 2 && // At least 2 choices required for meaningful multiple-choice
    Number.isFinite(q?.correctIndex) && // Correct index must be valid number for answer checking
    typeof q?.questionId === "string" && // Question ID must be string for attempt tracking
    q.questionId.length > 0 && // Question ID must be non-empty to be useful
    Number.isFinite(q?.version) // Version must be numeric for schema compliance
  ); // End compound validation expression
}

/* -----------------------------
   Topic mode: pick questions from a single bank
------------------------------ */

// Select and normalize questions from single topic bank with optional shuffling
function pickQuestionsFromBank(bank, cfg) { // Return array of normalized, validated questions ready for quiz engine
  if (!bank || !Array.isArray(bank.questions)) return []; // Early return empty array if bank or questions array missing/invalid
  const bankMeta = { // Build metadata object for attaching to each question from this bank
    bankId: bank?.bankId || bank?.topic || null, // Use bankId field or fallback to topic field or null
    bankVersion: bank?.bankVersion ?? bank?.version ?? null, // Use bankVersion with nullish coalescing fallbacks
    title: bank?.title || null, // Human-readable bank title for UI/analytics
  }; // End bank metadata object
  const desired = // Determine requested question count from config with multiple fallback property names
    Number(cfg?.pickCount ?? cfg?.pick ?? cfg?.count ?? bank.questions.length); // Try pickCount→pick→count→all questions
  const pickCount = Number.isFinite(desired) ? Math.max(1, Math.min(60, desired)) : bank.questions.length; // Clamp to 1-60 range or use all
  const qs = bank.questions.slice().map((q) => normalizeQuestion(q, bankMeta)); // Clone questions array and normalize each with bank metadata
  // Respect shuffle if you later set it true in boot cfg // Comment: optional randomization feature
  if (cfg?.shuffle) { // Only shuffle if config explicitly enables it
    const rand = mulberry32(hash32("topic-shuffle")); // Create deterministic RNG seeded with fixed string for reproducible shuffle
    shuffleInPlace(qs, rand); // Apply Fisher-Yates shuffle using deterministic RNG
  } // End conditional shuffle block
  const sliced = qs.slice(0, pickCount).filter(isRunnableQuestion); // Take first N questions then filter out invalid ones
  return sliced; // Return final array of validated, normalized questions
}

/* -----------------------------
   Random mode: load registry + banks (tolerant of 404)
------------------------------ */

// Fetch bank registry JSON and load all listed bank files with error tolerance
async function loadRegistryBanks(registryUrl) { // Return array of successfully loaded bank payloads; skips failed fetches
  const reg = await loadJson(registryUrl); // Fetch and parse the registry JSON file listing available bank URLs
  const urls = asArray(reg?.banks); // Ensure banks property is treated as array (handles missing/malformed registry)
  if (!urls.length) { // Check if registry contained any bank URLs to fetch
    throw new Error(`Bank registry had no banks: ${registryUrl}`); // Throw descriptive error if registry is empty/invalid
  } // End empty registry check
  const results = await Promise.allSettled( // Fetch all bank URLs concurrently; allSettled waits for all even if some fail
    urls.map(async (url) => { // Map each URL to async fetch operation
      const payload = await loadJson(url); // Fetch and parse individual bank JSON file
      payload.__bankUrl = url; // Attach original URL to payload for debugging failed banks later
      return payload; // Return enriched payload for collection
    }) // End map callback
  ); // End Promise.allSettled call
  const ok = []; // Initialize array to collect successfully loaded bank payloads
  const failed = []; // Initialize array to collect errors from failed fetches
  for (const r of results) { // Iterate over each Promise settlement result
    if (r.status === "fulfilled") ok.push(r.value); // Add successful payload to ok array
    else failed.push(r.reason); // Add error reason to failed array for rejected promises
  } // End results iteration
  if (failed.length) { // Log warnings if any banks failed to load (non-fatal)
    console.warn("[Random mode] Some banks failed to load and were skipped:"); // Prefix warning for easy console filtering
    for (const err of failed) console.warn(err); // Log each individual error for debugging
  } // End failed banks warning block
  if (!ok.length) { // Throw fatal error if ALL banks failed (can't generate quiz with zero questions)
    throw new Error( // Construct descriptive error message with registry URL and troubleshooting hints
      `All banks in ${registryUrl} failed to load. ` + // Mention registry file location
      `Fix the URLs in banks.math.json or create the missing files.` // Suggest concrete fixes for developer
    ); // End error construction
  } // End all-failed check
  return ok; // Return array of successfully loaded bank payloads for question pooling
}

// Flatten questions from multiple bank payloads into single array with source metadata
function flattenQuestions(bankPayloads) { // Return single array of normalized questions from all provided banks
  const all = []; // Initialize accumulator array for collected questions
  for (const b of bankPayloads) { // Iterate over each successfully loaded bank payload
    const bankMeta = { // Build metadata object for this specific bank's questions
      bankId: b?.bankId || b?.topic || null, // Extract bank identifier with fallbacks
      bankVersion: b?.bankVersion ?? b?.version ?? null, // Extract version with nullish coalescing
      title: b?.title || null, // Extract human-readable title
      __bankUrl: b?.__bankUrl || null, // Preserve original fetch URL for debugging
    }; // End bank metadata object
    const qs = asArray(b?.questions); // Ensure questions property is treated as array (handles malformed banks)
    for (const q of qs) all.push(normalizeQuestion(q, bankMeta)); // Normalize each question with bank metadata and add to accumulator
  } // End bank iteration loop
  return all; // Return flattened array of all normalized questions from all banks
}

// Filter pooled questions by section, difficulty, and validity requirements
function filterQuestionsForRandom(pool, settings) { // Return subset of questions matching random mode configuration
  let out = pool; // Start with full pool; apply filters sequentially
  // Section gate (expects topics like "math.circles") // Comment: filter by topic namespace
  if (settings.section === "math") { // Only apply math-section filter if section param equals "math"
    out = out.filter((q) => safeStr(q?.topic).startsWith("math.")); // Keep questions whose topic starts with "math." prefix
  } // End section filtering block
  if (settings.difficulty) { // Only apply difficulty filter if difficulty param was provided
    out = out.filter((q) => safeStr(q?.difficulty).toLowerCase() === settings.difficulty); // Match difficulty field case-insensitively
  } // End difficulty filtering block
  // Must be runnable // Comment: final validation pass
  out = out.filter(isRunnableQuestion); // Remove any questions missing required fields for execution
  return out; // Return filtered question pool ready for sampling
}

// Deterministically sample N unique questions from pool using seed for reproducibility
function sampleUniqueDeterministic(pool, n, seedValue) { // Return array of N questions selected via seeded random shuffle
  const copy = pool.slice(); // Create shallow clone to avoid mutating original pool array
  const rand = mulberry32(hash32(String(seedValue))); // Create deterministic RNG seeded with stringified seedValue
  shuffleInPlace(copy, rand); // Apply Fisher-Yates shuffle using seeded RNG for reproducible ordering
  return copy.slice(0, n); // Return first N elements from shuffled copy (deterministic sample)
}

/* -----------------------------
   Build engine config
------------------------------ */

// Construct and assign global quiz configuration object for quiz-engine.js consumption
function setEngineConfig({ // Accept destructured config parameters for quiz initialization
  quizId, // Unique identifier for this quiz definition
  attemptId, // Unique identifier for this specific attempt/session
  attemptType, // "topic" | "random" // String indicating which loading mode generated this quiz
  title, // Display title for quiz header/UI
  sectionTitle, // Title for breadcrumb/navigation context
  description, // Optional description text for metadata/analytics
  timeLimitSec, // Optional time limit in seconds (null/0 disables timer)
  bank,        // { bankId, bankVersion, title } // Metadata about source question bank(s)
  pick,        // random-only: { pickCount, seedMode, seedValue, picked: [...] } // Deterministic sampling metadata for random mode
  questions, // Array of normalized question objects ready for rendering
}) { // End parameter destructuring
  // Draft key: keep unique per attempt to prevent collisions for random (and for repeated topic runs). // Comment: storage key design rationale
  // Attempts are always stored as dsa:attempt:{attemptId}. // Comment: final persistence key format
  const storageKey = `dsa:draft:${quizId}:${attemptId}`; // Construct localStorage key for draft/in-progress attempt data
  window.dsaQuizConfig = { // Assign global config object that quiz-engine.js will read on import
    // core identity // Comment: section grouping for related fields
    quizId, // Echo quizId for engine reference
    sectionId: quizId, // Alias sectionId to quizId for backward compatibility
    mode: attemptType === "random" ? "random" : "topic", // Derive mode string from attemptType for engine branching
    attemptType, // Preserve original attemptType for analytics/logging
    attemptId, // Unique session identifier for attempt persistence
    attemptKey: attemptId ? `dsa:attempt:${attemptId}` : null, // Construct final storage key for completed attempts (null if no attemptId)
    // titles // Comment: UI display text fields
    title: title || "Quiz", // Use provided title or fallback to generic "Quiz"
    sectionTitle: sectionTitle || title || "Quiz", // Fallback chain: sectionTitle → title → default
    description: description || "", // Use provided description or empty string
    // timing (0 disables timer in most implementations) // Comment: timer behavior note
    timeLimitSec: Number.isFinite(timeLimitSec) ? timeLimitSec : null, // Use numeric time limit or null to disable timer
    // storage // Comment: persistence configuration
    storageKey, // Key for draft/in-progress attempt data in localStorage
    // attempt payload helpers (quiz-engine uses these when building attempt object) // Comment: schema support fields
    bank: bank || { bankId: null, bankVersion: null, title: null }, // Provide bank metadata object with null fallbacks
    pick: pick || null, // Provide sampling metadata for random mode or null for topic mode
    pauseOnBlur: false, // Disable auto-pause when window loses focus (configurable feature)
    allowDraftSave: false, // Disable automatic draft saving during quiz (configurable feature)
    // normalized questions // Comment: core quiz content
    questions, // Array of validated, normalized question objects for rendering
  }; // End dsaQuizConfig object assignment
  document.title = window.dsaQuizConfig.sectionTitle; // Update browser tab title to match quiz section for UX/bookmarking
}

/* -----------------------------
   Init
------------------------------ */

// Immediately-invoked async function expression (IIFE) to bootstrap quiz loading
(async function initQuiz() { // Declare and immediately execute async initialization function
  const params = getParams(); // Parse URL query parameters for mode detection and config extraction
  const boot = window.DSA_BOOT || null; // Retrieve optional global boot configuration object or null if absent
  // -----------------------------
  // RANDOM MODE
  // ----------------------------- // Comment: section delimiter for code organization
  if (isRandomMode(params)) { // Branch: execute random-mode quiz generation logic if URL indicates random mode
    const settings = getRandomSettings(params); // Parse and validate random mode configuration from URL params
    if (settings.section !== "math") { // Validate that requested section is currently supported
      renderFatal(`Random mode currently supports section=math only (got: ${settings.section}).`); // Show user error and halt execution
      return; // Exit init function early due to unsupported configuration
    } // End section validation check
    const registryUrl = "/assets/questionbank/math/banks.math.json"; // Hardcoded path to math bank registry file
    let bankPayloads; // Declare variable to hold successfully loaded bank payloads
    try { // Attempt to load registry and all listed banks with error handling
      bankPayloads = await loadRegistryBanks(registryUrl); // Fetch registry and concurrently load all listed bank files
    } catch (err) { // Catch any errors from registry/bank loading process
      renderFatal(err?.message || err); // Display user-friendly error with technical details in console
      return; // Exit init function early due to loading failure
    } // End try-catch for bank loading
    const poolAll = flattenQuestions(bankPayloads); // Combine all questions from all loaded banks into single array
    const pool = filterQuestionsForRandom(poolAll, settings); // Apply section/difficulty/validity filters to pooled questions
    if (pool.length < settings.count) { // Validate that enough questions remain after filtering to satisfy requested count
      renderFatal( // Show descriptive error explaining why quiz can't be generated
        `Not enough questions available for random practice. ` + // Generic failure message
        `Need ${settings.count}, found ${pool.length}. ` + // Specific counts for debugging
        (settings.difficulty ? `difficulty=${settings.difficulty}. ` : `difficulty=any. `) + // Mention difficulty filter if applied
        `Add more bank files and/or update ${registryUrl}.` // Actionable troubleshooting guidance
      ); // End error message construction
      return; // Exit init function early due to insufficient questions
    } // End question count validation
    // Unique attempt per run // Comment: generate session identifier
    const attemptId = makeAttemptId(); // Create cryptographically-unique ID for this quiz attempt
    // Deterministic seed per attempt (so pick list is reconstructable) // Comment: reproducibility design
    const seedMode = "perAttempt"; // Indicate that seed is derived from attempt ID for replayability
    const seedValue = attemptId; // Use attemptId as seed value for deterministic question sampling
    const sampled = sampleUniqueDeterministic(pool, settings.count, seedValue); // Select N questions deterministically using seeded RNG
    const quizId = "random.math"; // Fixed identifier for random math quiz type
    const title = "Random Math Practice"; // Human-readable title for UI display
    const sectionTitle = settings.untimed ? "Untimed · Random Math" : "Random Math"; // Conditional title variant based on timer setting
    const timeLimitSec = settings.untimed ? 0 : null; // Disable timer (0) if untimed flag set; otherwise use engine default (null)
    // "Mixed" bank metadata for attempt schema // Comment: construct bank metadata for multi-bank random mode
    const bank = { // Build simplified bank object representing aggregated source
      bankId: "math.random", // Fixed identifier for random math aggregation
      bankVersion: 1, // Version number for schema compliance
      title: "Math — Mixed Banks", // Human-readable title for analytics/UI
    }; // End bank metadata object
    const description = // Construct descriptive metadata string with quiz parameters
      `Randomized practice across all Math banks. ` + // Generic description prefix
      `count=${settings.count}` + // Include requested question count
      (settings.difficulty ? `, difficulty=${settings.difficulty}` : ``) + // Append difficulty if specified
      (settings.untimed ? `, untimed` : ``) + // Append untimed flag if set
      `. updatedAt=${nowISODate()}.`; // Append generation date for freshness tracking
    // pick block required by your attempt schema for randomized attempts // Comment: schema compliance note
    const pick = { // Build sampling metadata object for attempt persistence and replay
      pickCount: settings.count, // Record how many questions were requested
      seedMode, // Record seeding strategy ("perAttempt")
      seedValue, // Record actual seed value (attemptId) for reproducibility
      picked: sampled.map((q) => ({ questionId: q.questionId, version: q.version })), // Record minimal identifiers for each selected question
    }; // End pick metadata object
    setEngineConfig({ // Call config builder with all assembled parameters
      quizId, // Pass quiz identifier
      attemptId, // Pass unique attempt identifier
      attemptType: "random", // Explicitly mark as random mode
      title, // Pass display title
      sectionTitle, // Pass navigation title
      description, // Pass metadata description
      timeLimitSec, // Pass timer configuration
      bank, // Pass aggregated bank metadata
      pick, // Pass sampling metadata for random mode
      questions: sampled, // Pass the actual selected question objects
    }); // End setEngineConfig call
    await import("/assets/js/quiz-engine.js"); // Dynamically import quiz engine module now that config is ready
    return; // Exit init function; engine import handles rest of quiz lifecycle
  } // End random mode conditional block
  // -----------------------------
  // TOPIC MODE (normal quizId flow)
  // ----------------------------- // Comment: section delimiter for topic mode
  const quizId = boot?.quizId || getQuizIdFromUrl(); // Determine quiz identifier from global boot config or URL parameter
  if (!quizId) { // Validate that quizId was successfully resolved from either source
    renderFatal("Missing quizId. Use /pages/quiz.html?quizId=math.circles"); // Show user error with usage hint
    return; // Exit init function early due to missing required parameter
  } // End quizId validation
  const cfg = boot?.cfg || null; // Extract optional configuration object from boot or default to null
  const bankUrl = boot?.bankUrl || cfg?.bank; // Determine bank JSON URL from boot config or nested cfg property
  if (!cfg || !bankUrl) { // Validate that both config object and bank URL are present
    renderFatal("Missing cfg/bankUrl (expected window.DSA_BOOT = { quizId, cfg, bankUrl })."); // Show error with expected boot structure
    return; // Exit init function early due to missing configuration
  } // End config validation
  let bankPayload; // Declare variable to hold fetched bank JSON data
  try { // Attempt to fetch and parse bank JSON file with error handling
    bankPayload = await loadJson(bankUrl); // Fetch bank URL and parse response as JSON
  } catch (err) { // Catch network or parsing errors from bank fetch
    renderFatal(err?.message || err); // Display user-friendly error with technical details in console
    return; // Exit init function early due to bank loading failure
  } // End try-catch for bank fetch
  const questions = pickQuestionsFromBank(bankPayload, cfg); // Select and normalize questions from bank using config parameters
  if (!questions.length) { // Validate that at least one runnable question was extracted from bank
    renderFatal(`Bank loaded but contained no runnable questions: ${bankUrl}`); // Show error indicating bank file issue
    return; // Exit init function early due to empty question set
  } // End question validation
  // Unique attempt per run (so topic attempts don't collide) // Comment: session identifier generation
  const attemptId = makeAttemptId(); // Create unique ID for this specific quiz attempt
  const bank = { // Build bank metadata object for attempt schema
    bankId: bankPayload?.bankId || bankPayload?.topic || quizId, // Derive bankId from payload fields or fallback to quizId
    bankVersion: bankPayload?.bankVersion ?? bankPayload?.version ?? null, // Extract version with nullish coalescing fallbacks
    title: bankPayload?.title || cfg?.title || "Quiz", // Use payload title, config title, or generic fallback
  }; // End bank metadata object
  setEngineConfig({ // Call config builder with assembled topic-mode parameters
    quizId, // Pass resolved quiz identifier
    attemptId, // Pass unique attempt identifier
    attemptType: "topic", // Explicitly mark as topic mode
    title: cfg.title || bankPayload.title || "Quiz", // Fallback chain for display title
    sectionTitle: cfg.sectionTitle || cfg.title || bankPayload.title || "Quiz", // Fallback chain for navigation title
    description: bankPayload?.description || cfg?.description || "", // Use payload description, config description, or empty string
    timeLimitSec: cfg.timeLimitSec ?? null, // Use config time limit or null to disable timer
    bank, // Pass bank metadata object
    pick: null, // Topic mode doesn't use sampling metadata; explicitly pass null
    questions, // Pass array of normalized questions from bank
  }); // End setEngineConfig call
  await import("/assets/js/quiz-engine.js"); // Dynamically import quiz engine module now that config is ready
})().catch((err) => renderFatal(err?.message || err)); // Close IIFE and attach catch handler for any unhandled promise rejections during init
