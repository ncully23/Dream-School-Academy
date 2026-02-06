# Quiz Architecture Documentation

## Overview

The Dream School Academy quiz system is a **fully scalable architecture** that handles:
- Loading questions from JSON question banks
- Running interactive quizzes with a Bluebook-style UI
- Saving results to Firebase for student profiles
- Displaying comprehensive summary feedback
- Tracking student progress over time

## Current Implementation Status

✅ **COMPLETE**: The circles quiz (`/practice/circles/quiz.html`) already implements the full architecture:
- ✅ Pulls questions from `/assets/questionbank/math/circles.json`
- ✅ Executes quiz through `quiz-engine.js`
- ✅ Logs results to Firebase via `quiz-data.js`
- ✅ Displays full summary at `/pages/review.html`
- ✅ Tracks attempts in student profiles

## Architecture Components

### 1. Quiz Entry Point
**File**: `/practice/circles/quiz.html` (or `/practice/{topic}/quiz.html`)

Each quiz page:
- Loads the quiz registry (`quiz-registry.js`)
- Imports the quiz engine (`quiz-engine.js`)
- Resolves the quiz ID from the URL path (e.g., `/practice/circles/quiz.html` → `quizId=circles`)
- Initializes Firebase for data persistence

### 2. Quiz Registry
**File**: `/assets/js/quiz-registry.js`

Central configuration mapping quiz IDs to their settings:

```javascript
const REGISTRY = {
  circles: {
    title: "Circles",
    bankUrl: "/assets/questionbank/math/circles.json",
    pickCount: 20,        // Number of questions per quiz
    timeLimitSec: 0,      // 0 = no timer
    seedMode: null,       // null | "perAttempt" | "perQuiz"
    pauseOnBlur: false    // Pause timer when tab loses focus
  }
  // Add more quizzes here...
};
```

### 3. Question Banks
**Location**: `/assets/questionbank/{subject}/{topic}.json`

JSON structure:
```json
{
  "bankId": "math.circles",
  "bankVersion": 1,
  "title": "Math — Circles",
  "description": "Circle geometry topics...",
  "skills": ["circumference", "area", "equation-of-a-circle"],
  "updatedAt": "2026-02-05",
  "questions": [
    {
      "questionId": "math.circles.001",
      "version": 1,
      "topic": "math.circles",
      "skill": "circumference",
      "difficulty": "easy",
      "prompt": "Question text here",
      "promptHtml": null,
      "choices": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 0,
      "solution": {
        "finalAnswer": "Option A",
        "approach": "Explanation of approach",
        "steps": ["Step 1", "Step 2", "Step 3"],
        "commonMistakes": ["Mistake 1", "Mistake 2"],
        "checks": ["Verification method 1", "Verification method 2"]
      }
    }
  ]
}
```

### 4. Quiz Engine
**File**: `/assets/js/quiz-engine.js`

Core functionality:
- Resolves quiz ID from URL, hash, or path
- Loads question bank JSON
- Randomly selects questions (configurable count)
- Manages quiz state (answers, flags, eliminations, timer)
- Renders Bluebook-style UI with:
  - Question cards with multiple choice
  - Timer (optional)
  - Mark for review flags
  - Eliminate answer mode
  - Question navigator
  - Progress tracking
- Generates comprehensive summary on completion
- Saves attempt data via Firebase

### 5. Firebase Integration
**File**: `/assets/js/quiz-data.js`

Handles data persistence:
- Saves completed attempts to Firestore: `users/{uid}/examAttempts/{attemptId}`
- Stores comprehensive attempt data including:
  - Quiz metadata (quizId, title, timestamp)
  - User answers and correct answers
  - Time spent per question
  - Score and performance metrics
- Maintains local backup in localStorage
- Provides fallback for offline scenarios

**File**: `/assets/js/firebase-init.js`
- Firebase configuration and initialization
- Authentication setup (Google OAuth)
- Exports `auth`, `db`, and `googleProvider`

### 6. Review/Summary Page
**File**: `/pages/review.html`

Displays comprehensive feedback after quiz completion:
- Overall score and performance metrics
- Question-by-question breakdown
- Shows user's answer vs. correct answer
- Detailed solution explanations with:
  - Step-by-step approach
  - Common mistakes to avoid
  - Verification checks
- Color-coded feedback (correct/incorrect/unanswered)
- Skill and difficulty labels

**File**: `/assets/js/pages/reviewpage.js`
- Loads attempt data from localStorage using attemptId
- Renders detailed review interface
- Falls back to latest attempt if no attemptId provided

## Data Flow

```
1. User visits /practice/circles/quiz.html
   ↓
2. Page resolves quizId="circles" from path
   ↓
3. Looks up config in quiz-registry.js
   ↓
4. Fetches /assets/questionbank/math/circles.json
   ↓
5. quiz-engine.js loads, randomly picks 20 questions
   ↓
6. User takes quiz (answers questions, uses timer, etc.)
   ↓
7. User clicks "End & Score"
   ↓
8. quiz-engine.js generates summary object with:
   - attemptId
   - all questions and user answers
   - score, time, metadata
   ↓
9. quiz-data.js.appendAttempt(summary):
   - Saves to Firestore (users/{uid}/examAttempts/)
   - Backs up to localStorage
   ↓
10. Redirects to /pages/review.html?attemptId={id}
    ↓
11. reviewpage.js loads attempt from localStorage
    ↓
12. Displays comprehensive feedback with solutions
```

## How to Add a New Quiz

### Step 1: Create Question Bank
Create a new JSON file at `/assets/questionbank/{subject}/{topic}.json`:

```json
{
  "bankId": "math.linear-equations",
  "bankVersion": 1,
  "title": "Math — Linear Equations",
  "description": "Linear equations in one variable",
  "skills": ["solving", "graphing", "slope"],
  "updatedAt": "2026-02-06",
  "questions": [
    {
      "questionId": "math.linear.001",
      "version": 1,
      "topic": "math.linear",
      "skill": "solving",
      "difficulty": "easy",
      "prompt": "Solve for x: 2x + 5 = 13",
      "promptHtml": null,
      "choices": ["4", "8", "9", "6.5"],
      "answerIndex": 0,
      "solution": {
        "finalAnswer": "4",
        "approach": "Isolate x using inverse operations",
        "steps": [
          "Subtract 5 from both sides: 2x = 8",
          "Divide by 2: x = 4"
        ],
        "commonMistakes": [
          "Forgetting to perform the same operation on both sides"
        ],
        "checks": [
          "Substitute x=4 back: 2(4)+5 = 8+5 = 13 ✓"
        ]
      }
    }
  ]
}
```

### Step 2: Register the Quiz
Add an entry to `/assets/js/quiz-registry.js`:

```javascript
const REGISTRY = {
  circles: {
    // existing config...
  },
  
  // NEW QUIZ:
  "linear-equations": {
    title: "Linear Equations",
    bankUrl: "/assets/questionbank/math/linear-equations.json",
    pickCount: 15,        // Pick 15 random questions
    timeLimitSec: 20 * 60, // 20 minute timer
    seedMode: "perQuiz",  // Reproducible question selection
    pauseOnBlur: true     // Pause timer when tab loses focus
  }
};
```

### Step 3: Create Quiz Page
Copy the quiz template to `/practice/linear-equations/quiz.html`:

```bash
mkdir -p practice/linear-equations
cp practice/circles/quiz.html practice/linear-equations/quiz.html
```

The page will automatically:
- Resolve `quizId="linear-equations"` from the URL path
- Look it up in the registry
- Load the question bank
- Run the quiz
- Save to Firebase
- Redirect to the review page

That's it! No code changes needed beyond these three steps.

### Step 4: (Optional) Create Landing Page
Create `/practice/linear-equations/preview.html` for quiz description and start button.

## Student Profile Integration

All quiz attempts are automatically logged to the student's Firebase profile:

**Firestore Structure:**
```
users/
  {userId}/
    examAttempts/
      {autoId}/
        - attemptId: "t_1738814400000_1234"
        - quizId: "circles"
        - sectionId: "circles"
        - title: "Circles"
        - userId: "user123"
        - timestamp: "2026-02-06T03:30:00.000Z"
        - scorePercent: 85
        - durationSeconds: 720
        - totals: { answered: 20, correct: 17, total: 20 }
        - items: [ /* array of questions with answers */ ]
        - bank: { bankId, bankVersion, title, description, skills }
        - createdAt: serverTimestamp()
```

**Accessing Student Data:**
- Progress page (`/progress`) displays all attempts
- Uses `quiz-data.js` methods: `loadAllResultsForUser()`
- Exports to JSON for analysis

## Testing the Architecture

### Local Testing
1. Open `/practice/circles/quiz.html` in a browser
2. Sign in with Google (Firebase auth)
3. Answer some questions
4. Click "End & Score"
5. Verify redirect to `/pages/review.html?attemptId=...`
6. Check that review page shows:
   - Score and metrics
   - All questions with solutions
   - Your answers vs. correct answers

### Verify Firebase Logging
1. Open Firebase Console
2. Navigate to Firestore Database
3. Check `users/{your-uid}/examAttempts/`
4. Verify attempt was saved with all data

### Verify Progress Tracking
1. Visit `/progress` page
2. Sign in if needed
3. See all quiz attempts listed
4. Click on an attempt to view review

## Scalability Benefits

1. **No code duplication**: All quizzes share the same engine
2. **Configuration-driven**: Add new quizzes by editing JSON files
3. **Centralized registry**: One file manages all quiz configs
4. **Flexible question banks**: Easy to add/update questions
5. **Consistent UX**: All quizzes have the same polished interface
6. **Future-proof**: Add new features to quiz-engine.js, all quizzes benefit

## Advanced Features

### Question Randomization
- `pickCount`: Select N random questions from bank
- `seedMode: "perQuiz"`: Same questions for all users (reproducible)
- `seedMode: "perAttempt"`: Different questions each attempt
- `seedMode: null`: Truly random selection

### Timer Configuration
- `timeLimitSec: 0`: No timer (unlimited time)
- `timeLimitSec: 1800`: 30-minute timer
- `pauseOnBlur: true`: Pause timer when user switches tabs

### Rich Solutions
Each question can include:
- `solution.finalAnswer`: The correct answer
- `solution.approach`: High-level strategy
- `solution.steps`: Step-by-step breakdown
- `solution.commonMistakes`: Pitfalls to avoid
- `solution.checks`: How to verify the answer

### Per-Question Analytics
The system tracks:
- Time spent on each question
- Number of visits to each question
- Questions marked for review
- Answers eliminated
- Tab switches and blur events

## Files Reference

### Core Files
- `/assets/js/quiz-registry.js` - Quiz configuration registry
- `/assets/js/quiz-engine.js` - Core quiz execution engine
- `/assets/js/quiz-data.js` - Firebase persistence layer
- `/assets/js/firebase-init.js` - Firebase configuration
- `/pages/review.html` - Summary/review page
- `/assets/js/pages/reviewpage.js` - Review page logic

### Supporting Files
- `/assets/css/quiz.css` - Quiz UI styles
- `/assets/js/shell.js` - Shared header/footer/auth
- `/assets/js/lib/routes.js` - URL routing helpers
- `/assets/js/utils.js` - Utility functions

### Question Banks
- `/assets/questionbank/math/circles.json` - Circles question bank
- Add more banks here for new quizzes

### Quiz Pages
- `/practice/circles/quiz.html` - Circles quiz entry point
- Create similar pages for new quizzes

## Future Enhancements

Potential improvements to the architecture:
1. **Admin UI**: Web interface to add/edit questions
2. **Analytics Dashboard**: Aggregate statistics across all users
3. **Adaptive Learning**: Adjust difficulty based on performance
4. **Study Mode**: Review specific skills or difficulty levels
5. **Question Tags**: More granular categorization
6. **Image Support**: Embed diagrams and charts in questions
7. **Equation Rendering**: MathJax or KaTeX integration
8. **Timed Practice**: Per-question time limits
9. **Explanatory Videos**: Link to video solutions
10. **Peer Comparison**: Anonymous leaderboards

## Support

For questions or issues with the quiz architecture:
1. Check this documentation
2. Review the code comments in core files
3. Test with the circles quiz as a reference implementation
4. Verify Firebase configuration is correct

## Summary

The Dream School Academy quiz architecture is **production-ready and fully scalable**. The circles quiz demonstrates all components working together:

✅ Question banks with rich solution data
✅ Registry-based configuration
✅ Reusable quiz engine
✅ Firebase integration for student profiles
✅ Comprehensive review/feedback system

To add new quizzes, simply:
1. Create a question bank JSON
2. Add an entry to the registry
3. Copy the quiz HTML template

All the infrastructure is in place and working!
