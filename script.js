const initialRuns = [
  {name:"Run #105", files:300, gb:9,  buzzer:"1 beep",    result:"SUCCESS", severity:"—",  time:"Fri 10:12 AM"},
  {name:"Run #104", files:350, gb:11, buzzer:"1 beep",    result:"SUCCESS", severity:"—",  time:"Thu 04:40 PM"},
  {name:"Run #103", files:0,   gb:0,  buzzer:"Long tone", result:"FAILED",  severity:"P2", time:"Wed 09:05 AM"},
  {name:"Run #102", files:280, gb:8,  buzzer:"1 beep",    result:"SUCCESS", severity:"—",  time:"Tue 02:05 PM"},
  {name:"Run #101", files:310, gb:10, buzzer:"1 beep",    result:"SUCCESS", severity:"—",  time:"Mon 11:30 AM"}
];

let runs = [...initialRuns];
let nextId = 106;
let running = false;

const $ = id => document.getElementById(id);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ---------- buzzer (Web Audio) ---------- */
let audioCtx;
function beep(ms, freq) {
  if ($("muted").checked) return wait(ms);
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.value = 0.08;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  return wait(ms).then(() => osc.stop());
}
async function playBuzzer(result) {
  if (result === "SUCCESS") {
    await beep(150, 880);
  } else if (result === "PARTIAL") {
    await beep(150, 880); await wait(120); await beep(150, 880);
  } else {
    await beep(1200, 220);
  }
}

/* ---------- dashboard ---------- */
function updateDashboard() {
  const total = runs.length;
  const successful = runs.filter(r => r.result === "SUCCESS").length;
  const failed = runs.filter(r => r.result === "FAILED").length;
  const files = runs.reduce((a, r) => a + r.files, 0);
  const gb = runs.reduce((a, r) => a + r.gb, 0);
  const rate = total ? Math.round(successful / total * 100) : 0;

  $("files").textContent = files.toLocaleString();
  $("gb").textContent = Math.round(gb) + " GB";
  $("failed").textContent = failed;
  $("rate").textContent = rate + "%";
  $("gaugeRate").textContent = rate + "%";
  $("rateText").textContent = total ? (rate >= 80 ? "Healthy archive performance" : "Needs improvement") : "No runs yet";
  $("gauge").style.background = `conic-gradient(#4f46e5 ${rate * 3.6}deg, #e4e7ec ${rate * 3.6}deg)`;

  $("history").innerHTML = runs.map(r => {
    const cls = r.result === "SUCCESS" ? "success-text" : r.result === "PARTIAL" ? "partial-text" : "failed-text";
    const sev = r.severity === "—" ? "—" : `<span class="badge ${r.severity === "P3" ? "partial" : "failed"}">${r.severity}</span>`;
    return `
    <tr>
      <td><b>${r.name}</b></td>
      <td>${r.files.toLocaleString()}</td>
      <td>${r.gb} GB</td>
      <td>${r.buzzer}</td>
      <td class="result ${cls}">${r.result}</td>
      <td>${sev}</td>
      <td>${r.time}</td>
    </tr>`;
  }).join("");
}

function resetStages() {
  ["press", "archive", "buzzer"].forEach(id => { $(id).className = "stage"; });
  $("buzzer").querySelector("span").textContent = "Confirms the result";
}

/* ---------- one archive run ---------- */
function pickOutcome() {
  const forced = $("forceOutcome").value;
  if (forced !== "random") return forced.toUpperCase();
  const r = Math.random();
  return r < 0.12 ? "FAILED" : r < 0.20 ? "PARTIAL" : "SUCCESS";
}

async function runArchive() {
  if (running) return;
  if ($("offline").checked) {
    $("message").textContent = "Device is offline. The press was not sent. Untick “Simulate device offline” to continue.";
    return;
  }
  running = true;
  $("runBtn").disabled = true;
  $("runBtn").textContent = "⏳ Archiving...";
  resetStages();
  $("runStatus").className = "badge running";
  $("runStatus").textContent = "RUNNING";

  const outcome = pickOutcome();

  // 1. Press
  $("message").textContent = "Button held for 2 seconds. Sending command to AWS IoT Core...";
  $("press").classList.add("running");
  await wait(900);
  $("press").classList.remove("running");
  $("press").classList.add("pass");

  // 2. Archive
  $("message").textContent = "Lambda is moving old S3 files to Glacier...";
  $("archive").classList.add("running");
  await wait(1400);
  $("archive").classList.remove("running");
  $("archive").classList.add(outcome === "SUCCESS" ? "pass" : outcome === "PARTIAL" ? "warn" : "fail");

  // numbers for this run
  let files = 0, gb = 0, buzzer = "Long tone", note = "";
  if (outcome !== "FAILED") {
    files = 200 + Math.floor(Math.random() * 200);
    if (outcome === "PARTIAL") files = Math.round(files * 0.7);
    gb = Math.round(files * 0.03 * 10) / 10;
    buzzer = outcome === "SUCCESS" ? "1 beep" : "2 beeps";
  }
  const permission = Math.random() < 0.5;
  if (outcome === "SUCCESS") note = `Archive complete. ${files} files moved to Glacier.`;
  if (outcome === "PARTIAL") note = `Partial run. ${files} files moved, some files left behind.`;
  if (outcome === "FAILED")  note = permission ? "Archive failed: permission error on the bucket." : "Archive failed: the job errored out.";

  // 3. Buzzer
  $("message").textContent = "Result received. Playing buzzer pattern: " + buzzer.toLowerCase() + ".";
  $("buzzer").classList.add("running");
  $("buzzer").querySelector("span").textContent = buzzer;
  await playBuzzer(outcome);
  $("buzzer").classList.remove("running");
  $("buzzer").classList.add(outcome === "SUCCESS" ? "pass" : outcome === "PARTIAL" ? "warn" : "fail");

  finishRun(outcome, files, gb, buzzer, permission, note);
}

function finishRun(outcome, files, gb, buzzer, permission, note) {
  // Severity rules from the proposal: partial = P1, permission error or repeated failure = P2, single failure = P3.
  let severity = "—";
  if (outcome === "PARTIAL") severity = "P1";
  if (outcome === "FAILED") severity = (permission || runs[0]?.result === "FAILED") ? "P2" : "P3";

  runs.unshift({
    name: "Run #" + nextId++,
    files, gb, buzzer,
    result: outcome,
    severity,
    time: new Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})
  });

  const cls = outcome === "SUCCESS" ? "success" : outcome === "PARTIAL" ? "partial" : "failed";
  $("runStatus").className = "badge " + cls;
  $("runStatus").textContent = outcome;
  $("message").textContent = note + (severity !== "—" ? ` Incident raised: ${severity}.` : "");
  updateDashboard();
  $("runBtn").disabled = false;
  $("runBtn").textContent = "🔘 Press Archive Button";
  $("forceOutcome").value = "random";
  running = false;
}

/* ---------- device online / offline ---------- */
$("offline").addEventListener("change", e => {
  const off = e.target.checked;
  $("devicePill").classList.toggle("offline", off);
  $("deviceText").textContent = off ? "Device Offline" : "Device Online";
  $("message").textContent = off
    ? "Button heartbeat stopped. Alarm, dashboard flag and notification raised (P2)."
    : "Device is back online.";
});

$("runBtn").addEventListener("click", runArchive);
$("resetBtn").addEventListener("click", () => {
  if (running) return;
  runs = [...initialRuns];
  nextId = 106;
  resetStages();
  $("runStatus").className = "badge idle";
  $("runStatus").textContent = "IDLE";
  $("message").textContent = "Demo data restored. Click “Press Archive Button” to start.";
  updateDashboard();
});

updateDashboard();