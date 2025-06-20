// Timer settings (in seconds)
let timeLeft = 300;

function startTimer() {
  const timerEl = document.getElementById("timer");
  if (!timerEl) return;

  const storedTime = localStorage.getItem("timeLeft");
  if (storedTime !== null) timeLeft = parseInt(storedTime);

  const interval = setInterval(() => {
    if (timeLeft <= 0) {
      clearInterval(interval);
      alert("Time's up!");
      window.location.href = "results.html";
    } else {
      const minutes = Math.floor(timeLeft / 60);
      const seconds = String(timeLeft % 60).padStart(2, "0");
      timerEl.textContent = `${minutes}:${seconds}`;
      timeLeft--;
      localStorage.setItem("timeLeft", timeLeft);
    }
  }, 1000);
}

function saveAndNext(questionId, nextPage) {
  const selected = document.querySelector(`input[name="${questionId}"]:checked`);
  if (selected) {
    localStorage.setItem(questionId, selected.value);
    window.location.href = nextPage;
  } else {
    alert("Please select an answer before continuing.");
  }
}

function goBack() {
  window.history.back();
}

window.onload = startTimer;
