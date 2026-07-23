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

  function slugDate(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
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

  NIRSApp.money = money;
  NIRSApp.rangeMoney = rangeMoney;
  NIRSApp.createElement = createElement;
  NIRSApp.downloadJson = downloadJson;
  NIRSApp.slugDate = slugDate;
  NIRSApp.makeId = makeId;
  NIRSApp.safeStorage = safeStorage;
  NIRSApp.clone = clone;
})();

