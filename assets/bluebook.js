let startTime = Date.now();
let showClock = true;
const timerElement = document.getElementById("timer");
const clockToggle = document.getElementById("toggleClock");

setInterval(() => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  if (showClock) {
    timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}, 1000);

function toggleClock() {
  showClock = !showClock;
  timerElement.style.visibility = showClock ? "visible" : "hidden";
  clockToggle.innerText = showClock ? "Hide" : "Show";
}
