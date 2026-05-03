

// Outer parentheses force the [anonynmous] function to be treated as a function expression instead of a function declaration.
// This allows it to run immediately.
(function () {
  "use strict";

// Prevent double initialization (important if scripts load twice)
// Checks whether Firebase is already initialized before running the rest of the code.
// The condition uses && to ensure three things: window.firebase exists, firebase.apps exists, and firebase.apps.length is greater than 0 (meaning at least one app is already initialized).
//  If all three are true, return; exits the function immediately, preventing Firebase from being initialized a second time.
  if (window.firebase && firebase.apps && firebase.apps.length) {
    return;
  }

  // Firebase configuration

const firebaseConfig = {
  apiKey: "AIzaSyD7R7ZsmTpGojgLNt7w_R0tm_mWg_FZEYE",
  authDomain: "dream-school-academy.firebaseapp.com",
  projectId: "dream-school-academy",
  storageBucket: "dream-school-academy.firebasestorage.app",
  messagingSenderId: "665412130733",
  appId: "1:665412130733:web:fc73f3ed574ffb6d277324",
  measurementId: "G-7LY2V2HQ4G"
};
//Why not let? — let allows reassignment, but this config should never be reassigned, so const better enforces intent.
//Why not var? — var is function-scoped and can be redeclared, which can lead to bugs and unpredictable behavior, so modern code avoids it in favor of const or let.




  
  try {
    firebase.initializeApp(firebaseConfig); // connects your app to Firebase using your project settings
  } catch (err) { //  If something goes wrong, the catch (err) block runs.
    // Ignore duplicate-app errors but surface real ones
    if (!/already exists/i.test(err.message)) { // checks the error message by looking for the phrase “already exists” regardless of capitalization
      console.error("[firebase-init-compat] init failed:", err); // For any other error, the code logs a message to the console.
      throw err; // stops execution & shows the real prolem
    }
  }

// checks that Firebase Authentication and Firestore were loaded correctly.
  
  if (typeof firebase.auth !== "function") { //tests whether firebase.auth exists and is usable
    console.error("[firebase-init-compat] firebase.auth() missing"); // if not, it logs an error to the console saying it is missing
  }

  if (typeof firebase.firestore !== "function") { // ame check for firebase.firestore
    console.error("[firebase-init-compat] firebase.firestore() missing");
  }
})(); // end of an Immediately Invoked Function Expression (IIFE)
// ) closes the function expression that started with (function () {, turning it into a value instead of a declaration.
// () right after it immediately calls (executes) that function
// ; just ends the statement
// Together, this pattern means “define a function and run it immediately,” while keeping its variables out of the global scope.
