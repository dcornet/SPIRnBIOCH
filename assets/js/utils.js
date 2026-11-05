(function () {
  "use strict";

  const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};

  function money(value, currency = "EUR") {
    if (!Number.isFinite(value)) return "Sur devis";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(value);
  }

  function rangeMoney(range, currency = "EUR") {
    if (Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.min === range.max) {
      return money(range.min, currency);
    }
    return `${money(range.min, currency)} - ${money(range.max, currency)}`;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  const scriptPromises = new Map();

  function loadScriptOnce(src, globalName) {
    if (globalName && globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    if (typeof document === "undefined") {
      return Promise.reject(new Error(`Chargement dynamique indisponible pour ${src}`));
    }
    const promise = new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts || []).find((script) => script.getAttribute("src") === src);
      if (existing) {
        existing.addEventListener("load", () => resolve(globalName ? globalThis[globalName] : existing), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Impossible de charger ${src}`)), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve(globalName ? globalThis[globalName] : script);
      script.onerror = () => reject(new Error(`Impossible de charger ${src}`));
      document.head.append(script);
    });
    scriptPromises.set(src, promise);
    return promise;
  }

  function slugDate(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function tooltipHtml(id, text, label = "Aide contextuelle") {
    return `
      <span class="help-tooltip">
        <button type="button" class="help-tooltip-trigger" aria-describedby="${escapeHtml(id)}" aria-label="${escapeHtml(label)}">?</button>
        <span class="help-tooltip-popup help-popover" id="${escapeHtml(id)}" role="tooltip" hidden>${escapeHtml(text)}</span>
      </span>
    `;
  }

  function attachTooltips(scope = document) {
    scope.querySelectorAll(".help-tooltip").forEach((tooltip) => {
      const trigger = tooltip.querySelector(".help-tooltip-trigger");
      const popup = tooltip.querySelector(".help-tooltip-popup");
      if (!trigger || !popup || trigger.dataset.tooltipBound === "true") return;
      trigger.dataset.tooltipBound = "true";
      const open = () => { popup.hidden = false; };
      const close = () => { popup.hidden = true; };
      trigger.addEventListener("mouseenter", open);
      trigger.addEventListener("focus", open);
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        open();
      });
      tooltip.addEventListener("mouseleave", close);
      trigger.addEventListener("blur", close);
      trigger.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close();
      });
    });
  }

  function makeId(prefix = "item") {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  function safeStorage() {
    try {
      const key = "__nirs_storage_test__";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      return localStorage;
    } catch (_error) {
      return null;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeReferencePart(value, maxLength = 11) {
    const stopWords = new Set(["D", "DE", "DU", "DES", "L", "LA", "LE", "LES"]);
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((part) => part && !stopWords.has(part))
      .join("")
      .slice(0, maxLength);
  }

  function formatSequenceNumber(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error("Le numero local du pre-devis est invalide.");
    }
    return String(number).padStart(4, "0");
  }

  function dateFromValue(value) {
    const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) {
      throw new Error("La date de generation du pre-devis est invalide.");
    }
    return date;
  }

  function compactDateYYMMDD(value) {
    const date = dateFromValue(value);
    return [
      String(date.getFullYear()).slice(-2),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("");
  }

  function buildQuoteReference({
    requester,
    sequenceNumber,
    generatedAt,
    serviceCode = "SPIR",
    documentCode = "PRD"
  }) {
    const date = dateFromValue(generatedAt);
    const unitCode = normalizeReferencePart(requester?.unit);
    if (!unitCode) {
      throw new Error("Renseignez l'unite, le laboratoire ou le service avant de generer les documents du pre-devis.");
    }
    const year = String(date.getFullYear());
    const reference = [
      normalizeReferencePart(documentCode, 8) || "PRD",
      year,
      normalizeReferencePart(serviceCode, 8) || "SPIR",
      formatSequenceNumber(sequenceNumber),
      unitCode,
      compactDateYYMMDD(date)
    ].join("_");
    return reference;
  }

  function sanitizeFilenameStem(value) {
    return normalizeReferencePart(String(value || "").replace(/_/g, " "), 80)
      .replace(/(.{2})(?=PRD|SPIR)/g, "$1")
      || "PREDEVIS";
  }

  function filenameFromReference(reference, extension = "pdf") {
    const stem = String(reference || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!stem) throw new Error("La reference du pre-devis est invalide.");
    return `${stem}.${String(extension || "pdf").replace(/[^a-z0-9]/gi, "").toLowerCase() || "pdf"}`;
  }

  function nextQuoteSequence(storage = safeStorage()) {
    if (!storage) return 1;
    const key = "nirs_spir_quote_sequence";
    const current = Number.parseInt(storage.getItem(key) || "0", 10);
    const next = Number.isInteger(current) && current > 0 ? current + 1 : 1;
    storage.setItem(key, String(next));
    return next;
  }

  function ensureQuoteReference(state, config = {}, options = {}) {
    if (!state) throw new Error("Etat du pre-devis indisponible.");
    if (state.document?.reference) return state.document;
    const generatedAt = options.generatedAt || new Date().toISOString();
    const sequenceNumber = options.sequenceNumber || nextQuoteSequence(options.storage === undefined ? safeStorage() : options.storage);
    const reference = buildQuoteReference({
      requester: state.requester || {},
      sequenceNumber,
      generatedAt,
      serviceCode: options.serviceCode || "SPIR",
      documentCode: options.documentCode || "PRD"
    });
    const generatedDate = dateFromValue(generatedAt);
    const validityDays = Number(config.textes?.pdf?.quoteValidityDays ?? config.textes?.quoteValidityDays ?? 45);
    const validUntilDate = addDays(generatedDate, Number.isFinite(validityDays) ? validityDays : 45);
    state.document = {
      type: "pre_quote",
      reference,
      fileName: filenameFromReference(reference, "pdf"),
      sequenceNumber,
      generatedAt,
      validUntil: isoLocal(validUntilDate)
    };
    return state.document;
  }

  function ensureQuoteDocument(state, config = {}, options = {}) {
    return ensureQuoteReference(state, config, options);
  }

  function localDate(value) {
    const parts = String(value || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function isoLocal(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function frenchHolidays(year) {
    const easter = easterSunday(year);
    return new Set([
      `${year}-01-01`,
      `${year}-05-01`,
      `${year}-05-08`,
      `${year}-07-14`,
      `${year}-08-15`,
      `${year}-11-01`,
      `${year}-11-11`,
      `${year}-12-25`,
      isoLocal(addDays(easter, 1)),
      isoLocal(addDays(easter, 39)),
      isoLocal(addDays(easter, 50))
    ]);
  }

  function isWorkingDay(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    return !frenchHolidays(date.getFullYear()).has(isoLocal(date));
  }

  function workingDaysBetween(startValue, endValue) {
    const start = localDate(startValue);
    const end = localDate(endValue);
    if (!start || !end || end < start) return 0;
    let count = 0;
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      if (isWorkingDay(cursor)) count += 1;
    }
    return count;
  }

  function suggestedHalfDays(startValue, endValue) {
    return workingDaysBetween(startValue, endValue) * 2;
  }

  function restoreAcquisitionDetails(answers) {
    const next = { ...answers };
    const legacy = next.legacySpectraDetails || {};
    if (next.samples === undefined && legacy.samples !== undefined) next.samples = legacy.samples;
    if (next.replicates === undefined && legacy.replicates !== undefined) next.replicates = legacy.replicates;
    if (next.instrument === "asd_labspec" && next.measurementDevice === "optical_fiber") {
      next.legacyMeasurementDevice = next.measurementDevice;
      next.measurementDevice = "";
      next.measurementDeviceNeedsReview = true;
    }
    return next;
  }

  function predictionNotes(config, answers = {}) {
    const notes = config.textes.prediction;
    const rate = config.tarifs.predictionReferenceAnalyses.samplingRate;
    const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 });
    const samplingRange = rate.min === rate.max ? percent.format(rate.min) : `${percent.format(rate.min)} à ${percent.format(rate.max)}`;
    const verification = answers.predictionMode === "with_reference"
      ? notes.withReference.replace("{samplingRange}", samplingRange)
        .replace("{maxSamples}", new Intl.NumberFormat("fr-FR").format(config.tarifs.predictionReferenceAnalyses.maxReferenceSamples))
      : notes.withoutReference;
    return [notes.conformity, verification, notes.releasePolicy];
  }

  NIRSApp.predictionNotes = predictionNotes;
  NIRSApp.restoreAcquisitionDetails = restoreAcquisitionDetails;
  NIRSApp.money = money;
  NIRSApp.rangeMoney = rangeMoney;
  NIRSApp.createElement = createElement;
  NIRSApp.downloadJson = downloadJson;
  NIRSApp.loadScriptOnce = loadScriptOnce;
  NIRSApp.slugDate = slugDate;
  NIRSApp.escapeHtml = escapeHtml;
  NIRSApp.tooltipHtml = tooltipHtml;
  NIRSApp.attachTooltips = attachTooltips;
  NIRSApp.makeId = makeId;
  NIRSApp.safeStorage = safeStorage;
  NIRSApp.clone = clone;
  NIRSApp.normalizeReferencePart = normalizeReferencePart;
  NIRSApp.formatSequenceNumber = formatSequenceNumber;
  NIRSApp.compactDateYYMMDD = compactDateYYMMDD;
  NIRSApp.buildQuoteReference = buildQuoteReference;
  NIRSApp.filenameFromReference = filenameFromReference;
  NIRSApp.nextQuoteSequence = nextQuoteSequence;
  NIRSApp.ensureQuoteReference = ensureQuoteReference;
  NIRSApp.ensureQuoteDocument = ensureQuoteDocument;
  NIRSApp.frenchHolidays = frenchHolidays;
  NIRSApp.isWorkingDay = isWorkingDay;
  NIRSApp.workingDaysBetween = workingDaysBetween;
  NIRSApp.suggestedHalfDays = suggestedHalfDays;
})();

