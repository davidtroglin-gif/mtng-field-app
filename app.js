import { db } from "./db.js";

// ===== CONFIG =====
const API_URL = "https://script.google.com/macros/s/AKfycby4A2Ci8N6IFLB7oORb7KKThB_jqW580SV0EvG67CZ1FFoudWgLttJ8PyOiqPMKXtDiEQ/exec"; // .../exec

// ---- SW registration ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

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
let mode = "new"; // new | editDraft | editQueued

const form = document.getElementById("form");
const pageTypeEl = document.getElementById("pageType");
const netStatus = document.getElementById("netStatus");
const listCard = document.getElementById("listCard");
const formMeta = document.getElementById("formMeta");

// ---- Online status ----
function updateNet() {
  netStatus.textContent = `Status: ${navigator.onLine ? "Online" : "Offline"}`;
}
updateNet();
window.addEventListener("online", () => { updateNet(); trySync(); });
window.addEventListener("offline", updateNet);

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
function start(ev){ drawing = true; last = pos(ev); }
function move(ev){
  if (!drawing) return;
  ev.preventDefault();
  const p = pos(ev);
  ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
  last = p;
}
function end(){ drawing = false; last = null; }

canvas.addEventListener("mousedown", start);
canvas.addEventListener("mousemove", move);
window.addEventListener("mouseup", end);
canvas.addEventListener("touchstart", start, { passive:false });
canvas.addEventListener("touchmove", move, { passive:false });
canvas.addEventListener("touchend", end);

document.getElementById("clearSketch").addEventListener("click", () => {
  ctx.clearRect(0,0,canvas.width,canvas.height);
});

// ---- Repeaters (Leak Repair MVP) ----
const pipeMaterialsEl = document.getElementById("pipeMaterials");
const otherMaterialsEl = document.getElementById("otherMaterials");
const pipeTestsEl = document.getElementById("pipeTests");

function makeRow(fields, onRemove) {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.background = "#fafafa";
  wrap.style.border = "1px solid #eee";
  wrap.style.margin = "8px 0";
  wrap.innerHTML = fields + `<button type="button" style="margin-top:10px;">Remove</button>`;
  wrap.querySelector("button").addEventListener("click", () => {
    wrap.remove();
    onRemove?.();
  });
  return wrap;
}

function addPipeMaterialRow(data = {}) {
  const row = makeRow(`
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
  `);
  pipeMaterialsEl.appendChild(row);
}

function addOtherMaterialRow(data = {}) {
  const row = makeRow(`
    <label>Type (input)</label><input data-r="otherMaterials" data-k="Type (input)" value="${data["Type (input)"]||""}">
    <label>Size (input)</label><input data-r="otherMaterials" data-k="Size (input)" value="${data["Size (input)"]||""}">
    <label>Material (input)</label><input data-r="otherMaterials" data-k="Material (input)" value="${data["Material (input)"]||""}">
    <label>Quantity (input)</label><input data-r="otherMaterials" data-k="Quantity (input)" value="${data["Quantity (input)"]||""}">
  `);
  otherMaterialsEl.appendChild(row);
}

function addPipeTestRow(data = {}) {
  const row = makeRow(`
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
  `);
  pipeTestsEl.appendChild(row);
}

document.getElementById("addPipeMaterial").addEventListener("click", () => addPipeMaterialRow());
document.getElementById("addOtherMaterial").addEventListener("click", () => addOtherMaterialRow());
document.getElementById("addPipeTest").addEventListener("click", () => addPipeTestRow());

// Start with one row each for usability
addPipeMaterialRow();
addOtherMaterialRow();
addPipeTestRow();

// ---- Photos: compress to JPEG dataUrl ----
async function fileToCompressedDataUrl(file, maxW = 1280, quality = 0.75) {
  const img = await loadImg(file);
  const scale = img.width > maxW ? maxW / img.width : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}
function loadImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

// ---- Gather form -> payload ----
function gatherFields() {
  const fields = {};
  const fd = new FormData(form);

  for (const [k, v] of fd.entries()) {
    fields[k] = v;
  }

  // checkboxes not in FormData if unchecked; handle explicit ones
  fields["Odor Readily Detectable (checkbox)"] = !!form.querySelector('input[name="Odor Readily Detectable"]').checked;

  // Leak Occurred on (section) checkboxes
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
    fields[name + " (checkbox)"] = !!form.querySelector(`input[name="${name}"]`)?.checked;
  });

  return fields;
}

function gatherRepeaters() {
  const readRows = (container, key) => {
    const cards = Array.from(container.querySelectorAll(".card"));
    const rows = [];
    for (const card of cards) {
      const inputs = Array.from(card.querySelectorAll("input[data-r]"));
      const row = {};
      inputs.forEach(inp => {
        const k = inp.getAttribute("data-k");
        row[k] = (inp.type === "checkbox") ? inp.checked : inp.value;
      });
      // skip empty rows (optional)
      if (Object.values(row).some(v => v !== "" && v !== false)) rows.push(row);
    }
    return rows;
  };

  return {
    pipeMaterials: readRows(pipeMaterialsEl, "pipeMaterials"),
    otherMaterials: readRows(otherMaterialsEl, "otherMaterials"),
    pipeTests: readRows(pipeTestsEl, "pipeTests"),
  };
}

async function buildPayload() {
  const deviceId = getDeviceId();
  const fields = gatherFields();
  const repeaters = gatherRepeaters();

  // sketch
  const sketch = { filename: `sketch_${currentId}.png`, dataUrl: canvas.toDataURL("image/png") };

  // photos (max 5)
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

// ---- Drafts / Queue / Sync ----
async function saveDraft() {
  const payload = await buildPayload();
  await db.put("drafts", payload);
  formMeta.textContent = `Saved Draft: ${payload.submissionId}`;
}

async function queueForSync() {
  const payload = await buildPayload();
  await db.put("queue", payload);
  await db.del("drafts", payload.submissionId);
  formMeta.textContent = `Queued: ${payload.submissionId}`;
  await trySync();
}

async function submitNow() {
  const payload = await buildPayload();
  // Submit immediately if online; otherwise queue.
  if (!navigator.onLine) {
    await db.put("queue", payload);
    formMeta.textContent = `Offline — queued: ${payload.submissionId}`;
    return;
  }
  const ok = await postSubmit(payload);
  if (!ok) {
    await db.put("queue", payload);
    formMeta.textContent = `Submit failed — queued: ${payload.submissionId}`;
  } else {
    await db.del("drafts", payload.submissionId);
    await db.del("queue", payload.submissionId);
    formMeta.textContent = `Submitted: ${payload.submissionId}`;
  }
}

async function postSubmit(payload, isUpdate = false) {
  const url = isUpdate ? `${API_URL}?action=update` : API_URL;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      // IMPORTANT: avoid CORS preflight
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const txt = await res.text();
  return txt.includes('"ok":true');
}

async function trySync() {
  if (!navigator.onLine) return;

  const queued = await db.getAll("queue");
  // oldest first
  queued.sort((a,b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  for (const item of queued) {
    const ok = await postSubmit(item, false);
    if (!ok) return;
    await db.del("queue", item.submissionId);
  }
}

async function submitNow() {
  try {
    const payload = await buildPayload();

    if (!navigator.onLine) {
      await db.put("queue", payload);
      formMeta.textContent = `Offline — queued: ${payload.submissionId}`;
      alert("Offline: saved and queued.");
      return;
    }

    const ok = await postSubmit(payload, false);

    if (!ok) {
      await db.put("queue", payload);
      formMeta.textContent = `Submit failed — queued: ${payload.submissionId}`;
      alert("Submit failed (likely permissions). Saved and queued for sync.");
    } else {
      await db.del("drafts", payload.submissionId);
      await db.del("queue", payload.submissionId);
      formMeta.textContent = `Submitted: ${payload.submissionId}`;
      alert("Submitted successfully.");
    }
  } catch (err) {
    console.error(err);
    alert("Submit error: " + err);
  }
}


document.getElementById("saveDraft").addEventListener("click", saveDraft);
document.getElementById("queueForSync").addEventListener("click", queueForSync);
document.getElementById("syncNow").addEventListener("click", trySync);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitNow();
});

// ---- New form ----
document.getElementById("newForm").addEventListener("click", () => {
  currentId = newSubmissionId();
  mode = "new";
  form.reset();
  ctx.clearRect(0,0,canvas.width,canvas.height);
  pipeMaterialsEl.innerHTML = "";
  otherMaterialsEl.innerHTML = "";
  pipeTestsEl.innerHTML = "";
  addPipeMaterialRow();
  addOtherMaterialRow();
  addPipeTestRow();
  formMeta.textContent = `New: ${currentId}`;
});

// ---- Lists (Drafts / Queue) ----
async function showList(storeName, title) {
  const items = await db.getAll(storeName);
  listCard.style.display = "block";
  listCard.innerHTML = `
    <h3 style="margin:0 0 10px;">${title} (${items.length})</h3>
    ${items.map(i => `
      <div class="card" style="margin:8px 0;">
        <div><b>${i.pageType}</b></div>
        <div class="small">${i.submissionId}</div>
        <div class="small">${i.fields?.["Customer Name"] || ""} — ${i.fields?.["Date"] || ""}</div>
        <div class="btnrow" style="margin-top:10px;">
          <button type="button" data-open="${i.submissionId}" data-store="${storeName}">Open</button>
          <button type="button" data-del="${i.submissionId}" data-store="${storeName}">Delete</button>
        </div>
      </div>
    `).join("")}
  `;

  listCard.querySelectorAll("button[data-open]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-open");
      const store = btn.getAttribute("data-store");
      const record = await db.get(store, id);
      if (record) loadIntoForm(record, store);
    });
  });

  listCard.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      const store = btn.getAttribute("data-store");
      await db.del(store, id);
      await showList(storeName, title);
    });
  });
}

function loadIntoForm(record, store) {
  currentId = record.submissionId;
  pageTypeEl.value = record.pageType;

  // fill normal fields
  for (const [k,v] of Object.entries(record.fields || {})) {
    const el = form.querySelector(`[name="${CSS.escape(k)}"]`);
    if (el) el.value = v;
  }

  // checkboxes
  const odor = form.querySelector('input[name="Odor Readily Detectable"]');
  if (odor) odor.checked = !!record.fields?.["Odor Readily Detectable (checkbox)"];

  // Leak occurred checkboxes
  Object.entries(record.fields || {}).forEach(([k,v]) => {
    if (k.endsWith("(checkbox)") && k.startsWith("Leak Occurred on -")) {
      const base = k.replace(" (checkbox)", "");
      const el = form.querySelector(`input[name="${CSS.escape(base)}"]`);
      if (el) el.checked = !!v;
    }
  });

  // repeaters
  pipeMaterialsEl.innerHTML = "";
  otherMaterialsEl.innerHTML = "";
  pipeTestsEl.innerHTML = "";
  (record.repeaters?.pipeMaterials || []).forEach(addPipeMaterialRow);
  (record.repeaters?.otherMaterials || []).forEach(addOtherMaterialRow);
  (record.repeaters?.pipeTests || []).forEach(addPipeTestRow);

  // sketch (best-effort restore)
  try {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = record.sketch?.dataUrl || "";
  } catch {}

  mode = store === "drafts" ? "editDraft" : "editQueued";
  formMeta.textContent = `Editing (${store}): ${currentId}`;
}

document.getElementById("openDrafts").addEventListener("click", () => showList("drafts", "Drafts"));
document.getElementById("openQueue").addEventListener("click", () => showList("queue", "Queued"));


formMeta.textContent = `New: ${currentId}`;
