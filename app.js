import { db } from "./db.js";

// ===== CONFIG =====
const API_URL =
  "https://script.google.com/macros/s/AKfycby4A2Ci8N6IFLB7oORb7KKThB_jqW580SV0EvG67CZ1FFoudWgLttJ8PyOiqPMKXtDiEQ/exec";
const params = new URLSearchParams(location.search);
const editId = params.get("edit") || "";
const ownerKey = params.get("key") || ""; // ✅ pulled from URL


// ---- UI helpers ----
const netStatusEl = document.getElementById("netStatus");
const debugEl = document.getElementById("debug");
const formMeta = document.getElementById("formMeta");

// ---- core DOM ----
const form = document.getElementById("form");
const pageTypeEl = document.getElementById("pageType");
const listCard = document.getElementById("listCard");



// ---- Section show/hide (4 pages) ----
const sectionLeakRepair = document.getElementById("sectionLeakRepair");
const sectionMains = document.getElementById("sectionMains");
const sectionRetirement = document.getElementById("sectionRetirement");
const sectionServices = document.getElementById("sectionServices");

const urlParams = new URLSearchParams(window.location.search);
//const editId = urlParams.get("edit");

/* ===========================
   app.js (DROP-IN CORE)
   - Edit load (fields + repeaters + sketch)
   - Save payload (fields + repeaters + sketch preserve)
   - Page scoping (no isVisible() data loss)
   =========================== */

/* ---------- CONFIG: REQUIRED GLOBALS YOU ALREADY HAVE ----------

Required existing globals in your project:
- API_URL (string)
- form (HTMLFormElement)
- pageTypeEl (select)
- sectionLeakRepair, sectionMains, sectionServices, sectionRetirement (containers)
- updatePageSections() (your existing function; shows/hides page sections)
- addXRow(...) functions + repeater container elements (see REPEATER_BINDINGS below)
- canvas + ctx (for sketch), and your drawDataUrlToCanvas_(dataUrl) helper (or include below)

Optional existing globals:
- setStatus(msg) or debug(msg)
- ownerKey (string)
- db (indexedDB wrapper you already have)
- updateNet()

---------------------------------------------------------------- */

function logStatus(msg) {
  if (typeof setStatus === "function") setStatus(msg);
  else if (typeof debug === "function") debug(msg);
  else console.log(msg);
}

function normKey(s) {
  return String(s ?? "").trim();
}
function normVal(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/* ---------- EDIT BOOT ---------- */
const qs = new URLSearchParams(location.search);
//const editId = qs.get("edit") || "";
// If you pass key in URL, uncomment:
// const ownerKey = qs.get("key") || (window.ownerKey || "");
// Otherwise rely on your existing ownerKey global.
window.editId = editId;

/* ---------- SKETCH STATE (prevents blank overwrite) ---------- */
let existingSketch = null;
let sketchDirty = false;

function markSketchDirty() {
  sketchDirty = true;
}

// Hook dirty tracking if you have pointer events
// If you already have drawing handlers, just call markSketchDirty() inside them.
if (window.canvas) {
  canvas.addEventListener("pointerdown", () => markSketchDirty(), { passive: true });
}

/* ---------- HELPERS ---------- */
function getActivePageType() {
  return String(pageTypeEl?.value || "Leak Repair").trim();
}

function getActiveSectionByPageType(pageType) {
  const pt = String(pageType || "").trim();
  if (pt === "Leak Repair") return document.getElementById("sectionLeakRepair");
  if (pt === "Mains") return document.getElementById("sectionMains");
  if (pt === "Retirement") return document.getElementById("sectionRetirement");
  if (pt === "Services") return document.getElementById("sectionServices");
  return document.getElementById("sectionCustomer") || document.querySelector("form");
}


/* ---------- FIELD GATHER (NO isVisible gating) ---------- */
function gatherFieldsNormalized() {
  const fields = {};
  const pt = getActivePageType();
  const scope = getActiveSectionByPageType(pt) || form;

  const els = Array.from(scope.querySelectorAll("input[name], textarea[name], select[name]"));
  els.forEach((el) => {
    const name = normKey(el.name);
    if (!name) return;

    let value = "";
    if (el.type === "checkbox") value = !!el.checked;
    else if (el.type === "radio") {
      if (!el.checked) return;
      value = normVal(el.value);
    } else value = normVal(el.value);

    fields[name] = value;
  });

  return fields;
}

/* ---------- REPEATER GATHER (NO isVisible gating) ---------- */
function gatherRepeatersForPage() {
  const pt = getActivePageType();
  const scope = getActiveSectionByPageType(pt) || form;

  // expects repeater inputs have data-r + data-k
  const inputs = Array.from(scope.querySelectorAll("[data-r][data-k]"));

  const map = {}; // { repeaterName: { rowId: { key: value } } }

  inputs.forEach((el) => {
    const r = normKey(el.dataset.r);
    const k = normKey(el.dataset.k);
    if (!r || !k) return;

    const rowEl = el.closest("[data-row]") || el.closest(".card");
    if (!rowEl) return;

    if (!rowEl.dataset.rowId) {
      rowEl.dataset.rowId = crypto.randomUUID?.() || (Date.now() + "_" + Math.random());
    }
    const rowId = rowEl.dataset.rowId;

    map[r] = map[r] || {};
    map[r][rowId] = map[r][rowId] || {};

    let value = "";
    if (el.type === "checkbox") value = !!el.checked;
    else if (el.type === "radio") {
      if (!el.checked) return;
      value = normVal(el.value);
    } else value = normVal(el.value);

    map[r][rowId][k] = value;
  });

  // rowId maps -> arrays; drop empty rows
  const out = {};
  Object.keys(map).forEach((r) => {
    out[r] = Object.values(map[r]).filter((row) =>
      Object.values(row).some((v) => (typeof v === "boolean" ? v === true : String(v ?? "").trim() !== ""))
    );
  });

  return out;
}

/* ---------- REPEATERS: CLEAR + POPULATE ---------- */
// IMPORTANT: your addRow fns must accept (rowObj) and set inputs with data-k, etc.
function clearRepeaterContainer(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll("[data-row]").forEach((row) => row.remove());
}

// ✅ PLUG YOUR EXISTING CONTAINERS + ADD ROW FUNCTIONS HERE
const REPEATER_BINDINGS = {
  // Leak Repair
  pipeMaterials:   { container: () => window.pipeMaterialsEl,   addRow: window.addPipeMaterialRow },
  otherMaterials:  { container: () => window.otherMaterialsEl,  addRow: window.addOtherMaterialRow },
  pipeTests:       { container: () => window.pipeTestsEl,       addRow: window.addPipeTestRow },

  // Mains
  mainsMaterials:      { container: () => window.mainsMaterialsEl,      addRow: window.addMainsMaterialRow },
  mainsOtherMaterials: { container: () => window.mainsOtherMaterialsEl, addRow: window.addMainsOtherMaterialRow },
  mainsPipeTests:      { container: () => window.mainsPipeTestsEl,      addRow: window.addMainsPipeTestRow },

  // Services
  svcMaterials:      { container: () => window.svcMaterialsEl,      addRow: window.addSvcMaterialRow },
  svcOtherMaterials: { container: () => window.svcOtherMaterialsEl, addRow: window.addSvcOtherMaterialRow },
  svcPipeTests:      { container: () => window.svcPipeTestsEl,      addRow: window.addSvcPipeTestRow },

  // Retirement
  retSection:      { container: () => window.retSectionEl,      addRow: window.addRetSectionRow },
  retStructures:   { container: () => window.retStructuresEl,   addRow: window.addRetStructuresRow },
  retNewMaterials: { container: () => window.retNewMaterialsEl, addRow: window.addRetNewMaterialsRow },
};

function getPageRepeaterKeys(pt) {
  const p = String(pt || "").trim();
  return (
    p === "Leak Repair" ? ["pipeMaterials","otherMaterials","pipeTests"] :
    p === "Mains"       ? ["mainsMaterials","mainsOtherMaterials","mainsPipeTests"] :
    p === "Services"    ? ["svcMaterials","svcOtherMaterials","svcPipeTests"] :
    p === "Retirement"  ? ["retSection","retStructures","retNewMaterials"] :
    []
  );
}

function populateRepeatersForPage(pt, repeaters) {
  const keys = getPageRepeaterKeys(pt);
  const reps = (repeaters && typeof repeaters === "object") ? repeaters : {};

  // Clear only current page repeaters (removes starter rows)
  keys.forEach((key) => {
    const b = REPEATER_BINDINGS[key];
    if (!b || typeof b.container !== "function") return;
    clearRepeaterContainer(b.container());
  });

  // Add payload rows (or one blank row)
  keys.forEach((key) => {
    const b = REPEATER_BINDINGS[key];
    if (!b || typeof b.addRow !== "function") return;

    const arr = Array.isArray(reps[key]) ? reps[key] : [];
    if (arr.length) arr.forEach((rowObj) => b.addRow(rowObj || {}));
    else b.addRow({});
  });

  console.log("✅ Repeaters populated:", pt, keys);
}

/* ---------- NORMALIZE PAYLOAD ---------- */
function normalizePayload({ submissionId, pageType, deviceId, createdAt, fields, repeaters, sketch, photos }) {
  return {
    submissionId: String(submissionId || "").trim(),
    pageType: normKey(pageType),
    deviceId: String(deviceId || "").trim(),
    createdAt: createdAt || new Date().toISOString(),
    fields: Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [normKey(k), v])),
    repeaters: Object.fromEntries(
      Object.entries(repeaters || {}).map(([r, rows]) => [
        normKey(r),
        Array.isArray(rows)
          ? rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [normKey(k), v])))
          : [],
      ])
    ),
    sketch: sketch || null,
    photos: Array.isArray(photos) ? photos : [],
  };
}

/* ---------- SKETCH DRAW HELPER (use yours if already exists) ---------- */
async function drawDataUrlToCanvas_(dataUrl) {
  if (!window.canvas || !window.ctx || !dataUrl) return false;

  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;

      ctx.drawImage(img, x, y, w, h);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

/*function getActiveSectionByPageType(pageType) {
  const pt = String(pageType || "").trim();

  if (pt === "Leak Repair") return document.getElementById("sectionLeakRepair");
  if (pt === "Mains") return document.getElementById("sectionMains");
  if (pt === "Retirement") return document.getElementById("sectionRetirement");
  if (pt === "Services") return document.getElementById("sectionServices");

  // fallback
  return document.getElementById("sectionCustomer") || document.querySelector("form");
}*/




/* ---------- EDIT LOAD ---------- */
let _editLoading = false;
let currentId = window.currentId || "";
let mode = window.mode || "new";

async function loadForEdit(submissionId) {
  if (_editLoading) return;
  _editLoading = true;

  try {
    logStatus("Loading for edit…");
    console.log("EDIT submissionId:", submissionId);

    // --- Fetch payload ---
    const url = new URL(API_URL);
    url.searchParams.set("action", "get");
    url.searchParams.set("id", submissionId);
    if (typeof ownerKey !== "undefined" && ownerKey) url.searchParams.set("key", ownerKey);

    console.log("GET URL:", url.toString());

    const res = await fetch(url.toString(), { cache: "no-store" });
    const text = await res.text();
    const json = JSON.parse(text);

    if (!json.ok) throw new Error(json.error || "Failed to load");

    const p = json.payload || {};
    const pt = String(p.pageType || "Leak Repair").trim();
    const fields = p.fields || {};
    const repeaters = p.repeaters || {};
    const sketch = p.sketch || null;

    // --- Set edit mode globals ---
    currentId = submissionId;
    mode = "edit";

    // --- Reset first ---
    form?.reset?.();

    // --- Set page type + show correct section BEFORE populating ---
    if (pageTypeEl) {
      const exists = [...pageTypeEl.options].some(o => o.value === pt);
      pageTypeEl.value = exists ? pt : "Leak Repair";
    }
    if (typeof updatePageSections === "function") updatePageSections();

    // --- Populate repeaters AFTER sections are visible ---
    if (typeof populateRepeatersForPage === "function") {
      populateRepeatersForPage(pt, repeaters);
    }

    // --- Populate fields (SCOPED to active page section) ---
    const scope = (typeof getActiveSectionByPageType === "function")
      ? (getActiveSectionByPageType(pt) || form)
      : form;

    Object.entries(fields).forEach(([k, v]) => {
      const name = String(k);
      const esc = (window.CSS && CSS.escape) ? CSS.escape(name) : name.replace(/"/g, '\\"');

      const el = scope.querySelector(`[name="${esc}"]`);
      if (!el) return;

      if (el.type === "checkbox") {
        el.checked = !!v;
      } else if (el.type === "radio") {
        scope.querySelectorAll(`input[type="radio"][name="${esc}"]`)
          .forEach(r => (r.checked = (String(r.value) === String(v))));
      } else {
        el.value = (v ?? "");
      }
    });

    // --- Restore sketch ---
    existingSketch = sketch;
    sketchDirty = false;

    if (existingSketch?.dataUrl && window.canvas && window.ctx && typeof drawDataUrlToCanvas_ === "function") {
      await drawDataUrlToCanvas_(existingSketch.dataUrl);
    } else if (window.canvas && window.ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // --- Update submit button label ---
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Update Submission";

    logStatus("Edit mode ready ✅");
  } catch (err) {
    console.error(err);
    logStatus("Edit load failed: " + (err?.message || err));
  } finally {
    _editLoading = false;
  }
}


/* ---------- BUILD PAYLOAD ---------- */
// You already have getDeviceId() / newSubmissionId() etc.
// If not, keep your own versions and this will use them.
async function buildPayload() {
  const deviceId = (typeof getDeviceId === "function") ? getDeviceId() : "";
  const fields = gatherFieldsNormalized();
  const repeaters = gatherRepeatersForPage();

  // preserve sketch unless user actually drew
  let sketchOut = existingSketch || null;
  if (window.canvas) {
    if (sketchDirty) {
      sketchOut = { filename: `sketch_${currentId}.png`, dataUrl: canvas.toDataURL("image/png") };
    }
  }

  // photos: keep your existing compression flow if you want;
  // here we leave photos empty unless you already manage them elsewhere
  const photos = [];

  return normalizePayload({
    submissionId: currentId,
    pageType: getActivePageType(),
    deviceId,
    createdAt: new Date().toISOString(),
    fields,
    repeaters,
    sketch: sketchOut,
    photos,
  });
}

/* ---------- SUBMIT ---------- */
async function postSubmit(payload) {
  const url = new URL(API_URL);
  if (typeof ownerKey !== "undefined" && ownerKey) url.searchParams.set("key", ownerKey);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    return !!j.ok;
  } catch {
    return txt.includes('"ok":true') || txt.includes('"ok": true');
  }
}

async function submitNow() {
  const payload = await buildPayload();

  // if you have offline queue logic, keep using it — here’s a simple direct submit:
  const ok = await postSubmit(payload);
  if (!ok) {
    alert("Submit failed.");
    return;
  }
  alert("Submitted ✅");
}

/* ---------- NEW FORM ---------- */
function startNewForm() {
  currentId = (typeof newSubmissionId === "function") ? newSubmissionId() : (crypto.randomUUID?.() || String(Date.now()));
  mode = "new";
  existingSketch = null;
  sketchDirty = false;

  form?.reset?.();
  if (window.canvas && window.ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Set default page type (optional)
  if (pageTypeEl && !pageTypeEl.value) pageTypeEl.value = "Leak Repair";
  if (typeof updatePageSections === "function") updatePageSections();

  // Add starter rows ONLY for active page
  const pt = getActivePageType();
  populateRepeatersForPage(pt, {}); // will add 1 blank row each

  const submitBtn = document.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = "Submit";

  logStatus("New form ✅");
}

/* ---------- EVENTS ---------- */
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitNow();
});

document.getElementById("newForm")?.addEventListener("click", () => startNewForm());

pageTypeEl?.addEventListener("change", () => {
  if (typeof updatePageSections === "function") updatePageSections();

  // When switching page type in NEW mode, rebuild starter repeaters for that page
  if (!editId && mode !== "edit") {
    const pt = getActivePageType();
    populateRepeatersForPage(pt, {});
  }
});

/* ---------- BOOT ---------- */
window.addEventListener("DOMContentLoaded", () => {
  console.log("app.js running ✅");
  if (typeof updatePageSections === "function") updatePageSections();

  if (editId) {
    // edit boot
    loadForEdit(editId);
  } else {
    // new form boot
    startNewForm();
  }

  if (typeof updateNet === "function") updateNet();
});














































/*  OLD CODE OLD CODE OLD CODE
// =====================================================
// Normalization helpers (CLIENT)
// =====================================================
function normKey(k) {
  return String(k ?? "")
    .replace(/\u00A0/g, " ") // NBSP
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}
function normVal(v) {
  if (v === null || v === undefined) return "";
  // keep booleans
  if (typeof v === "boolean") return v;
  return String(v);
}
function isCheckedVal(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return ["true", "yes", "y", "1", "checked", "on"].includes(s);
}
function isVisible(el) {
  // visible = not display:none and not within a hidden parent
  return !!(el && el.offsetParent !== null);
}

function setStatus(msg) {
  if (netStatusEl) netStatusEl.textContent = msg;
}
function debug(msg) {
  console.log(msg);
  if (debugEl) debugEl.textContent = msg;
}

// show errors on-screen
window.addEventListener("unhandledrejection", (e) =>
  debug("Promise error: " + (e.reason?.message || e.reason))
);
window.addEventListener("error", (e) => debug("JS error: " + e.message));

setStatus("Status: app.js loaded ✅");
debug("app.js running ✅");

// ---- Edit boot (DEBUG) ----
const qs = new URLSearchParams(window.location.search);
debug(`Edit boot → editId=${editId || "(none)"} | key=${ownerKey ? "YES" : "NO"}`);


// ---- SW registration ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => debug("SW error: " + e.message));
  });
}

// ---- Online status ----
function updateNet() {
  setStatus(`Status: ${navigator.onLine ? "Online" : "Offline"}`);
}
updateNet();
window.addEventListener("online", () => {
  updateNet();
  trySync().catch((e) => debug("Sync error: " + e.message));
});
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

// =====================================================
// Page switching
// =====================================================
function updatePageSections() {
  const pt = pageTypeEl?.value || "Leak Repair";
  if (sectionLeakRepair) sectionLeakRepair.style.display = pt === "Leak Repair" ? "block" : "none";
  if (sectionMains) sectionMains.style.display = pt === "Mains" ? "block" : "none";
  if (sectionRetirement) sectionRetirement.style.display = pt === "Retirement" ? "block" : "none";
  if (sectionServices) sectionServices.style.display = pt === "Services" ? "block" : "none";
}
pageTypeEl?.addEventListener("change", updatePageSections);
updatePageSections();

// =====================================================
// Sketch canvas
// =====================================================
const canvas = document.getElementById("sketch");
const ctx = canvas?.getContext("2d");

if (ctx) {
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
}

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
function startDraw(ev) {
  if (!canvas || !ctx) return;
  drawing = true;
  last = pos(ev);
}
function moveDraw(ev) {
  if (!canvas || !ctx) return;
  if (!drawing) return;
  ev.preventDefault();
  const p = pos(ev);
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  last = p;
}
function endDraw() {
  drawing = false;
  last = null;
}

if (canvas) {
  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);

  canvas.addEventListener("touchstart", startDraw, { passive: false });
  canvas.addEventListener("touchmove", moveDraw, { passive: false });
  canvas.addEventListener("touchend", endDraw);
}

document.getElementById("clearSketch")?.addEventListener("click", () => {
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// =====================================================
// Repeater row helper (ONE version only)
// - IMPORTANT: row wrapper has [data-row] AND class="card"
// - Remove button included
// =====================================================
function makeRow(innerHtml) {
  const div = document.createElement("div");
  div.setAttribute("data-row", "1");
  div.className = "card";
  div.style.background = "#fafafa";
  div.style.border = "1px solid #eee";
  div.style.margin = "8px 0";
  div.innerHTML = `
    ${innerHtml}
    <button type="button" style="margin-top:10px;">Remove</button>
  `;
  div.querySelector("button").addEventListener("click", () => div.remove());
  return div;
}

// =====================================================
// Repeaters: containers
// =====================================================
// Leak Repair
const pipeMaterialsEl = document.getElementById("pipeMaterials");
const otherMaterialsEl = document.getElementById("otherMaterials");
const pipeTestsEl = document.getElementById("pipeTests");

// Mains
const mainsMaterialsEl = document.getElementById("mainsMaterials");
const mainsOtherMaterialsEl = document.getElementById("mainsOtherMaterials");
const mainsPipeTestsEl = document.getElementById("mainsPipeTests");

// Services
const svcMaterialsEl = document.getElementById("svcMaterials");
const svcOtherMaterialsEl = document.getElementById("svcOtherMaterials");
const svcPipeTestsEl = document.getElementById("svcPipeTests");

// Retirement
const retSectionEl = document.getElementById("retSection");
const retStructuresEl = document.getElementById("retStructures");
const retNewMaterialsEl = document.getElementById("retNewMaterials");

// =====================================================
// Repeaters: add-row functions
// =====================================================

// ---- Leak Repair ----
function addPipeMaterialRow(data = {}) {
  pipeMaterialsEl?.appendChild(
    makeRow(`
      <label>Size</label><input data-r="pipeMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="pipeMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Manufacturer</label><input data-r="pipeMaterials" data-k="Manufacturer" value="${data["Manufacturer"] || ""}">
      <label>Date</label><input data-r="pipeMaterials" data-k="Date" value="${data["Date"] || ""}">
      <label>Coil #</label><input data-r="pipeMaterials" data-k="Coil #" value="${data["Coil #"] || ""}">
      <label>SDR of PE</label><input data-r="pipeMaterials" data-k="SDR of PE" value="${data["SDR of PE"] || ""}">
      <label>ST Pipe Thickness</label><input data-r="pipeMaterials" data-k="ST Pipe Thickness" value="${
        data["ST Pipe Thickness"] || ""
      }">
      <label>Coating Type</label><input data-r="pipeMaterials" data-k="Coating Type" value="${data["Coating Type"] || ""}">
      <label>Depth (inches)</label><input data-r="pipeMaterials" data-k="Depth (inches)" value="${
        data["Depth (inches)"] || ""
      }">
      <label>Length (inches)</label><input data-r="pipeMaterials" data-k="Length (inches)" value="${
        data["Length (inches)"] || ""
      }">
    `)
  );
}
function addOtherMaterialRow(data = {}) {
  otherMaterialsEl?.appendChild(
    makeRow(`
      <label>Type</label><input data-r="otherMaterials" data-k="Type" value="${data["Type"] || ""}">
      <label>Size</label><input data-r="otherMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="otherMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Quantity</label><input data-r="otherMaterials" data-k="Quantity" value="${data["Quantity"] || ""}">
    `)
  );
}
function addPipeTestRow(data = {}) {
  pipeTestsEl?.appendChild(
    makeRow(`
      <label>Date Tested</label><input type="date" data-r="pipeTests" data-k="Date Tested" value="${data["Date Tested"] || ""}">
      <label>Test Type</label><input data-r="pipeTests" data-k="Test Type" value="${data["Test Type"] || ""}">
      <div class="check" style="margin-top:8px;">
        <input type="checkbox" data-r="pipeTests" data-k="Soaped with no Leaks" ${isCheckedVal(
          data["Soaped with no Leaks"]
        )
          ? "checked"
          : ""}>
        Soaped with no Leaks
      </div>
      <label>Pressure</label><input data-r="pipeTests" data-k="Pressure" value="${data["Pressure"] || ""}">
      <label>Chart</label><input data-r="pipeTests" data-k="Chart" value="${data["Chart"] || ""}">
      <label>Duration</label><input data-r="pipeTests" data-k="Duration" value="${data["Duration"] || ""}">
      <label>Tested By</label><input data-r="pipeTests" data-k="Tested By" value="${data["Tested By"] || ""}">
    `)
  );
}

document.getElementById("addPipeMaterial")?.addEventListener("click", () => addPipeMaterialRow());
document.getElementById("addOtherMaterial")?.addEventListener("click", () => addOtherMaterialRow());
document.getElementById("addPipeTest")?.addEventListener("click", () => addPipeTestRow());

// ---- Mains ----
function addMainsMaterialRow(data = {}) {
  mainsMaterialsEl?.appendChild(
    makeRow(`
      <label>Size</label><input data-r="mainsMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="mainsMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Manufacturer</label><input data-r="mainsMaterials" data-k="Manufacturer" value="${data["Manufacturer"] || ""}">
      <label>Date</label><input data-r="mainsMaterials" data-k="Date" value="${data["Date"] || ""}">
      <label>Coil #</label><input data-r="mainsMaterials" data-k="Coil #" value="${data["Coil #"] || ""}">
      <label>SDR of PE</label><input data-r="mainsMaterials" data-k="SDR of PE" value="${data["SDR of PE"] || ""}">
      <label>ST Pipe Thickness</label><input data-r="mainsMaterials" data-k="ST Pipe Thickness" value="${
        data["ST Pipe Thickness"] || ""
      }">
      <label>Coating Types</label><input data-r="mainsMaterials" data-k="Coating Types" value="${data["Coating Types"] || ""}">
      <label>Depth (inches)</label><input data-r="mainsMaterials" data-k="Depth (inches)" value="${
        data["Depth (inches)"] || ""
      }">
      <label>Length (inches)</label><input data-r="mainsMaterials" data-k="Length (inches)" value="${
        data["Length (inches)"] || ""
      }">
    `)
  );
}
function addMainsOtherMaterialRow(data = {}) {
  mainsOtherMaterialsEl?.appendChild(
    makeRow(`
      <label>Type</label><input data-r="mainsOtherMaterials" data-k="Type" value="${data["Type"] || ""}">
      <label>Size</label><input data-r="mainsOtherMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="mainsOtherMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Quantity</label><input data-r="mainsOtherMaterials" data-k="Quantity" value="${data["Quantity"] || ""}">
    `)
  );
}
function addMainsPipeTestRow(data = {}) {
  mainsPipeTestsEl?.appendChild(
    makeRow(`
      <label>Date Tested</label><input type="date" data-r="mainsPipeTests" data-k="Date Tested" value="${data["Date Tested"] || ""}">
      <label>Test Type</label><input data-r="mainsPipeTests" data-k="Test Type" value="${data["Test Type"] || ""}">
      <div class="check" style="margin-top:8px;">
        <input type="checkbox" data-r="mainsPipeTests" data-k="Soaped with no Leaks" ${isCheckedVal(
          data["Soaped with no Leaks"]
        )
          ? "checked"
          : ""}>
        Soaped with no Leaks
      </div>
      <label>Pressure</label><input data-r="mainsPipeTests" data-k="Pressure" value="${data["Pressure"] || ""}">
      <label>Chart</label><input data-r="mainsPipeTests" data-k="Chart" value="${data["Chart"] || ""}">
      <label>Duration</label><input data-r="mainsPipeTests" data-k="Duration" value="${data["Duration"] || ""}">
      <label>Tested By</label><input data-r="mainsPipeTests" data-k="Tested By" value="${data["Tested By"] || ""}">
    `)
  );
}

document.getElementById("addMainsMaterial")?.addEventListener("click", () => addMainsMaterialRow());
document.getElementById("addMainsOtherMaterial")?.addEventListener("click", () => addMainsOtherMaterialRow());
document.getElementById("addMainsPipeTest")?.addEventListener("click", () => addMainsPipeTestRow());

// ---- Services ----
function addSvcMaterialRow(data = {}) {
  svcMaterialsEl?.appendChild(
    makeRow(`
      <label>Size</label><input data-r="svcMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="svcMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Manufacturer</label><input data-r="svcMaterials" data-k="Manufacturer" value="${data["Manufacturer"] || ""}">
      <label>Date</label><input data-r="svcMaterials" data-k="Date" value="${data["Date"] || ""}">
      <label>Coil #</label><input data-r="svcMaterials" data-k="Coil #" value="${data["Coil #"] || ""}">
      <label>SDR of PE</label><input data-r="svcMaterials" data-k="SDR of PE" value="${data["SDR of PE"] || ""}">
      <label>ST Pipe Thickness</label><input data-r="svcMaterials" data-k="ST Pipe Thickness" value="${
        data["ST Pipe Thickness"] || ""
      }">
      <label>Coating Types</label><input data-r="svcMaterials" data-k="Coating Types" value="${data["Coating Types"] || ""}">
      <label>Depth (inches)</label><input data-r="svcMaterials" data-k="Depth (inches)" value="${
        data["Depth (inches)"] || ""
      }">
      <label>Length (inches)</label><input data-r="svcMaterials" data-k="Length (inches)" value="${
        data["Length (inches)"] || ""
      }">
    `)
  );
}
function addSvcOtherMaterialRow(data = {}) {
  svcOtherMaterialsEl?.appendChild(
    makeRow(`
      <label>Type</label><input data-r="svcOtherMaterials" data-k="Type" value="${data["Type"] || ""}">
      <label>Size</label><input data-r="svcOtherMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="svcOtherMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Quantity</label><input data-r="svcOtherMaterials" data-k="Quantity" value="${data["Quantity"] || ""}">
    `)
  );
}
function addSvcPipeTestRow(data = {}) {
  svcPipeTestsEl?.appendChild(
    makeRow(`
      <label>Date Tested</label><input type="date" data-r="svcPipeTests" data-k="Date Tested" value="${data["Date Tested"] || ""}">
      <label>Test Type</label><input data-r="svcPipeTests" data-k="Test Type" value="${data["Test Type"] || ""}">
      <div class="check" style="margin-top:8px;">
        <input type="checkbox" data-r="svcPipeTests" data-k="Soaped with no Leaks" ${isCheckedVal(
          data["Soaped with no Leaks"]
        )
          ? "checked"
          : ""}>
        Soaped with no Leaks
      </div>
      <label>Pressure</label><input data-r="svcPipeTests" data-k="Pressure" value="${data["Pressure"] || ""}">
      <label>Chart</label><input data-r="svcPipeTests" data-k="Chart" value="${data["Chart"] || ""}">
      <label>Duration</label><input data-r="svcPipeTests" data-k="Duration" value="${data["Duration"] || ""}">
      <label>Tested By</label><input data-r="svcPipeTests" data-k="Tested By" value="${data["Tested By"] || ""}">
    `)
  );
}

document.getElementById("addSvcMaterial")?.addEventListener("click", () => addSvcMaterialRow());
document.getElementById("addSvcOtherMaterial")?.addEventListener("click", () => addSvcOtherMaterialRow());
document.getElementById("addSvcPipeTest")?.addEventListener("click", () => addSvcPipeTestRow());

// ---- Retirement ----
function addRetSectionRow(data = {}) {
  retSectionEl?.appendChild(
    makeRow(`
      <label>Size</label><input data-r="retSection" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="retSection" data-k="Material" value="${data["Material"] || ""}">
      <label>Pipe Condition</label><input data-r="retSection" data-k="Pipe Condition" value="${data["Pipe Condition"] || ""}">
      <label>Retired in Place</label><input data-r="retSection" data-k="Retired in Place" value="${data["Retired in Place"] || ""}">
      <label>Riser Removed</label><input data-r="retSection" data-k="Riser Removed" value="${data["Riser Removed"] || ""}">
      <label>Length (feet)</label><input data-r="retSection" data-k="Length (feet)" value="${data["Length (feet)"] || ""}">
    `)
  );
}
function addRetStructuresRow(data = {}) {
  retStructuresEl?.appendChild(
    makeRow(`
      <label>Structures Retired</label><input data-r="retStructures" data-k="Structures Retired" value="${data["Structures Retired"] || ""}">
      <label>Number</label><input data-r="retStructures" data-k="Number" value="${data["Number"] || ""}">
      <label>Action Taken</label><input data-r="retStructures" data-k="Action Taken" value="${data["Action Taken"] || ""}">
    `)
  );
}
function addRetNewMaterialsRow(data = {}) {
  retNewMaterialsEl?.appendChild(
    makeRow(`
      <label>Materials Used</label><input data-r="retNewMaterials" data-k="Materials Used" value="${data["Materials Used"] || ""}">
      <label>Size</label><input data-r="retNewMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="retNewMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Quantity</label><input data-r="retNewMaterials" data-k="Quantity" value="${data["Quantity"] || ""}">
    `)
  );
}

document.getElementById("addRetSection")?.addEventListener("click", () => addRetSectionRow());
document.getElementById("addRetStructures")?.addEventListener("click", () => addRetStructuresRow());
document.getElementById("addRetNewMaterials")?.addEventListener("click", () => addRetNewMaterialsRow());

// initial starter rows (only if containers exist)
if (!editId) {
  if (pipeMaterialsEl) addPipeMaterialRow();
  if (otherMaterialsEl) addOtherMaterialRow();
  if (pipeTestsEl) addPipeTestRow();

  if (mainsMaterialsEl) addMainsMaterialRow();
  if (mainsOtherMaterialsEl) addMainsOtherMaterialRow();
  if (mainsPipeTestsEl) addMainsPipeTestRow();

  if (svcMaterialsEl) addSvcMaterialRow();
  if (svcOtherMaterialsEl) addSvcOtherMaterialRow();
  if (svcPipeTestsEl) addSvcPipeTestRow();

  if (retSectionEl) addRetSectionRow();
  if (retStructuresEl) addRetStructuresRow();
  if (retNewMaterialsEl) addRetNewMaterialsRow();
}

// =====================================================
// Gather fields + repeaters
// =====================================================
function gatherFieldsNormalized(formEl) {
  const fields = {};
  const pt = (pageTypeEl?.value || "Leak Repair").trim();

  const scope =
    pt === "Leak Repair" ? sectionLeakRepair :
    pt === "Mains"       ? sectionMains :
    pt === "Retirement"  ? sectionRetirement :
    pt === "Services"    ? sectionServices :
    formEl;

  const els = Array.from(scope.querySelectorAll("input[name], textarea[name], select[name]"));

  els.forEach((el) => {
    const name = normKey(el.name);
    if (!name) return;

    let value = "";
    if (el.type === "checkbox") value = !!el.checked;
    else if (el.type === "radio") { if (!el.checked) return; value = normVal(el.value); }
    else value = normVal(el.value);

    fields[name] = value;
  });

  return fields;
}

function gatherRepeaters() {
  const repeaters = {};

  const els = Array.from(document.querySelectorAll("[data-r][data-k]"));
  els.forEach((el) => {
    if (!isVisible(el)) return;

    const r = normKey(el.dataset.r);
    const k = normKey(el.dataset.k);
    if (!r || !k) return;

    const rowEl = el.closest("[data-row]") || el.closest(".card");
    if (!rowEl) return;

    if (!rowEl.dataset.rowId) {
      rowEl.dataset.rowId = crypto.randomUUID?.() || (Date.now() + "_" + Math.random());
    }

    const rowId = rowEl.dataset.rowId;

    repeaters[r] = repeaters[r] || {};
    repeaters[r][rowId] = repeaters[r][rowId] || {};

    let value = "";
    if (el.type === "checkbox") value = !!el.checked;
    else if (el.type === "radio") {
      if (!el.checked) return;
      value = normVal(el.value);
    } else value = normVal(el.value);

    repeaters[r][rowId][k] = value;
  });

  // Convert rowId maps → arrays and drop empty rows
  const out = {};
  Object.keys(repeaters).forEach((r) => {
    out[r] = Object.values(repeaters[r]).filter((row) =>
      Object.values(row).some((v) => (typeof v === "boolean" ? v === true : String(v ?? "").trim() !== ""))
    );
  });

  return out;
}

let existingSketch = null;
let sketchDirty = false;

function markSketchDirty() { sketchDirty = true; }

function normalizePayload({ submissionId, pageType, deviceId, createdAt, fields, repeaters, sketch, photos }) {
  return {
    submissionId: String(submissionId || "").trim(),
    pageType: normKey(pageType),
    deviceId: String(deviceId || "").trim(),
    createdAt: createdAt || new Date().toISOString(),
    fields: Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [normKey(k), v])),
    repeaters: Object.fromEntries(
      Object.entries(repeaters || {}).map(([r, rows]) => [
        normKey(r),
        Array.isArray(rows)
          ? rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [normKey(k), v])))
          : [],
      ])
    ),
    sketch: sketch || null,
    photos: Array.isArray(photos) ? photos : [],
  };
}

function fillRepeater(el, addRowFn, rows) {
  if (!el || typeof addRowFn !== "function") return;

  clearRepeaterContainer(el);

  const safeRows = Array.isArray(rows) && rows.length ? rows : [{}];
  safeRows.forEach(r => addRowFn(r || {}));
}

// =====================================================
// Repeaters: populate from saved payload
// =====================================================

// =====================================================
// Repeaters: clear + populate from saved payload
// Drop-in (single version)
// =====================================================

// Safe normalizer
function normalizeRepeatersObj(repeaters) {
  return (repeaters && typeof repeaters === "object") ? repeaters : {};
}

// Map payload repeater keys -> container + addRow function
const REPEATER_BINDINGS = {
  // Leak Repair
  pipeMaterials:   { container: () => document.getElementById("pipeMaterials"),   addRow: addPipeMaterialRow },
  otherMaterials:  { container: () => document.getElementById("otherMaterials"),  addRow: addOtherMaterialRow },
  pipeTests:       { container: () => document.getElementById("pipeTests"),       addRow: addPipeTestRow },

  // Mains
  mainsMaterials:      { container: () => document.getElementById("mainsMaterials"),      addRow: addMainsMaterialRow },
  mainsOtherMaterials: { container: () => document.getElementById("mainsOtherMaterials"), addRow: addMainsOtherMaterialRow },
  mainsPipeTests:      { container: () => document.getElementById("mainsPipeTests"),      addRow: addMainsPipeTestRow },

  // Services
  svcMaterials:      { container: () => document.getElementById("svcMaterials"),      addRow: addSvcMaterialRow },
  svcOtherMaterials: { container: () => document.getElementById("svcOtherMaterials"), addRow: addSvcOtherMaterialRow },
  svcPipeTests:      { container: () => document.getElementById("svcPipeTests"),      addRow: addSvcPipeTestRow },

  // Retirement
  retSection:      { container: () => document.getElementById("retSection"),      addRow: addRetSectionRow },
  retStructures:   { container: () => document.getElementById("retStructures"),   addRow: addRetStructuresRow },
  retNewMaterials: { container: () => document.getElementById("retNewMaterials"), addRow: addRetNewMaterialsRow },
};


// Populates ONLY repeaters present in payload; ensures at least 1 row per repeater on the current page
function populateRepeatersForPage(pageType, repeaters) {
  const pt = String(pageType || "").trim();
  const reps = normalizeRepeatersObj(repeaters);
  

  function logContainer(id) {
  const el = document.getElementById(id);
  console.log(`[repeater] #${id}:`, {
    exists: !!el,
    inDom: !!el && document.body.contains(el),
    childRows: el ? el.querySelectorAll('[data-row]').length : 0
  });
}

console.log("[repeater] pageType:", pageType);
[
  "pipeMaterials","otherMaterials","pipeTests",
  "mainsMaterials","mainsOtherMaterials","mainsPipeTests",
  "svcMaterials","svcOtherMaterials","svcPipeTests",
  "retSection","retStructures","retNewMaterials"
].forEach(logContainer);
console.log("[repeater] payload keys:", Object.keys(repeaters || {}));

  // Which repeaters belong to this page?
  const pageRepeaterKeys =
    pt === "Leak Repair" ? ["pipeMaterials","otherMaterials","pipeTests"] :
    pt === "Mains"       ? ["mainsMaterials","mainsOtherMaterials","mainsPipeTests"] :
    pt === "Services"    ? ["svcMaterials","svcOtherMaterials","svcPipeTests"] :
    pt === "Retirement"  ? ["retSection","retStructures","retNewMaterials"] :
    [];

  // 1) Clear containers for this page (removes starter rows)
  pageRepeaterKeys.forEach(key => {
    const b = REPEATER_BINDINGS[key];
    if (b) clearRepeaterContainer(b.container());
  });

  // 2) Add payload rows for those repeaters (or 1 blank if none)
  pageRepeaterKeys.forEach(key => {
    const b = REPEATER_BINDINGS[key];
    if (!b) return;

    const rows = Array.isArray(reps[key]) ? reps[key] : [];
    if (rows.length) rows.forEach(r => b.addRow(r || {}));
    else b.addRow({}); // always show one row
  });

  console.log("✅ Repeaters populated for", pt, "→", pageRepeaterKeys);
}

let _editLoading = false;

async function loadForEdit(submissionId) {
   if (_editLoading) return;          // ✅ prevents double-run
  _editLoading = true;
  try {
    setStatus("Loading for edit…");
    console.log("EDIT submissionId:", submissionId);

    const url = new URL(API_URL);
    url.searchParams.set("action", "get");
    url.searchParams.set("id", submissionId);
    if (ownerKey) url.searchParams.set("key", ownerKey);

    console.log("GET URL:", url.toString());

    const res = await fetch(url.toString(), { cache: "no-store" });
    const text = await res.text();
    console.log("RAW RESPONSE:", text);

    const json = JSON.parse(text);
    console.log("PARSED JSON:", json);

    if (!json.ok) throw new Error(json.error || "Failed to load");

    const p = json.payload || {};
const fields = p.fields || {};
const repeaters = p.repeaters || {};

// ---- SET EDIT MODE ----
currentId = submissionId;
mode = "edit";

// reset first
form.reset();

// set page type BEFORE populating anything
const pt = String(p.pageType || "").trim();
console.log("EDIT pageType:", JSON.stringify(pt));

if (pageTypeEl) {
  const exists = [...pageTypeEl.options].some(o => o.value === pt);
  pageTypeEl.value = exists ? pt : "Leak Repair";
  updatePageSections();
}
    existingSketch = p.sketch || null;
sketchDirty = false;

if (existingSketch?.dataUrl) {
  await drawDataUrlToCanvas_(existingSketch.dataUrl);
}

// ✅ NOW populate repeaters (pt is defined + correct section is visible)
populateRepeatersForPage(pt, repeaters);

    console.log("Rows now in mainsMaterials:", document.getElementById("mainsMaterials")?.querySelectorAll('[data-row]').length);


console.log("REPEATERS OBJECT:", repeaters);
console.log("REPEATER KEYS:", Object.keys(repeaters));

// ---- Populate fields ----
Object.entries(fields).forEach(([k, v]) => {
  const esc = (window.CSS && CSS.escape) ? CSS.escape(k) : String(k).replace(/"/g, '\\"');
  const el = form.querySelector(`[name="${esc}"]`);
  if (!el) return;

  if (el.type === "checkbox") el.checked = !!v;
  else if (el.type === "radio") {
    form.querySelectorAll(`input[type="radio"][name="${el.name}"]`)
      .forEach(r => r.checked = (String(r.value) === String(v)));
  } else {
    el.value = (v ?? "");
  }
});

    // update submit button label
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Update Submission";

    // ---- Populate fields ----
    Object.entries(fields).forEach(([k, v]) => {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(k) : String(k).replace(/"/g, '\\"');
      const el = form.querySelector(`[name="${esc}"]`);
      if (!el) return;

      if (el.type === "checkbox") el.checked = !!v;
      else if (el.type === "radio") {
        form.querySelectorAll(`input[type="radio"][name="${el.name}"]`)
          .forEach(r => r.checked = (String(r.value) === String(v)));
      } else {
        el.value = (v ?? "");
      }
    });

    setStatus("Edit mode ready ✅");
  } catch (err) {
    console.error(err);
    setStatus("Edit load failed: " + (err?.message || err));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (editId) loadForEdit(editId);
});


// =====================================================
// Photos compression
// =====================================================
async function loadImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
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
  c.width = w;
  c.height = h;

  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

async function urlToDataUrlClient_(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("Sketch fetch->dataUrl failed", e);
    return "";
  }
}

async function drawDataUrlToCanvas_(dataUrl) {
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Fit the image into the canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;

      ctx.drawImage(img, x, y, w, h);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}


// =====================================================
// Build payload
// =====================================================
async function buildPayload() {
  const deviceId = getDeviceId();

  const fields = gatherFieldsNormalized(form);
  const repeaters = gatherRepeaters();

  const sketch = canvas
    ? { filename: `sketch_${currentId}.png`, dataUrl: canvas.toDataURL("image/png") }
    : null;

  const photoInput = form.querySelector('input[type="file"][data-photos]');
  const files = Array.from(photoInput?.files || []).slice(0, 5);

  const photos = [];
  for (const f of files) {
    const dataUrl = await fileToCompressedDataUrl(f);
    photos.push({ filename: f.name || `photo_${currentId}.jpg`, dataUrl });
  }

  const sketch =
  canvas
    ? (sketchDirty
        ? { filename: `sketch_${currentId}.png`, dataUrl: canvas.toDataURL("image/png") }
        : (existingSketch || null))
    : (existingSketch || null);

  return normalizePayload({
    submissionId: currentId,
    pageType: pageTypeEl?.value || "Leak Repair",
    deviceId,
    createdAt: new Date().toISOString(),
    fields,
    repeaters,
    sketch,
    photos,
  });
}

// =====================================================
// Submit / Sync
// =====================================================
async function postSubmit(payload) {
  debug("Submitting…");

  const url = new URL(API_URL);

  // ✅ if your backend expects key for edits, pass it
  if (ownerKey) url.searchParams.set("key", ownerKey);
  
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text();
  debug(`Response HTTP ${res.status}: ${txt.slice(0, 160)}`);

  try {
    const j = JSON.parse(txt);
    return !!j.ok;
  } catch {
    return txt.includes('"ok":true') || txt.includes('"ok": true');
  }
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

// =====================================================
// Buttons / Events
// =====================================================
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

document.getElementById("syncNow")?.addEventListener("click", () => {
  trySync().catch((e) => debug("Sync error: " + e.message));
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitNow();
});

document.getElementById("newForm")?.addEventListener("click", () => {
  currentId = newSubmissionId();
  mode = "new";
  form.reset();

  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Clear repeater containers and add a starter row again
 // initial starter rows (only if NOT editing)
if (!editId) {
  if (pipeMaterialsEl) addPipeMaterialRow();
  if (otherMaterialsEl) addOtherMaterialRow();
  if (pipeTestsEl) addPipeTestRow();

  if (mainsMaterialsEl) addMainsMaterialRow();
  if (mainsOtherMaterialsEl) addMainsOtherMaterialRow();
  if (mainsPipeTestsEl) addMainsPipeTestRow();

  if (svcMaterialsEl) addSvcMaterialRow();
  if (svcOtherMaterialsEl) addSvcOtherMaterialRow();
  if (svcPipeTestsEl) addSvcPipeTestRow();

  if (retSectionEl) addRetSectionRow();
  if (retStructuresEl) addRetStructuresRow();
  if (retNewMaterialsEl) addRetNewMaterialsRow();
}

  formMeta.textContent = `New: ${currentId}`;
  updatePageSections();
});

// --- helpers -------------------------------------------------
function _nk(s) {
  // use your normKey if present, otherwise fallback
  const f = (typeof normKey === "function") ? normKey : (x) => String(x || "").trim();
  return f(s);
}

function _setElValue(el, v) {
  if (!el) return;
  if (el.type === "checkbox") el.checked = !!v;
  else if (el.type === "radio") el.checked = (String(el.value) === String(v));
  else el.value = (v ?? "");
}

// fill inputs inside ONE repeater row by matching data-k
function applyRepeaterRowValues(rowEl, rowObj) {
  if (!rowEl || !rowObj) return;

  // build map of normalizedKey -> value from payload row
  const map = {};
  Object.entries(rowObj).forEach(([k, v]) => { map[_nk(k)] = v; });

  // find any inputs/selects/textareas in this row that have data-k (and optionally data-r)
  const inputs = rowEl.querySelectorAll("[data-k]");
  inputs.forEach((el) => {
    const k = _nk(el.dataset.k);
    if (!(k in map)) return;

    // radio groups: set the matching radio only
    if (el.type === "radio") {
      _setElValue(el, map[k]);
    } else {
      _setElValue(el, map[k]);
    }
  });
}

// remove only repeater rows
function clearRepeaterContainer(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll("[data-row]").forEach(r => r.remove());
}

// add rows and then force-fill the new row
function populateRepeater(bindingKey, rows) {
  const binding = REPEATER_BINDINGS[bindingKey];
  if (!binding) return;

  const container = binding.container();
  if (!container) return;

  clearRepeaterContainer(container);

  const arr = Array.isArray(rows) && rows.length ? rows : [{}];

  arr.forEach((rowObj) => {
    // count rows before
    const before = container.querySelectorAll("[data-row]").length;

    // create row (even if it ignores rowObj)
    binding.addRow(rowObj || {});

    // find the newly created row
    const all = container.querySelectorAll("[data-row]");
    const newRow = (all.length > before) ? all[all.length - 1] : null;

    // force-apply values into that row
    applyRepeaterRowValues(newRow, rowObj || {});
  });

  console.log(`✅ populated ${bindingKey}:`, arr.length);
}

updatePageSections();
updateNet();

*/







































