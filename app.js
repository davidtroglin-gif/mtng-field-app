import { db } from "./db.js";

/* =========================
   SERVICE WORKER: auto-reload on update
   ========================= */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_UPDATED") {
      location.reload();
    }
  });
}

/* =========================
   CONFIG / URL PARAMS
   ========================= */
const API_URL =
  "https://script.google.com/macros/s/AKfycby4A2Ci8N6IFLB7oORb7KKThB_jqW580SV0EvG67CZ1FFoudWgLttJ8PyOiqPMKXtDiEQ/exec";

const params = new URLSearchParams(window.location.search);
const ownerKey = (params.get("key") || "").trim(); // ✅ pulled from URL

// MUST be let so "New Form" can clear it
let editId = (params.get("edit") || "").trim();

// These are used throughout the app to decide insert vs update
let currentId = editId ? editId : newSubmissionId();
let mode = editId ? "edit" : "new";




window.mtngDebug = {
  state: () => ({ mode, editId, currentId, ownerKey }),
  set: (patch) => {
    if (patch.mode !== undefined) mode = patch.mode;
    if (patch.editId !== undefined) editId = patch.editId;
    if (patch.currentId !== undefined) currentId = patch.currentId;
    return { mode, editId, currentId };
  }
};






/* =========================
   UI helpers / DOM
   ========================= */
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

/* =========================
   NEW FORM BUTTON
   ========================= */
const newFormBtn = document.getElementById("newForm");

newFormBtn?.addEventListener("click", () => {
  editId = "";
  mode = "new";
  currentId = newSubmissionId();

  createdAtLocked = null;     // ✅ important
  existingSketch = null;      // ✅ important
  sketchDirty = false;        // ✅ important

  const u = new URL(window.location.href);
  u.searchParams.delete("edit");
  history.replaceState({}, "", u.toString());

  form?.reset();

  if (pageTypeEl) {
    pageTypeEl.value = "Leak Repair";
    pageTypeEl.dispatchEvent(new Event("change"));
  }

  if (formMeta) formMeta.textContent = "";
  if (debugEl) debugEl.textContent = "";
});


/* =========================
   OPTIONAL: helper to refresh params (if you ever need it)
   ========================= */
function refreshUrlParams_() {
  const p = new URLSearchParams(window.location.search);
  editId = (p.get("edit") || "").trim();
  // ownerKey usually stays constant; re-read only if you expect it to change
}



//OLD CODE OLD CODE OLD CODE
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
  return crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}


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

// =====================================================
// EDIT: Drop-in replacement loader + field population
// =====================================================
// ---------- field population (bulletproof) ----------
function attrValEsc_(s) {
  // Escape for CSS attribute selector values inside double quotes
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function fireInputChange_(el) {
  try { el.dispatchEvent(new Event("input",  { bubbles: true })); } catch {}
  try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
}

function setElValue_(el, v) {
  if (!el) return;
  const t = (el.type || "").toLowerCase();

  if (t === "checkbox") {
    el.checked = isCheckedVal(v);
    fireInputChange_(el);
    return;
  }

  if (t === "radio") {
    el.checked = (String(el.value) === String(v));
    fireInputChange_(el);
    return;
  }

  el.value = (v ?? "");
  fireInputChange_(el);
}

function buildNameIndex_(root) {
  // normalized-name -> list of elements
  const idx = new Map();
  const all = Array.from(root.querySelectorAll("input[name],select[name],textarea[name]"));
  for (const el of all) {
    const nk = normKey(el.name);
    if (!nk) continue;
    if (!idx.has(nk)) idx.set(nk, []);
    idx.get(nk).push(el);
  }
  return idx;
}

function findElsByKey_(formEl, key, nameIndexDoc, nameIndexForm) {
  const kRaw = String(key ?? "");
  const kNorm = normKey(kRaw);

  // 1) exact name inside form
  let els = Array.from(formEl.querySelectorAll(`[name="${attrValEsc_(kRaw)}"]`));
  if (els.length) return els;

  // 2) exact name anywhere
  els = Array.from(document.querySelectorAll(`[name="${attrValEsc_(kRaw)}"]`));
  if (els.length) return els;

  // 3) normalized name match (form first, then document)
  if (kNorm) {
    const inForm = nameIndexForm.get(kNorm);
    if (inForm?.length) return inForm;

    const inDoc = nameIndexDoc.get(kNorm);
    if (inDoc?.length) return inDoc;
  }

  // 4) id match
  const byId = document.getElementById(kRaw) || (kNorm ? document.getElementById(kNorm) : null);
  if (byId) return [byId];

  // 5) data-field match (optional)
  const df = Array.from(document.querySelectorAll(`[data-field="${attrValEsc_(kRaw)}"]`));
  if (df.length) return df;

  return [];
}

function _attrEsc_(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function _fire_(el) {
  try { el.dispatchEvent(new Event("input",  { bubbles: true })); } catch {}
  try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
}
function _set_(el, v) {
  if (!el) return;
  const t = (el.type || "").toLowerCase();
  if (t === "checkbox") el.checked = isCheckedVal(v);
  else if (t === "radio") el.checked = (String(el.value) === String(v));
  else el.value = (v ?? "");
  _fire_(el);
}

function populateFieldsSmart_(formEl, fieldsObj) {
  const fields = (fieldsObj && typeof fieldsObj === "object") ? fieldsObj : {};

  // Build normalized name index (form + document) to handle NBSP/spacing mismatches
  const idxForm = new Map();
  const idxDoc  = new Map();

  const addToIdx = (idx, root) => {
    Array.from(root.querySelectorAll("input[name],select[name],textarea[name]")).forEach(el => {
      const nk = normKey(el.name);
      if (!nk) return;
      if (!idx.has(nk)) idx.set(nk, []);
      idx.get(nk).push(el);
    });
  };

  addToIdx(idxForm, formEl);
  addToIdx(idxDoc, document);

  for (const [k, v] of Object.entries(fields)) {
    const kRaw  = String(k ?? "");
    const kNorm = normKey(kRaw);

    // 1) exact name inside form
    let els = Array.from(formEl.querySelectorAll(`[name="${_attrEsc_(kRaw)}"]`));

    // 2) exact name anywhere
    if (!els.length) els = Array.from(document.querySelectorAll(`[name="${_attrEsc_(kRaw)}"]`));

    // 3) normalized name match (form first, then doc)
    if (!els.length && kNorm) els = idxForm.get(kNorm) || [];
    if (!els.length && kNorm) els = idxDoc.get(kNorm) || [];

    // 4) id match fallback (if some controls use id not name)
    if (!els.length) {
      const byId = document.getElementById(kRaw) || (kNorm ? document.getElementById(kNorm) : null);
      if (byId) els = [byId];
    }

    if (!els.length) continue;

    // ✅ Prefer visible matches if any exist (fixes Mains vs Services duplicates)
    const vis = els.filter(isVisible);
    if (vis.length) els = vis;

    const types = new Set(els.map(e => (e.type || "").toLowerCase()));

    // ---- RADIO GROUP ----
    if (types.has("radio")) {
      els.forEach(r => _set_(r, v));
      continue;
    }

    // ---- CHECKBOXES ----
    const cbs = els.filter(e => (e.type || "").toLowerCase() === "checkbox");
    if (cbs.length > 1) {
      // If payload is boolean-ish, treat as "same checkbox duplicated on page"
      // (Mains + Services) and set them all the same.
      const isBoolish =
        typeof v === "boolean" ||
        (typeof v === "string" && ["true","false","yes","no","y","n","1","0","checked","on","off"].includes(v.trim().toLowerCase())) ||
        typeof v === "number";

      if (isBoolish) {
        const checked = isCheckedVal(v);
        cbs.forEach(cb => { cb.checked = checked; _fire_(cb); });
        continue;
      }

      // Otherwise treat as a real checkbox group with distinct values
      const want = new Set(Array.isArray(v) ? v.map(String) : [String(v)]);
      cbs.forEach(cb => {
        cb.checked = want.has(String(cb.value));
        _fire_(cb);
      });
      continue;
    }

    // ---- SINGLE ELEMENT ----
    _set_(els[0], v);
  }
}


async function loadForEdit(submissionId) {
  if (_editLoading) return;
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
    const raw = await res.text();
    console.log("RAW RESPONSE:", raw);

    const json = JSON.parse(raw);
    console.log("PARSED JSON:", json);

    if (!json.ok) throw new Error(json.error || "Failed to load");

    const p = json.payload || {};
    const fields = p.fields || {};
    const repeaters = p.repeaters || {};

    // ---- SET EDIT MODE + PRESERVE ORIGINAL CREATED TIME ----
    createdAtLocked = p.createdAt || null;
    editId = submissionId;
    currentId = submissionId;
    mode = "edit";

    // Reset first (keeps it clean)
    form.reset();

    // ---- SET PAGE TYPE FIRST + SHOW SECTION ----
    const pt = String(p.pageType || "Leak Repair").trim();
    console.log("EDIT pageType:", JSON.stringify(pt));

    if (pageTypeEl) {
      const exists = [...pageTypeEl.options].some(o => o.value === pt);
      pageTypeEl.value = exists ? pt : "Leak Repair";
      updatePageSections();
    }

    // ---- SKETCH ----
    existingSketch = p.sketch || null;
    sketchDirty = false;

    if (existingSketch?.dataUrl) {
      await drawDataUrlToCanvas_(existingSketch.dataUrl);
    }

    // ---- REPEATERS ----
    populateRepeatersForPage(pt, repeaters);

    // ---- FIELDS ----
    populateFieldsSmart_(form, fields);
    updatePageSections();

    // update submit button label
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Update Submission";

    setStatus("Edit mode ready ✅");
    console.log("✅ Edit load complete for", submissionId);

  } catch (err) {
    console.error(err);
    setStatus("Edit load failed: " + (err?.message || err));
  } finally {
    _editLoading = false;
  }
}




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
// =====================================================
// EDIT / MODE / ID LOCK (DROP-IN)
// =====================================================
//const params = new URLSearchParams(location.search);

// MUST be let so New Form can clear it
//let editId = params.get("edit") || "";

// Keep createdAt stable per record (important so edits don't look like "new" submissions)
let createdAtLocked = null;

// If you load an existing payload elsewhere, set createdAtLocked from it.
// But even if you don't, this will still behave well.

// =====================================================
// buildPayload (DROP-IN REPLACEMENT)
// =====================================================
async function buildPayload() {
  const deviceId = getDeviceId();

  // IMPORTANT: gather from a root that includes all inputs
  const root = document.getElementById("app") || document;
  const fields = gatherFieldsNormalized(root);
  const repeaters = gatherRepeaters();

  // Preserve createdAt on edit; always set updatedAt
  const createdAt =
    (mode === "edit" && createdAtLocked)
      ? createdAtLocked
      : (createdAtLocked || new Date().toISOString());

  const updatedAt = new Date().toISOString();

  // Photos
  const photoInput = form.querySelector('input[type="file"][data-photos]');
  const files = Array.from(photoInput?.files || []).slice(0, 5);

  const photos = [];
  for (const f of files) {
    const dataUrl = await fileToCompressedDataUrl(f);
    photos.push({ filename: f.name || `photo_${currentId}.jpg`, dataUrl });
  }

  // Sketch
  const sketch =
    canvas
      ? (sketchDirty
          ? { filename: `sketch_${currentId}.png`, dataUrl: canvas.toDataURL("image/png") }
          : (existingSketch || null))
      : (existingSketch || null);

  const payload = normalizePayload({
    submissionId: currentId,
    pageType: pageTypeEl?.value || "Leak Repair",
    deviceId,
    createdAt,
    updatedAt,
    fields,
    repeaters,
    sketch,
    photos,
    mode,
    editId
  });

  // Safety guard: prevent accidental "edit becomes new"
  if (mode === "edit" && editId && payload.submissionId !== editId) {
    throw new Error(`Edit safety check failed: editId=${editId} payloadId=${payload.submissionId}`);
  }

  return payload;
}

// ============================
// SUBMIT / UPDATE (SERVER POST)
// ============================
async function sendSubmission_(payload) {
  // make absolutely sure the id is stable
  payload.submissionId = currentId;

  const url = new URL(API_URL);

  // owner key (needed for your doGet and can also be used for doPost if you want)
  if (ownerKey) url.searchParams.set("key", ownerKey);

  if (mode === "edit") {
    url.searchParams.set("action", "update");
    url.searchParams.set("id", currentId);

    // safety: also include in body (in case server starts reading action from body)
    payload.action = "update";
  } else {
    // your server routes anything other than "update" to submit_()
    url.searchParams.set("action", "submit");
    payload.action = "submit";
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text();

  let j = null;
  try { j = JSON.parse(txt); } catch {}

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  if (j && j.ok === false) throw new Error(j.error || "Server returned ok:false");

  return j || { ok: true, raw: txt };
}

// ============================
// FORM SUBMIT HANDLER
// ============================
form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    setStatus(mode === "edit" ? "Updating…" : "Submitting…");

    const payload = await buildPayload();   // ✅ your existing builder
    const result = await sendSubmission_(payload);

    console.log("✅ Saved:", result);

    // After first successful submit, switch into edit mode (so next save updates)
    if (mode !== "edit") {
      mode = "edit";
      editId = currentId;

      // update the URL to include edit id (keep key)
      const u = new URL(window.location.href);
      u.searchParams.set("edit", currentId);
      if (ownerKey) u.searchParams.set("key", ownerKey);
      history.replaceState({}, "", u.toString());

      // update submit button label
      const submitBtn = document.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.textContent = "Update Submission";
    }

    setStatus("Saved ✅");
  } catch (err) {
    console.error(err);
    setStatus("Save failed: " + (err?.message || err));
    alert("Save failed: " + (err?.message || err));
  }
});


// --- helpers -------------------------------------------------
function _nk(s) {
  // use your normKey if present, otherwise fallback
  const f = (typeof normKey === "function") ? normKey : (x) => String(x || "").trim();
  return f(s);
}

function _setElValue(el, v) {
  if (!el) return;
 if (el.type === "checkbox") el.checked = isCheckedVal(v);
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

  //console.log(`✅ populated ${bindingKey}:`, arr.length);
}


updatePageSections();
updateNet();













































































