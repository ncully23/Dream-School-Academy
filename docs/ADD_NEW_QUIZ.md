# Quick Start: Adding a New Quiz

This guide shows you how to add a new quiz in 3 simple steps.

## Prerequisites

- The circles quiz (`/practice/circles/quiz.html`) is already working as a reference
- All the infrastructure (quiz engine, Firebase, review page) is in place

## Step 1: Create Question Bank JSON

Create: `/assets/questionbank/{subject}/{topic}.json`

**Example**: `/assets/questionbank/math/linear-equations.json`

```json
{
  "bankId": "math.linear-equations",
  "bankVersion": 1,
  "title": "Math — Linear Equations",
  "description": "Solving linear equations in one variable",
  "skills": ["solving", "simplifying", "word-problems"],
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
          "Divide both sides by 2: x = 4"
        ],
        "commonMistakes": [
          "Forgetting to do the same operation on both sides"
        ],
        "checks": [
          "Substitute back: 2(4) + 5 = 8 + 5 = 13 ✓"
        ]
      }
    }
  ]
}
```

## Step 2: Register in Quiz Registry

Edit: `/assets/js/quiz-registry.js`

Add your quiz configuration to the REGISTRY object.

## Step 3: Create Quiz Page

Copy the circles quiz template:
```bash
mkdir -p practice/your-topic
cp practice/circles/quiz.html practice/your-topic/quiz.html
```

The page automatically extracts the quiz ID from the path.

For complete documentation, see `QUIZ_ARCHITECTURE.md` in the root directory.
