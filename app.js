import { db } from "./db.js";

// ===== CONFIG =====
const API_URL = "https://script.google.com/macros/s/AKfycby4A2Ci8N6IFLB7oORb7KKThB_jqW580SV0EvG67CZ1FFoudWgLttJ8PyOiqPMKXtDiEQ/exec";

// ---- UI helpers ----
const netStatusEl = document.getElementById("netStatus");
const debugEl = document.getElementById("debug");
const formMeta = document.getElementById("formMeta");

function setStatus(msg) {
  if (netStatusEl) netStatusEl.textContent = msg;
}
function debug(msg) {
  console.log(msg);
  if (debugEl) debugEl.textContent = msg;
}

setStatus("Status: app.js loaded ✅");
debug("app.js running ✅");

// catch errors so they show on screen
window.addEventListener("unhandledrejection", (e) => debug("Promise error: " + e.reason));
window.addEventListener("error", (e) => debug("JS error: " + e.message));

// ---- SW registration ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

// ---- Online status ----
function updateNet() {
  setStatus(`Status: ${navigator.onLine ? "Online" : "Offline"}`);
}
updateNet();
window.addEventListener("online", () => { updateNet(); trySync(); });
window.addEventListener("offline", updateNet);

// ---- device + submission ids ----
function getDeviceId() {
  const k = "mtng_device_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = (crypto.randomUUID?.() || (Date.now() + "_" + Math.random())).toString();
    localStorage.setItem(k, v);
  }
  return v;
}
function newSubmissionId() {
  return crypto.randomUUID?.() || (Date.now() + "_" + Math.random());
}

let currentId = newSubmissionId();
let mode = "new";

const form = document.getElementById("form");
const pageTypeEl = document.getElementById("pageType");
const listCard = document.getElementById("listCard");

// ---- Sketch canvas ----
const canvas = document.getElementById("sketch");
const ctx = canvas.getContext("2d");
ctx.lineWidth = 6;
ctx.lineCap = "round";

let drawing = false;
let last = null;

function pos(ev) {
  const r = canvas.getBoundingClientRect();
  const p = ev.touches ? ev.touches[0] : ev;
  return {
    x: (p.clientX - r.left) * (canvas.width / r.width),
    y: (p.clientY - r.top) * (canvas.height / r.height),
  };
}
function start(ev) { drawing = true; last = pos(ev); }
function move(ev) {
  if (!drawing) return;
  ev.preventDefault();
  const p = pos(ev);
  ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  last = p;
}
function end() { drawing = false; last = null; }

canvas.addEventListener("mousedown", start);
canvas.addEventListener("mousemove", move);
window.addEventListener("mouseup", end);
canvas.addEventListener("touchstart", start, { passive: false });
canvas.addEventListener("touchmove", move, { passive: false });
canvas.addEventListener("touchend", end);

document.getElementById("clearSketch").addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ---- Repeaters ----
const pipeMaterialsEl = document.getElementById("pipeMaterials");
const otherMaterialsEl = document.getElementById("otherMaterials");
const pipeTestsEl = document.getElementById("pipeTests");

function makeRow(fieldsHtml) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.background = "#fafafa";
  wrap.style.border = "1px solid #eee";
  wrap.style.margin = "8px 0";
  wrap.innerHTML = fieldsHtml + `<button type="button" style="margin-top:10px;">Remove</button>`;
  wrap.querySelector("button").addEventListener("click", () => wrap.remove());
  return wrap;
}

function addPipeMaterialRow(data = {}) {
  pipeMaterialsEl.appendChild(makeRow(`
    <label>Size (input)</label><input data-r="pipeMaterials" data-k="Size (input)" value="${data["Size (input)"]||""}">
    <label>Material (input)</label><input data-r="pipeMaterials" data-k="Material (input)" value="${data["Material (input)"]||""}">
    <label>Manufacturer (input)</label><input data-r="pipeMaterials" data-k="Manufacturer (input)" value="${data["Manufacturer (input)"]||""}">
    <label>Date (input)</label><input data-r="pipeMaterials" data-k="Date (input)" value="${data["Date (input)"]||""}">
    <label>Coil # (input)</label><input data-r="pipeMaterials" data-k="Coil # (input)" value="${data["Coil # (input)"]||""}">
    <label>SDR of PE (input)</label><input data-r="pipeMaterials" data-k="SDR of PE (input)" value="${data["SDR of PE (input)"]||""}">
    <label>ST Pipe Thickness (input)</label><input data-r="pipeMaterials" data-k="ST Pipe Thickness (input)" value="${data["ST Pipe Thickness (input)"]||""}">
    <label>Coating Type (input)</label><input data-r="pipeMaterials" data-k="Coating Type (input)" value="${data["Coating Type (input)"]||""}">
    <label>Depth (inches) (input)</label><input data-r="pipeMaterials" data-k="Depth (inches) (input)" value="${data["Depth (inches) (input)"]||""}">
    <label>Length (inches) (input)</label><input data-r="pipeMaterials" data-k="Length (inches) (input)" value="${data["Length (inches) (input)"]||""}">
  `));
}
function addOtherMaterialRow(data = {}) {
  otherMaterialsEl.appendChild(makeRow(`
    <label>Type (input)</label><input data-r="otherMaterials" data-k="Type (input)" value="${data["Type (input)"]||""}">
    <label>Size (input)</label><input data-r="otherMaterials" data-k="Size (input)" value="${data["Size (input)"]||""}">
    <label>Material (input)</label><input data-r="otherMaterials" data-k="Material (input)" value="${data["Material (input)"]||""}">
    <label>Quantity (input)</label><input data-r="otherMaterials" data-k="Quantity (input)" value="${data["Quantity (input)"]||""}">
  `));
}
function addPipeTestRow(data = {}) {
  pipeTestsEl.appendChild(makeRow(`
    <label>Date Tested (input)</label><input data-r="pipeTests" data-k="Date Tested (input)" value="${data["Date Tested (input)"]||""}">
    <label>Test Type (input)</label><input data-r="pipeTests" data-k="Test Type (input)" value="${data["Test Type (input)"]||""}">
    <div class="check" style="margin-top:8px;">
      <input type="checkbox" data-r="pipeTests" data-k="Soaped with no Leaks (checkbox)" ${data["Soaped with no Leaks (checkbox)"] ? "checked" : ""}>
      Soaped with no Leaks (checkbox)
    </div>
    <label>Pressure (input)</label><input data-r="pipeTests" data-k="Pressure (input)" value="${data["Pressure (input)"]||""}">
    <label>Chart (input)</label><input data-r="pipeTests" data-k="Chart (input)" value="${data["Chart (input)"]||""}">
    <label>Duration (input)</label><input data-r="pipeTests" data-k="Duration (input)" value="${data["Duration (input)"]||""}">
    <label>Tested By (input)</label><input data-r="pipeTests" data-k="Tested By (input)" value="${data["Tested By (input)"]||""}">
  `));
}

document.getElementById("addPipeMaterial").addEventListener("click", () => addPipeMaterialRow());
document.getElementById("addOtherMaterial").addEventListener("click", () => addOtherMaterialRow());
document.getElementById("addPipeTest").addEventListener("click", () => addPipeTestRow());

// initial rows
addPipeMaterialRow();
addOtherMaterialRow();
addPipeTestRow();

// ---- Photos compression ----
async function loadImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}
async function fileToCompressedDataUrl(file, maxW = 1024, quality = 0.6) {
  const img = await loadImg(file);
  const scale = img.width > maxW ? maxW / img.width : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

// ---- Gather payload ----
function gatherFields() {
  const fields = {};
  const fd = new FormData(form);
  for (const [k, v] of fd.entries()) fields[k] = v;

  // explicit checkboxes
  fields["Odor Readily Detectable (checkbox)"] =
    !!form.querySelector('input[name="Odor Readily Detectable"]')?.checked;

  const occurred = [
    "Leak Occurred on - Farm Tap",
    "Leak Occurred on - Fitting",
    "Leak Occurred on - Meter",
    "Leak Occurred on - Pipe",
    "Leak Occurred on - Regulator",
    "Leak Occurred on - Tap Connection",
    "Leak Occurred on - Valve",
  ];
  occurred.forEach(name => {
    const el = form.querySelector(`input[name="${name}"]`);
    fields[name + " (checkbox)"] = !!el?.checked;
  });

  return fields;
}

function gatherRepeaters() {
  function readRows(container) {
    const cards = Array.from(container.querySelectorAll(".card"));
    return cards.map(card => {
      const row = {};
      Array.from(card.querySelectorAll("input[data-r]")).forEach(inp => {
        const k = inp.getAttribute("data-k");
        row[k] = inp.type === "checkbox" ? inp.checked : inp.value;
      });
      return row;
    }).filter(r => Object.values(r).some(v => v !== "" && v !== false));
  }
  return {
    pipeMaterials: readRows(pipeMaterialsEl),
    otherMaterials: readRows(otherMaterialsEl),
    pipeTests: readRows(pipeTestsEl),
  };
}

async function buildPayload() {
  const deviceId = getDeviceId();
  const fields = gatherFields();
  const repeaters = gatherRepeaters();

  const sketch = { filename: `sketch_${currentId}.png`, dataUrl: canvas.toDataURL("image/png") };

  const photoInput = document.getElementById("photos");
  const files = Array.from(photoInput.files || []).slice(0, 5);
  const photos = [];
  for (const f of files) {
    const dataUrl = await fileToCompressedDataUrl(f);
    photos.push({ filename: f.name || `photo_${currentId}.jpg`, dataUrl });
  }

  return {
    submissionId: currentId,
    pageType: pageTypeEl.value,
    deviceId,
    createdAt: new Date().toISOString(),
    fields,
    repeaters,
    sketch,
    photos
  };
}

// ---- Submit ----
async function postSubmit(payload) {
  debug("Submitting…");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  debug(`Response HTTP ${res.status}: ${txt.slice(0, 120)}`);
  return txt.includes('"ok":true');
}

async function trySync() {
  if (!navigator.onLine) return;
  const queued = await db.getAll("queue");
  queued.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  for (const item of queued) {
    const ok = await postSubmit(item);
    if (!ok) return;
    await db.del("queue", item.submissionId);
  }
}

async function submitNow() {
  const payload = await buildPayload();

  if (!navigator.onLine) {
    await db.put("queue", payload);
    formMeta.textContent = `Offline — queued: ${payload.submissionId}`;
    alert("Offline: saved and queued.");
    return;
  }

  const ok = await postSubmit(payload);
  if (!ok) {
    await db.put("queue", payload);
    formMeta.textContent = `Submit failed — queued: ${payload.submissionId}`;
    alert("Submit failed — queued.");
  } else {
    await db.del("drafts", payload.submissionId);
    await db.del("queue", payload.submissionId);
    formMeta.textContent = `Submitted: ${payload.submissionId}`;
    alert("Submitted ✅");
  }
}

// ---- Buttons ----
document.getElementById("saveDraft").addEventListener("click", async () => {
  const payload = await buildPayload();
  await db.put("drafts", payload);
  formMeta.textContent = `Saved Draft: ${payload.submissionId}`;
  alert("Draft saved.");
});

document.getElementById("queueForSync").addEventListener("click", async () => {
  const payload = await buildPayload();
  await db.put("queue", payload);
  await db.del("drafts", payload.submissionId);
  formMeta.textContent = `Queued: ${payload.submissionId}`;
  alert("Queued for sync.");
  await trySync();
});

document.getElementById("syncNow").addEventListener("click", trySync);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitNow();
});

document.getElementById("newForm").addEventListener("click", () => {
  currentId = newSubmissionId();
  mode = "new";
  form.reset();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  pipeMaterialsEl.innerHTML = "";
  otherMaterialsEl.innerHTML = "";
  pipeTestsEl.innerHTML = "";
  addPipeMaterialRow();
  addOtherMaterialRow();
  addPipeTestRow();

  formMeta.textContent = `New: ${currentId}`;
});

