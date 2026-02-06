# Dream School Academy - Quiz System

## Overview

This repository contains a **fully scalable quiz architecture** that powers interactive practice tests for students. The system is production-ready and designed to easily accommodate new quizzes.

## ✅ Current Status

The **Circles quiz** (`/practice/circles/quiz.html`) demonstrates the complete working architecture:

- ✅ **Question Bank**: Pulls from `/assets/questionbank/math/circles.json` (10 questions)
- ✅ **Quiz Execution**: Interactive Bluebook-style UI with timer, navigation, and review features
- ✅ **Firebase Logging**: Automatically saves attempts to student profiles in Firestore
- ✅ **Rich Feedback**: Comprehensive review page with solutions, steps, common mistakes, and verification methods
- ✅ **Student Profiles**: Progress tracking across all quiz attempts

## Quick Start

### Taking a Quiz

1. Visit `/practice/circles/quiz.html`
2. Sign in with Google (optional for testing, required for saving)
3. Answer questions using the interactive interface
4. Click "End & Score" when done
5. Review your results with detailed explanations

### Adding a New Quiz (3 Steps)

1. **Create Question Bank**: Add `/assets/questionbank/{subject}/{topic}.json`
2. **Register Quiz**: Add entry to `/assets/js/quiz-registry.js`
3. **Create Page**: Copy `/practice/circles/quiz.html` to `/practice/{topic}/quiz.html`

See [`docs/ADD_NEW_QUIZ.md`](docs/ADD_NEW_QUIZ.md) for detailed instructions.

## Architecture Components

| Component | File | Purpose |
|-----------|------|---------|
| **Quiz Registry** | `/assets/js/quiz-registry.js` | Central configuration for all quizzes |
| **Quiz Engine** | `/assets/js/quiz-engine.js` | Core quiz execution and UI logic |
| **Question Banks** | `/assets/questionbank/` | JSON files with questions and solutions |
| **Firebase Integration** | `/assets/js/quiz-data.js` | Persistence layer for student data |
| **Review Page** | `/pages/review.html` | Comprehensive feedback after quiz |
| **Quiz Pages** | `/practice/{topic}/quiz.html` | Entry points for each quiz |

## Features

### For Students
- **Interactive Quiz Interface**: Bluebook-style UI with question navigation
- **Timer Support**: Optional time limits with pause capability
- **Mark for Review**: Flag questions to revisit later
- **Eliminate Answers**: Cross out incorrect choices
- **Detailed Feedback**: Solutions with step-by-step explanations, common mistakes, and verification methods
- **Progress Tracking**: All attempts saved to student profile
- **Mobile Friendly**: Responsive design works on all devices

### For Developers
- **Zero Code Duplication**: Single quiz engine powers all quizzes
- **Configuration Driven**: Add quizzes by editing JSON files
- **Rich Question Format**: Support for text, HTML, images, and detailed solutions
- **Randomization**: Configurable question selection and ordering
- **Scalable Firebase Backend**: Automatic data persistence
- **Modular Architecture**: Easy to extend and maintain

## Question Bank Format

```json
{
  "bankId": "math.circles",
  "bankVersion": 1,
  "title": "Math — Circles",
  "description": "Circle geometry topics",
  "skills": ["circumference", "area", "equations"],
  "questions": [
    {
      "questionId": "math.circles.001",
      "version": 1,
      "topic": "math.circles",
      "skill": "circumference",
      "difficulty": "easy",
      "prompt": "A circle has radius 5 cm. What is its circumference?",
      "choices": ["10π cm", "25π cm", "5π cm", "50π cm"],
      "answerIndex": 0,
      "solution": {
        "finalAnswer": "10π cm",
        "approach": "Use the circumference formula",
        "steps": [
          "Use C = 2πr",
          "Substitute r = 5: C = 2π(5)",
          "Simplify: C = 10π"
        ],
        "commonMistakes": [
          "Using area formula instead",
          "Forgetting the factor of 2"
        ],
        "checks": [
          "Units should be cm, not cm²",
          "Doubling r should double C"
        ]
      }
    }
  ]
}
```

## Data Flow

```
Student visits quiz page
    ↓
Quiz ID resolved from URL path
    ↓
Configuration loaded from registry
    ↓
Questions fetched from JSON bank
    ↓
Quiz engine renders UI and manages state
    ↓
Student completes quiz
    ↓
Results saved to Firebase (Firestore)
    ↓
Redirect to review page
    ↓
Comprehensive feedback displayed
    ↓
Attempt logged in student profile
```

## Firebase Structure

```
users/
  {userId}/
    examAttempts/
      {attemptId}/
        - quizId: "circles"
        - title: "Circles"
        - timestamp: "2026-02-06T..."
        - scorePercent: 85
        - durationSeconds: 720
        - totals: { answered, correct, total }
        - items: [ /* questions with answers */ ]
        - bank: { bankId, title, skills, ... }
```

## Documentation

- **[QUIZ_ARCHITECTURE.md](QUIZ_ARCHITECTURE.md)** - Complete technical documentation
- **[docs/ADD_NEW_QUIZ.md](docs/ADD_NEW_QUIZ.md)** - Step-by-step guide for adding quizzes
- **Inline Code Comments** - All JavaScript files are thoroughly documented

## Technology Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend**: Firebase (Authentication + Firestore)
- **Hosting**: GitHub Pages / Static hosting
- **No Build Process**: Pure HTML/CSS/JS for simplicity

## Testing

The circles quiz serves as a reference implementation and can be used to verify:
- Question loading from JSON banks
- Quiz UI functionality (navigation, timer, flags, eliminations)
- Answer submission and scoring
- Firebase data persistence
- Review page rendering
- Progress tracking

## Example Quizzes

Currently implemented:
- **Circles** (`/practice/circles/quiz.html`) - 10 questions on circle geometry

Easy to add:
- Linear Equations
- Quadratic Functions  
- Geometry (triangles, angles, area)
- Algebra (polynomials, factoring)
- Trigonometry
- And any other topics!

## Scalability

The architecture is designed to scale from 1 quiz to 100+ quizzes without code changes:

1. **Single Engine**: All quizzes share the same tested, optimized code
2. **Data-Driven**: Questions stored in JSON, not hardcoded
3. **Configuration-Based**: Registry controls all quiz settings
4. **Stateless Pages**: Quiz pages are templates with no logic
5. **Centralized Review**: One review page handles all quiz results
6. **Shared Firebase**: Single database structure for all attempts

## Contributing

To add a new quiz:

1. Create a question bank JSON file with rich solution data
2. Add an entry to the quiz registry with your quiz settings
3. Create or copy a quiz page HTML file
4. Test thoroughly with the Firebase console
5. Submit a pull request

## Future Enhancements

Potential improvements:
- Admin UI for managing questions
- Analytics dashboard
- Adaptive difficulty
- Study mode by topic/skill
- Question tagging system
- Image/diagram support
- MathJax integration for equations
- Peer comparison features
- Export quiz results to CSV/PDF

## Support

- Check [`QUIZ_ARCHITECTURE.md`](QUIZ_ARCHITECTURE.md) for detailed technical information
- Reference the circles quiz as a working example
- Review browser console for debugging information
- Verify Firebase configuration in `firebase-init.js`

## License

[Add your license here]

## Credits

Dream School Academy - Making test prep interactive and effective.
