# Quiz System Architecture Diagram

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Student Browser                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Student visits: /practice/circles/quiz.html                  │
│                                                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Quiz Page (HTML)                              │
│  • Loads shell.js (header/footer/auth)                          │
│  • Loads firebase-init.js                                       │
│  • Loads quiz-registry.js                                       │
│  • Loads quiz-engine.js                                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Quiz Engine Resolution                          │
│  1. Extract quizId from URL path: "circles"                      │
│  2. Look up in QUIZ_REGISTRY                                     │
│  3. Get config: { bankUrl, pickCount, timer, ... }              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│               Load Question Bank (JSON)                          │
│  Fetch: /assets/questionbank/math/circles.json                  │
│  • bankId, title, description                                    │
│  • Array of questions with solutions                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Question Selection & Normalization                  │
│  • Randomly pick N questions (configurable)                      │
│  • Extract solution data (steps, mistakes, checks)               │
│  • Normalize prompt, choices, answer index                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Quiz Execution (UI)                           │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  • Question display (text or HTML)                      │     │
│  │  • Multiple choice options (A, B, C, D)                 │     │
│  │  • Timer (optional, configurable)                       │     │
│  │  • Mark for review flags                                │     │
│  │  • Eliminate answer mode                                │     │
│  │  • Question navigator                                   │     │
│  │  • Progress bar                                         │     │
│  │  • Back/Next/Finish buttons                             │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                   │
│  State Management:                                               │
│  • User answers: { questionId: choiceIndex }                     │
│  • Flagged questions: Set                                        │
│  • Eliminated choices: Map                                       │
│  • Time per question: { questionId: seconds }                    │
│  • Visit counts: { questionId: count }                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Quiz Completion                                 │
│  1. Student clicks "End & Score"                                 │
│  2. Generate summary object:                                     │
│     • attemptId (unique identifier)                              │
│     • quizId, title, timestamp                                   │
│     • totals: answered, correct, score%                          │
│     • items: all questions + user answers + solutions            │
│     • sessionMeta: time, visits, blur count                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Firebase Persistence (quiz-data.js)                 │
│                                                                   │
│  1. Normalize attempt data                                       │
│  2. Save to localStorage (backup)                                │
│  3. Check user authentication                                    │
│  4. Write to Firestore:                                          │
│     users/{uid}/examAttempts/{autoId}                           │
│     • Full attempt data with timestamp                           │
│     • Bank metadata                                              │
│     • Score and performance                                      │
│  5. Mark local copy as synced                                    │
│                                                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Redirect to Review Page                          │
│  URL: /pages/review.html?attemptId={id}                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Review Page (reviewpage.js)                         │
│                                                                   │
│  1. Extract attemptId from URL                                   │
│  2. Load from localStorage: dsa:attempt:{id}                     │
│  3. Render comprehensive feedback:                               │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  HEADER:                                              │       │
│  │  • Title, score percentage                            │       │
│  │  • Answered count, time spent                         │       │
│  │  • Completion timestamp                               │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  FOR EACH QUESTION:                                   │       │
│  │  • Question number and prompt                         │       │
│  │  • All answer choices (highlighted correct/chosen)    │       │
│  │  • Correct vs. user's answer comparison               │       │
│  │  • Skill tested and difficulty                        │       │
│  │  • Reasoning/approach                                 │       │
│  │  • Step-by-step solution                              │       │
│  │  • Common mistakes to avoid                           │       │
│  │  • How to verify the answer                           │       │
│  │  • Color-coded: green=correct, red=wrong, gray=blank  │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Quiz Pages (`/practice/{topic}/quiz.html`)
- Minimal HTML template
- Imports necessary scripts
- Resolves quiz ID from path
- No business logic

### Quiz Registry (`quiz-registry.js`)
```javascript
{
  quizId: {
    title: "Display Name",
    bankUrl: "/path/to/bank.json",
    pickCount: 20,
    timeLimitSec: 0,
    seedMode: null,
    pauseOnBlur: false
  }
}
```

### Quiz Engine (`quiz-engine.js`)
- Question loading and validation
- Random selection (with optional seeding)
- UI rendering and state management
- Timer management
- User interaction handling
- Summary generation
- Navigation to review

### Quiz Data (`quiz-data.js`)
- Firebase authentication wrapper
- Firestore write/read operations
- localStorage backup
- Attempt normalization
- Progress loading

### Review Page (`reviewpage.js`)
- Attempt data loading
- Rich feedback rendering
- Solution display
- Result visualization

## Data Models

### Question Bank Schema
```json
{
  "bankId": "unique.id",
  "bankVersion": 1,
  "title": "Bank Title",
  "description": "Description",
  "skills": ["skill1", "skill2"],
  "questions": [
    {
      "questionId": "unique.q.id",
      "version": 1,
      "topic": "topic",
      "skill": "skill",
      "difficulty": "easy|medium|hard",
      "prompt": "Question text",
      "promptHtml": "Optional HTML",
      "choices": ["A", "B", "C", "D"],
      "answerIndex": 0,
      "solution": {
        "finalAnswer": "A",
        "approach": "Strategy",
        "steps": ["Step 1", "Step 2"],
        "commonMistakes": ["Mistake 1"],
        "checks": ["Verification 1"]
      }
    }
  ]
}
```

### Attempt Summary Schema
```json
{
  "attemptId": "t_timestamp_random",
  "quizId": "circles",
  "sectionId": "circles",
  "title": "Circles",
  "generatedAt": "ISO timestamp",
  "totals": {
    "answered": 20,
    "correct": 17,
    "total": 20,
    "timeSpentSec": 720,
    "scorePercent": 85
  },
  "items": [
    {
      "number": 1,
      "questionId": "math.circles.001",
      "prompt": "Question text",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "chosenIndex": 0,
      "correct": true,
      "explanation": "Approach",
      "steps": ["Step 1", "Step 2"],
      "solution": {
        "commonMistakes": [],
        "checks": []
      },
      "timeSpentSec": 30,
      "visits": 2
    }
  ],
  "bank": {
    "bankId": "math.circles",
    "bankVersion": 1,
    "title": "Math — Circles"
  },
  "sessionMeta": {
    "blurCount": 2,
    "focusCount": 3,
    "tabSwitchCount": 1
  }
}
```

## Scalability Pattern

```
To add a new quiz:

1. CREATE: /assets/questionbank/{subject}/{topic}.json
   └─> Question bank with solutions

2. EDIT: /assets/js/quiz-registry.js
   └─> Add entry: { title, bankUrl, pickCount, ... }

3. COPY: /practice/circles/quiz.html
   └─> To: /practice/{topic}/quiz.html
   └─> No modifications needed!

The system automatically:
✓ Resolves quiz ID from URL
✓ Loads configuration from registry
✓ Fetches question bank
✓ Runs quiz with shared engine
✓ Saves to Firebase
✓ Shows review with shared page
```

## Security & Privacy

- **Firebase Rules**: Should restrict write access to authenticated users
- **User Data**: Scoped to `users/{uid}/` - each user sees only their data
- **No PII in Questions**: Question banks contain only educational content
- **Client-Side Only**: No server-side processing, data flows directly to Firebase
- **localStorage Backup**: Prevents data loss if Firebase is unavailable

## Performance Considerations

- **Lazy Loading**: Quiz engine loaded only when needed
- **JSON Caching**: Question banks cached by browser
- **Minimal DOM Updates**: Efficient re-rendering
- **No Build Step**: Instant deployment
- **CDN-Friendly**: All static assets can be cached
- **Responsive**: Works on mobile without heavy frameworks

## Extension Points

Want to add features? Key extension points:

1. **Question Types**: Modify `normalizeQuestion()` in quiz-engine.js
2. **Scoring Logic**: Update `finishExam()` calculation
3. **UI Customization**: Edit `/assets/css/quiz.css`
4. **Analytics**: Add tracking in quiz-data.js
5. **New Question Fields**: Extend question bank schema
6. **Review Enhancements**: Modify reviewpage.js rendering
