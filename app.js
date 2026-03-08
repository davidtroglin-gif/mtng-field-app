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

const params = new URLSearchParams(location.search);
const ownerKey = params.get("ownerKey") || params.get("key") || "";

let editReady = false;
let isSubmitting = false;

// MUST be let so "New Form" can clear it
let editId = (params.get("edit") || "").trim();

// These are used throughout the app to decide insert vs update
let currentId = editId ? editId : newSubmissionId();
let mode = editId ? "edit" : "new";

// ===== DEBUG HOOK (module-safe) =====
window.mtngDebug = {
  state: () => ({ mode, editId, currentId, ownerKey }),
};

let _loadedFieldsBaseline = {};
let _loadedRepeatersBaseline = {};
let _loadedHourlyRateBaseline = {};

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

// ---- Section show/hide ----
const sectionLeakRepair = document.getElementById("sectionLeakRepair");
const sectionMains = document.getElementById("sectionMains");
const sectionRetirement = document.getElementById("sectionRetirement");
const sectionServices = document.getElementById("sectionServices");
const sectionCustomer = document.getElementById("sectionCustomer");
const sectionHourlyRate = document.getElementById("sectionHourlyRate");
const sectionSketchPhotos = document.getElementById("sectionSketchPhotos");

// ---- Hourly Rate DOM ----
const hourlyLaborBody = document.getElementById("hourlyLaborBody");
const hourlyEquipmentBody = document.getElementById("hourlyEquipmentBody");
const addHourlyLaborRowBtn = document.getElementById("addHourlyLaborRowBtn");

const EQUIPMENT_LIST = [
  "Hoe Ram w/ Backhoe",
  "Power Tools (Pump, Saw, ECT.)",
  "Backhoe",
  "Skid Steer Loader",
  "Dump Truck & Trailer",
  "Service Truck (Pickup)",
  "Welding Rig",
  "Trencher greater 90 hp",
  "Air compressor w/ accessories"
];

/* =========================
   Helpers
   ========================= */
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function setStatus(msg) {
  if (netStatusEl) netStatusEl.textContent = msg;
}

function debug(msg) {
  console.log(msg);
  if (debugEl) debugEl.textContent = msg;
}

function normKey(k) {
  return String(k ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normVal(v) {
  if (v === null || v === undefined) return "";
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
  return !!(el && el.offsetParent !== null);
}

window.addEventListener("unhandledrejection", (e) =>
  debug("Promise error: " + (e.reason?.message || e.reason))
);
window.addEventListener("error", (e) => debug("JS error: " + e.message));

setStatus("Status: app.js loaded ✅");
debug("app.js running ✅");

// ---- Edit boot (DEBUG) ----
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

/* =========================
   Hourly Rate Report
   ========================= */
function addHourlyLaborRow(data = {}) {
  if (!hourlyLaborBody) return;

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="hr-labor-name" value="${data.name || ""}"></td>
    <td><input type="number" class="hr-labor-hours" step="0.01" value="${data.hours || ""}"></td>
    <td><input type="number" class="hr-labor-rate" step="0.01" value="${data.rate || ""}"></td>
    <td><input type="number" class="hr-labor-total" step="0.01" value="${data.total || ""}" readonly></td>
    <td><button type="button" class="remove-hourly-labor-row">X</button></td>
  `;

  hourlyLaborBody.appendChild(tr);

  tr.querySelector(".hr-labor-hours")?.addEventListener("input", recalcHourlyRateForm);
  tr.querySelector(".hr-labor-rate")?.addEventListener("input", recalcHourlyRateForm);
  tr.querySelector(".remove-hourly-labor-row")?.addEventListener("click", () => {
    tr.remove();
    recalcHourlyRateForm();
  });

  recalcHourlyRateForm();
}

function buildHourlyEquipmentRows(savedRows = []) {
  if (!hourlyEquipmentBody) return;
  hourlyEquipmentBody.innerHTML = "";

  EQUIPMENT_LIST.forEach((item) => {
    const match = savedRows.find(r => (r.name || "") === item) || {};

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" class="hr-equip-name" value="${item}" readonly></td>
      <td><input type="number" class="hr-equip-hours" step="0.01" value="${match.hours || ""}"></td>
      <td><input type="number" class="hr-equip-rate" step="0.01" value="${match.rate || ""}"></td>
      <td><input type="number" class="hr-equip-total" step="0.01" value="${match.total || ""}" readonly></td>
    `;

    hourlyEquipmentBody.appendChild(tr);

    tr.querySelector(".hr-equip-hours")?.addEventListener("input", recalcHourlyRateForm);
    tr.querySelector(".hr-equip-rate")?.addEventListener("input", recalcHourlyRateForm);
  });

  recalcHourlyRateForm();
}

function recalcHourlyRateForm() {
  let totalLabor = 0;
  let totalEquipment = 0;

  document.querySelectorAll("#hourlyLaborBody tr").forEach((tr) => {
    const hours = num(tr.querySelector(".hr-labor-hours")?.value);
    const rate = num(tr.querySelector(".hr-labor-rate")?.value);
    const total = hours * rate;
    const totalEl = tr.querySelector(".hr-labor-total");
    if (totalEl) totalEl.value = total ? total.toFixed(2) : "";
    totalLabor += total;
  });

  document.querySelectorAll("#hourlyEquipmentBody tr").forEach((tr) => {
    const hours = num(tr.querySelector(".hr-equip-hours")?.value);
    const rate = num(tr.querySelector(".hr-equip-rate")?.value);
    const total = hours * rate;
    const totalEl = tr.querySelector(".hr-equip-total");
    if (totalEl) totalEl.value = total ? total.toFixed(2) : "";
    totalEquipment += total;
  });

  const totalLaborEl = document.getElementById("hr_totalLabor");
  const totalEquipmentEl = document.getElementById("hr_totalEquipment");
  const grandTotalEl = document.getElementById("hr_grandTotal");

  if (totalLaborEl) totalLaborEl.value = totalLabor ? totalLabor.toFixed(2) : "";
  if (totalEquipmentEl) totalEquipmentEl.value = totalEquipment ? totalEquipment.toFixed(2) : "";
  if (grandTotalEl) grandTotalEl.value = (totalLabor + totalEquipment) ? (totalLabor + totalEquipment).toFixed(2) : "";
}

addHourlyLaborRowBtn?.addEventListener("click", () => addHourlyLaborRow());

buildHourlyEquipmentRows();
addHourlyLaborRow();

function loadHourlyRateReport(data = {}) {
  const contractorEl = document.getElementById("hr_contractorName");
  const acceptedDateEl = document.getElementById("hr_mtngAcceptedDate");
  const timeStartedEl = document.getElementById("hr_timeStarted");
  const completedEl = document.getElementById("hr_completed");
  const workPerformedEl = document.getElementById("hr_workPerformed");

  if (contractorEl) contractorEl.value = data.contractorName || "Walker Construction";
  if (acceptedDateEl) acceptedDateEl.value = data.mtngAcceptedDate || "";
  if (timeStartedEl) timeStartedEl.value = data.timeStarted || "";
  if (completedEl) completedEl.value = data.completed || "";
  if (workPerformedEl) workPerformedEl.value = data.workPerformed || "";

  if (hourlyLaborBody) hourlyLaborBody.innerHTML = "";

  const laborRows = Array.isArray(data.laborRows) ? data.laborRows : [];
  if (laborRows.length) laborRows.forEach(row => addHourlyLaborRow(row));
  else addHourlyLaborRow();

  buildHourlyEquipmentRows(Array.isArray(data.equipmentRows) ? data.equipmentRows : []);
  recalcHourlyRateForm();
}

/* =========================
   NEW FORM BUTTON
   ========================= */
const newFormBtn = document.getElementById("newForm");

newFormBtn?.addEventListener("click", () => {
  editId = "";
  mode = "new";
  currentId = newSubmissionId();

  createdAtLocked = null;
  existingSketch = null;
  sketchDirty = false;

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
   Page switching
   ========================= */
function updatePageSections() {
  const pt = pageTypeEl?.value || "Leak Repair";
  const isHourlyRate = pt === "MTNG Hourly Rate Report";

  updateJobNumberLabel(pt);

  if (sectionLeakRepair) sectionLeakRepair.style.display = pt === "Leak Repair" ? "block" : "none";
  if (sectionMains) sectionMains.style.display = pt === "Mains" ? "block" : "none";
  if (sectionRetirement) sectionRetirement.style.display = pt === "Retirement" ? "block" : "none";
  if (sectionServices) sectionServices.style.display = pt === "Services" ? "block" : "none";
  if (sectionHourlyRate) sectionHourlyRate.style.display = isHourlyRate ? "block" : "none";

  if (sectionCustomer) sectionCustomer.style.display = isHourlyRate ? "none" : "block";
  if (sectionSketchPhotos) sectionSketchPhotos.style.display = isHourlyRate ? "none" : "block";
}

pageTypeEl?.addEventListener("change", updatePageSections);
updatePageSections();

function updateJobNumberLabel(pageType) {
  const label = document.getElementById("mloLabel");
  if (!label) return;

  const pt = String(pageType || "").trim();
  if (pt === "Services" || pt === "Retirement") label.textContent = "SLO Number";
  else if (pt === "Leak Repair") label.textContent = "LRO Number";
  else label.textContent = "MLO Number";
}

/* =========================
   Sketch canvas
   ========================= */
const canvas = document.getElementById("sketch");
const ctx = canvas?.getContext("2d");

if (ctx) {
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
}

let drawing = false;
let last = null;
let existingSketch = null;
let sketchDirty = false;

function markSketchDirty() {
  sketchDirty = true;
  console.log("✅ sketchDirty set TRUE");
}

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
  markSketchDirty();
  if (ev.cancelable) ev.preventDefault();
}

function moveDraw(ev) {
  if (!canvas || !ctx || !drawing) return;
  if (ev.cancelable) ev.preventDefault();

  markSketchDirty();

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
  markSketchDirty();
});

/* =========================
   Repeater row helper
   ========================= */
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

/* =========================
   Repeaters: containers
   ========================= */
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

/* =========================
   Repeaters: add-row functions
   ========================= */
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
      <label>ST Pipe Thickness</label><input data-r="pipeMaterials" data-k="ST Pipe Thickness" value="${data["ST Pipe Thickness"] || ""}">
      <label>Coating Type</label><input data-r="pipeMaterials" data-k="Coating Type" value="${data["Coating Type"] || ""}">
      <label>Depth (inches)</label><input data-r="pipeMaterials" data-k="Depth (inches)" value="${data["Depth (inches)"] || ""}">
      <label>Length (feet)</label><input data-r="pipeMaterials" data-k="Length (feet)" value="${data["Length (feet)"] || ""}">
    `)
  );
}

function addOtherMaterialRow(data = {}) {
  otherMaterialsEl?.appendChild(
    makeRow(`
      <label>Type</label><input data-r="otherMaterials" data-k="Type" value="${data["Type"] || ""}">
      <label>Size</label><input data-r="otherMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="otherMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Quantity</label><input type="number" name="quantity" data-r="otherMaterials" data-k="Quantity" value="${data["Quantity"] || ""}">
    `)
  );
}

function addPipeTestRow(data = {}) {
  pipeTestsEl?.appendChild(
    makeRow(`
      <label>Date Tested</label><input type="date" data-r="pipeTests" data-k="Date Tested" value="${data["Date Tested"] || ""}">
      <label>Test Type</label><input data-r="pipeTests" data-k="Test Type" value="${data["Test Type"] || ""}">
      <div class="check" style="margin-top:8px;">
        <input type="checkbox" data-r="pipeTests" data-k="Soaped with no Leaks" ${isCheckedVal(data["Soaped with no Leaks"]) ? "checked" : ""}>
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
      <label>ST Pipe Thickness</label><input data-r="mainsMaterials" data-k="ST Pipe Thickness" value="${data["ST Pipe Thickness"] || ""}">
      <label>Coating Type</label><input data-r="mainsMaterials" data-k="Coating Type" value="${data["Coating Type"] || ""}">
      <label>Depth (inches)</label><input data-r="mainsMaterials" data-k="Depth (inches)" value="${data["Depth (inches)"] || ""}">
      <label>Length (feet)</label><input data-r="mainsMaterials" data-k="Length (feet)" value="${data["Length (feet)"] || ""}">
    `)
  );
}

function addMainsOtherMaterialRow(data = {}) {
  mainsOtherMaterialsEl?.appendChild(
    makeRow(`
      <label>Type</label><input data-r="mainsOtherMaterials" data-k="Type" value="${data["Type"] || ""}">
      <label>Size</label><input data-r="mainsOtherMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="mainsOtherMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Quantity</label><input type="number" name="quantity" data-r="mainsOtherMaterials" data-k="Quantity" value="${data["Quantity"] || ""}">
    `)
  );
}

function addMainsPipeTestRow(data = {}) {
  mainsPipeTestsEl?.appendChild(
    makeRow(`
      <label>Date Tested</label><input type="date" data-r="mainsPipeTests" data-k="Date Tested" value="${data["Date Tested"] || ""}">
      <label>Test Type</label><input data-r="mainsPipeTests" data-k="Test Type" value="${data["Test Type"] || ""}">
      <div class="check" style="margin-top:8px;">
        <input type="checkbox" data-r="mainsPipeTests" data-k="Soaped with no Leaks" ${isCheckedVal(data["Soaped with no Leaks"]) ? "checked" : ""}>
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
      <label>ST Pipe Thickness</label><input data-r="svcMaterials" data-k="ST Pipe Thickness" value="${data["ST Pipe Thickness"] || ""}">
      <label>Coating Type</label><input data-r="svcMaterials" data-k="Coating Type" value="${data["Coating Type"] || ""}">
      <label>Depth (inches)</label><input data-r="svcMaterials" data-k="Depth (inches)" value="${data["Depth (inches)"] || ""}">
      <label>Length (feet)</label><input data-r="svcMaterials" data-k="Length (feet)" value="${data["Length (feet)"] || ""}">
    `)
  );
}

function addSvcOtherMaterialRow(data = {}) {
  svcOtherMaterialsEl?.appendChild(
    makeRow(`
      <label>Type</label><input data-r="svcOtherMaterials" data-k="Type" value="${data["Type"] || ""}">
      <label>Size</label><input data-r="svcOtherMaterials" data-k="Size" value="${data["Size"] || ""}">
      <label>Material</label><input data-r="svcOtherMaterials" data-k="Material" value="${data["Material"] || ""}">
      <label>Quantity</label><input type="number" name="quantity" data-r="svcOtherMaterials" data-k="Quantity" value="${data["Quantity"] || ""}">
    `)
  );
}

function addSvcPipeTestRow(data = {}) {
  svcPipeTestsEl?.appendChild(
    makeRow(`
      <label>Date Tested</label><input type="date" data-r="svcPipeTests" data-k="Date Tested" value="${data["Date Tested"] || ""}">
      <label>Test Type</label><input data-r="svcPipeTests" data-k="Test Type" value="${data["Test Type"] || ""}">
      <div class="check" style="margin-top:8px;">
        <input type="checkbox" data-r="svcPipeTests" data-k="Soaped with no Leaks" ${isCheckedVal(data["Soaped with no Leaks"]) ? "checked" : ""}>
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
      <label>Quantity</label><input type="number" name="quantity" data-r="retNewMaterials" data-k="Quantity" value="${data["Quantity"] || ""}">
    `)
  );
}

document.getElementById("addRetSection")?.addEventListener("click", () => addRetSectionRow());
document.getElementById("addRetStructures")?.addEventListener("click", () => addRetStructuresRow());
document.getElementById("addRetNewMaterials")?.addEventListener("click", () => addRetNewMaterialsRow());

// starter rows only for new mode
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

/* =========================
   Gatherers
   ========================= */
function gatherFieldsNormalized() {
  const fields = {};
  const root = document.getElementById("app") || document;
  const els = Array.from(root.querySelectorAll("input[name], textarea[name], select[name]"));
  const isNonEmpty = (v) => String(v ?? "").trim().length > 0;

  els.forEach((el) => {
    const name = normKey(el.name);
    if (!name || el.disabled) return;

    if (el.type === "checkbox") {
      const incoming = !!el.checked;
      const existing = !!fields[name];
      fields[name] = existing || incoming;
      return;
    }

    if (el.type === "radio") {
      if (!el.checked) return;
      fields[name] = normVal(el.value);
      return;
    }

    const incoming = normVal(el.value);

    if (name in fields) {
      const existing = fields[name];
      if (isNonEmpty(existing) && !isNonEmpty(incoming)) return;
    }

    fields[name] = incoming;
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

/* =========================
   Repeater population
   ========================= */
function clearRepeaterContainer(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll("[data-row]").forEach(r => r.remove());
}

function normalizeRepeatersObj(repeaters) {
  return (repeaters && typeof repeaters === "object") ? repeaters : {};
}

const REPEATER_BINDINGS = {
  pipeMaterials: { container: () => document.getElementById("pipeMaterials"), addRow: addPipeMaterialRow },
  otherMaterials: { container: () => document.getElementById("otherMaterials"), addRow: addOtherMaterialRow },
  pipeTests: { container: () => document.getElementById("pipeTests"), addRow: addPipeTestRow },

  mainsMaterials: { container: () => document.getElementById("mainsMaterials"), addRow: addMainsMaterialRow },
  mainsOtherMaterials: { container: () => document.getElementById("mainsOtherMaterials"), addRow: addMainsOtherMaterialRow },
  mainsPipeTests: { container: () => document.getElementById("mainsPipeTests"), addRow: addMainsPipeTestRow },

  svcMaterials: { container: () => document.getElementById("svcMaterials"), addRow: addSvcMaterialRow },
  svcOtherMaterials: { container: () => document.getElementById("svcOtherMaterials"), addRow: addSvcOtherMaterialRow },
  svcPipeTests: { container: () => document.getElementById("svcPipeTests"), addRow: addSvcPipeTestRow },

  retSection: { container: () => document.getElementById("retSection"), addRow: addRetSectionRow },
  retStructures: { container: () => document.getElementById("retStructures"), addRow: addRetStructuresRow },
  retNewMaterials: { container: () => document.getElementById("retNewMaterials"), addRow: addRetNewMaterialsRow },
};

function populateRepeatersForPage(pageType, repeaters) {
  const pt = String(pageType || "").trim();
  const reps = normalizeRepeatersObj(repeaters);

  const pageRepeaterKeys =
    pt === "Leak Repair" ? ["pipeMaterials","otherMaterials","pipeTests"] :
    pt === "Mains" ? ["mainsMaterials","mainsOtherMaterials","mainsPipeTests"] :
    pt === "Services" ? ["svcMaterials","svcOtherMaterials","svcPipeTests"] :
    pt === "Retirement" ? ["retSection","retStructures","retNewMaterials"] :
    [];

  pageRepeaterKeys.forEach(key => {
    const b = REPEATER_BINDINGS[key];
    if (b) clearRepeaterContainer(b.container());
  });

  pageRepeaterKeys.forEach(key => {
    const b = REPEATER_BINDINGS[key];
    if (!b) return;

    const rows = Array.isArray(reps[key]) ? reps[key] : [];
    if (rows.length) rows.forEach(r => b.addRow(r || {}));
    else b.addRow({});
  });

  console.log("✅ Repeaters populated for", pt, "→", pageRepeaterKeys);
}

/* =========================
   Field population
   ========================= */
function attrValEsc_(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function fireInputChange_(el) {
  try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
  try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
}

function _attrEsc_(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function _fire_(el) {
  try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
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
  const NEVER_BOOLISH = new Set([normKey("Quantity")]);
  const fields = (fieldsObj && typeof fieldsObj === "object") ? fieldsObj : {};

  const idxForm = new Map();
  const idxDoc = new Map();

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
    const kRaw = String(k ?? "");
    const kNorm = normKey(kRaw);
    const key = kNorm || normKey(kRaw);

    let els = Array.from(formEl.querySelectorAll(`[name="${_attrEsc_(kRaw)}"]`));
    if (!els.length) els = Array.from(document.querySelectorAll(`[name="${_attrEsc_(kRaw)}"]`));
    if (!els.length && kNorm) els = idxForm.get(kNorm) || [];
    if (!els.length && kNorm) els = idxDoc.get(kNorm) || [];

    if (!els.length) {
      const byId = document.getElementById(kRaw) || (kNorm ? document.getElementById(kNorm) : null);
      if (byId) els = [byId];
    }

    if (!els.length) continue;

    const vis = els.filter(isVisible);
    if (vis.length) els = vis;

    const types = new Set(els.map(e => (e.type || "").toLowerCase()));

    if (types.has("radio")) {
      els.forEach(r => _set_(r, v));
      continue;
    }

    const cbs = els.filter(e => (e.type || "").toLowerCase() === "checkbox");
    if (cbs.length > 1 && cbs.length === els.length) {
      const isBoolish =
        !NEVER_BOOLISH.has(key) && (
          typeof v === "boolean" ||
          (typeof v === "string" && ["true","false","yes","no","y","n","1","0","checked","on","off"].includes(v.trim().toLowerCase())) ||
          typeof v === "number"
        );

      if (isBoolish) {
        const checked = isCheckedVal(v);
        cbs.forEach(cb => { cb.checked = checked; _fire_(cb); });
        continue;
      }

      const want = new Set(Array.isArray(v) ? v.map(String) : [String(v)]);
      cbs.forEach(cb => {
        cb.checked = want.has(String(cb.value));
        _fire_(cb);
      });
      continue;
    }

    _set_(els[0], v);
  }
}

/* =========================
   Edit loading
   ========================= */
let _editLoading = false;

document.addEventListener("DOMContentLoaded", () => {
  const p = new URLSearchParams(location.search);
  const id = p.get("edit");
  if (id) loadForEdit(id);
});

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
    const hourlyRateReport = p.hourlyRateReport || {};

    createdAtLocked = p.createdAt || null;
    editId = submissionId;
    currentId = submissionId;
    mode = "edit";

    form.reset();

    const pt = String(p.pageType || "Leak Repair").trim();
    console.log("EDIT pageType:", JSON.stringify(pt));

    if (pageTypeEl) {
      const exists = [...pageTypeEl.options].some(o => o.value === pt);
      pageTypeEl.value = exists ? pt : "Leak Repair";
      updatePageSections();
    }

    // ---- SKETCH ----
    existingSketch = null;
    sketchDirty = false;

    try {
      const sketchUrl = p.media?.sketchUrl || "";
      console.log("EDIT SKETCH:", {
        hasEmbeddedDataUrl: !!p.sketch?.dataUrl,
        sketchUrl,
      });

      if (p.sketch?.dataUrl) {
        existingSketch = p.sketch;
        await drawDataUrlToCanvas_(p.sketch.dataUrl);
        console.log("✅ drew embedded sketch dataUrl");
      } else if (sketchUrl && /^https?:\/\//i.test(sketchUrl)) {
        const dataUrl = await urlToDataUrlClient_(sketchUrl);
        console.log("FETCHED SKETCH dataUrl len:", dataUrl ? dataUrl.length : 0);

        if (dataUrl) {
          existingSketch = {
            filename: p.sketch?.filename || `sketch_${submissionId}.png`,
            dataUrl,
          };
          await drawDataUrlToCanvas_(dataUrl);
          console.log("✅ drew sketch from media.sketchUrl");
        } else {
          console.warn("⚠️ sketchUrl fetch returned empty dataUrl");
        }
      } else if (sketchUrl) {
        console.warn("⚠️ invalid sketchUrl ignored:", sketchUrl);
      } else {
        console.warn("⚠️ no sketch found (no embedded dataUrl, no media.sketchUrl)");
      }
    } catch (err) {
      console.error("⚠️ sketch load failed, continuing without sketch:", err);
      existingSketch = null;
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    populateRepeatersForPage(pt, repeaters);
    populateFieldsSmart_(form, fields);

    if (pt === "MTNG Hourly Rate Report") {
      loadHourlyRateReport(hourlyRateReport);
    }

    updatePageSections();

    _loadedFieldsBaseline = { ...(fields || {}) };
    _loadedRepeatersBaseline = JSON.parse(JSON.stringify(repeaters || {}));
    _loadedHourlyRateBaseline = JSON.parse(JSON.stringify(hourlyRateReport || {}));

    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    setStatus("Edit mode ready ✅");
    console.log("✅ Edit load complete for", submissionId);

    editReady = true;
    _editLoading = false;
    if (submitBtn) submitBtn.disabled = false;

  } catch (err) {
    console.error(err);
    setStatus("Error: " + (err?.message || err));
    _editLoading = false;
  }
}

/* =========================
   Photo / sketch helpers
   ========================= */
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
  return new Promise((resolve, reject) => {
    if (!canvas || !ctx) return resolve();

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = () => reject(new Error("Sketch image failed to load"));
    img.src = dataUrl;
  });
}

/* =========================
   Edit bootstrap
   ========================= */
function setSubmitButtonLabel_() {
  const submitBtn = document.querySelector('button[type="submit"]');
  if (!submitBtn) return;
  submitBtn.textContent = (mode === "edit") ? "Update Submission" : "Submit Now (If Online)";
}

window.addEventListener("load", async () => {
  try {
    setSubmitButtonLabel_();

    if (editId) {
      console.log("BOOT: editId detected -> loading payload", editId);
      await loadForEdit(editId);
      setSubmitButtonLabel_();
    } else {
      console.log("BOOT: no editId -> new form");
    }
  } catch (err) {
    console.error("BOOT ERROR:", err);
    setStatus("Boot error: " + (err?.message || err));
  }
});

/* =========================
   Payload build
   ========================= */
let createdAtLocked = null;

function collectHourlyRateReport() {
  const laborRows = Array.from(document.querySelectorAll("#hourlyLaborBody tr")).map((tr) => ({
    name: tr.querySelector(".hr-labor-name")?.value?.trim() || "",
    hours: tr.querySelector(".hr-labor-hours")?.value || "",
    rate: tr.querySelector(".hr-labor-rate")?.value || "",
    total: tr.querySelector(".hr-labor-total")?.value || ""
  })).filter(r => r.name || r.hours || r.rate || r.total);

  const equipmentRows = Array.from(document.querySelectorAll("#hourlyEquipmentBody tr")).map((tr) => ({
    name: tr.querySelector(".hr-equip-name")?.value?.trim() || "",
    hours: tr.querySelector(".hr-equip-hours")?.value || "",
    rate: tr.querySelector(".hr-equip-rate")?.value || "",
    total: tr.querySelector(".hr-equip-total")?.value || ""
  })).filter(r => r.hours || r.rate || r.total);

  return {
    contractorName: document.getElementById("hr_contractorName")?.value?.trim() || "Walker Construction",
    mtngAcceptedDate: document.getElementById("hr_mtngAcceptedDate")?.value || "",
    timeStarted: document.getElementById("hr_timeStarted")?.value || "",
    completed: document.getElementById("hr_completed")?.value || "",
    workPerformed: document.getElementById("hr_workPerformed")?.value?.trim() || "",
    totalLabor: document.getElementById("hr_totalLabor")?.value || "",
    totalEquipment: document.getElementById("hr_totalEquipment")?.value || "",
    grandTotal: document.getElementById("hr_grandTotal")?.value || "",
    laborRows,
    equipmentRows
  };
}

async function buildPayload() {
  const deviceId = getDeviceId();

  let fields = gatherFieldsNormalized();
  const getF = (label) => fields[normKey(label)];

  console.log("FIELD CHECK:", {
    pipeCondition: getF("Pipe Condition"),
    odor: getF("Odor Readily Detectable"),
    typeOfTap: getF("Type of Tap"),
    foreman: getF("Foreman"),
    fusion: getF("Fusion Tech"),
    steel: getF("Steel Welder"),
    hours: getF("Contract Labor Hours"),
    dateCompleted: getF("Date Completed"),
    mtng: getF("MTNG On-Site Personnel"),
    acceptedBy: getF("Accepted By"),
  });

  let repeaters = gatherRepeaters();

  if (mode === "edit") {
    fields = { ..._loadedFieldsBaseline, ...fields };
    repeaters = { ..._loadedRepeatersBaseline, ...repeaters };
  }

  const createdAt =
    (mode === "edit" && createdAtLocked)
      ? createdAtLocked
      : (createdAtLocked || new Date().toISOString());

  const updatedAt = new Date().toISOString();

  const photoInput = form.querySelector('input[type="file"][data-photos]');
  const files = Array.from(photoInput?.files || []).slice(0, 5);

  const photos = [];
  for (const f of files) {
    const dataUrl = await fileToCompressedDataUrl(f);
    photos.push({ filename: f.name || `photo_${currentId}.jpg`, dataUrl });
  }

  // Only send sketch if user changed it
  let sketch = null;
  if (canvas && sketchDirty) {
    sketch = {
      filename: `sketch_${currentId}.png`,
      dataUrl: canvas.toDataURL("image/png"),
    };
  } else {
    sketch = null;
  }

  console.log("SKETCH DEBUG:", {
    canvas: !!canvas,
    sketchDirty,
    existingSketch: !!existingSketch,
    sketchHasDataUrl: !!(sketch && sketch.dataUrl),
    sketchDataUrlLen: sketch?.dataUrl?.length || 0
  });

  const pageType = pageTypeEl?.value || "Leak Repair";

  const payload = normalizePayload({
    submissionId: currentId,
    pageType,
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

  if (pageType === "MTNG Hourly Rate Report") {
    const currentHourly = collectHourlyRateReport();
    payload.hourlyRateReport = (mode === "edit")
      ? { ...(_loadedHourlyRateBaseline || {}), ...currentHourly }
      : currentHourly;
    console.log("HOURLY PAYLOAD:", payload.hourlyRateReport);
  }

  if (mode === "edit" && editId && payload.submissionId !== editId) {
    throw new Error(`Edit safety check failed: editId=${editId} payloadId=${payload.submissionId}`);
  }

  return payload;
}

/* =========================
   Submit / update
   ========================= */
async function sendSubmission_(payload) {
  payload.submissionId = currentId;

  const url = new URL(API_URL);
  if (ownerKey) url.searchParams.set("key", ownerKey);

  if (mode === "edit") {
    url.searchParams.set("action", "update");
    url.searchParams.set("id", currentId);
    payload.action = "update";
  } else {
    url.searchParams.set("action", "submit");
    payload.action = "submit";
  }

  console.log("POST URL:", url.toString());
  console.log("POST MODE/IDS:", { mode, editId, currentId, submissionId: payload.submissionId, action: payload.action });
  console.log("FIELDS COUNT:", Object.keys(payload.fields || {}).length);
  console.log("REPEATERS KEYS:", Object.keys(payload.repeaters || {}));
  console.log("SKETCH?", !!payload.sketch, "PHOTOS:", (payload.photos || []).length);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  console.log("FETCH redirected?", res.redirected, "final url:", res.url, "status:", res.status);

  const txt = await res.text();
  console.log("POST RESPONSE:", { status: res.status, txt });

  let j = null;
  try { j = JSON.parse(txt); } catch {}

  if (j?.message && String(j.message).includes("MTNG API OK")) {
    throw new Error("Server returned doGet default response. Update did not run—check deployment/version.");
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  if (j && j.ok === false) throw new Error(j.error || "Server returned ok:false");
  if (j && j.ok === true) return j;

  throw new Error("Unexpected server response: " + txt.slice(0, 160));
}

/* =========================
   Reset to new form
   ========================= */
function resetToNewForm() {
  mode = "new";
  editId = "";
  editReady = false;
  createdAtLocked = null;

  currentId = newSubmissionId();

  form?.reset();
  updatePageSections?.();

  const pt = pageTypeEl?.value || "Leak Repair";
  populateRepeatersForPage?.(pt, {});

  existingSketch = null;
  sketchDirty = false;
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

  const photoInput = form?.querySelector('input[type="file"][data-photos]');
  if (photoInput) photoInput.value = "";

  const u = new URL(window.location.href);
  u.searchParams.delete("edit");
  history.replaceState({}, "", u.toString());

  const submitBtn = document.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = "Submit Submission";

  setStatus?.("Ready");
}

/* =========================
   Form submit
   ========================= */
form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isSubmitting) return;
  isSubmitting = true;

  const wasNew = (mode === "new");

  try {
    setStatus(wasNew ? "Submitting…" : "Updating…");

    const payload = await buildPayload();
    const result = await sendSubmission_(payload);

    console.log("✅ Saved:", result);
    setStatus("Saved ✅");

    if (wasNew) resetToNewForm();
  } catch (err) {
    console.error(err);

    const msg = String(err?.message || err);
    const isNetworkish =
      !navigator.onLine ||
      msg.includes("Failed to fetch") ||
      msg.includes("NetworkError") ||
      msg.includes("Load failed") ||
      msg.includes("TypeError: Failed to fetch");

    if (isNetworkish) {
      if (!wasNew) {
        setStatus("Update may have saved — please verify in dashboard.");
        alert("The update may have already saved. Please verify before trying again.");
        return;
      }

      try {
        await addToQueue_(navigator.onLine ? "network_error" : "offline");
        setStatus("Queued ✅ (will sync when online)");
        alert("No connection — saved to Queue and will sync when online.");

        if (wasNew) resetToNewForm();
        return;
      } catch (qErr) {
        console.error("Queue failed:", qErr);
        setStatus("Queue failed: " + (qErr?.message || qErr));
        alert("Queue failed: " + (qErr?.message || qErr));
        return;
      }
    }

    setStatus("Save failed: " + msg);
    alert("Save failed: " + msg);
  } finally {
    isSubmitting = false;
  }
});

form?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "textarea") return;
  e.preventDefault();
});

/* =========================
   Offline: Drafts + Queue + Sync
   ========================= */
async function saveDraft_() {
  const payload = await buildPayload();
  await db.put("drafts", {
    ...payload,
    _savedAt: new Date().toISOString(),
    _kind: "draft",
  });
  setStatus("Draft saved ✅");
}

async function addToQueue_(reason = "manual") {
  const payload = await buildPayload();
  await db.put("queue", {
    ...payload,
    _queuedAt: new Date().toISOString(),
    _lastError: "",
    _reason: reason,
    _kind: "queue",
  });
  setStatus("Queued ✅ (will sync when online)");
}

async function trySync() {
  if (!navigator.onLine) {
    setStatus("Offline — cannot sync");
    return;
  }

  const items = await db.getAll("queue");
  if (!items.length) {
    setStatus("Nothing queued ✅");
    return;
  }

  setStatus(`Syncing ${items.length}…`);
  let ok = 0;

  for (const item of items) {
    try {
      currentId = item.submissionId;
      mode = item.mode === "edit" ? "edit" : "new";
      editId = item.editId || (mode === "edit" ? item.submissionId : "");

      await sendSubmission_(item);
      await db.del("queue", item.submissionId);
      ok++;
    } catch (e) {
      await db.put("queue", {
        ...item,
        _lastError: String(e?.message || e),
        _lastTryAt: new Date().toISOString(),
      });
    }
  }

  setStatus(`Sync done ✅ (${ok}/${items.length})`);
}

async function showStore_(storeName) {
  const items = await db.getAll(storeName);

  if (!items.length) {
    debug(`${storeName}: (empty)`);
    return;
  }

  debug(
    `${storeName.toUpperCase()} (${items.length})\n` +
      items
        .map((x) => {
          const when = x._savedAt || x._queuedAt || x.createdAt || "";
          const err = x._lastError ? ` | ERROR: ${x._lastError}` : "";
          return `${x.submissionId} | ${x.pageType} | ${when}${err}`;
        })
        .join("\n")
  );
}

/* =========================
   Button wiring
   ========================= */
document.getElementById("saveDraft")?.addEventListener("click", () => {
  saveDraft_().catch((e) => alert("Draft save failed: " + (e?.message || e)));
});

document.getElementById("syncNow")?.addEventListener("click", () => {
  trySync().catch((e) => alert("Sync failed: " + (e?.message || e)));
});

document.getElementById("openDrafts")?.addEventListener("click", () => {
  showStore_("drafts").catch((e) => alert("Drafts error: " + (e?.message || e)));
});

document.getElementById("openQueue")?.addEventListener("click", () => {
  showStore_("queue").catch((e) => alert("Queue error: " + (e?.message || e)));
});

document.getElementById("queueForSync")?.addEventListener("click", () => {
  addToQueue_("manual").catch((e) => alert("Queue failed: " + (e?.message || e)));
});

document.getElementById("openOwnerDash")?.addEventListener("click", () => {
  let k =
    (ownerKey || "").trim() ||
    (sessionStorage.getItem("mtng_owner_key") || "").trim();

  if (!k) {
    k = (prompt("Enter owner password/key to open the dashboard:") || "").trim();
  }

  if (!k) return;

  sessionStorage.setItem("mtng_owner_key", k);

  const url = new URL("./owner.html", window.location.href);
  url.searchParams.set("key", k);
  window.location.href = url.toString();
});

updatePageSections();
updateNet();
