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

// ---- Section show/hide (4 pages) ----
const sectionLeakRepair = document.getElementById("sectionLeakRepair");
const sectionMains = document.getElementById("sectionMains");
const sectionRetirement = document.getElementById("sectionRetirement");
const sectionServices = document.getElementById("sectionServices");

function updatePageSections() {
  const pt = pageTypeEl?.value || "Leak Repair";
  if (sectionLeakRepair) sectionLeakRepair.style.display = (pt === "Leak Repair") ? "block" : "none";
  if (sectionMains) sectionMains.style.display = (pt === "Mains") ? "block" : "none";
  if (sectionRetirement) sectionRetirement.style.display = (pt === "Retirement") ? "block" : "none";
  if (sectionServices) sectionServices.style.display = (pt === "Services") ? "block" : "none";
}
pageTypeEl?.addEventListener("change", updatePageSections);
updatePageSections();

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

document.getElementById("clearSketch")?.addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ---- Repeater helpers ----
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

function readRows(container) {
  if (!container) return [];
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

// =====================================================
// LEAK REPAIR REPEATERS
// =====================================================
const pipeMaterialsEl = document.getElementById("pipeMaterials");
const otherMaterialsEl = document.getElementById("otherMaterials");
const pipeTestsEl = document.getElementById("pipeTests");

function addPipeMaterialRow(data = {}) {
  pipeMaterialsEl?.appendChild(makeRow(`
    <label>Size</label><input data-r="pipeMaterials" data-k="Size" value="${data["Size"]||""}">
    <label>Material</label><input data-r="pipeMaterials" data-k="Material" value="${data["Material"]||""}">
    <label>Manufacturer</label><input data-r="pipeMaterials" data-k="Manufacturer" value="${data["Manufacturer"]||""}">
    <label>Date</label><input data-r="pipeMaterials" data-k="Date" value="${data["Date"]||""}">
    <label>Coil #</label><input data-r="pipeMaterials" data-k="Coil #" value="${data["Coil #"]||""}">
    <label>SDR of PE</label><input data-r="pipeMaterials" data-k="SDR of PE" value="${data["SDR of PE"]||""}">
    <label>ST Pipe Thickness</label><input data-r="pipeMaterials" data-k="ST Pipe Thickness" value="${data["ST Pipe Thickness"]||""}">
    <label>Coating Type</label><input data-r="pipeMaterials" data-k="Coating Type" value="${data["Coating Type"]||""}">
    <label>Depth (inches)</label><input data-r="pipeMaterials" data-k="Depth (inches)" value="${data["Depth (inches)"]||""}">
    <label>Length (inches)</label><input data-r="pipeMaterials" data-k="Length (inches)" value="${data["Length (inches)"]||""}">
  `));
}
function addOtherMaterialRow(data = {}) {
  otherMaterialsEl?.appendChild(makeRow(`
    <label>Type</label><input data-r="otherMaterials" data-k="Type" value="${data["Type"]||""}">
    <label>Size</label><input data-r="otherMaterials" data-k="Size" value="${data["Size"]||""}">
    <label>Material</label><input data-r="otherMaterials" data-k="Material" value="${data["Material"]||""}">
    <label>Quantity</label><input data-r="otherMaterials" data-k="Quantity" value="${data["Quantity"]||""}">
  `));
}
function addPipeTestRow(data = {}) {
  pipeTestsEl?.appendChild(makeRow(`
    <label>Date Tested</label><input data-r="pipeTests" data-k="Date Tested" value="${data["Date Tested"]||""}">
    <label>Test Type</label><input data-r="pipeTests" data-k="Test Type" value="${data["Test Type"]||""}">
    <div class="check" style="margin-top:8px;">
      <input type="checkbox" data-r="pipeTests" data-k="Soaped with no Leaks" ${data["Soaped with no Leaks"] ? "checked" : ""}>
      Soaped with no Leaks
    </div>
    <label>Pressure</label><input data-r="pipeTests" data-k="Pressure" value="${data["Pressure"]||""}">
    <label>Chart</label><input data-r="pipeTests" data-k="Chart" value="${data["Chart"]||""}">
    <label>Duration</label><input data-r="pipeTests" data-k="Duration" value="${data["Duration"]||""}">
    <label>Tested By</label><input data-r="pipeTests" data-k="Tested By" value="${data["Tested By"]||""}">
  `));
}

document.getElementById("addPipeMaterial")?.addEventListener("click", () => addPipeMaterialRow());
document.getElementById("addOtherMaterial")?.addEventListener("click", () => addOtherMaterialRow());
document.getElementById("addPipeTest")?.addEventListener("click", () => addPipeTestRow());

// initial rows for leak repair containers only if present
if (pipeMaterialsEl) addPipeMaterialRow();
if (otherMaterialsEl) addOtherMaterialRow();
if (pipeTestsEl) addPipeTestRow();

// =====================================================
// MAINS REPEATERS
// =====================================================
const mainsMaterialsEl = document.getElementById("mainsMaterials");
const mainsOtherMaterialsEl = document.getElementById("mainsOtherMaterials");
const mainsPipeTestsEl = document.getElementById("mainsPipeTests");

function addMainsMaterialRow(data = {}) {
  mainsMaterialsEl?.appendChild(makeRow(`
    <label>Size</label><input data-r="mainsMaterials" data-k="Size" value="${data["Size"]||""}">
    <label>Material</label><input data-r="mainsMaterials" data-k="Material" value="${data["Material"]||""}">
    <label>Manufacturer</label><input data-r="mainsMaterials" data-k="Manufacturer" value="${data["Manufacturer"]||""}">
    <label>Date</label><input data-r="mainsMaterials" data-k="Date" value="${data["Date"]||""}">
    <label>Coil #</label><input data-r="mainsMaterials" data-k="Coil #" value="${data["Coil #"]||""}">
    <label>SDR of PE</label><input data-r="mainsMaterials" data-k="SDR of PE" value="${data["SDR of PE"]||""}">
    <label>ST Pipe Thickness</label><input data-r="mainsMaterials" data-k="ST Pipe Thickness" value="${data["ST Pipe Thickness"]||""}">
    <label>Coating Types</label><input data-r="mainsMaterials" data-k="Coating Types" value="${data["Coating Types"]||""}">
    <label>Depth (inches)</label><input data-r="mainsMaterials" data-k="Depth (inches)" value="${data["Depth (inches)"]||""}">
    <label>Length (inches)</label><input data-r="mainsMaterials" data-k="Length (inches)" value="${data["Length (inches)"]||""}">
  `));
}
function addMainsOtherMaterialRow(data = {}) {
  mainsOtherMaterialsEl?.appendChild(makeRow(`
    <label>Type</label><input data-r="mainsOtherMaterials" data-k="Type" value="${data["Type"]||""}">
    <label>Size</label><input data-r="mainsOtherMaterials" data-k="Size" value="${data["Size"]||""}">
    <label>Material</label><input data-r="mainsOtherMaterials" data-k="Material" value="${data["Material"]||""}">
    <label>Quantity</label><input data-r="mainsOtherMaterials" data-k="Quantity" value="${data["Quantity"]||""}">
  `));
}
function addMainsPipeTestRow(data = {}) {
  mainsPipeTestsEl?.appendChild(makeRow(`
    <label>Date Tested</label><input data-r="mainsPipeTests" data-k="Date Tested" value="${data["Date Tested"]||""}">
    <label>Test Type</label><input data-r="mainsPipeTests" data-k="Test Type" value="${data["Test Type"]||""}">
    <div class="check" style="margin-top:8px;">
      <input type="checkbox" data-r="mainsPipeTests" data-k="Soaped with no Leaks" ${data["Soaped with no Leaks"] ? "checked" : ""}>
      Soaped with no Leaks
    </div>
    <label>Pressure</label><input data-r="mainsPipeTests" data-k="Pressure" value="${data["Pressure"]||""}">
    <label>Chart</label><input data-r="mainsPipeTests" data-k="Chart" value="${data["Chart"]||""}">
    <label>Duration</label><input data-r="mainsPipeTests" data-k="Duration" value="${data["Duration"]||""}">
    <label>Tested By</label><input data-r="mainsPipeTests" data-k="Tested By" value="${data["Tested By"]||""}">
  `));
}
document.getElementById("addMainsMaterial")?.addEventListener("click", () => addMainsMaterialRow());
document.getElementById("addMainsOtherMaterial")?.addEventListener("click", () => addMainsOtherMaterialRow());
document.getElementById("addMainsPipeTest")?.addEventListener("click", () => addMainsPipeTestRow());

if (mainsMaterialsEl) addMainsMaterialRow();
if (mainsOtherMaterialsEl) addMainsOtherMaterialRow();
if (mainsPipeTestsEl) addMainsPipeTestRow();

// =====================================================
// SERVICES REPEATERS
// =====================================================
const svcMaterialsEl = document.getElementById("svcMaterials");
const svcOtherMaterialsEl = document.getElementById("svcOtherMaterials");
const svcPipeTestsEl = document.getElementById("svcPipeTests");

function addSvcMaterialRow(data = {}) {
  svcMaterialsEl?.appendChild(makeRow(`
    <label>Size</label><input data-r="svcMaterials" data-k="Size" value="${data["Size"]||""}">
    <label>Material</label><input data-r="svcMaterials" data-k="Material" value="${data["Material"]||""}">
    <label>Manufacturer</label><input data-r="svcMaterials" data-k="Manufacturer" value="${data["Manufacturer"]||""}">
    <label>Date</label><input data-r="svcMaterials" data-k="Date" value="${data["Date"]||""}">
    <label>Coil #</label><input data-r="svcMaterials" data-k="Coil #" value="${data["Coil #"]||""}">
    <label>SDR of PE</label><input data-r="svcMaterials" data-k="SDR of PE" value="${data["SDR of PE"]||""}">
    <label>ST Pipe Thickness</label><input data-r="svcMaterials" data-k="ST Pipe Thickness" value="${data["ST Pipe Thickness"]||""}">
    <label>Coating Types</label><input data-r="svcMaterials" data-k="Coating Types" value="${data["Coating Types"]||""}">
    <label>Depth (inches)</label><input data-r="svcMaterials" data-k="Depth (inches)" value="${data["Depth (inches)"]||""}">
    <label>Length (inches)</label><input data-r="svcMaterials" data-k="Length (inches)" value="${data["Length (inches)"]||""}">
  `));
}
function addSvcOtherMaterialRow(data = {}) {
  svcOtherMaterialsEl?.appendChild(makeRow(`
    <label>Type</label><input data-r="svcOtherMaterials" data-k="Type" value="${data["Type"]||""}">
    <label>Size</label><input data-r="svcOtherMaterials" data-k="Size" value="${data["Size"]||""}">
    <label>Material</label><input data-r="svcOtherMaterials" data-k="Material" value="${data["Material"]||""}">
    <label>Quantity</label><input data-r="svcOtherMaterials" data-k="Quantity" value="${data["Quantity"]||""}">
  `));
}
function addSvcPipeTestRow(data = {}) {
  svcPipeTestsEl?.appendChild(makeRow(`
    <label>Date Tested</label><input data-r="svcPipeTests" data-k="Date Tested" value="${data["Date Tested"]||""}">
    <label>Test Type</label><input data-r="svcPipeTests" data-k="Test Type" value="${data["Test Type"]||""}">
    <div class="check" style="margin-top:8px;">
      <input type="checkbox" data-r="svcPipeTests" data-k="Soaped with no Leaks" ${data["Soaped with no Leaks"] ? "checked" : ""}>
      Soaped with no Leaks
    </div>
    <label>Pressure</label><input data-r="svcPipeTests" data-k="Pressure" value="${data["Pressure"]||""}">
    <label>Chart</label><input data-r="svcPipeTests" data-k="Chart" value="${data["Chart"]||""}">
    <label>Duration</label><input data-r="svcPipeTests" data-k="Duration" value="${data["Duration"]||""}">
    <label>Tested By</label><input data-r="svcPipeTests" data-k="Tested By" value="${data["Tested By"]||""}">
  `));
}
document.getElementById("addSvcMaterial")?.addEventListener("click", () => addSvcMaterialRow());
document.getElementById("addSvcOtherMaterial")?.addEventListener("click", () => addSvcOtherMaterialRow());
document.getElementById("addSvcPipeTest")?.addEventListener("click", () => addSvcPipeTestRow());

if (svcMaterialsEl) addSvcMaterialRow();
if (svcOtherMaterialsEl) addSvcOtherMaterialRow();
if (svcPipeTestsEl) addSvcPipeTestRow();

// =====================================================
// RETIREMENT REPEATERS
// =====================================================
const retSectionEl = document.getElementById("retSection");
const retStructuresEl = document.getElementById("retStructures");
const retNewMaterialsEl = document.getElementById("retNewMaterials");

function addRetSectionRow(data = {}) {
  retSectionEl?.appendChild(makeRow(`
    <label>Size</label><input data-r="retSection" data-k="Size" value="${data["Size"]||""}">
    <label>Material</label><input data-r="retSection" data-k="Material" value="${data["Material"]||""}">
    <label>Pipe Condition</label><input data-r="retSection" data-k="Pipe Condition" value="${data["Pipe Condition"]||""}">
    <label>Retired in Place</label><input data-r="retSection" data-k="Retired in Place" value="${data["Retired in Place"]||""}">
    <label>Riser Removed</label><input data-r="retSection" data-k="Riser Removed" value="${data["Riser Removed"]||""}">
    <label>Length (feet)</label><input data-r="retSection" data-k="Length (feet)" value="${data["Length (feet)"]||""}">
  `));
}
function addRetStructuresRow(data = {}) {
  retStructuresEl?.appendChild(makeRow(`
    <label>Structures Retired</label><input data-r="retStructures" data-k="Structures Retired" value="${data["Structures Retired"]||""}">
    <label>Number</label><input data-r="retStructures" data-k="Number" value="${data["Number"]||""}">
    <label>Action Taken</label><input data-r="retStructures" data-k="Action Taken" value="${data["Action Taken"]||""}">
  `));
}
function addRetNewMaterialsRow(data = {}) {
  retNewMaterialsEl?.appendChild(makeRow(`
    <label>Materials Used</label><input data-r="retNewMaterials" data-k="Materials Used" value="${data["Materials Used"]||""}">
    <label>Size</label><input data-r="retNewMaterials" data-k="Size" value="${data["Size"]||""}">
    <label>Material</label><input data-r="retNewMaterials" data-k="Material" value="${data["Material"]||""}">
    <label>Quantity</label><input data-r="retNewMaterials" data-k="Quantity" value="${data["Quantity"]||""}">
  `));
}
document.getElementById("addRetSection")?.addEventListener("click", () => addRetSectionRow());
document.getElementById("addRetStructures")?.addEventListener("click", () => addRetStructuresRow());
document.getElementById("addRetNewMaterials")?.addEventListener("click", () => addRetNewMaterialsRow());

if (retSectionEl) addRetSectionRow();
if (retStructuresEl) addRetStructuresRow();
if (retNewMaterialsEl) addRetNewMaterialsRow();

// ---- Gather payload ----
function gatherFields() {
  const fields = {};
  const fd = new FormData(form);
  for (const [k, v] of fd.entries()) fields[k] = v;

  // Explicit checkboxes (unchecked checkboxes won't appear in FormData)
  fields["Odor Readily Detectable"] =
    !!form.querySelector('input[name="Odor Readily Detectable"]')?.checked;

  // Leak Occurred On checkboxes
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
    fields[name] = !!el?.checked;
  });

  // Bore/Rock checkboxes used on Mains/Services
  const boreChecks = [
    "Bore",
    "Directional Bore",
    "Rock Bore",
    "Rock 6x18",
    "Rock 12x18",
    "Rock 18x18",
    "Rock 24x24",
  ];
  boreChecks.forEach(name => {
    const el = form.querySelector(`input[name="${name}"]`);
    if (el) fields[name] = !!el.checked;
  });

  // Retirement checkbox
  const soapRet = form.querySelector('input[name="Soaped with no leaks"]');
  if (soapRet) fields["Soaped with no leaks"] = !!soapRet.checked;

  return fields;
}

function gatherRepeaters() {
  return {
    // Leak Repair
    pipeMaterials: readRows(pipeMaterialsEl),
    otherMaterials: readRows(otherMaterialsEl),
    pipeTests: readRows(pipeTestsEl),

    // Mains
    mainsMaterials: readRows(mainsMaterialsEl),
    mainsOtherMaterials: readRows(mainsOtherMaterialsEl),
    mainsPipeTests: readRows(mainsPipeTestsEl),

    // Services
    svcMaterials: readRows(svcMaterialsEl),
    svcOtherMaterials: readRows(svcOtherMaterialsEl),
    svcPipeTests: readRows(svcPipeTestsEl),

    // Retirement
    retSection: readRows(retSectionEl),
    retStructures: readRows(retStructuresEl),
    retNewMaterials: readRows(retNewMaterialsEl),
  };
}

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
document.getElementById("saveDraft")?.addEventListener("click", async () => {
  const payload = await buildPayload();
  await db.put("drafts", payload);
  formMeta.textContent = `Saved Draft: ${payload.submissionId}`;
  alert("Draft saved.");
});

document.getElementById("queueForSync")?.addEventListener("click", async () => {
  const payload = await buildPayload();
  await db.put("queue", payload);
  await db.del("drafts", payload.submissionId);
  formMeta.textContent = `Queued: ${payload.submissionId}`;
  alert("Queued for sync.");
  await trySync();
});

document.getElementById("syncNow")?.addEventListener("click", trySync);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitNow();
});

document.getElementById("newForm")?.addEventListener("click", () => {
  currentId = newSubmissionId();
  mode = "new";
  form.reset();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Clear all repeater containers
  if (pipeMaterialsEl) { pipeMaterialsEl.innerHTML = ""; addPipeMaterialRow(); }
  if (otherMaterialsEl) { otherMaterialsEl.innerHTML = ""; addOtherMaterialRow(); }
  if (pipeTestsEl) { pipeTestsEl.innerHTML = ""; addPipeTestRow(); }

  if (mainsMaterialsEl) { mainsMaterialsEl.innerHTML = ""; addMainsMaterialRow(); }
  if (mainsOtherMaterialsEl) { mainsOtherMaterialsEl.innerHTML = ""; addMainsOtherMaterialRow(); }
  if (mainsPipeTestsEl) { mainsPipeTestsEl.innerHTML = ""; addMainsPipeTestRow(); }

  if (svcMaterialsEl) { svcMaterialsEl.innerHTML = ""; addSvcMaterialRow(); }
  if (svcOtherMaterialsEl) { svcOtherMaterialsEl.innerHTML = ""; addSvcOtherMaterialRow(); }
  if (svcPipeTestsEl) { svcPipeTestsEl.innerHTML = ""; addSvcPipeTestRow(); }

  if (retSectionEl) { retSectionEl.innerHTML = ""; addRetSectionRow(); }
  if (retStructuresEl) { retStructuresEl.innerHTML = ""; addRetStructuresRow(); }
  if (retNewMaterialsEl) { retNewMaterialsEl.innerHTML = ""; addRetNewMaterialsRow(); }

  formMeta.textContent = `New: ${currentId}`;
  updatePageSections();
});
