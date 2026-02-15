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

window.addEventListener("load", async () => {
  if (!editId) return;

  debug("Calling loadForEdit(...) now…");

  try {
    await loadForEdit(editId);
    debug("loadForEdit finished ✅");
  } catch (err) {
    debug("loadForEdit threw: " + (err?.message || err));
  }
});


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

// =====================================================
// Gather fields + repeaters
// =====================================================
function gatherFieldsNormalized(formEl) {
  const fields = {};
  const els = Array.from(formEl.querySelectorAll("input[name], textarea[name], select[name]"));

  els.forEach((el) => {
    if (!isVisible(el)) return;

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

function clearRepeaterContainer(el) {
  if (!el) return;
  el.innerHTML = "";
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

function clearRepeaterContainer(containerEl) {
  if (!containerEl) return;
  // remove only repeater rows (your makeRow sets [data-row])
  containerEl.querySelectorAll('[data-row]').forEach(el => el.remove());
}

function normalizeRepeatersObj(repeaters) {
  // handles undefined/null
  return (repeaters && typeof repeaters === "object") ? repeaters : {};
}

const REPEATER_BINDINGS = {
  // Leak Repair
  pipeMaterials: { container: () => pipeMaterialsEl, addRow: addPipeMaterialRow },
  otherMaterials: { container: () => otherMaterialsEl, addRow: addOtherMaterialRow },
  pipeTests: { container: () => pipeTestsEl, addRow: addPipeTestRow },

  // Mains
  mainsMaterials: { container: () => mainsMaterialsEl, addRow: addMainsMaterialRow },
  mainsOtherMaterials: { container: () => mainsOtherMaterialsEl, addRow: addMainsOtherMaterialRow },
  mainsPipeTests: { container: () => mainsPipeTestsEl, addRow: addMainsPipeTestRow },

  // Services
  svcMaterials: { container: () => svcMaterialsEl, addRow: addSvcMaterialRow },
  svcOtherMaterials: { container: () => svcOtherMaterialsEl, addRow: addSvcOtherMaterialRow },
  svcPipeTests: { container: () => svcPipeTestsEl, addRow: addSvcPipeTestRow },

  // Retirement
  retSection: { container: () => retSectionEl, addRow: addRetSectionRow },
  retStructures: { container: () => retStructuresEl, addRow: addRetStructuresRow },
  retNewMaterials: { container: () => retNewMaterialsEl, addRow: addRetNewMaterialsRow },
};

function populateRepeatersForPage(pageType, repeaters) {
  const reps = normalizeRepeatersObj(repeaters);

  console.log("POPULATE repeaters keys:", Object.keys(reps));

  // 1) Clear ALL repeater containers first (removes your starter rows)
  Object.values(REPEATER_BINDINGS).forEach(b => clearRepeaterContainer(b.container()));

  // 2) Add rows from payload for any repeater key present
  Object.entries(reps).forEach(([repName, rows]) => {
    const binding = REPEATER_BINDINGS[repName];
    if (!binding) {
      console.warn("No binding for repeater:", repName, rows);
      return;
    }

    const arr = Array.isArray(rows) ? rows : [];
    console.log(`POPULATE ${repName}:`, arr.length);

    if (arr.length === 0) {
      // optional: add one blank row if empty
      binding.addRow({});
      return;
    }

    arr.forEach(rowObj => binding.addRow(rowObj || {}));
  });

  // 3) If the page has repeaters but payload didn’t include them, ensure at least one blank row exists
  // (optional quality-of-life)
  // Example: if editing a Leak Repair with no repeaters saved, show one row each.
  if (String(pageType).trim() === "Leak Repair") {
    if (pipeMaterialsEl && pipeMaterialsEl.querySelectorAll('[data-row]').length === 0) addPipeMaterialRow();
    if (otherMaterialsEl && otherMaterialsEl.querySelectorAll('[data-row]').length === 0) addOtherMaterialRow();
    if (pipeTestsEl && pipeTestsEl.querySelectorAll('[data-row]').length === 0) addPipeTestRow();
  }
}


async function loadForEdit(submissionId) {
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
    const fields = p.fields || {};         // ✅ ADD THIS
    const repeaters = p.repeaters || {};   // ✅ ADD THIS

    console.log("PAGE TYPE:", p.pageType);
    console.log("REPEATERS OBJECT:", repeaters);
    console.log("REPEATER KEYS:", Object.keys(repeaters));

    // ---- SET EDIT MODE ----
    currentId = submissionId;
    mode = "edit";

    // reset first
    form.reset();

    // set page type BEFORE populating fields
    const pt = String(p.pageType || "").trim();
    console.log("EDIT pageType:", JSON.stringify(pt));

    if (pageTypeEl) {
      const exists = [...pageTypeEl.options].some(o => o.value === pt);
      pageTypeEl.value = exists ? pt : "Leak Repair";
      updatePageSections();
    }

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
  if (pipeMaterialsEl) {
    pipeMaterialsEl.innerHTML = "";
    addPipeMaterialRow();
  }
  if (otherMaterialsEl) {
    otherMaterialsEl.innerHTML = "";
    addOtherMaterialRow();
  }
  if (pipeTestsEl) {
    pipeTestsEl.innerHTML = "";
    addPipeTestRow();
  }

  if (mainsMaterialsEl) {
    mainsMaterialsEl.innerHTML = "";
    addMainsMaterialRow();
  }
  if (mainsOtherMaterialsEl) {
    mainsOtherMaterialsEl.innerHTML = "";
    addMainsOtherMaterialRow();
  }
  if (mainsPipeTestsEl) {
    mainsPipeTestsEl.innerHTML = "";
    addMainsPipeTestRow();
  }

  if (svcMaterialsEl) {
    svcMaterialsEl.innerHTML = "";
    addSvcMaterialRow();
  }
  if (svcOtherMaterialsEl) {
    svcOtherMaterialsEl.innerHTML = "";
    addSvcOtherMaterialRow();
  }
  if (svcPipeTestsEl) {
    svcPipeTestsEl.innerHTML = "";
    addSvcPipeTestRow();
  }

  if (retSectionEl) {
    retSectionEl.innerHTML = "";
    addRetSectionRow();
  }
  if (retStructuresEl) {
    retStructuresEl.innerHTML = "";
    addRetStructuresRow();
  }
  if (retNewMaterialsEl) {
    retNewMaterialsEl.innerHTML = "";
    addRetNewMaterialsRow();
  }

  formMeta.textContent = `New: ${currentId}`;
  updatePageSections();
});

// optional: if you have these buttons wired elsewhere, keep them harmless
document.getElementById("openDrafts")?.addEventListener("click", () => {
  debug("openDrafts clicked (handler not implemented in this drop-in).");
});
document.getElementById("openQueue")?.addEventListener("click", () => {
  debug("openQueue clicked (handler not implemented in this drop-in).");
});

//if (editId) {
 // loadForEdit(editId);
//}


updatePageSections();
updateNet();

























