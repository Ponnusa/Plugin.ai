const allowMicBtn = document.getElementById("allowMicBtn");
const micSetupStatusEl = document.getElementById("micSetupStatus");

allowMicBtn.addEventListener("click", async () => {
  micSetupStatusEl.textContent = "Requesting access...";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop()); // we only needed the permission grant, not an open mic
    micSetupStatusEl.textContent = "Microphone access granted. You can close this tab and return to Beacon AI.";
    allowMicBtn.hidden = true;
  } catch (err) {
    micSetupStatusEl.textContent =
      "Microphone access was denied. Check chrome://settings/content/microphone and remove this extension " +
      "from the blocked list, then try again.";
  }
});
