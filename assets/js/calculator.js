(function () {
  "use strict";

const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};

function makeEmptyResult(tarifs) {
  return {
    status: "estimated",
    currency: tarifs.metadata.currency,
    taxMode: tarifs.metadata.taxMode,
    technicalValue: { min: 0, max: 0 },
    billedEstimate: { min: 0, max: 0 },
    inKindContribution: { min: 0, max: 0 },
    inKindContributionBreakdown: emptyInKindContributionBreakdown(),
    partnershipBreakdown: null,
    items: [],
    exclusions: [],
    warnings: [],
    assumptions: [],
    pricingAudit: emptyPricingAudit()
  };
}

function emptyPricingAudit() {
  return {
    technicalReferenceAmount: { min: 0, max: 0 },
    technicalDiscussionRange: { min: 0, max: 0 },
    contextId: "",
    contextMode: "",
    contextCoefficient: null,
    subcontractingAdjustmentAmount: { min: 0, max: 0 },
    partnershipBreakdown: null,
    administrativeFee: { min: 0, max: 0 },
    billingMinimumAdjustment: { min: 0, max: 0 },
    billedEstimate: { min: 0, max: 0 },
    quoteRequiredItems: [],
    overlapWarnings: [],
    maintenance: []
  };
}

function emptyInKindContributionBreakdown() {
  return {
    personnel: { min: 0, max: 0 },
    training: { min: 0, max: 0 },
    negotiatedReduction: { min: 0, max: 0 },
    total: { min: 0, max: 0 }
  };
}

function roundRange(range, rounding) {
  const precision = Number(rounding?.precision ?? 1);
  const factor = precision > 0 ? 1 / precision : 1;
  const roundNearest = (value) => Math.round(Number(value) * factor + 1e-9) / factor;
  return {
    min: roundNearest(range.min),
    max: roundNearest(range.max)
  };
}

function assertQuantity(value, label, { integer = false, allowZero = false, max = 100000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${label}: valeur non numérique`);
  }
  if (number < 0 || (!allowZero && number === 0)) {
    throw new RangeError(`${label}: valeur négative ou nulle interdite`);
  }
  if (integer && !Number.isInteger(number)) {
    throw new RangeError(`${label}: entier attendu`);
  }
  if (number > max) {
    throw new RangeError(`${label}: valeur trop élevée`);
  }
  return number;
}

function asBool(value) {
  return value === true || value === "true" || value === "on";
}

function priceFrom(source, key) {
  const price = source?.[key];
  if (!price) throw new Error(`Tarif manquant: ${key}`);
  return price;
}

function instrumentFrom(tarifs, id) {
  const instrument = tarifs.instruments[id];
  if (!instrument) throw new Error(`Instrument inconnu: ${id}`);
  return instrument;
}

function addRange(left = {}, right = {}) {
  return {
    min: Number(left.min || 0) + Number(right.min || 0),
    max: Number(left.max || 0) + Number(right.max || 0)
  };
}

function multiplyRange(range = {}, minCoefficient = 1, maxCoefficient = minCoefficient) {
  return {
    min: Number(range.min || 0) * Number(minCoefficient),
    max: Number(range.max || 0) * Number(maxCoefficient)
  };
}

function finiteRange(min, max) {
  return Number.isFinite(Number(min)) && Number.isFinite(Number(max));
}

function lineTechnicalRange(line) {
  return {
    min: Number(line.technicalTotalMin ?? line.totalMin ?? 0),
    max: Number(line.technicalTotalMax ?? line.totalMax ?? 0)
  };
}

function ensureLineAccounting(line, fallbackCategory = "technical_non_personnel") {
  if (!line || line.pricingMode === "quote") return line;
  const technical = lineTechnicalRange(line);
  line.technicalTotalMin = technical.min;
  line.technicalTotalMax = technical.max;
  line.billedTotalMin = Number.isFinite(Number(line.billedTotalMin)) ? Number(line.billedTotalMin) : technical.min;
  line.billedTotalMax = Number.isFinite(Number(line.billedTotalMax)) ? Number(line.billedTotalMax) : technical.max;
  line.costCategory = line.costCategory || fallbackCategory;
  if (!Array.isArray(line.costComponents) || !line.costComponents.length) {
    line.costComponents = [{
      category: line.costCategory,
      label: line.costCategory,
      min: technical.min,
      max: technical.max
    }];
  }
  return line;
}

function reconcileCostComponents(components, total) {
  const normalized = components.map((component) => ({
    category: component.category,
    label: component.label,
    min: Number(component.min || 0),
    max: Number(component.max || 0)
  }));
  const sum = normalized.reduce((acc, component) => addRange(acc, component), { min: 0, max: 0 });
  const equipment = normalized.find((component) => component.category === "equipment") || normalized[0];
  if (equipment) {
    equipment.min += Number(total.min || 0) - sum.min;
    equipment.max += Number(total.max || 0) - sum.max;
  }
  return normalized;
}

function costComponentsFromSplit(price = {}, total = {}, fallbackCategory = "technical_non_personnel") {
  const split = Array.isArray(price.costSplit) ? price.costSplit : [];
  if (!split.length) return null;
  const components = split.map((component) => {
    const share = Number(component.share);
    if (!Number.isFinite(share) || share < 0) throw new RangeError(`Ventilation de coût invalide pour ${price.label || fallbackCategory}`);
    return {
      category: component.category || fallbackCategory,
      label: component.label || component.category || fallbackCategory,
      min: Number(total.min || 0) * share,
      max: Number(total.max || 0) * share
    };
  });
  return reconcileCostComponents(components, total);
}

function finiteNumber(value, label, { positive = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${label}: valeur invalide`);
  if (positive ? number <= 0 : number < 0) throw new RangeError(`${label}: valeur négative ou nulle interdite`);
  return number;
}

function roundCostModelValue(value, rounding) {
  return roundRange({ min: value, max: value }, rounding || { precision: 1 }).min;
}

function calculateAnnualDepreciation(costModel, globalSettings = {}) {
  const purchaseValue = finiteNumber(costModel?.purchase?.workingValue, "Prix d'achat de travail");
  const amortizationYears = finiteNumber(
    costModel?.amortizationYears || globalSettings.amortizationYears,
    "Durée d'amortissement",
    { positive: true }
  );
  return purchaseValue / amortizationYears;
}

function calculateInstrumentAnnualCost(costModel, globalSettings = {}) {
  const depreciation = calculateAnnualDepreciation(costModel, globalSettings);
  const annual = costModel?.annualCosts || {};
  return (
    depreciation +
    finiteNumber(annual.maintenance, "Maintenance annuelle") +
    finiteNumber(annual.indirectPersonnel, "Personnel indirect annuel") +
    finiteNumber(annual.softwareAndLicenses, "Logiciels et licences annuels") +
    finiteNumber(annual.standardsAndReferences, "Standards et références annuels") +
    finiteNumber(annual.informationTechnology, "Informatique annuelle") +
    finiteNumber(annual.insurance || 0, "Assurance annuelle")
  );
}

function calculateMachineHalfDayCost(costModel, globalSettings = {}) {
  const annualCost = calculateInstrumentAnnualCost(costModel, globalSettings);
  const capacity = finiteNumber(
    costModel?.capacity?.targetHalfDaysPerYear || globalSettings.centralTargetHalfDaysPerYear,
    "Capacité annuelle en demi-journées",
    { positive: true }
  );
  return annualCost / capacity;
}

function calculateSelfServiceHalfDayCost(costModel, globalSettings = {}) {
  const direct = costModel?.directServiceCosts || {};
  const directStaffHourlyRate = finiteNumber(
    direct.directStaffHourlyRate || globalSettings.directStaffHourlyRate,
    "Taux horaire du personnel direct",
    { positive: true }
  );
  return (
    calculateMachineHalfDayCost(costModel, globalSettings) +
    finiteNumber(
      direct.selfServicePreparationReturnHours ?? globalSettings.selfServicePreparationReturnHours,
      "Temps de préparation et retour en autonomie"
    ) * directStaffHourlyRate +
    finiteNumber(direct.routineConsumablesPerHalfDay, "Consommables courants par demi-journée")
  );
}

function calculateAssistedHalfDayCost(costModel, globalSettings = {}) {
  const direct = costModel?.directServiceCosts || {};
  const assistedDirectStaffHourlyRate = finiteNumber(
    direct.assistedDirectStaffHourlyRate ?? globalSettings.assistedDirectStaffHourlyRate ?? direct.directStaffHourlyRate ?? globalSettings.directStaffHourlyRate,
    "Taux horaire du personnel direct en accompagnement",
    { positive: true }
  );
  return (
    calculateMachineHalfDayCost(costModel, globalSettings) +
    finiteNumber(direct.assistedStaffHoursPerHalfDay, "Temps personnel en accompagnement") * assistedDirectStaffHourlyRate +
    finiteNumber(direct.routineConsumablesPerHalfDay, "Consommables courants par demi-journée")
  );
}

function canonicalServiceMode(mode) {
  return {
    self_service: "autonomous_supported",
    assisted: "plateau_operated",
    full_service: "plateau_operated"
  }[mode] || mode || "autonomous_supported";
}

function calculateAutonomousSupportedComponents(costModel, globalSettings = {}) {
  const machineHalfDayCost = calculateMachineHalfDayCost(costModel, globalSettings);
  const direct = costModel?.directServiceCosts || {};
  const routineConsumablesPerHalfDay = finiteNumber(direct.routineConsumablesPerHalfDay, "Consommables courants par demi-journée");
  const machineAndConsumables = machineHalfDayCost + routineConsumablesPerHalfDay;
  const supportRate = finiteNumber(
    direct.autonomousTechnicalSupportRate ?? globalSettings.autonomousTechnicalSupportRate,
    "Taux d'assistance technique autonome"
  );
  const supportCost = machineAndConsumables * supportRate;
  return {
    machineHalfDayCost,
    routineConsumablesPerHalfDay,
    machineAndConsumables,
    autonomousTechnicalSupportRate: supportRate,
    autonomousTechnicalSupportAmount: supportCost,
    technicalHalfDayCost: machineAndConsumables + supportCost
  };
}

function calculatePlateauOperatedComponents(costModel, globalSettings = {}) {
  const machineHalfDayCost = calculateMachineHalfDayCost(costModel, globalSettings);
  const direct = costModel?.directServiceCosts || {};
  const routineConsumablesPerHalfDay = finiteNumber(direct.routineConsumablesPerHalfDay, "Consommables courants par demi-journée");
  const staffHours = finiteNumber(direct.plateauStaffHoursPerHalfDay ?? globalSettings.hoursPerHalfDay, "Temps personnel plateau par demi-journée");
  const staffHourlyRate = finiteNumber(direct.directStaffHourlyRate ?? globalSettings.directStaffHourlyRate, "Taux horaire du personnel plateau", { positive: true });
  const staffCost = staffHours * staffHourlyRate;
  return {
    machineHalfDayCost,
    routineConsumablesPerHalfDay,
    staffHours,
    staffHourlyRate,
    staffCost,
    technicalHalfDayCost: machineHalfDayCost + routineConsumablesPerHalfDay + staffCost
  };
}

function manualHalfDayPrice(instrument, serviceMode, globalSettings = {}) {
  const costModel = instrument.costModel || {};
  const manual = costModel.pricing?.manualOverride || {};
  const key = canonicalServiceMode(serviceMode) === "plateau_operated" ? "assistedHalfDay" : "selfServiceHalfDay";
  const config = manual[key] || {};
  if (config.pricingMode === "range") {
    const min = finiteNumber(config.min, `Tarif manuel ${key} min`);
    const max = finiteNumber(config.max, `Tarif manuel ${key} max`);
    if (min > max) throw new RangeError(`Tarif manuel ${key}: min supérieur au max`);
    return {
      min,
      max,
      source: "manual",
      detail: { manual: true },
      costBasis: {
        modelVersion: costModel.version || "",
        pricingSource: "manual",
        roundedHalfDayPrice: min === max ? min : null,
        roundedHalfDayPriceMin: min,
        roundedHalfDayPriceMax: max
      }
    };
  }
  const amount = finiteNumber(config.amount, `Tarif manuel ${key}`, { positive: true });
  return {
    min: amount,
    max: amount,
    source: "manual",
    detail: { manual: true },
    costBasis: {
      modelVersion: costModel.version || "",
      pricingSource: "manual",
      roundedHalfDayPrice: amount
    }
  };
}

function resolveInstrumentHalfDayPrice(instrument, serviceMode, globalSettings = {}) {
  const canonicalMode = canonicalServiceMode(serviceMode);
  const costModel = instrument.costModel;
  if (!costModel?.enabled) throw new Error(`Modèle de coût instrument requis pour ${instrument.label}`);
  const pricingMode = costModel.pricing?.mode || (costModel.pricing?.manualOverride?.enabled ? "manual" : "cost_model");
  if (pricingMode === "manual" || costModel.pricing?.manualOverride?.enabled === true) {
    return manualHalfDayPrice(instrument, canonicalMode, globalSettings);
  }
  if (pricingMode !== "cost_model") throw new Error(`Mode de tarification instrument inconnu: ${pricingMode}`);

  const annualCost = calculateInstrumentAnnualCost(costModel, globalSettings);
  const targetHalfDaysPerYear = finiteNumber(
    costModel.capacity?.targetHalfDaysPerYear || globalSettings.centralTargetHalfDaysPerYear,
    "Capacité annuelle en demi-journées",
    { positive: true }
  );
  const components = canonicalMode === "plateau_operated"
    ? calculatePlateauOperatedComponents(costModel, globalSettings)
    : calculateAutonomousSupportedComponents(costModel, globalSettings);
  const roundedHalfDayPrice = roundCostModelValue(components.technicalHalfDayCost, globalSettings.rounding);
  return {
    min: roundedHalfDayPrice,
    max: roundedHalfDayPrice,
    source: "cost_model",
    detail: {
      annualCost,
      targetHalfDaysPerYear,
      machineHalfDayCost: components.machineHalfDayCost,
      staffHours: components.staffHours || 0,
      staffHourlyRate: components.staffHourlyRate || 0,
      staffCost: components.staffCost || 0,
      routineConsumablesPerHalfDay: components.routineConsumablesPerHalfDay,
      machineAndConsumables: components.machineAndConsumables ?? (components.machineHalfDayCost + components.routineConsumablesPerHalfDay),
      autonomousTechnicalSupportRate: components.autonomousTechnicalSupportRate ?? null,
      autonomousTechnicalSupportAmount: components.autonomousTechnicalSupportAmount || 0,
      technicalHalfDayCost: components.technicalHalfDayCost,
      roundedHalfDayPrice
    },
    costBasis: {
      modelVersion: costModel.version,
      pricingSource: "cost_model",
      serviceMode: canonicalMode,
      purchaseWorkingValue: Number(costModel.purchase?.workingValue),
      amortizationYears: Number(costModel.amortizationYears || globalSettings.amortizationYears),
      annualCost,
      targetHalfDaysPerYear,
      machineHalfDayCost: components.machineHalfDayCost,
      routineConsumablesPerHalfDay: components.routineConsumablesPerHalfDay,
      machineAndConsumables: components.machineAndConsumables ?? (components.machineHalfDayCost + components.routineConsumablesPerHalfDay),
      autonomousTechnicalSupportRate: components.autonomousTechnicalSupportRate ?? null,
      autonomousTechnicalSupportAmount: components.autonomousTechnicalSupportAmount || 0,
      staffHours: components.staffHours || 0,
      staffHourlyRate: components.staffHourlyRate || 0,
      staffCost: components.staffCost || 0,
      technicalHalfDayCost: components.technicalHalfDayCost,
      roundedHalfDayPrice
    }
  };
}

function spectralCapacityFor(tarifs, choices) {
  const instrumentId = choices.instrument;
  const measurementDeviceId = choices.measurementDevice;
  const device = tarifs.spectralThroughputProfiles?.[instrumentId]?.[measurementDeviceId];
  if (!device) return null;
  const allowedModes = device.quantityEstimateModes;
  const mode = canonicalServiceMode(choices.serviceMode || "autonomous_supported");
  const aliases = mode === "autonomous_supported" ? ["autonomous_supported", "self_service"] : ["plateau_operated", "assisted"];
  if (Array.isArray(allowedModes) && !aliases.some((entry) => allowedModes.includes(entry))) return null;
  const halfDays = assertQuantity(choices.halfDays || 1, "Nombre de demi-journées réservées", { integer: true });
  const hoursPerHalfDay = Number(tarifs.reservation?.hoursPerHalfDay || 4);
  const minRate = finitePositiveRate(device.samplesPerHour?.min);
  const maxRate = finitePositiveRate(device.samplesPerHour?.max);
  if (!Number.isFinite(minRate) || !Number.isFinite(maxRate) || maxRate < minRate) {
    return device.requiresValidation ? {
      min: null,
      max: null,
      unit: "spectrum",
      halfDays,
      hoursPerHalfDay,
      ratePerHour: null,
      instrumentId,
      measurementDeviceId,
      label: device.label,
      measurementWindow: device.measurementWindow,
      requiresValidation: true
    } : null;
  }
  return {
    min: halfDays * hoursPerHalfDay * minRate,
    max: halfDays * hoursPerHalfDay * maxRate,
    unit: "spectrum",
    halfDays,
    hoursPerHalfDay,
    ratePerHour: {
      min: minRate,
      max: maxRate
    },
    instrumentId,
    measurementDeviceId,
    label: device.label,
    measurementWindow: device.measurementWindow,
    requiresValidation: device.requiresValidation === true
  };
}

function finitePositiveRate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function contextFrom(tarifs, id) {
  const migration = {
    point_support: "internal_agap",
    occasional_help: "internal_agap",
    collaborative_project: "partnership"
  };
  const contextId = Object.prototype.hasOwnProperty.call(migration, id) ? migration[id] : id;
  if (!contextId) return { id: "", context: null };
  return {
    id: contextId,
    context: tarifs.contexts[contextId] || null
  };
}

function addRangeItem(result, id, label, quantity, unit, price, reason, mandatory = false) {
  const costCategory = price.costCategory || "technical_non_personnel";
  if (price.pricingMode === "quote") {
    const item = {
      id,
      label: price.label || label,
      quantity,
      unit,
      unitPriceMin: null,
      unitPriceMax: null,
      totalMin: null,
      totalMax: null,
      pricingMode: "quote",
      mandatory,
      reason,
      costCategory
    };
    result.items.push(item);
    return item;
  }

  const item = {
    id,
    label,
    quantity,
    unit: unit || price.unit,
    unitPriceMin: Number(price.min),
    unitPriceMax: Number(price.max),
    totalMin: quantity * Number(price.min),
    totalMax: quantity * Number(price.max),
    pricingMode: price.pricingMode,
    mandatory,
    reason,
    costCategory,
    discussionRangePolicy: price.discussionRangePolicy || null,
    preQuoteAdjustmentEligible: price.discussionRangePolicy?.mode !== "none"
  };
  item.technicalReferenceUnitPrice = Number(price.min) === Number(price.max) ? Number(price.min) : (Number(price.min) + Number(price.max)) / 2;
  item.technicalReferenceTotal = item.technicalReferenceUnitPrice * quantity;
  const splitComponents = costComponentsFromSplit(price, { min: item.totalMin, max: item.totalMax }, costCategory);
  if (splitComponents) item.costComponents = splitComponents;
  ensureLineAccounting(item, costCategory);
  result.items.push(item);
  result.technicalValue.min += item.totalMin;
  result.technicalValue.max += item.totalMax;
  return item;
}

function addDerivedItem(result, id, label, quantity, unit, unitMin, unitMax, reason, mandatory = false, costCategory = "technical_non_personnel", costComponents = null) {
  const item = {
    id,
    label,
    quantity,
    unit,
    unitPriceMin: unitMin,
    unitPriceMax: unitMax,
    totalMin: quantity * unitMin,
    totalMax: quantity * unitMax,
    pricingMode: "range",
    mandatory,
    reason,
    costCategory,
    discussionRangePolicy: null,
    preQuoteAdjustmentEligible: true
  };
  item.technicalReferenceUnitPrice = unitMin === unitMax ? unitMin : (unitMin + unitMax) / 2;
  item.technicalReferenceTotal = item.technicalReferenceUnitPrice * quantity;
  if (Array.isArray(costComponents) && costComponents.length) item.costComponents = costComponents;
  ensureLineAccounting(item, costCategory);
  result.items.push(item);
  result.technicalValue.min += item.totalMin;
  result.technicalValue.max += item.totalMax;
  return item;
}

function addQuoteItem(result, id, label, reason, mandatory = false) {
  result.items.push({
    id,
    label,
    quantity: 1,
    unit: "sur_devis",
    unitPriceMin: null,
    unitPriceMax: null,
    totalMin: null,
    totalMax: null,
    pricingMode: "quote",
    mandatory,
    reason,
    costCategory: "technical_non_personnel"
  });
}

function addOption(result, tarifs, key, quantity, reason, mandatory = false) {
  const price = priceFrom(tarifs.options, key);
  addRangeItem(result, key, price.label, quantity, price.unit, price, reason, mandatory);
}

function rateFrom(price, fallback = 0) {
  if (Number.isFinite(Number(price.rate))) return Number(price.rate);
  if (Number.isFinite(Number(price.min)) && Number(price.min) === Number(price.max)) return Number(price.min);
  return fallback;
}

function resolveConfiguredPrice(priceConfig) {
  if (!priceConfig?.enabled && priceConfig?.enabled !== undefined) return null;
  if (priceConfig?.pricingMode === "fixed") {
    const amount = Number(priceConfig.amount);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return {
      ...priceConfig,
      min: amount,
      max: amount
    };
  }
  if (priceConfig?.pricingMode === "range") {
    const min = Number(priceConfig.min);
    const max = Number(priceConfig.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0 || min > max) return null;
    return {
      ...priceConfig,
      min,
      max
    };
  }
  return null;
}

function resolveAdministrativeFee(tarifs, choices = {}) {
  const fee = tarifs.options.externalAdministrativeFee;
  if (!fee?.enabled) return null;
  const contextId = contextFrom(tarifs, choices.context).id || fee.defaultContext || "";
  const scoped = fee.contexts?.[contextId] || fee.contexts?.[fee.defaultContext] || fee;
  if (scoped.enabled === false) return null;
  const resolved = resolveConfiguredPrice({
    ...fee,
    ...scoped,
    label: scoped.label || fee.label,
    publicLabel: scoped.publicLabel || fee.publicLabel || scoped.label || fee.label,
    unit: scoped.unit || fee.unit,
    enabled: scoped.enabled ?? fee.enabled
  });
  if (!resolved) return null;
  return {
    ...resolved,
    contextId,
    helpText: scoped.helpText || fee.helpText || ""
  };
}

function addPercentItem(result, id, label, base, rate, reason, mandatory = true, costCategory = "technical_non_personnel", costComponents = null) {
  if (base.min <= 0 && base.max <= 0) return;
  addDerivedItem(result, id, label, 1, "percent", base.min * rate, base.max * rate, reason, mandatory, costCategory, costComponents);
}

function rangeDelta(before, after) {
  return {
    min: Math.max(0, after.min - before.min),
    max: Math.max(0, after.max - before.max)
  };
}

function addChemometric(result, tarifs, key, quantity, reason, mandatory = true) {
  const price = priceFrom(tarifs.chemometrics, key);
  if (price.pricingMode === "quote") {
    addQuoteItem(result, key, price.label || price.labelForQuote || "Sur devis", reason, mandatory);
    return;
  }
  addRangeItem(result, key, price.label, quantity, price.unit, price, reason, mandatory);
}

function addCalibrationTransfer(result, tarifs, traits) {
  const rule = priceFrom(tarifs.chemometrics, "calibration_transfer");
  if (rule.pricingMode !== "base_plus_additional_trait") {
    addChemometric(result, tarifs, "calibration_transfer", traits, "Transfert par trait");
    return;
  }
  const baseAmount = Number(rule.baseAmount);
  if (!Number.isFinite(baseAmount) || baseAmount < 0) throw new RangeError("Base de transfert entre instruments invalide");
  addDerivedItem(
    result,
    "calibration_transfer",
    rule.label || "Transfert entre instruments",
    1,
    rule.unit || "transfer",
    baseAmount,
    baseAmount,
    `Base de transfert pour le premier trait déclaré`,
    true,
    rule.costCategory || "personnel",
    costComponentsFromSplit(rule, { min: baseAmount, max: baseAmount }, rule.costCategory || "personnel")
  );
  const extra = rule.additionalTrait || {};
  const extraTraits = Math.max(0, traits - 1);
  if (!extraTraits) return;
  const amount = Number(extra.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Tarif du trait supplémentaire en transfert invalide");
  addDerivedItem(
    result,
    "calibration_transfer_additional_trait",
    extra.label || "Trait supplémentaire en transfert",
    extraTraits,
    extra.unit || "trait",
    amount,
    amount,
    `Forfait ajouté pour ${extraTraits} trait(s) supplémentaire(s) au-delà du premier trait transféré`,
    true,
    rule.costCategory || "personnel",
    costComponentsFromSplit(extra.costSplit ? extra : rule, { min: amount * extraTraits, max: amount * extraTraits }, rule.costCategory || "personnel")
  );
}

function addInstrumentPrice(result, instrument, key, quantity, reason, mandatory = true) {
  const price = priceFrom(instrument.prices, key);
  addRangeItem(result, key, `${price.label} - ${instrument.label}`, quantity, price.unit, price, reason, mandatory);
}

function addScientificInterpretation(result, tarifs, choices) {
  const hours = Number(choices.scientificInterpretationHours ?? 0);
  if (hours > 0) {
    assertQuantity(hours, "Heures d'interprétation scientifique", { allowZero: false });
    addOption(result, tarifs, "scientific_interpretation_hourly", hours, "Option d'interprétation scientifique");
  }
}

const INSTRUMENT_TRANSFER_SCENARIOS = {
  validated_paired_transfer: {
    label: "Transfert complet avec validation",
    description: "Les mêmes échantillons ont été mesurés sur les deux spectromètres et des valeurs de référence permettent d'évaluer la justesse du transfert.",
    validationLevel: "complete",
    recommendedAction: "Transférer vers un autre spectromètre",
    pricingProfile: "validated_paired_transfer"
  },
  partially_validated_paired_transfer: {
    label: "Transfert avec validation partielle",
    description: "Les spectres appariés permettent d'étudier le transfert, mais seule une partie des données permettra d'évaluer la justesse des prédictions.",
    validationLevel: "partial",
    recommendedAction: "Transférer vers un autre spectromètre",
    pricingProfile: "partially_validated_paired_transfer"
  },
  unvalidated_spectral_standardization: {
    label: "Standardisation spectrale sans validation analytique",
    description: "Les spectres appariés permettent d'étudier une harmonisation instrumentale, mais l'absence de valeurs de référence ne permet pas de valider l'exactitude analytique du modèle transféré.",
    validationLevel: "spectral_only",
    recommendedAction: "Définir les valeurs de référence nécessaires avec le plateau",
    pricingProfile: "unvalidated_spectral_standardization"
  },
  local_model_adaptation: {
    label: "Adaptation locale",
    description: "Les données disponibles correspondent davantage à une adaptation ou une mise à jour locale du modèle qu'à un transfert spectral classique.",
    validationLevel: "local",
    recommendedAction: "Mettre à jour ou étendre le modèle",
    pricingProfile: "local_model_adaptation"
  },
  multi_instrument_recalibration: {
    label: "Recalibration multi-instruments",
    description: "Les jeux ne sont pas appariés, mais des spectres et des références sont disponibles sur les deux instruments. Une recalibration commune ou un modèle multi-instruments doit être étudié.",
    validationLevel: "multi_instrument",
    recommendedAction: "Mettre à jour ou étendre le modèle",
    pricingProfile: "multi_instrument_recalibration"
  },
  compatibility_diagnostic: {
    label: "Diagnostic de compatibilité",
    description: "Les données permettent uniquement un diagnostic exploratoire de compatibilité. Une validation quantitative du modèle n'est pas possible à ce stade.",
    validationLevel: "diagnostic_only",
    recommendedAction: "Définir les références nécessaires avec le plateau",
    pricingProfile: "compatibility_diagnostic"
  },
  transfer_plan_required: {
    label: "Plan de transfert à construire",
    description: "Les données actuelles ne permettent pas encore d'engager un transfert validé. Le plateau devra définir les échantillons, mesures et références nécessaires.",
    validationLevel: "planning",
    recommendedAction: "Construire le plan de transfert avec le plateau",
    pricingProfile: "transfer_plan_required"
  },
  incomplete_transfer_information: {
    label: "Informations de transfert incomplètes",
    description: "Les informations disponibles sont insuffisantes ou incohérentes pour qualifier la situation de transfert.",
    validationLevel: "incomplete",
    recommendedAction: "Compléter ou corriger les champs du questionnaire",
    pricingProfile: "incomplete_transfer_information"
  }
};

function transferScenario(scenarioId, missingFields = []) {
  return {
    scenarioId,
    ...INSTRUMENT_TRANSFER_SCENARIOS[scenarioId],
    missingFields
  };
}

// Compatibilite historique: cet ancien classificateur n'est plus utilise par le flux public.
function classifyInstrumentTransfer(answers = {}) {
  const missing = [];
  const paired = answers.pairedSpectraStatus || "";
  const references = answers.referenceDataAvailability || "";
  const validation = answers.independentTargetValidation || "";
  if (!answers.sourceInstrument) missing.push("sourceInstrument");
  if (!answers.targetInstrument) missing.push("targetInstrument");
  if (answers.sourceInstrument && answers.targetInstrument && answers.sourceInstrument === answers.targetInstrument) missing.push("targetInstrument");
  if (!String(answers.propertyName || "").trim()) missing.push("propertyName");
  if (!paired) missing.push("pairedSpectraStatus");
  if (!references) missing.push("referenceDataAvailability");
  if (!validation) missing.push("independentTargetValidation");
  if (["all", "partial"].includes(paired) && !(Number(answers.pairedSampleCount) > 0)) missing.push("pairedSampleCount");
  if (missing.length) return transferScenario("incomplete_transfer_information", missing);

  if (paired === "to_acquire") return transferScenario("transfer_plan_required");
  if (["all", "partial"].includes(paired) && references === "all_paired") return transferScenario("validated_paired_transfer");
  if (["all", "partial"].includes(paired) && references === "partial_paired") return transferScenario("partially_validated_paired_transfer");
  if (["all", "partial"].includes(paired) && references === "none") return transferScenario("unvalidated_spectral_standardization");
  if (paired === "none" && references === "source_and_target_separate_sets") return transferScenario("multi_instrument_recalibration");
  if (paired === "none" && references === "target_separate_set") return transferScenario("local_model_adaptation");
  if (paired === "none" && references === "none") return transferScenario("compatibility_diagnostic");
  return transferScenario("incomplete_transfer_information", ["referenceDataAvailability"]);
}

function participantName(person) {
  return [person.firstName, person.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function trainingStatusFor(person, instrumentId) {
  const scoped = person.trainingStatusByInstrument?.[instrumentId] || person.trainedInstruments?.[instrumentId];
  if (typeof scoped === "string") return scoped;
  return scoped?.status || person.trainingStatus || "";
}

function trainingDateFor(person, instrumentId) {
  const scoped = person.trainingStatusByInstrument?.[instrumentId] || person.trainedInstruments?.[instrumentId];
  return typeof scoped === "object" ? (scoped.date || scoped.trainingDate || "") : (person.trainingDate || "");
}

function addAdministrativeFee(result, tarifs, choices = {}) {
  const fee = resolveAdministrativeFee(tarifs, choices);
  if (!fee) return;
  addRangeItem(
    result,
    "global_external_administrative_fee",
    fee.publicLabel || fee.label,
    1,
    fee.unit || "quote",
    fee,
    "Frais obligatoires ajoutés une seule fois au pré-devis, sans majoration ni coefficient",
    true
  );
  const line = result.items[result.items.length - 1];
  result.technicalValue.min -= Number(line.totalMin || 0);
  result.technicalValue.max -= Number(line.totalMax || 0);
  line.provisional = fee.provisional === true;
  line.requiresValidation = fee.requiresValidation === true;
  line.contextId = fee.contextId || "";
  line.helpText = fee.helpText || "";
  line.configRule = "externalAdministrativeFee";
  line.costCategory = fee.costCategory || "administrative";
  line.preQuoteAdjustmentEligible = false;
  line.technicalReferenceUnitPrice = 0;
  line.technicalReferenceTotal = 0;
  ensureLineAccounting(line, line.costCategory);
  result.billedEstimate.min += line.totalMin;
  result.billedEstimate.max += line.totalMax;
  result.pricingAudit = result.pricingAudit || emptyPricingAudit();
  result.pricingAudit.administrativeFee = addRange(result.pricingAudit.administrativeFee, {
    min: line.totalMin,
    max: line.totalMax
  });
  if (result.partnershipBreakdown) {
    result.partnershipBreakdown.administrativeFee = { min: line.totalMin, max: line.totalMax };
    result.partnershipBreakdown.billedEstimate = { ...result.billedEstimate };
  }
}

function addCommonOptions(result, tarifs, choices = {}) {
  addAdministrativeFee(result, tarifs, choices);
}

function resolveReservationPrice(result, tarifs, instrument, serviceMode) {
  try {
    return resolveInstrumentHalfDayPrice(instrument, serviceMode, tarifs.instrumentCostModelSettings || {});
  } catch (error) {
    result.warnings.push(`Modèle de coût invalide pour ${instrument.label}: ${error.message}.`);
    throw error;
  }
}

function addReservationLine(result, id, label, halfDays, priceInfo, reason) {
  const item = addDerivedItem(
    result,
    id,
    label,
    halfDays,
    "half_day",
    priceInfo.min,
    priceInfo.max,
    reason,
    true
  );
  item.pricingSource = priceInfo.source;
  item.costBasis = priceInfo.costBasis;
  item.costDetail = priceInfo.detail;
  if (priceInfo.detail?.machineHalfDayCost !== undefined) {
    item.machineHalfDayCost = priceInfo.detail.machineHalfDayCost;
    item.technicalHalfDayCost = priceInfo.detail.technicalHalfDayCost;
    item.costCategory = "mixed";
    const components = [
      {
        category: "equipment",
        label: "Base machine",
        min: Number(priceInfo.detail.machineHalfDayCost || 0) * halfDays,
        max: Number(priceInfo.detail.machineHalfDayCost || 0) * halfDays
      },
      {
        category: "consumables",
        label: "Consommables courants",
        min: Number(priceInfo.detail.routineConsumablesPerHalfDay || 0) * halfDays,
        max: Number(priceInfo.detail.routineConsumablesPerHalfDay || 0) * halfDays
      }
    ];
    if (Number(priceInfo.detail.autonomousTechnicalSupportAmount || 0) > 0) {
      components.push({
        category: "instrument_staff",
        label: "Assistance technique autonome",
        min: Number(priceInfo.detail.autonomousTechnicalSupportAmount || 0) * halfDays,
        max: Number(priceInfo.detail.autonomousTechnicalSupportAmount || 0) * halfDays
      });
    }
    if (Number(priceInfo.detail.staffCost || 0) > 0) {
      components.push({
        category: "instrument_staff",
        label: "Personnel plateau",
        min: Number(priceInfo.detail.staffCost || 0) * halfDays,
        max: Number(priceInfo.detail.staffCost || 0) * halfDays
      });
    }
    item.costComponents = reconcileCostComponents(components, lineTechnicalRange(item));
  }
  return item;
}

function calculateSpectraAcquisition(result, tarifs, choices, settings = {}) {
  const instrument = instrumentFrom(tarifs, choices.instrument);
  const mode = canonicalServiceMode(choices.serviceMode || "autonomous_supported");
  const instrumentBefore = { ...result.technicalValue };
  result.estimatedSpectralCapacity = spectralCapacityFor(tarifs, choices);

  if (mode === "autonomous_supported") {
    const halfDays = assertQuantity(choices.halfDays || 1, "Nombre de demi-journées réservées", { integer: true });
    const priceInfo = resolveReservationPrice(result, tarifs, instrument, "autonomous_supported");
    addReservationLine(
      result,
      "autonomous_supported_half_day",
      `Utilisation autonome avec assistance technique du plateau - ${instrument.label}`,
      halfDays,
      priceInfo,
      priceInfo.source === "manual"
        ? "Tarif manuel instrument prioritaire"
        : "Coût technique issu du modèle de coût instrument"
    );
    result.assumptions.push("L'utilisateur réalise lui-même les mesures après formation valide, avec assistance technique du plateau.");
  } else if (mode === "plateau_operated") {
    const halfDays = assertQuantity(choices.halfDays || 1, "Nombre de demi-journées réservées", { integer: true });
    const priceInfo = resolveReservationPrice(result, tarifs, instrument, "plateau_operated");
    addReservationLine(
      result,
      "plateau_operated_half_day",
      `Réalisation des mesures par le plateau - ${instrument.label}`,
      halfDays,
      priceInfo,
      priceInfo.source === "manual"
        ? "Tarif manuel instrument prioritaire"
        : "Coût technique issu du modèle de coût instrument"
    );
  } else {
    addQuoteItem(
      result,
      "spectra_full_service_legacy",
      `Mesures réalisées par le plateau - ${instrument.label}`,
      "Mode de saisie inconnu : reconfigurer la demande."
    );
    result.warnings.push("Mode de réalisation non reconnu.");
  }

  calculateInstrumentTransport(result, tarifs, instrument, choices);
  rangeDelta(instrumentBefore, result.technicalValue);
}

function calculateInstrumentTransport(result, tarifs, instrument, choices) {
  if (choices.measurementLocation !== "transport_required") return;
  if (instrument.transportPolicy === "included_portable") {
    result.assumptions.push("Instrument portable — aucun supplément de transport.");
    return;
  }
  if (instrument.transportPolicy === "forbidden") {
    result.warnings.push(`${instrument.label}: mesures réalisées uniquement au laboratoire Bioch&SPIR.`);
    return;
  }
  if (instrument.transportPolicy !== "fixed_fee") return;
  const rule = tarifs.options?.instrument_transport || {};
  const amount = finiteNumber(instrument.transportFee ?? rule.amount, "Forfait de transport instrument", { positive: true });
  const line = addDerivedItem(
    result,
    "instrument_transport",
    rule.label || "Transport du spectromètre",
    1,
    rule.unit || "transport_occurrence",
    amount,
    amount,
    `Transport du spectromètre — ${instrument.label}`,
    true,
    rule.costCategory || "logistics",
    [{ category: rule.costCategory || "logistics", label: rule.label || "Transport du spectromètre", min: amount, max: amount }]
  );
  line.configRule = "instrumentTransport";
  line.applyContextCoefficient = false;
  line.preQuoteAdjustmentEligible = false;
  line.discussionRangePolicy = rule.discussionRangePolicy || { mode: "none" };
  line.partnershipTreatment = rule.partnershipTreatment || "full_price";
  line.transportOccurrences = 1;
  line.transportUnitPrice = amount;
}

function calculateInitialTraining(result, tarifs, choices) {
  const instrument = instrumentFrom(tarifs, choices.instrument);
  const people = assertQuantity(choices.people || choices.participants || 1, "Nombre de personnes", { integer: true });
  const trainingType = choices.trainingType === "refresher" ? "refresher" : "initial";
  addInstrumentPrice(result, instrument, trainingType === "refresher" ? "refresher_training" : "initial_training", people, trainingType === "refresher" ? "Remise à niveau nominative" : "Formation initiale nominative");
  result.items[result.items.length - 1].configRule = "instrumentTraining";
  result.items[result.items.length - 1].trainingType = trainingType;
  result.assumptions.push("L'habilitation est nominative et propre à chaque instrument.");
}

function calculateTheoreticalNirsTraining(result, tarifs, choices) {
  const rule = tarifs.trainingPricing?.theoreticalNirs || {};
  const participants = assertQuantity(choices.participants || 1, "Nombre de participants", { integer: true });
  const maxPeople = assertQuantity(rule.maxPeoplePerSession, "Capacité de session", { integer: true });
  const sessions = Math.ceil(participants / maxPeople);
  const amount = finiteNumber(rule.amountPerSession, "Tarif de formation théorique NIRS", { positive: true });
  const line = addDerivedItem(
    result,
    "theoretical_nirs_training",
    rule.label || "Formation théorique NIRS",
    sessions,
    "session",
    amount,
    amount,
    `${participants} participant(s), ${sessions} session(s) d'une demi-journée`,
    true,
    rule.costCategory || "training"
  );
  line.configRule = "theoreticalNirsTraining";
  line.participants = participants;
  line.sessions = sessions;
  line.maxPeoplePerSession = maxPeople;
  line.durationHours = finiteNumber(rule.durationHours, "Durée de formation théorique NIRS", { positive: true });
  line.discussionRangePolicy = rule.discussionRangePolicy || { mode: "none" };
  result.assumptions.push("La formation théorique NIRS ne crée pas d'habilitation instrumentale.");
}

function addChemometricDataPreparation(result, tarifs, choices) {
  if (!asBool(choices.dataPreparationRequired)) {
    result.warnings.push("Vous indiquez que les données sont directement exploitables. Si la jointure automatique entre les spectres et les valeurs de référence n'est pas possible, la réalisation des analyses pourra être retardée et un travail complémentaire pourra être proposé.");
    return;
  }
  const samples = assertQuantity(choices.samples || 1, "Nombre d'échantillons", { integer: true });
  const replicates = assertQuantity(choices.replicates || 1, "Répétitions spectrales", { integer: true });
  addChemometricDataPreparationForScans(result, tarifs, samples * replicates);
}

function addChemometricDataPreparationForScans(result, tarifs, scans) {
  const rule = priceFrom(tarifs.options, "chemometric_data_preparation");
  const scanCount = assertQuantity(scans, "Nombre de scans à préparer", { integer: true });
  const amount = estimateScanScaleAmount(rule, scanCount);
  if (amount?.pricingMode === "quote") {
    addQuoteItem(result, "chemometric_data_preparation", amount.labelForQuote || rule.label || "Préparation et nettoyage des données", `Préparation et nettoyage de ${scanCount} scans à discuter avec le plateau`, true);
    return;
  }
  addDerivedItem(
    result,
    "chemometric_data_preparation",
    rule.label,
    1,
    rule.unit || "scan_batch",
    amount,
    amount,
    `Préparation et nettoyage de ${scanCount} scans. Montant indicatif à valider et discuter avec le plateau`,
    true,
    rule.costCategory || "personnel"
  );
  const line = result.items[result.items.length - 1];
  line.discussionRangePolicy = rule.discussionRangePolicy || null;
  line.scans = scanCount;
  line.provisional = rule.provisional === true;
  line.requiresValidation = rule.requiresValidation === true;
}

function estimateScanScaleAmount(rule, scans) {
  const bracket = findThresholdBracket(rule.thresholds, scans);
  if (!bracket) throw new RangeError("Tranche de préparation des données introuvable");
  if (bracket.pricingMode === "quote") return bracket;
  const amount = Number(bracket.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Montant de préparation des données invalide");
  return amount;
}

function findThresholdBracket(thresholds = [], value) {
  const numeric = Number(value);
  return thresholds.find((entry) => {
    const min = entry.min === undefined ? -Infinity : Number(entry.min);
    const max = entry.max === undefined ? Infinity : Number(entry.max);
    return numeric >= min && numeric <= max;
  }) || null;
}

function addValidatedCalibrationBase(result, tarifs, samples, scans) {
  const rule = priceFrom(tarifs.chemometrics, "validated_calibration");
  if (rule.pricingMode !== "sample_threshold") {
    addChemometric(result, tarifs, "validated_calibration", 1, `Base de calibration pour ${samples} échantillons indépendants`);
    return;
  }
  const bracket = findThresholdBracket(rule.thresholds, samples);
  if (!bracket) throw new RangeError("Tranche de calibration introuvable");
  if (bracket.pricingMode === "quote") {
    addQuoteItem(result, "validated_calibration", bracket.labelForQuote || "Calibration sur devis", `Calibration pour ${samples} échantillons indépendants`, true);
    return;
  }
  const amount = Number(bracket.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Montant de calibration invalide");
  const line = addDerivedItem(
    result,
    "validated_calibration",
    rule.label,
    1,
    rule.unit || "database",
    amount,
    amount,
    `Base de calibration pour ${samples} échantillon(s) indépendant(s) et ${scans} spectres totaux`,
    true,
    rule.costCategory || "personnel",
    costComponentsFromSplit(rule, { min: amount, max: amount }, rule.costCategory || "personnel")
  );
  line.discussionRangePolicy = rule.discussionRangePolicy || null;
  line.samples = samples;
  line.scans = scans;
  line.thresholdBracket = { min: bracket.min ?? null, max: bracket.max ?? null };
  line.pricingSource = rule.pricingMode;
}

function calculateValidatedCalibration(result, tarifs, choices) {
  const properties = assertQuantity(choices.properties, "Nombre de propriétés", { integer: true });
  const samples = assertQuantity(choices.samples, "Nombre d'échantillons", { integer: true });
  const replicates = assertQuantity(choices.replicates ?? 1, "Répétitions spectrales", { integer: true });
  const scans = samples * replicates;
  addValidatedCalibrationBase(result, tarifs, samples, scans);
  addCalibrationAdditionalTraits(result, tarifs, properties);
  if (Number(choices.matrices) > 1) {
    result.warnings.push("Une calibration sur plusieurs matrices, familles ou spectromètres nécessite une demande spécifique ; l'estimation n'est pas multipliée par le nombre de matrices.");
  }
  result.assumptions.push("La calibration estimée concerne une même matrice et une même base de données. L'étude préalable, l'analyse exploratoire, le contrôle de cohérence courant et le rapport de résultats standard sont inclus dans le processus de calibration.");
  addChemometricDataPreparation(result, tarifs, choices);
  const referenceDisclaimer = (tarifs.disclaimers || []).find((entry) => /^Analyses de référence\b/i.test(String(entry || "")));
  if (referenceDisclaimer) result.exclusions.push(referenceDisclaimer);
  if (Object.prototype.hasOwnProperty.call(choices, "referenceAnalysesExist") && !asBool(choices.referenceAnalysesExist)) {
    result.warnings.push("Les analyses de référence devront être obtenues avant une calibration validée.");
  }
}

function addCalibrationAdditionalTraits(result, tarifs, properties) {
  const rule = tarifs.chemometrics?.validated_calibration?.additionalTrait;
  const quantity = Math.max(0, properties - 1);
  if (!rule || quantity <= 0) return;
  const amount = Number(rule.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Tarif du trait supplémentaire invalide");
  const line = addDerivedItem(
    result,
    "validated_calibration_additional_trait",
    rule.label || "Trait supplémentaire en calibration",
    quantity,
    rule.unit || "trait",
    amount,
    amount,
    `Forfait ajouté pour ${quantity} trait(s) supplémentaire(s) au-delà du premier trait déclaré`,
    true,
    tarifs.chemometrics?.validated_calibration?.costCategory || "personnel",
    costComponentsFromSplit(rule.costSplit ? rule : tarifs.chemometrics?.validated_calibration, { min: amount * quantity, max: amount * quantity }, tarifs.chemometrics?.validated_calibration?.costCategory || "personnel")
  );
  line.discussionRangePolicy = tarifs.chemometrics?.validated_calibration?.discussionRangePolicy || null;
}

function calculateLocalValidation(result, tarifs, choices) {
  const models = assertQuantity(choices.models, "Nombre de modèles", { integer: true });
  const instruments = assertQuantity(choices.instrumentsCount, "Nombre d'instruments", { integer: true });
  assertQuantity(choices.validationSamples, "Échantillons de validation", { integer: true });
  addChemometric(result, tarifs, "local_model_validation", models * instruments, "Validation par modèle et instrument");
  if (!asBool(choices.referenceResultsAvailable)) result.exclusions.push("Résultats de référence non inclus.");
  if (asBool(choices.biasCorrectionPossible)) {
    addChemometric(result, tarifs, "bias_correction", models * instruments, "Correction de biais potentiellement nécessaire", false);
  }
}

function calculateBiasCorrection(result, tarifs, choices) {
  const models = assertQuantity(choices.models, "Nombre de modèles", { integer: true });
  const instruments = assertQuantity(choices.instrumentsCount, "Nombre d'instruments", { integer: true });
  assertQuantity(choices.controlSamples, "Échantillons de contrôle", { integer: true });
  addChemometric(result, tarifs, "bias_correction", models * instruments, "Correction ou ajustement par modèle et instrument");
  result.assumptions.push("L'intervention est limitée à un décalage systématique et ne remplace pas une recalibration complète.");
}

function calculateTransfer(result, tarifs, choices) {
  const traits = assertQuantity(choices.transferTraits ?? choices.properties ?? choices.models, "Nombre de traits à transférer", { integer: true });
  assertQuantity(choices.transferSamples, "Échantillons de transfert", { integer: true });
  addCalibrationTransfer(result, tarifs, traits);
  if (choices.instrumentSimilarity === "different_technology") {
    addOption(result, tarifs, "scientific_interpretation_hourly", Number(tarifs.calculation.defaultScientificInterpretationHours), "Analyse complémentaire pour technologies différentes");
  }
}

function calculatePredictions(result, tarifs, choices) {
  const spectra = assertQuantity(choices.spectra, "Nombre de spectres", { integer: true });
  const models = assertQuantity(choices.models, "Nombre de modèles", { integer: true });
  const instrument = instrumentFrom(tarifs, choices.instrument);
  const rule = priceFrom(tarifs.chemometrics, "existing_model_predictions");
  const maxSpectra = Number(rule.maxSpectra || Infinity);
  if (spectra > maxSpectra) {
    addQuoteItem(result, "existing_model_predictions", `Prédiction sur ${spectra} spectres`, `Volume supérieur au seuil automatique de ${maxSpectra} spectres`, true);
    addPredictionReferenceAnalyses(result, tarifs, choices);
    return;
  }
  if (!asBool(choices.spectraAlreadyAcquired)) {
    addQuoteItem(
      result,
      "prediction_spectra_acquisition_required",
      `Acquisition des spectres - ${instrument.label}`,
      "Les spectres ne sont pas déclarés comme déjà acquis : ajouter une prestation de prise de spectres ou discuter le périmètre avec le plateau."
    );
  }
  const setup = Number(rule.setupAmount || 0);
  const perSpectrum = Number(rule.perSpectrumAmount || 0);
  const additional = Number(rule.additionalModelPerSpectrumAmount || 0);
  const minimum = Number(rule.minimumAmount || 0);
  const amount = Math.max(minimum, setup + perSpectrum * spectra + additional * spectra * Math.max(0, models - 1));
  const line = addDerivedItem(
    result,
    "existing_model_predictions",
    rule.label || "Prédiction avec modèle existant",
    1,
    rule.unit || "batch",
    amount,
    amount,
    `${spectra} spectres et ${models} modèle(s) ou propriété(s)`,
    true,
    rule.costCategory || "scientific_expertise",
    costComponentsFromSplit(rule, { min: amount, max: amount }, rule.costCategory || "scientific_expertise")
  );
  line.discussionRangePolicy = rule.discussionRangePolicy || null;
  line.spectra = spectra;
  line.models = models;
  if (asBool(choices.dataPreparationRequired) || asBool(choices.outlierCheck)) {
    addChemometricDataPreparationForScans(result, tarifs, spectra);
  }
  result.assumptions.push("Le rapport de résultats courant et le contrôle de cohérence standard sont inclus dans la prestation de prédiction.");
  addPredictionReferenceAnalyses(result, tarifs, choices);
}

function addPredictionReferenceAnalyses(result, tarifs, choices) {
  if (choices.predictionMode !== "with_reference") return;
  const policy = priceFrom(tarifs, "predictionReferenceAnalyses");
  if (typeof policy.applyUrgency !== "boolean" || typeof policy.applyContextCoefficient !== "boolean" || !policy.costCategory || !policy.discussionRangePolicy) throw new Error("Politique tarifaire des analyses de référence incomplète.");
  const minRate = finiteNumber(policy.samplingRate?.min, "Taux minimal d’analyses de référence", { positive: true });
  const maxRate = finiteNumber(policy.samplingRate?.max, "Taux maximal d’analyses de référence", { positive: true });
  if (maxRate < minRate || maxRate > 1 || policy.quantityRounding !== "ceil") throw new Error("Politique d’échantillonnage des analyses de référence invalide.");
  const samples = assertQuantity(choices.samples, "Échantillons indépendants", { integer: true });
  const maxSamples = assertQuantity(policy.maxReferenceSamples, "Plafond d’échantillons de référence", { integer: true });
  const quantities = {
    min: Math.min(maxSamples, Math.ceil(samples * minRate - Number.EPSILON * samples)),
    max: Math.min(maxSamples, Math.ceil(samples * maxRate - Number.EPSILON * samples))
  };
  const properties = [...new Set(Array.isArray(choices.referenceProperties) ? choices.referenceProperties : [])];
  if (!properties.length) throw new Error("Sélectionnez les propriétés à vérifier par chimie humide.");
  const contextId = contextFrom(tarifs, choices.context).id;
  for (const property of properties) {
    const rule = priceFrom(policy.analyses, property);
    const percent = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 2 });
    const quantityText = quantities.min === quantities.max ? `${quantities.min}` : `${quantities.min} à ${quantities.max}`;
    const rateText = minRate === maxRate ? percent.format(minRate) : `${percent.format(minRate)} à ${percent.format(maxRate)}`;
    const reason = `${quantityText} ${quantities.max === 1 ? "analyse" : "analyses"} pour ${samples} échantillons indépendants à prédire (${rateText}, arrondi supérieur, plafond de ${maxSamples} échantillons)`;
    if (rule.pricingMode === "quote") {
      addQuoteItem(result, `prediction_reference_${property}`, rule.label, reason, true);
      continue;
    }
    const amount = finiteNumber(rule.contextAmounts?.[contextId], `Tarif de référence ${property} / ${contextId || "contexte à choisir"}`, { positive: true });
    const unitPriceText = new Intl.NumberFormat("fr-FR", { style: "currency", currency: tarifs.metadata.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
    const line = addDerivedItem(result, `prediction_reference_${property}`, rule.label, quantities.min, rule.unit, amount, amount, `${reason} ; ${unitPriceText} par analyse`, true, policy.costCategory);
    const totalMax = quantities.max * amount;
    result.technicalValue.max += totalMax - line.totalMax;
    line.totalMax = totalMax;
    line.technicalTotalMax = totalMax;
    line.billedTotalMax = totalMax;
    line.costComponents = [{ category: policy.costCategory, label: rule.label, min: line.totalMin, max: totalMax }];
    line.quantityMax = quantities.max;
    line.technicalReferenceTotal = (line.totalMin + totalMax) / 2;
    line.configRule = "predictionReferenceAnalyses";
    line.applyUrgency = policy.applyUrgency;
    line.applyContextCoefficient = policy.applyContextCoefficient;
    line.discussionRangePolicy = policy.discussionRangePolicy;
    line.referenceAnalysis = { property, samples, maxReferenceSamples: maxSamples, samplingRate: { min: minRate, max: maxRate }, quantity: quantities, unitPrice: amount, contextId };
  }
}

function calculateMaintenance(result, tarifs, choices) {
  const maintenanceType = migratedMaintenanceType(choices.maintenanceType);
  choices.maintenanceType = maintenanceType;
  const rule = tarifs.maintenancePricing?.[maintenanceType];
  if (!rule) throw new Error(`Type d'entretien inconnu: ${maintenanceType}`);
  const amount = Number(rule.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`Montant de référence d'entretien invalide: ${maintenanceType}`);
  }
  const line = addDerivedItem(
    result,
    `maintenance_${maintenanceType}`,
    rule.label || maintenanceReason(choices),
    1,
    rule.unit || "forfait",
    amount,
    amount,
    "Tarifs indicatifs à confirmer avec le plateau.",
    true,
    rule.costCategory || "scientific_expertise",
    costComponentsFromSplit(rule, { min: amount, max: amount }, rule.costCategory || "scientific_expertise")
  );
  line.technicalReferenceUnitPrice = amount;
  line.technicalReferenceTotal = amount;
  line.pricingMode = rule.pricingMode || "range";
  line.discussionRangePolicy = rule.discussionRangePolicy || tarifs.discussionRangePolicies?.default || null;
  line.preQuoteAdjustmentEligible = line.discussionRangePolicy?.mode !== "none";
  line.pricingConfidence = rule.pricingConfidence || "low";
  line.requiresPlateauReview = rule.requiresPlateauReview === true;
  line.partnershipTreatment = rule.partnershipTreatment || "negotiated";
  line.maintenanceType = maintenanceType;
  line.maintenanceComment = String(choices.maintenanceComment || choices.comment || "").trim();
  line.discussionChecklist = maintenanceDiscussionChecklist(maintenanceType);
  result.pricingAudit = result.pricingAudit || emptyPricingAudit();
  result.pricingAudit.maintenance = result.pricingAudit.maintenance || [];
  result.pricingAudit.maintenance.push({
    parentItemId: "",
    type: maintenanceType,
    maintenanceType,
    label: line.label,
    technicalReferenceAmount: { min: amount, max: amount },
    technicalDiscussionRange: null,
    contextId: "",
    contextCoefficient: null,
    partnershipTreatment: line.partnershipTreatment,
    billedRange: null,
    comment: line.maintenanceComment,
    discussionChecklist: line.discussionChecklist,
    pricingConfidence: line.pricingConfidence,
    requiresPlateauReview: line.requiresPlateauReview
  });
  if (!line.maintenanceComment) result.assumptions.push("Informations à préciser avec le plateau.");
  result.assumptions.push("Tarifs indicatifs à confirmer avec le plateau.");
}

function maintenanceDiscussionChecklist(type) {
  return {
    performance_audit: [
      "nom ou description du modele",
      "instrument utilise",
      "propriete ou caractere predit",
      "periode, campagne ou site concerne",
      "volume approximatif de spectres ou d echantillons",
      "valeurs de reference eventuellement disponibles",
      "anomalie, derive ou baisse de performance observee",
      "resultat attendu de l audit"
    ],
    contextual_validation: [
      "modele et propriete concernes",
      "contexte dans lequel le modele a ete developpe",
      "nouveau site, campagne, variete, population ou matrice",
      "instrument utilise",
      "nombre approximatif d echantillons",
      "presence de valeurs obtenues par une methode de reference",
      "principales differences avec les donnees d origine",
      "utilisation prevue du modele apres validation"
    ],
    bias_correction: [
      "modele, propriete et instrument concernes",
      "periode ou lot sur lequel le decalage est observe",
      "sens et importance approximative du decalage",
      "nombre de predictions disponibles",
      "nombre de valeurs de reference correspondantes",
      "changement recent d instrument, de matrice ou de protocole",
      "exemples de resultats consideres comme anormaux"
    ],
    model_update: [
      "modele et proprietes concernes",
      "raison de la mise a jour",
      "nombre approximatif de nouvelles donnees",
      "valeurs de reference disponibles",
      "matrice et instrument utilises",
      "nouvelle campagne, origine ou plage de valeurs",
      "changements intervenus depuis la calibration initiale",
      "objectif attendu apres mise a jour"
    ],
    instrument_transfer: [
      "spectrometre source",
      "spectrometre cible",
      "modele et proprietes concernes",
      "existence des memes echantillons mesures sur les deux appareils",
      "nombre approximatif d echantillons mesures sur les deux appareils",
      "valeurs de reference disponibles et volume correspondant",
      "plages spectrales, accessoires et conditions de mesure",
      "donnees deja acquises ou mesures restant a realiser",
      "niveau de validation souhaite"
    ]
  }[type] || [];
}

function addBracketedChemometric(result, tarifs, key, quantityForBracket, extraQuantity, extraRuleKey, reason) {
  const rule = priceFrom(tarifs.chemometrics, key);
  const bracket = findThresholdBracket(rule.thresholds, quantityForBracket);
  if (!bracket) throw new RangeError(`Tranche tarifaire introuvable pour ${rule.label}`);
  if (bracket.pricingMode === "quote") {
    addQuoteItem(result, key, bracket.labelForQuote || rule.label || "Sur devis", reason, true);
    return;
  }
  const amount = Number(bracket.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Montant invalide pour ${rule.label}`);
  const line = addDerivedItem(
    result,
    key,
    rule.label,
    1,
    rule.unit || "forfait",
    amount,
    amount,
    reason,
    true,
    rule.costCategory || "scientific_expertise",
    costComponentsFromSplit(rule, { min: amount, max: amount }, rule.costCategory || "scientific_expertise")
  );
  line.discussionRangePolicy = rule.discussionRangePolicy || null;
  line.thresholdQuantity = quantityForBracket;
  line.thresholdBracket = { min: bracket.min ?? null, max: bracket.max ?? null };
  addMaintenanceSupplement(result, rule, `${key}_supplement`, extraRuleKey, extraQuantity, reason);
}

function addMaintenanceSupplement(result, rule, id, ruleKey, quantity, reason) {
  if (!quantity) return;
  const supplement = rule?.[ruleKey];
  if (!supplement) return;
  const amount = Number(supplement.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Montant complémentaire invalide pour ${rule.label}`);
  const line = addDerivedItem(
    result,
    id,
    supplement.label || rule.label,
    quantity,
    supplement.unit || "forfait",
    amount,
    amount,
    reason,
    true,
    rule.costCategory || "scientific_expertise",
    costComponentsFromSplit(supplement.costSplit ? supplement : rule, { min: amount * quantity, max: amount * quantity }, rule.costCategory || "scientific_expertise")
  );
  line.discussionRangePolicy = rule.discussionRangePolicy || null;
}

function migratedMaintenanceType(type) {
  return {
    annual_audit: "performance_audit",
    audit_annual: "performance_audit",
    local_validation: "contextual_validation",
    new_samples: "model_update",
    add_samples: "model_update",
    light_update: "model_update",
    update: "model_update",
    transfer: "instrument_transfer",
    transfer_between_instruments: "instrument_transfer",
    calibration_transfer: "instrument_transfer"
  }[type] || type || "performance_audit";
}

function maintenanceReason(choices) {
  const type = choices.maintenanceType;
  if (type === "performance_audit") return "Audit des performances du modèle";
  if (type === "contextual_validation") return "Validation dans un nouveau contexte";
  if (type === "bias_correction") return "Correction ou ajustement d'un biais";
  if (type === "model_update") return "Mise à jour ou extension du modèle";
  return "Entretien par modèle";
}

function calculateInstrumentTransferMaintenance(result, tarifs, choices) {
  const classification = classifyInstrumentTransfer(choices);
  result.instrumentTransferClassification = classification;
  result.assumptions.push(`${classification.label} : ${classification.description}`);
  if (classification.validationLevel === "spectral_only") {
    result.warnings.push("L'absence de valeurs de référence ne permet pas de valider l'exactitude analytique du modèle transféré.");
  }
  const profile = tarifs.instrumentTransferPricingProfiles?.[classification.pricingProfile] || {};
  if (profile.pricingMode === "quote" || !profile.pricingMode) {
    addQuoteItem(
      result,
      `instrument_transfer_${classification.scenarioId}`,
      `${classification.label} - à définir avec le plateau`,
      classification.description,
      true
    );
    result.items[result.items.length - 1].transferClassification = classification;
    return;
  }
  const traits = assertQuantity(choices.transferTraits ?? choices.propertiesCount ?? 1, "Nombre de traits à transférer", { integer: true });
  const pairedSamples = Number(choices.pairedSampleCount || 0);
  if (profile.pairedSampleQuoteAbove && pairedSamples > Number(profile.pairedSampleQuoteAbove)) {
    addQuoteItem(result, `instrument_transfer_${classification.scenarioId}`, `${classification.label} - échantillons appariés nombreux`, `Plus de ${profile.pairedSampleQuoteAbove} échantillons appariés : chiffrage à confirmer avec le plateau.`, true);
    result.items[result.items.length - 1].transferClassification = classification;
    return;
  }
  const baseAmount = Number(profile.amount ?? profile.baseAmount);
  if (!Number.isFinite(baseAmount) || baseAmount < 0) throw new RangeError("Montant de transfert invalide");
  const rule = tarifs.chemometrics?.calibration_transfer || {};
  const baseLine = addDerivedItem(
    result,
    `instrument_transfer_${classification.scenarioId}`,
    classification.label,
    1,
    "transfer",
    baseAmount,
    baseAmount,
    classification.description,
    true,
    rule.costCategory || "scientific_expertise",
    costComponentsFromSplit(rule, { min: baseAmount, max: baseAmount }, rule.costCategory || "scientific_expertise")
  );
  baseLine.discussionRangePolicy = profile.discussionRangePolicy || rule.discussionRangePolicy || null;
  baseLine.transferClassification = classification;
  const extraTraits = Math.max(0, traits - 1);
  const extraAmount = Number(profile.additionalTraitAmount || 0);
  if (extraTraits > 0 && extraAmount > 0) {
    const extraLine = addDerivedItem(
      result,
      `instrument_transfer_${classification.scenarioId}_additional_trait`,
      "Propriété supplémentaire en transfert",
      extraTraits,
      "trait",
      extraAmount,
      extraAmount,
      "Supplément par propriété au-delà de la première",
      true,
      rule.costCategory || "scientific_expertise",
      costComponentsFromSplit(rule, { min: extraAmount * extraTraits, max: extraAmount * extraTraits }, rule.costCategory || "scientific_expertise")
    );
    extraLine.discussionRangePolicy = profile.discussionRangePolicy || rule.discussionRangePolicy || null;
    extraLine.transferClassification = classification;
  }
  const surcharge = profile.pairedSampleSurcharge || {};
  if (pairedSamples >= Number(surcharge.min || Infinity) && pairedSamples <= Number(surcharge.max || -Infinity)) {
    const surchargeAmount = Number(surcharge.amount || 0);
    const surchargeLine = addDerivedItem(
      result,
      `instrument_transfer_${classification.scenarioId}_paired_sample_surcharge`,
      "Volume d'échantillons appariés",
      1,
      "forfait",
      surchargeAmount,
      surchargeAmount,
      `${pairedSamples} échantillons appariés`,
      true,
      rule.costCategory || "scientific_expertise",
      costComponentsFromSplit(rule, { min: surchargeAmount, max: surchargeAmount }, rule.costCategory || "scientific_expertise")
    );
    surchargeLine.discussionRangePolicy = profile.discussionRangePolicy || rule.discussionRangePolicy || null;
    surchargeLine.transferClassification = classification;
  }
}

function calculateInstrumentQualification(result, tarifs, choices) {
  const instruments = assertQuantity(choices.instrumentsCount, "Nombre d'instruments", { integer: true });
  addChemometric(result, tarifs, "instrument_qualification", instruments, "Prestation configurée en mode sur devis");
  result.assumptions.push("L'étalonnage ou la qualification concerne le fonctionnement de l'instrument.");
  result.assumptions.push("La calibration chimiométrique concerne la relation entre les spectres et une propriété de référence.");
  if (asBool(choices.formalReport)) addOption(result, tarifs, "formal_report", 1, "Certificat ou rapport formalisé demandé");
  if (choices.interventionLocation === "field") {
    addQuoteItem(result, "travel_expenses", "Déplacement sur site", "Frais de déplacement à confirmer");
  }
}

function addUrgency(result, tarifs, choices) {
  if (!asBool(choices.urgent)) return;
  const urgent = priceFrom(tarifs.options, "urgent_markup");
  const context = contextFrom(tarifs, choices.context).context;
  let baseMin = urgencyBaseFromLines(result).min;
  let baseMax = urgencyBaseFromLines(result).max;
  let components = null;
  let costCategory = urgent.costCategory || "technical_non_personnel";
  if (context?.mode === "negotiated_partnership") {
    const negotiated = new Set(context.billingPolicy?.negotiatedCategories || ["equipment", "consumables", "technical_non_personnel"]);
    const totals = costCategoryTotals(result, isUrgencyEligible);
    components = [...negotiated]
      .map((category) => totals[category] ? ({
        category,
        label: `Majoration d'urgence - ${category}`,
        min: totals[category].min * finiteNumber(rateFrom(urgent, Number.NaN), "Taux de majoration urgence"),
        max: totals[category].max * finiteNumber(rateFrom(urgent, Number.NaN), "Taux de majoration urgence")
      }) : null)
      .filter(Boolean);
    const base = components.reduce((sum, component) => addRange(sum, component), { min: 0, max: 0 });
    baseMin = base.min;
    baseMax = base.max;
    costCategory = "technical_non_personnel";
  }
  if (baseMin <= 0 && baseMax <= 0) return;
  addPercentItem(
    result,
    "urgent_markup",
    urgent.label,
    { min: baseMin, max: baseMax },
    context?.mode === "negotiated_partnership" ? 1 : finiteNumber(rateFrom(urgent, Number.NaN), "Taux de majoration urgence"),
    "Majoration d'urgence appliquée une seule fois aux prestations techniques chiffrables",
    true,
    costCategory,
    components
  );
}

function applyBillingMinimum(result, tarifs) {
  if (result.context?.billingPolicy?.billingMinimumApplies === false) return;
  const minimum = priceFrom(tarifs.options, "billing_minimum");
  if (result.billedEstimate.min === 0 && result.billedEstimate.max === 0) return;
  const addMin = Math.max(0, Number(minimum.min) - result.billedEstimate.min);
  const addMax = Math.max(0, Number(minimum.max) - result.billedEstimate.max);
  if (addMin > 0 || addMax > 0) {
    const item = {
      id: "billing_minimum_adjustment",
      label: minimum.label,
      quantity: 1,
      unit: minimum.unit,
      unitPriceMin: addMin,
      unitPriceMax: addMax,
      totalMin: addMin,
      totalMax: addMax,
      pricingMode: "range",
      mandatory: true,
      configRule: "billingMinimumAdjustment",
      costCategory: minimum.costCategory || "administrative",
      preQuoteAdjustmentEligible: false,
      reason: "Minimum configurable appliqué uniquement lorsque le montant facturé est inférieur"
    };
    item.technicalReferenceUnitPrice = 0;
    item.technicalReferenceTotal = 0;
    result.items.push(item);
    result.billedEstimate.min += addMin;
    result.billedEstimate.max += addMax;
    result.pricingAudit = result.pricingAudit || emptyPricingAudit();
    result.pricingAudit.billingMinimumAdjustment = addRange(result.pricingAudit.billingMinimumAdjustment, {
      min: addMin,
      max: addMax
    });
  }
}

function applyContext(result, tarifs, choices) {
  const resolved = contextFrom(tarifs, choices.context);
  const contextId = resolved.id;
  const context = resolved.context;
  if (!context) {
    result.context = null;
    result.billedEstimate = { ...result.technicalValue };
    result.pricingAudit = result.pricingAudit || emptyPricingAudit();
    result.pricingAudit.contextId = "";
    result.pricingAudit.contextMode = "";
    result.pricingAudit.contextCoefficient = null;
    return;
  }
  result.context = {
    id: contextId,
    label: context.label,
    description: context.description,
    display: context.display || null,
    mode: context.mode || "direct",
    billedShare: context.billedShare || null,
    requiresDiscussion: context.requiresDiscussion === true,
    billingPolicy: context.billingPolicy || {}
  };

  if (context.mode === "negotiated_partnership") {
    applyNegotiatedPartnershipContext(result, context, tarifs);
    result.pricingAudit = result.pricingAudit || emptyPricingAudit();
    result.pricingAudit.contextId = contextId;
    result.pricingAudit.contextMode = context.mode;
    result.pricingAudit.contextCoefficient = null;
    result.pricingAudit.partnershipBreakdown = result.partnershipBreakdown || null;
    return;
  }

  const coefficient = context.costCoefficient || { min: 1, max: 1 };
  result.contextCoefficient = { min: Number(coefficient.min), max: Number(coefficient.max) };
  const beforeContext = cloneRange(result.technicalValue);
  result.pricingAudit = result.pricingAudit || emptyPricingAudit();
  result.pricingAudit.contextId = contextId;
  result.pricingAudit.contextMode = context.mode || "direct";
  result.pricingAudit.contextCoefficient = { ...result.contextCoefficient };
  if (context.mode === "markup") applyMarkupDisplayToItems(result, coefficient);
  else applyDirectDisplayToItems(result);
  result.billedEstimate = sumBilledLines(result);
  result.pricingAudit.subcontractingAdjustmentAmount = {
    min: result.billedEstimate.min - beforeContext.min,
    max: result.billedEstimate.max - beforeContext.max
  };
}

function urgencyBaseFromLines(result) {
  return (result.items || []).reduce((sum, line) => {
    if (!isUrgencyEligible(line)) return sum;
    return addRange(sum, lineTechnicalRange(line));
  }, { min: 0, max: 0 });
}

function isUrgencyEligible(line) {
  return line.pricingMode !== "quote" && line.applyUrgency !== false && line.configRule !== "instrumentTransport" && line.costCategory !== "logistics";
}

function lineContextEligible(line) {
  return line.applyContextCoefficient !== false
    && line.configRule !== "externalAdministrativeFee"
    && line.configRule !== "billingMinimumAdjustment"
    && line.configRule !== "instrumentTransport";
}

function sumBilledLines(result) {
  return (result.items || []).reduce((sum, line) => {
    if (line.pricingMode === "quote") return sum;
    return addRange(sum, {
      min: Number(line.billedTotalMin ?? line.displayTotalMin ?? line.totalMin ?? 0),
      max: Number(line.billedTotalMax ?? line.displayTotalMax ?? line.totalMax ?? 0)
    });
  }, { min: 0, max: 0 });
}

function applyDirectDisplayToItems(result) {
  result.items.forEach((item) => {
    if (item.pricingMode === "quote" || item.configRule === "externalAdministrativeFee") return;
    ensureLineAccounting(item, item.costCategory);
    item.billedTotalMin = item.technicalTotalMin;
    item.billedTotalMax = item.technicalTotalMax;
    item.displayTotalMin = item.technicalTotalMin;
    item.displayTotalMax = item.technicalTotalMax;
  });
  (result.itemResults || []).forEach((item) => {
    if (!item.technicalValue || item.status === "incomplete") return;
    const lines = (result.items || []).filter((line) => line.parentItemId === item.itemId);
    item.billedEstimate = lines.length ? lines.reduce((sum, line) => addRange(sum, {
      min: Number(line.billedTotalMin ?? line.displayTotalMin ?? line.totalMin ?? 0),
      max: Number(line.billedTotalMax ?? line.displayTotalMax ?? line.totalMax ?? 0)
    }), { min: 0, max: 0 }) : { ...item.technicalValue };
  });
}

function applyMarkupDisplayToItems(result, coefficient) {
  const minCoefficient = Number(coefficient.min);
  const maxCoefficient = Number(coefficient.max);
  if (!Number.isFinite(minCoefficient) || !Number.isFinite(maxCoefficient)) return;
  result.items.forEach((item) => {
    if (item.pricingMode === "quote" || item.configRule === "externalAdministrativeFee") return;
    ensureLineAccounting(item, item.costCategory);
    const applyCoefficient = lineContextEligible(item);
    const lineMinCoefficient = applyCoefficient ? minCoefficient : 1;
    const lineMaxCoefficient = applyCoefficient ? maxCoefficient : 1;
    item.displayUnitPriceMin = Number(item.unitPriceMin) * lineMinCoefficient;
    item.displayUnitPriceMax = Number(item.unitPriceMax) * lineMaxCoefficient;
    item.displayTotalMin = Number(item.totalMin) * lineMinCoefficient;
    item.displayTotalMax = Number(item.totalMax) * lineMaxCoefficient;
    item.billedTotalMin = item.displayTotalMin;
    item.billedTotalMax = item.displayTotalMax;
    item.contextApplied = applyCoefficient ? (result.context?.label || "Contexte") : "";
  });
  (result.itemResults || []).forEach((item) => {
    if (!item.technicalValue || item.status === "incomplete") return;
    const lines = (result.items || []).filter((line) => line.parentItemId === item.itemId);
    item.billedEstimate = lines.length ? lines.reduce((sum, line) => addRange(sum, {
      min: Number(line.billedTotalMin ?? line.displayTotalMin ?? line.totalMin ?? 0),
      max: Number(line.billedTotalMax ?? line.displayTotalMax ?? line.totalMax ?? 0)
    }), { min: 0, max: 0 }) : {
      min: Number(item.technicalValue.min) * minCoefficient,
      max: Number(item.technicalValue.max) * maxCoefficient
    };
  });
}

function costCategoryTotals(result, predicate = () => true) {
  const totals = {};
  for (const line of result.items || []) {
    if (line.pricingMode === "quote" || !predicate(line)) continue;
    ensureLineAccounting(line, line.costCategory);
    for (const component of line.costComponents || []) {
      const category = component.category || line.costCategory || "technical_non_personnel";
      totals[category] = addRange(totals[category], component);
    }
  }
  return totals;
}

function sumCategories(totals, categories = []) {
  return categories.reduce((sum, category) => addRange(sum, totals[category]), { min: 0, max: 0 });
}

function applyNegotiatedPartnershipContext(result, context, tarifs) {
  const policy = context.billingPolicy || {};
  const offered = new Set(policy.offeredCategories || ["personnel", "training"]);
  const negotiated = new Set(policy.negotiatedCategories || ["equipment", "consumables", "technical_non_personnel"]);
  const fullPrice = new Set(policy.fullPriceCategories || ["logistics", "pass_through"]);
  const share = priceFrom(context, "billedShare");
  const shareMin = finiteNumber(share.min, "Part facturée minimale en partenariat");
  const shareMax = finiteNumber(share.max, "Part facturée maximale en partenariat");
  if (shareMax < shareMin || shareMax > 1) throw new Error("Part facturée en partenariat invalide.");

  result.items.forEach((line) => {
    if (line.pricingMode === "quote" || line.configRule === "externalAdministrativeFee") return;
    ensureLineAccounting(line, line.costCategory);
    let billed = { min: 0, max: 0 };
    let offeredAmount = { min: 0, max: 0 };
    line.costComponents.forEach((component) => {
      const category = component.category || line.costCategory || "technical_non_personnel";
      if (offered.has(category)) {
        component.billedMin = 0;
        component.billedMax = 0;
        component.offeredByPlatform = true;
        offeredAmount = addRange(offeredAmount, component);
      } else if (negotiated.has(category)) {
        component.billedMin = Number(component.min || 0) * shareMin;
        component.billedMax = Number(component.max || 0) * shareMax;
      } else if (fullPrice.has(category)) {
        component.billedMin = Number(component.min || 0);
        component.billedMax = Number(component.max || 0);
      } else {
        component.billedMin = Number(component.min || 0);
        component.billedMax = Number(component.max || 0);
      }
      billed.min += Number(component.billedMin || 0);
      billed.max += Number(component.billedMax || 0);
    });
    line.billedTotalMin = billed.min;
    line.billedTotalMax = billed.max;
    line.displayTotalMin = billed.min;
    line.displayTotalMax = billed.max;
    const quantity = Number(line.quantity || 1) || 1;
    line.displayUnitPriceMin = billed.min / quantity;
    line.displayUnitPriceMax = billed.max / Number(line.quantityMax || quantity);
    if (offeredAmount.min > 0 || offeredAmount.max > 0) {
      line.offeredByPlatform = billed.min === 0 && billed.max === 0;
      line.contextNote = line.offeredByPlatform
        ? (line.costCategory === "training" ? "Formation offerte dans le cadre du partenariat" : "Contribution scientifique Bioch&SPIR")
        : `Dont personnel apporté par Bioch&SPIR : ${NIRSApp?.rangeMoney ? NIRSApp.rangeMoney(offeredAmount, result.currency) : `${offeredAmount.min} à ${offeredAmount.max} EUR`}`;
    }
  });

  const totals = costCategoryTotals(result);
  const offeredPersonnel = sumCategories(totals, ["personnel", "instrument_staff"]);
  const offeredTraining = sumCategories(totals, ["training"]);
  const offeredBase = sumCategories(totals, [...offered]);
  const negotiableBase = sumCategories(totals, [...negotiated]);
  const fullPriceBase = sumCategories(totals, [...fullPrice].filter((category) => category !== "administrative"));
  const billedBeforeAdministrativeFee = addRange(multiplyRange(negotiableBase, shareMin, shareMax), fullPriceBase);
  const negotiatedReduction = {
    min: negotiableBase.min * Math.max(0, 1 - shareMax),
    max: negotiableBase.max * Math.max(0, 1 - shareMin)
  };
  const inKindContribution = addRange(offeredBase, negotiatedReduction);
  const partnershipScenarios = {
    minimumInvoice: {
      technicalRangePosition: "low",
      billedShare: shareMin,
      billedEstimate: {
        min: negotiableBase.min * shareMin + fullPriceBase.min,
        max: negotiableBase.min * shareMin + fullPriceBase.min
      },
      inKindContribution: {
        min: offeredBase.min + negotiableBase.min * (1 - shareMin),
        max: offeredBase.min + negotiableBase.min * (1 - shareMin)
      }
    },
    maximumInvoice: {
      technicalRangePosition: "high",
      billedShare: shareMax,
      billedEstimate: {
        min: negotiableBase.max * shareMax + fullPriceBase.max,
        max: negotiableBase.max * shareMax + fullPriceBase.max
      },
      inKindContribution: {
        min: offeredBase.max + negotiableBase.max * (1 - shareMax),
        max: offeredBase.max + negotiableBase.max * (1 - shareMax)
      }
    }
  };

  result.billedEstimate = { ...billedBeforeAdministrativeFee };
  result.inKindContribution = inKindContribution;
  result.inKindContributionBreakdown = {
    personnel: offeredPersonnel,
    training: offeredTraining,
    negotiatedReduction,
    total: inKindContribution
  };
  result.partnershipBreakdown = {
    technicalValue: { ...result.technicalValue },
    offeredBase,
    offeredPersonnel,
    offeredTraining,
    negotiableBase,
    fullPriceBase,
    negotiatedReduction,
    inKindContribution,
    billedEstimateBeforeAdministrativeFee: billedBeforeAdministrativeFee,
    administrativeFee: { min: 0, max: 0 },
    billedEstimate: { ...billedBeforeAdministrativeFee },
    billedShare: { min: shareMin, max: shareMax },
    partnershipScenarios
  };
  (result.itemResults || []).forEach((item) => {
    if (!item.technicalValue || item.status === "incomplete") return;
    const itemLines = (result.items || []).filter((line) => line.parentItemId === item.itemId);
    if (!itemLines.length) return;
    item.billedEstimate = itemLines.reduce((sum, line) => addRange(sum, {
      min: Number(line.billedTotalMin ?? line.displayTotalMin ?? line.totalMin ?? 0),
      max: Number(line.billedTotalMax ?? line.displayTotalMax ?? line.totalMax ?? 0)
    }), { min: 0, max: 0 });
    const technical = item.technicalValue || { min: 0, max: 0 };
    if (item.billedEstimate.min === 0 && item.billedEstimate.max === 0 && (technical.min > 0 || technical.max > 0)) {
      item.offeredByPlatform = true;
      item.contextNote = "Contribution Bioch&SPIR dans le cadre du partenariat";
    } else {
      const notes = [...new Set(itemLines.map((line) => line.contextNote).filter(Boolean))];
      if (notes.length) item.contextNote = notes.join(" ; ");
    }
  });
  if (context.notice) result.assumptions.push(context.notice);
}


function lineDisplayTotal(line) {
  return {
    min: Number.isFinite(line.displayTotalMin) ? Number(line.displayTotalMin) : Number(line.totalMin),
    max: Number.isFinite(line.displayTotalMax) ? Number(line.displayTotalMax) : Number(line.totalMax)
  };
}

function cloneRange(range = {}) {
  return {
    min: Number(range.min || 0),
    max: Number(range.max || 0)
  };
}

function lineReferenceRange(line) {
  const quantity = Number(line.quantity || 1) || 1;
  const unit = Number.isFinite(Number(line.technicalReferenceUnitPrice))
    ? Number(line.technicalReferenceUnitPrice)
    : Number.isFinite(Number(line.unitPriceMin)) && Number.isFinite(Number(line.unitPriceMax))
      ? (Number(line.unitPriceMin) + Number(line.unitPriceMax)) / 2
      : 0;
  const total = Number.isFinite(Number(line.technicalReferenceTotal))
    ? Number(line.technicalReferenceTotal)
    : unit * quantity;
  line.technicalReferenceUnitPrice = unit;
  line.technicalReferenceTotal = total;
  return { unit, total };
}

function isPreQuoteUncertaintyExcluded(line, settings = {}) {
  const excludedRules = new Set(settings.excludedConfigRules || []);
  return line.pricingMode === "quote"
    || excludedRules.has(line.configRule)
    || line.costCategory === "training"
    || line.costCategory === "administrative"
    || line.discussionRangePolicy?.mode === "none"
    || line.preQuoteAdjustmentEligible === false;
}

function discussionRangeRateForLine(line, settings = {}) {
  const policy = line.discussionRangePolicy || {};
  if (policy.mode === "quote" || policy.mode === "none") return 0;
  if ((policy.mode === "global_rate" || policy.mode === "custom_rate") && Number.isFinite(Number(policy.rate))) {
    return Number(policy.rate);
  }
  return Number(settings.rate || 0);
}

function stabilizedRangeAmount(min, max, mode = "midpoint") {
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (mode === "min") return low;
  if (mode === "max") return high;
  return (low + high) / 2;
}

function stabilizeTechnicalRanges(result, tarifs) {
  const settings = tarifs.preQuoteUncertainty || {};
  if (settings.enabled === false || settings.stabilizeRangesBeforeContext !== true) return;
  const mode = settings.stabilizationMode || "midpoint";
  let totalMin = 0;
  let totalMax = 0;
  for (const line of result.items) {
    if (line.pricingMode === "quote") continue;
    if (!isPreQuoteUncertaintyExcluded(line, settings) && Number(line.totalMin) !== Number(line.totalMax)) {
      const unit = stabilizedRangeAmount(line.unitPriceMin, line.unitPriceMax, mode);
      const total = stabilizedRangeAmount(line.totalMin, line.totalMax, mode);
      if (unit !== null && total !== null) {
        line.stabilizedFromRange = {
          unitPriceMin: line.unitPriceMin,
          unitPriceMax: line.unitPriceMax,
          totalMin: line.totalMin,
          totalMax: line.totalMax,
          mode
        };
        line.unitPriceMin = unit;
        line.unitPriceMax = unit;
        line.totalMin = total;
        line.totalMax = total;
      }
    }
    if (Number.isFinite(Number(line.totalMin))) totalMin += Number(line.totalMin);
    if (Number.isFinite(Number(line.totalMax))) totalMax += Number(line.totalMax);
  }
  result.technicalValue = { min: totalMin, max: totalMax };
}

function rescaleLineCostComponents(line, targetRange) {
  if (!line || line.pricingMode === "quote") return;
  const reference = lineReferenceRange(line);
  const source = {
    min: reference.total,
    max: reference.total
  };
  if (!Array.isArray(line.costComponents) || !line.costComponents.length) {
    line.costComponents = [{
      category: line.costCategory || "technical_non_personnel",
      label: line.costCategory || "technical_non_personnel",
      min: targetRange.min,
      max: targetRange.max
    }];
    return;
  }
  const sourceMin = source.min || reference.total || 0;
  const sourceMax = source.max || reference.total || 0;
  line.costComponents = reconcileCostComponents(line.costComponents.map((component) => ({
    category: component.category || line.costCategory || "technical_non_personnel",
    label: component.label || component.category || line.costCategory || "technical_non_personnel",
    min: sourceMin > 0 ? Number(component.min || 0) * targetRange.min / sourceMin : 0,
    max: sourceMax > 0 ? Number(component.max || 0) * targetRange.max / sourceMax : 0
  })), targetRange);
}

function refreshItemResultRanges(result) {
  const totalsByParent = new Map();
  for (const line of result.items || []) {
    if (!line.parentItemId || line.pricingMode === "quote") continue;
    const current = totalsByParent.get(line.parentItemId) || { min: 0, max: 0 };
    current.min += Number(line.totalMin || 0);
    current.max += Number(line.totalMax || 0);
    totalsByParent.set(line.parentItemId, current);
  }
  (result.itemResults || []).forEach((item) => {
    if (!item.itemId || item.status === "incomplete") return;
    const range = totalsByParent.get(item.itemId);
    if (range) {
      item.technicalValue = { ...range };
      item.billedEstimate = { ...range };
    }
  });
}

function applyTechnicalDiscussionRanges(result, tarifs) {
  const settings = tarifs.preQuoteUncertainty || {};
  result.pricingAudit = result.pricingAudit || emptyPricingAudit();
  let totalMin = 0;
  let totalMax = 0;
  let referenceTotal = 0;
  result.items.forEach((line) => {
    if (line.pricingMode === "quote") {
      line.discussionRangeRate = null;
      line.technicalDiscussionUnitPriceMin = null;
      line.technicalDiscussionUnitPriceMax = null;
      line.technicalDiscussionTotalMin = null;
      line.technicalDiscussionTotalMax = null;
      return;
    }
    const quantity = Number(line.quantity || 1) || 1;
    const reference = lineReferenceRange(line);
    referenceTotal += reference.total;
    const rate = discussionRangeRateForLine(line, settings);
    const excluded = settings.enabled === false || isPreQuoteUncertaintyExcluded(line, settings);
    const effectiveRate = excluded ? 0 : rate;
    const unitMin = excluded ? Number(line.unitPriceMin || 0) : reference.unit * (1 - effectiveRate);
    const unitMax = excluded ? Number(line.unitPriceMax || 0) : reference.unit * (1 + effectiveRate);
    const totalRange = excluded ? {
      min: Number(line.totalMin || 0),
      max: Number(line.totalMax || 0)
    } : {
      min: unitMin * quantity,
      max: unitMax * quantity
    };
    line.discussionRangeRate = effectiveRate;
    line.preQuoteUncertaintyRate = effectiveRate;
    line.technicalDiscussionUnitPriceMin = unitMin;
    line.technicalDiscussionUnitPriceMax = unitMax;
    line.technicalDiscussionTotalMin = totalRange.min;
    line.technicalDiscussionTotalMax = totalRange.max;
    line.unitPriceMin = unitMin;
    line.unitPriceMax = unitMax;
    line.totalMin = totalRange.min;
    line.totalMax = totalRange.max;
    line.technicalTotalMin = totalRange.min;
    line.technicalTotalMax = totalRange.max;
    line.billedTotalMin = totalRange.min;
    line.billedTotalMax = totalRange.max;
    line.displayUnitPriceMin = unitMin;
    line.displayUnitPriceMax = unitMax;
    line.displayTotalMin = totalRange.min;
    line.displayTotalMax = totalRange.max;
    rescaleLineCostComponents(line, totalRange);
    totalMin += totalRange.min;
    totalMax += totalRange.max;
  });
  result.technicalValue = { min: totalMin, max: totalMax };
  result.billedEstimate = { ...result.technicalValue };
  result.pricingAudit.technicalReferenceAmount = { min: referenceTotal, max: referenceTotal };
  result.pricingAudit.technicalDiscussionRange = { min: totalMin, max: totalMax };
  refreshItemResultRanges(result);
}

function applyPreQuoteUncertainty(result, tarifs) {
  applyTechnicalDiscussionRanges(result, tarifs);
}

function linePartnershipTreatment(line, context) {
  if (line.pricingMode === "quote") return "quote";
  if (line.configRule === "externalAdministrativeFee" || line.configRule === "billingMinimumAdjustment") return "full_price";
  if (context?.mode !== "negotiated_partnership") return lineContextEligible(line) ? "context_coefficient" : "full_price";
  const policy = context.billingPolicy || {};
  const offered = new Set(policy.offeredCategories || []);
  const negotiated = new Set(policy.negotiatedCategories || []);
  const fullPrice = new Set(policy.fullPriceCategories || []);
  const categories = [...new Set((line.costComponents || [{ category: line.costCategory }]).map((component) => component.category || line.costCategory))];
  if (categories.length && categories.every((category) => offered.has(category))) return "offered";
  if (categories.some((category) => negotiated.has(category))) return "negotiated";
  if (categories.some((category) => fullPrice.has(category))) return "full_price";
  return "full_price";
}

function quoteRequiredItems(result) {
  return (result.items || [])
    .filter((item) => item.pricingMode === "quote")
    .map((item) => ({
      id: item.id,
      parentItemId: item.parentItemId || "",
      parentLabel: item.parentLabel || "",
      label: item.label || "Sur devis",
      reason: item.reason || ""
    }));
}

function finalizeLinePricingAuditFields(result) {
  for (const line of result.items || []) {
    line.parentItemId = line.parentItemId || "";
    line.parentLabel = line.parentLabel || "";
    line.assumptions = Array.isArray(line.assumptions) ? line.assumptions : [];
    line.warnings = Array.isArray(line.warnings) ? line.warnings : [];
    line.partnershipTreatment = linePartnershipTreatment(line, result.context);
    line.contextCoefficient = lineContextEligible(line) ? result.contextCoefficient || null : { min: 1, max: 1 };
    if (line.pricingMode === "quote") {
      line.billedUnitPriceMin = null;
      line.billedUnitPriceMax = null;
      line.billedTotalMin = null;
      line.billedTotalMax = null;
      continue;
    }
    const quantity = Number(line.quantity || 1) || 1;
    const displayTotal = lineDisplayTotal(line);
    line.billedTotalMin = displayTotal.min;
    line.billedTotalMax = displayTotal.max;
    line.billedUnitPriceMin = displayTotal.min / quantity;
    line.billedUnitPriceMax = displayTotal.max / Number(line.quantityMax || quantity);
  }
}

function finalizePricingAudit(result) {
  result.pricingAudit = result.pricingAudit || emptyPricingAudit();
  finalizeLinePricingAuditFields(result);
  if (Array.isArray(result.pricingAudit.maintenance)) {
    const maintenanceLines = (result.items || []).filter((line) => line.maintenanceType);
    result.pricingAudit.maintenance = result.pricingAudit.maintenance.map((entry) => {
      const line = maintenanceLines.find((item) => item.maintenanceType === (entry.maintenanceType || entry.type) && (!entry.parentItemId || item.parentItemId === entry.parentItemId));
      return {
        ...entry,
        parentItemId: entry.parentItemId || line?.parentItemId || "",
        maintenanceType: entry.maintenanceType || entry.type || line?.maintenanceType || "",
        label: entry.label || line?.label || "",
        contextId: result.context?.id || entry.contextId || "",
        contextCoefficient: result.contextCoefficient?.min === result.contextCoefficient?.max
          ? result.contextCoefficient?.min ?? null
          : result.contextCoefficient || null,
        partnershipTreatment: line?.partnershipTreatment || entry.partnershipTreatment || "negotiated",
        technicalDiscussionRange: line ? {
          min: Number(line.technicalDiscussionTotalMin ?? line.totalMin ?? 0),
          max: Number(line.technicalDiscussionTotalMax ?? line.totalMax ?? 0)
        } : entry.technicalDiscussionRange,
        billedRange: line ? {
          min: Number(line.billedTotalMin ?? line.displayTotalMin ?? line.totalMin ?? 0),
          max: Number(line.billedTotalMax ?? line.displayTotalMax ?? line.totalMax ?? 0)
        } : entry.billedRange,
        pricingConfidence: entry.pricingConfidence || line?.pricingConfidence || "low",
        requiresPlateauReview: entry.requiresPlateauReview === true || line?.requiresPlateauReview === true
      };
    });
  }
  result.pricingAudit.contextId = result.context?.id || result.pricingAudit.contextId || "";
  result.pricingAudit.contextMode = result.context?.mode || result.pricingAudit.contextMode || "";
  result.pricingAudit.contextCoefficient = result.contextCoefficient || result.pricingAudit.contextCoefficient || null;
  result.pricingAudit.partnershipBreakdown = result.partnershipBreakdown || result.pricingAudit.partnershipBreakdown || null;
  result.pricingAudit.billedEstimate = cloneRange(result.billedEstimate);
  result.pricingAudit.quoteRequiredItems = quoteRequiredItems(result);
  result.pricingAudit.overlapWarnings = result.pricingAudit.overlapWarnings || [];
}

function billedRangeReview(range, policy) {
  const rate = finiteNumber(policy.rate, "Plafond de fourchette facturée");
  if (rate >= 1 || policy.overflowPolicy !== "quote_required") throw new Error("Plafond de fourchette facturée invalide.");
  const center = (Number(range.min) + Number(range.max)) / 2;
  const relativeHalfWidth = center > 0 ? (Number(range.max) - Number(range.min)) / (2 * center) : 0;
  return { required: relativeHalfWidth > rate + Number.EPSILON * 10, rateLimit: rate, relativeHalfWidth, computedEstimate: { ...range } };
}

function reconcileBilledTotals(result) {
  if (!result.context) return;
  result.billedEstimate = sumBilledLines(result);
  for (const item of result.itemResults || []) {
    if (item.status === "incomplete") continue;
    const lines = result.items.filter((line) => line.parentItemId === item.itemId);
    item.billedEstimate = sumBilledLines({ items: lines });
  }
  if (result.partnershipBreakdown) {
    result.partnershipBreakdown.billedEstimate = { ...result.billedEstimate };
    const fee = result.partnershipBreakdown.administrativeFee;
    result.partnershipBreakdown.billedEstimateBeforeAdministrativeFee = {
      min: result.billedEstimate.min - fee.min,
      max: result.billedEstimate.max - fee.max
    };
  }
}

function applyBilledRangeLimit(result, tarifs) {
  if (!result.context) return;
  const policy = priceFrom(tarifs, "billedEstimateRangeLimit");
  if (typeof policy.enabled !== "boolean") throw new Error("Activation du plafond de fourchette à renseigner.");
  if (policy.enabled === false) return;
  const review = billedRangeReview(result.billedEstimate, policy);
  result.billingRangeReview = review;
  result.pricingAudit.billingRangeReview = review;
  if (!review.required) return;
  result.status = "quote_required";
  result.warnings.push(policy.exceededMessage);
  result.billingRangeReview.message = policy.exceededMessage;
  for (const line of result.items || []) {
    if (line.pricingMode !== "quote") line.billingRangeReview = billedRangeReview(lineDisplayTotal(line), policy);
  }
  for (const item of result.itemResults || []) {
    if (item.billedEstimate) item.billingRangeReview = billedRangeReview(item.billedEstimate, policy);
  }
}

function roundPricingAudit(audit, rounding) {
  if (!audit) return audit;
  [
    "technicalReferenceAmount",
    "technicalDiscussionRange",
    "subcontractingAdjustmentAmount",
    "administrativeFee",
    "billingMinimumAdjustment",
    "billedEstimate"
  ].forEach((key) => {
    if (audit[key]) audit[key] = roundRange(audit[key], rounding);
  });
  if (audit.partnershipBreakdown) audit.partnershipBreakdown = roundNamedRanges(audit.partnershipBreakdown, rounding);
  return audit;
}

function roundNamedRanges(container, rounding) {
  if (!container || typeof container !== "object") return container;
  Object.entries(container).forEach(([key, value]) => {
    if (key === "billedShare") return;
    if (value && typeof value === "object" && Number.isFinite(Number(value.min)) && Number.isFinite(Number(value.max))) {
      container[key] = roundRange(value, rounding);
    }
  });
  return container;
}

function isBusinessLine(line) {
  return line && line.configRule !== "externalAdministrativeFee" && line.configRule !== "billingMinimumAdjustment" && line.configRule !== "urgentMarkup" && !String(line.id || "").startsWith("global_urgent");
}

function businessStatusFromItems(itemResults = [], items = []) {
  const completedBusinessItems = itemResults.filter((item) => item.status !== "incomplete");
  const pricedBusinessItems = completedBusinessItems.filter((item) => item.status === "estimated" || item.status === "partial");
  const quoteBusinessLines = items.filter((item) => isBusinessLine(item) && item.pricingMode === "quote");
  if (quoteBusinessLines.length && !pricedBusinessItems.length) return "quote_required";
  if (quoteBusinessLines.length) return "partial";
  if (pricedBusinessItems.length) return "estimated";
  return "quote_required";
}

function markStatus(result) {
  if (!Array.isArray(result.itemResults)) {
    const quoteCount = result.items.filter((item) => isBusinessLine(item) && item.pricingMode === "quote").length;
    const hasEstimated = result.technicalValue.min > 0 || result.technicalValue.max > 0;
    result.status = quoteCount ? (hasEstimated ? "partial" : "quote_required") : (hasEstimated ? "estimated" : "quote_required");
    return;
  }
  result.status = businessStatusFromItems(result.itemResults || [], result.items || []);
}

function calculateSingleQuote(tarifs, choices, options = {}) {
  const settings = {
    applyCommonOptions: true,
    applyUrgency: true,
    applyBillingMinimum: true,
    applyContext: true,
    applyPreQuoteUncertainty: true,
    addDisclaimers: true,
    ...options
  };
  if (!tarifs.metadata) throw new Error("Configuration tarifaire invalide");
  if (!choices.requestType) throw new Error("Type de demande manquant");

  const result = makeEmptyResult(tarifs);

  switch (choices.requestType) {
    case "spectra_acquisition":
      calculateSpectraAcquisition(result, tarifs, choices, settings);
      break;
    case "initial_training":
      calculateInitialTraining(result, tarifs, choices);
      break;
    case "theoretical_nirs_training":
      calculateTheoreticalNirsTraining(result, tarifs, choices);
      break;
    case "validated_calibration":
      calculateValidatedCalibration(result, tarifs, choices);
      break;
    case "local_model_validation":
      calculateLocalValidation(result, tarifs, choices);
      break;
    case "bias_correction":
      calculateBiasCorrection(result, tarifs, choices);
      break;
    case "calibration_transfer":
      calculateTransfer(result, tarifs, choices);
      break;
    case "existing_model_predictions":
      calculatePredictions(result, tarifs, choices);
      break;
    case "model_maintenance":
      calculateMaintenance(result, tarifs, choices);
      break;
    case "other_chemometrics":
      addChemometric(result, tarifs, "other_chemometrics", 1, choices.description || choices.shortTitle || "Autre demande");
      if (result.items.length) {
        const line = result.items[result.items.length - 1];
        const title = String(choices.shortTitle || "").trim();
        if (title) line.label = `Autre demande - ${title}`;
      }
      break;
    case "instrument_qualification":
      calculateInstrumentQualification(result, tarifs, choices);
      break;
    default:
      throw new Error(`Type de demande inconnu: ${choices.requestType}`);
  }

  // Ordre global: prestations techniques, transport instrument, préparation des données,
  // urgence sur les lignes techniques, contexte, forfait de gestion sans coefficient,
  // puis minimum de facturation et arrondi final.
  stabilizeTechnicalRanges(result, tarifs);
  if (settings.applyUrgency) addUrgency(result, tarifs, choices);
  if (settings.applyPreQuoteUncertainty) applyTechnicalDiscussionRanges(result, tarifs);
  if (settings.applyContext) applyContext(result, tarifs, choices);
  if (!settings.applyContext) {
    result.billedEstimate = { ...result.technicalValue };
    result.context = null;
  }
  if (settings.applyCommonOptions) addCommonOptions(result, tarifs, choices);
  if (settings.applyBillingMinimum) applyBillingMinimum(result, tarifs);
  markStatus(result);

  result.technicalValue = roundRange(result.technicalValue, tarifs.rounding);
  result.billedEstimate = roundRange(result.billedEstimate, tarifs.rounding);
  result.inKindContribution = roundRange(result.inKindContribution, tarifs.rounding);
  result.inKindContributionBreakdown = roundNamedRanges(result.inKindContributionBreakdown, tarifs.rounding);
  if (result.partnershipBreakdown) result.partnershipBreakdown = roundNamedRanges(result.partnershipBreakdown, tarifs.rounding);
  for (const item of result.items) {
    if (Number.isFinite(item.unitPriceMin)) item.unitPriceMin = roundRange({ min: item.unitPriceMin, max: item.unitPriceMin }, tarifs.rounding).min;
    if (Number.isFinite(item.unitPriceMax)) item.unitPriceMax = roundRange({ min: item.unitPriceMax, max: item.unitPriceMax }, tarifs.rounding).max;
    if (Number.isFinite(item.totalMin)) item.totalMin = roundRange({ min: item.totalMin, max: item.totalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.totalMax)) item.totalMax = roundRange({ min: item.totalMax, max: item.totalMax }, tarifs.rounding).max;
    if (Number.isFinite(item.displayUnitPriceMin)) item.displayUnitPriceMin = roundRange({ min: item.displayUnitPriceMin, max: item.displayUnitPriceMin }, tarifs.rounding).min;
    if (Number.isFinite(item.displayUnitPriceMax)) item.displayUnitPriceMax = roundRange({ min: item.displayUnitPriceMax, max: item.displayUnitPriceMax }, tarifs.rounding).max;
    if (Number.isFinite(item.displayTotalMin)) item.displayTotalMin = roundRange({ min: item.displayTotalMin, max: item.displayTotalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.displayTotalMax)) item.displayTotalMax = roundRange({ min: item.displayTotalMax, max: item.displayTotalMax }, tarifs.rounding).max;
    if (Number.isFinite(item.technicalTotalMin)) item.technicalTotalMin = roundRange({ min: item.technicalTotalMin, max: item.technicalTotalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalTotalMax)) item.technicalTotalMax = roundRange({ min: item.technicalTotalMax, max: item.technicalTotalMax }, tarifs.rounding).max;
    if (Number.isFinite(item.billedTotalMin)) item.billedTotalMin = roundRange({ min: item.billedTotalMin, max: item.billedTotalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.billedTotalMax)) item.billedTotalMax = roundRange({ min: item.billedTotalMax, max: item.billedTotalMax }, tarifs.rounding).max;
    if (Number.isFinite(item.technicalReferenceUnitPrice)) item.technicalReferenceUnitPrice = roundRange({ min: item.technicalReferenceUnitPrice, max: item.technicalReferenceUnitPrice }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalReferenceTotal)) item.technicalReferenceTotal = roundRange({ min: item.technicalReferenceTotal, max: item.technicalReferenceTotal }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalDiscussionUnitPriceMin)) item.technicalDiscussionUnitPriceMin = roundRange({ min: item.technicalDiscussionUnitPriceMin, max: item.technicalDiscussionUnitPriceMin }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalDiscussionUnitPriceMax)) item.technicalDiscussionUnitPriceMax = roundRange({ min: item.technicalDiscussionUnitPriceMax, max: item.technicalDiscussionUnitPriceMax }, tarifs.rounding).max;
    if (Number.isFinite(item.technicalDiscussionTotalMin)) item.technicalDiscussionTotalMin = roundRange({ min: item.technicalDiscussionTotalMin, max: item.technicalDiscussionTotalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalDiscussionTotalMax)) item.technicalDiscussionTotalMax = roundRange({ min: item.technicalDiscussionTotalMax, max: item.technicalDiscussionTotalMax }, tarifs.rounding).max;
    (item.costComponents || []).forEach((component) => {
      if (Number.isFinite(component.min)) component.min = roundRange({ min: component.min, max: component.min }, tarifs.rounding).min;
      if (Number.isFinite(component.max)) component.max = roundRange({ min: component.max, max: component.max }, tarifs.rounding).max;
      if (Number.isFinite(component.billedMin)) component.billedMin = roundRange({ min: component.billedMin, max: component.billedMin }, tarifs.rounding).min;
      if (Number.isFinite(component.billedMax)) component.billedMax = roundRange({ min: component.billedMax, max: component.billedMax }, tarifs.rounding).max;
    });
  }
  reconcileBilledTotals(result);
  finalizePricingAudit(result);
  result.pricingAudit = roundPricingAudit(result.pricingAudit, tarifs.rounding);

  applyBilledRangeLimit(result, tarifs);
  result.exclusions = [...new Set([...(settings.addDisclaimers ? tarifs.disclaimers : []), ...result.exclusions])];
  result.warnings = [...new Set(result.warnings)];
  result.assumptions = [...new Set(result.assumptions)];

  return result;
}

function emptyAggregate(config) {
  const tarifs = config.tarifs || config;
  return {
    status: "quote_required",
    currency: tarifs.metadata.currency,
    taxMode: tarifs.metadata.taxMode,
    itemResults: [],
    technicalValue: { min: 0, max: 0 },
    billedEstimate: { min: 0, max: 0 },
    inKindContribution: { min: 0, max: 0 },
    inKindContributionBreakdown: emptyInKindContributionBreakdown(),
    partnershipBreakdown: null,
    contextMarkup: { min: 0, max: 0 },
    trainingGroups: [],
    trainingRequirements: [],
    items: [],
    exclusions: [],
    warnings: [],
    assumptions: [],
    pricingAudit: emptyPricingAudit()
  };
}

function cleanAnswersForRequest(prestations, requestType, answers, people = []) {
  if (!NIRSApp.allVisibleFields) return { ...answers };
  const migratedAnswers = migrateLegacyAnswers(requestType, answers || {});
  const clean = { requestType };
  for (const field of NIRSApp.allVisibleFields(prestations, requestType, migratedAnswers || {})) {
    if (Object.prototype.hasOwnProperty.call(migratedAnswers || {}, field.id)) {
      clean[field.id] = migratedAnswers[field.id];
    } else if (Object.prototype.hasOwnProperty.call(field, "default")) {
      clean[field.id] = field.default;
    }
  }
  clean._people = people;
  clean._explicitTrainingKeys = migratedAnswers._explicitTrainingKeys;
  const peopleById = new Map((Array.isArray(people) ? people : []).map((person) => [person.id, person]));
  if (requestType === "spectra_acquisition" && canonicalServiceMode(clean.serviceMode) === "autonomous_supported" && Array.isArray(migratedAnswers.operatorIds)) {
    clean.operatorIds = [...new Set(migratedAnswers.operatorIds)];
    clean.operators = clean.operatorIds.map((id) => peopleById.get(id)).filter(Boolean);
  }
  if (requestType === "spectra_acquisition" && canonicalServiceMode(clean.serviceMode) === "autonomous_supported" && Array.isArray(migratedAnswers.operators)) {
    clean.operators = clean.operators || migratedAnswers.operators;
  }
  if (requestType === "initial_training" && Array.isArray(migratedAnswers.participantIds)) {
    clean.participantIds = [...new Set(migratedAnswers.participantIds)];
    clean.participants = clean.participantIds.map((id) => peopleById.get(id)).filter(Boolean);
    clean.people = clean.participants.length || clean.people;
  }
  if (requestType === "initial_training" && Array.isArray(migratedAnswers.participants)) {
    clean.participants = clean.participants || migratedAnswers.participants;
    clean.people = migratedAnswers.participants.length || clean.people;
  }
  return clean;
}

function migrateLegacyAnswers(requestType, answers) {
  const next = requestType === "spectra_acquisition"
    ? NIRSApp.restoreAcquisitionDetails(answers || {}) : { ...(answers || {}) };
  if (requestType === "spectra_acquisition") {
    next.serviceMode = canonicalServiceMode(next.serviceMode);
    if (next.measurementLocation === "platform" || next.measurementLocation === "field") {
      next.measurementLocation = next.measurementLocation === "field" ? "transport_required" : "bioch_spir_lab";
    }
    const instrument = globalThis.NIRS_CONFIG?.tarifs?.instruments?.[next.instrument] || {};
    if (instrument.transportPolicy === "forbidden" && next.measurementLocation === "transport_required") {
      next.measurementLocation = "bioch_spir_lab";
      next.transportMigrationWarning = "Ancien transport supprimé : mesures réalisées uniquement au laboratoire Bioch&SPIR.";
    }
  }
  if (requestType === "existing_model_predictions") {
    if (next.predictionMode === undefined) next.predictionMode = "without_reference";
    if (next.outlierCheck === true) next.dataPreparationRequired = true;
  }
  if (requestType === "model_maintenance") {
    const previousType = next.maintenanceType;
    next.maintenanceType = migratedMaintenanceType(previousType);
    next.legacyMaintenanceAnswers = next.legacyMaintenanceAnswers || legacyMaintenanceAnswers(next);
    next.maintenanceComment = buildMaintenanceComment(next);
    delete next.comment;
  }
  return next;
}

function legacyMaintenanceAnswers(answers) {
  const legacyKeys = [
    "modelName",
    "instrument",
    "propertyName",
    "spectra",
    "models",
    "referenceSampleCount",
    "modelsForValidation",
    "instrumentsCount",
    "predictionCount",
    "biasProperties",
    "biasInstrumentsCount",
    "updateReason",
    "updateReasonOther",
    "newSpectra",
    "updateProperties",
    "sourceInstrument",
    "targetInstrument",
    "pairedSpectraStatus",
    "pairedSampleCount",
    "referenceDataAvailability",
    "propertiesCount",
    "independentTargetValidation",
    "independentValidationSampleCount",
    "transferTraits",
    "transferSamples"
  ];
  return legacyKeys.reduce((legacy, key) => {
    if (answers[key] !== undefined && answers[key] !== null && String(answers[key]).trim() !== "") legacy[key] = answers[key];
    return legacy;
  }, {});
}

function buildMaintenanceComment(answers) {
  const existing = String(answers.maintenanceComment || answers.comment || "").trim();
  const legacy = answers.legacyMaintenanceAnswers || legacyMaintenanceAnswers(answers);
  const labels = {
    modelName: "Modele",
    instrument: "Instrument",
    propertyName: "Propriete ou trait",
    spectra: "Spectres",
    models: "Modeles ou proprietes",
    referenceSampleCount: "Valeurs de reference",
    modelsForValidation: "Modeles a valider",
    instrumentsCount: "Instruments concernes",
    predictionCount: "Couples prediction-reference",
    biasProperties: "Proprietes",
    biasInstrumentsCount: "Instruments pour le biais",
    updateReason: "Motif de mise a jour",
    updateReasonOther: "Autre motif",
    newSpectra: "Nouvelles donnees",
    updateProperties: "Proprietes a mettre a jour",
    sourceInstrument: "Spectrometre source",
    targetInstrument: "Spectrometre cible",
    pairedSpectraStatus: "echantillons apparies",
    pairedSampleCount: "Nombre d'echantillons apparies",
    referenceDataAvailability: "Valeurs de reference disponibles",
    propertiesCount: "Proprietes concernees",
    independentTargetValidation: "Jeu independant cible",
    independentValidationSampleCount: "echantillons du jeu independant",
    transferTraits: "Traits a transferer",
    transferSamples: "echantillons de transfert"
  };
  const legacyLines = Object.entries(legacy)
    .filter(([key, value]) => key !== "maintenanceComment" && key !== "comment" && value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => `${labels[key] || key} : ${value}.`);
  return [existing, ...legacyLines].filter(Boolean).join("\n");
}

function addAggregateOption(result, tarifs, key, quantity, reason) {
  const before = { ...result.technicalValue };
  const optionResult = makeEmptyResult(tarifs);
  addOption(optionResult, tarifs, key, quantity, reason, true);
  const item = optionResult.items[0];
  item.id = `global_${item.id}`;
  item.reason = reason;
  result.items.push(item);
  result.technicalValue.min += optionResult.technicalValue.min;
  result.technicalValue.max += optionResult.technicalValue.max;
  return before;
}

function addAggregateUrgency(result, tarifs, quoteState) {
  if (!asBool(quoteState.urgent)) return;
  const urgent = priceFrom(tarifs.options, "urgent_markup");
  const context = contextFrom(tarifs, quoteState.context).context;
  let baseMin = urgencyBaseFromLines(result).min;
  let baseMax = urgencyBaseFromLines(result).max;
  let components = null;
  let costCategory = urgent.costCategory || "technical_non_personnel";
  if (context?.mode === "negotiated_partnership") {
    const negotiated = new Set(context.billingPolicy?.negotiatedCategories || ["equipment", "consumables", "technical_non_personnel"]);
    const totals = costCategoryTotals(result, isUrgencyEligible);
    components = [...negotiated]
      .map((category) => totals[category] ? ({
        category,
        label: `Majoration d'urgence - ${category}`,
        min: totals[category].min * finiteNumber(rateFrom(urgent, Number.NaN), "Taux de majoration urgence"),
        max: totals[category].max * finiteNumber(rateFrom(urgent, Number.NaN), "Taux de majoration urgence")
      }) : null)
      .filter(Boolean);
    const base = components.reduce((sum, component) => addRange(sum, component), { min: 0, max: 0 });
    baseMin = base.min;
    baseMax = base.max;
    costCategory = "technical_non_personnel";
  }
  if (baseMin <= 0 && baseMax <= 0) return;
  addPercentItem(
    result,
    "global_urgent_markup",
    urgent.label,
    { min: baseMin, max: baseMax },
    context?.mode === "negotiated_partnership" ? 1 : finiteNumber(rateFrom(urgent, Number.NaN), "Taux de majoration urgence"),
    "Majoration d'urgence appliquée une seule fois aux prestations techniques chiffrables",
    true,
    costCategory,
    components
  );
}

function trainingAssignmentFor(person, instrumentId) {
  const assignment = person?.instrumentAssignments?.[instrumentId];
  if (assignment) return assignment;
  return {
    assigned: false,
    trainingStatus: trainingStatusFor(person, instrumentId),
    trainingDate: trainingDateFor(person, instrumentId),
    trainingRequested: false
  };
}

function collectGlobalTrainingRequirements(tarifs, quoteState) {
  const selectedInstruments = NIRSApp.collectSelectedSpectraInstruments
    ? NIRSApp.collectSelectedSpectraInstruments(quoteState, { tarifs })
    : [];
  const people = Array.isArray(quoteState.people) ? quoteState.people.filter((person) => !person.deleted) : [];
  const plannedStartDate = quoteState.project?.plannedStartDate || "";
  const requirements = [];
  const explicitKeys = explicitTrainingKeys(quoteState);
  const instrumentOrder = Object.keys(tarifs.instruments || {});
  const personOrder = new Map(people.map((person, index) => [person.id, index]));

  for (const person of people) {
    for (const instrumentInfo of selectedInstruments) {
      if (!instrumentInfo.hasAutonomousSupportedUse && canonicalServiceMode(instrumentInfo.effectiveMode) !== "autonomous_supported") continue;
      const assignment = trainingAssignmentFor(person, instrumentInfo.id);
      if (!assignment.assigned) continue;
      const status = assignment.trainingStatus;
      if (!["trained", "untrained"].includes(status)) {
        requirements.push({
          personId: person.id,
          firstName: person.firstName || "",
          lastName: person.lastName || "",
          email: person.email || "",
          instrumentId: instrumentInfo.id,
          instrumentLabel: instrumentFrom(tarifs, instrumentInfo.id).label,
          requirementType: "initial",
          mandatory: true,
          needsPlateauVerification: true,
          effectiveMode: instrumentInfo.effectiveMode,
          baseMin: Number(priceFrom(instrumentFrom(tarifs, instrumentInfo.id).prices, "initial_training").min),
          baseMax: Number(priceFrom(instrumentFrom(tarifs, instrumentInfo.id).prices, "initial_training").max),
          personOrder: personOrder.get(person.id) ?? 9999,
          instrumentOrder: instrumentOrder.indexOf(instrumentInfo.id)
        });
        continue;
      }
      let requirementType = "none";
      let mandatory = false;
      const refresherRequired = status === "trained"
        && NIRSApp.isTrainingOlderThanOneYear?.(assignment.trainingDate, plannedStartDate);
      if (refresherRequired) {
        requirementType = "refresher";
        mandatory = true;
      } else if (canonicalServiceMode(instrumentInfo.effectiveMode) === "autonomous_supported") {
        mandatory = true;
        if (status === "untrained") requirementType = "initial";
      }
      if (requirementType === "none") continue;
      const explicitKey = `${person.id}:${instrumentInfo.id}:${requirementType}`;
      if (explicitKeys.has(explicitKey)) continue;
      const instrument = instrumentFrom(tarifs, instrumentInfo.id);
      const priceKey = requirementType === "refresher" ? "refresher_training" : "initial_training";
      const base = priceFrom(instrument.prices, priceKey);
      requirements.push({
        personId: person.id,
        firstName: person.firstName || "",
        lastName: person.lastName || "",
        email: person.email || "",
        instrumentId: instrumentInfo.id,
        instrumentLabel: instrument.label,
        requirementType,
        mandatory,
        effectiveMode: instrumentInfo.effectiveMode,
        baseMin: Number(base.min),
        baseMax: Number(base.max),
        personOrder: personOrder.get(person.id) ?? 9999,
        instrumentOrder: instrumentOrder.indexOf(instrumentInfo.id)
      });
    }
  }
  return requirements;
}

function stableLineId(value) {
  return String(value || "person").replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function applyTrainingPricePolicy(tarifs, requirements) {
  return requirements.map((requirement) => {
    return {
      ...requirement,
      priceCoefficient: 1,
      totalMin: requirement.baseMin,
      totalMax: requirement.baseMax
    };
  });
}

function explicitTrainingKeys(quoteState) {
  const keys = new Set();
  for (const item of quoteState.items || []) {
    if (item.requestType !== "initial_training") continue;
    const instrumentId = item.answers?.instrument;
    const type = item.answers?.trainingType === "refresher" ? "refresher" : "initial";
    (item.answers?.participantIds || []).forEach((personId) => {
      if (personId && instrumentId) keys.add(`${personId}:${instrumentId}:${type}`);
    });
  }
  return keys;
}

function addGlobalTrainingRequirements(result, tarifs, trainingRequirements) {
  const pricedRequirements = applyTrainingPricePolicy(tarifs, trainingRequirements);
  if (!pricedRequirements.length) return;
  result.trainingRequirements = pricedRequirements.map((requirement) => ({
    personId: requirement.personId,
    firstName: requirement.firstName,
    lastName: requirement.lastName,
    email: requirement.email,
    instrumentId: requirement.instrumentId,
    instrumentLabel: requirement.instrumentLabel,
    requirementType: requirement.requirementType,
    mandatory: requirement.mandatory,
    needsPlateauVerification: requirement.needsPlateauVerification === true,
    effectiveMode: requirement.effectiveMode,
    priceCoefficient: requirement.priceCoefficient,
    totalMin: requirement.totalMin,
    totalMax: requirement.totalMax
  }));
  for (const requirement of pricedRequirements) {
    const person = participantName(requirement) || "Utilisateur à compléter";
    const label = `${requirement.requirementType === "refresher" ? "Remise à niveau" : "Formation initiale nominative"} - ${requirement.instrumentLabel}`;
    const detail = `${requirement.mandatory ? "Formation obligatoire" : "Formation demandée"} pour ${person}${requirement.priceCoefficient < 1 ? " - tarif réduit" : ""}`;
    addDerivedItem(
      result,
      `global_${requirement.requirementType}_training_${stableLineId(requirement.instrumentId)}_${stableLineId(requirement.personId)}`,
      label,
      1,
      "participant",
      requirement.totalMin,
      requirement.totalMax,
      detail,
      requirement.mandatory,
      "training"
    );
    const line = result.items[result.items.length - 1];
    line.parentLabel = "Utilisateurs et formations";
    line.personId = requirement.personId;
    line.instrumentId = requirement.instrumentId;
    line.requirementType = requirement.requirementType;
    line.priceCoefficient = requirement.priceCoefficient;
    line.needsPlateauVerification = requirement.needsPlateauVerification === true;
    line.configRule = "instrumentTraining";
    line.trainingDescription = `${requirement.instrumentLabel} - ${requirement.requirementType === "refresher" ? "remise à niveau" : "formation initiale"} - ${person}`;
  }
  result.warnings.push("Les formations sont dédupliquées par personne et par instrument.");
  result.assumptions.push("Une formation déclarée comme déjà effectuée devra être confirmée par le plateau.");
  if (pricedRequirements.some((requirement) => requirement.needsPlateauVerification)) {
    result.warnings.push("La validité de certaines formations devra être confirmée par le plateau avant utilisation autonome.");
  }
}

function applyAggregateBillingMinimum(result, tarifs) {
  // Minimum de facturation global applique une seule fois apres contexte et forfait de gestion.
  if (result.context?.billingPolicy?.billingMinimumApplies === false) return;
  const minimum = priceFrom(tarifs.options, "billing_minimum");
  if (result.billedEstimate.min === 0 && result.billedEstimate.max === 0) return;
  const addMin = Math.max(0, Number(minimum.min) - result.billedEstimate.min);
  const addMax = Math.max(0, Number(minimum.max) - result.billedEstimate.max);
  if (addMin > 0 || addMax > 0) {
    const item = {
      id: "global_billing_minimum_adjustment",
      label: minimum.label,
      quantity: 1,
      unit: minimum.unit,
      unitPriceMin: addMin,
      unitPriceMax: addMax,
      totalMin: addMin,
      totalMax: addMax,
      pricingMode: "range",
      mandatory: true,
      configRule: "billingMinimumAdjustment",
      costCategory: minimum.costCategory || "administrative",
      preQuoteAdjustmentEligible: false,
      reason: "Minimum configurable appliqué uniquement lorsque le montant facturé est inférieur"
    };
    item.technicalReferenceUnitPrice = 0;
    item.technicalReferenceTotal = 0;
    result.items.push(item);
    result.billedEstimate.min += addMin;
    result.billedEstimate.max += addMax;
    result.pricingAudit = result.pricingAudit || emptyPricingAudit();
    result.pricingAudit.billingMinimumAdjustment = addRange(result.pricingAudit.billingMinimumAdjustment, {
      min: addMin,
      max: addMax
    });
  }
}

function applyAggregateContext(result, tarifs, quoteState) {
  applyContext(result, tarifs, { context: quoteState.context });
  result.contextMarkup = {
    min: result.context?.mode === "markup" ? result.billedEstimate.min - result.technicalValue.min : 0,
    max: result.context?.mode === "markup" ? result.billedEstimate.max - result.technicalValue.max : 0
  };
}

function aggregateQuote(config, quoteState) {
  const tarifs = config.tarifs || config;
  const prestations = config.prestations || {};
  const result = emptyAggregate(config);
  const sourceItems = Array.isArray(quoteState.items) ? quoteState.items : [];
  const people = Array.isArray(quoteState.people) ? quoteState.people : [];
  const trainingRequirements = collectGlobalTrainingRequirements(tarifs, quoteState);

  for (const quoteItem of sourceItems) {
    const request = prestations.requestTypes?.[quoteItem.requestType];
    if (!request) {
      result.warnings.push(`Prestation inconnue ignorée: ${quoteItem.requestType}`);
      continue;
    }
    const answers = cleanAnswersForRequest(prestations, quoteItem.requestType, {
      ...(quoteItem.answers || {}),
      requestType: quoteItem.requestType
    }, people);
    const errors = NIRSApp.validateItem ? NIRSApp.validateItem(prestations, quoteItem.requestType, answers) : {};
    if (Object.keys(errors).length > 0) {
      result.itemResults.push({
        itemId: quoteItem.id,
        requestType: quoteItem.requestType,
        status: "incomplete",
        label: request.label,
        technicalValue: { min: 0, max: 0 },
        items: [],
        exclusions: [],
        warnings: [`Prestation incomplète: ${Object.values(errors).join(" ")}`],
        assumptions: [],
        errors
      });
      result.warnings.push(`${request.label}: informations incomplètes, ligne non incluse dans le total.`);
      continue;
    }

    try {
      const line = calculateSingleQuote(tarifs, { ...answers, context: quoteState.context }, {
        applyCommonOptions: false,
        applyUrgency: false,
        applyBillingMinimum: false,
        applyContext: false,
        applyPreQuoteUncertainty: false,
        addDisclaimers: false,
        includeAutonomousTraining: false
      });
      line.itemId = quoteItem.id;
      line.requestType = quoteItem.requestType;
      line.label = request.label;
      line.answers = answers;
      line.summary = NIRSApp.describeAnswers ? NIRSApp.describeAnswers(config, quoteItem.requestType, answers) : request.label;
      if (quoteItem.requestType === "existing_model_predictions" && config.textes?.prediction) {
        line.warnings.push(...NIRSApp.predictionNotes(config, answers));
      }
      result.itemResults.push(line);
      result.technicalValue.min += line.technicalValue.min;
      result.technicalValue.max += line.technicalValue.max;
      result.items.push(...line.items.map((item) => ({ ...item, parentItemId: quoteItem.id, parentLabel: request.label })));
      if (Array.isArray(line.pricingAudit?.maintenance) && line.pricingAudit.maintenance.length) {
        result.pricingAudit.maintenance.push(...line.pricingAudit.maintenance.map((entry) => ({
          ...entry,
          parentItemId: quoteItem.id
        })));
      }
      result.exclusions.push(...line.exclusions);
      result.warnings.push(...line.warnings);
      result.assumptions.push(...line.assumptions);
    } catch (error) {
      result.itemResults.push({
        itemId: quoteItem.id,
        requestType: quoteItem.requestType,
        status: "incomplete",
        label: request.label,
        technicalValue: { min: 0, max: 0 },
        items: [],
        exclusions: [],
        warnings: [`Calcul impossible: ${error.message}`],
        assumptions: [],
        errors: { _global: error.message }
      });
      result.warnings.push(`${request.label}: ${error.message}`);
    }
  }

  addGlobalTrainingRequirements(result, tarifs, trainingRequirements);
  addChemometricOverlapWarning(result, sourceItems);
  stabilizeTechnicalRanges(result, tarifs);
  addAggregateUrgency(result, tarifs, quoteState);
  applyTechnicalDiscussionRanges(result, tarifs);
  applyAggregateContext(result, tarifs, quoteState);
  addAdministrativeFee(result, tarifs, quoteState);
  applyAggregateBillingMinimum(result, tarifs);

  result.technicalValue = roundRange(result.technicalValue, tarifs.rounding);
  result.billedEstimate = roundRange(result.billedEstimate, tarifs.rounding);
  result.inKindContribution = roundRange(result.inKindContribution, tarifs.rounding);
  result.contextMarkup = roundRange(result.contextMarkup, tarifs.rounding);
  result.inKindContributionBreakdown = roundNamedRanges(result.inKindContributionBreakdown, tarifs.rounding);
  if (result.partnershipBreakdown) result.partnershipBreakdown = roundNamedRanges(result.partnershipBreakdown, tarifs.rounding);
  for (const item of result.items) {
    if (Number.isFinite(item.unitPriceMin)) item.unitPriceMin = roundRange({ min: item.unitPriceMin, max: item.unitPriceMin }, tarifs.rounding).min;
    if (Number.isFinite(item.unitPriceMax)) item.unitPriceMax = roundRange({ min: item.unitPriceMax, max: item.unitPriceMax }, tarifs.rounding).max;
    if (Number.isFinite(item.totalMin)) item.totalMin = roundRange({ min: item.totalMin, max: item.totalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.totalMax)) item.totalMax = roundRange({ min: item.totalMax, max: item.totalMax }, tarifs.rounding).max;
    if (Number.isFinite(item.displayUnitPriceMin)) item.displayUnitPriceMin = roundRange({ min: item.displayUnitPriceMin, max: item.displayUnitPriceMin }, tarifs.rounding).min;
    if (Number.isFinite(item.displayUnitPriceMax)) item.displayUnitPriceMax = roundRange({ min: item.displayUnitPriceMax, max: item.displayUnitPriceMax }, tarifs.rounding).max;
    if (Number.isFinite(item.displayTotalMin)) item.displayTotalMin = roundRange({ min: item.displayTotalMin, max: item.displayTotalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.displayTotalMax)) item.displayTotalMax = roundRange({ min: item.displayTotalMax, max: item.displayTotalMax }, tarifs.rounding).max;
    if (Number.isFinite(item.technicalTotalMin)) item.technicalTotalMin = roundRange({ min: item.technicalTotalMin, max: item.technicalTotalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalTotalMax)) item.technicalTotalMax = roundRange({ min: item.technicalTotalMax, max: item.technicalTotalMax }, tarifs.rounding).max;
    if (Number.isFinite(item.billedTotalMin)) item.billedTotalMin = roundRange({ min: item.billedTotalMin, max: item.billedTotalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.billedTotalMax)) item.billedTotalMax = roundRange({ min: item.billedTotalMax, max: item.billedTotalMax }, tarifs.rounding).max;
    if (Number.isFinite(item.technicalReferenceUnitPrice)) item.technicalReferenceUnitPrice = roundRange({ min: item.technicalReferenceUnitPrice, max: item.technicalReferenceUnitPrice }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalReferenceTotal)) item.technicalReferenceTotal = roundRange({ min: item.technicalReferenceTotal, max: item.technicalReferenceTotal }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalDiscussionUnitPriceMin)) item.technicalDiscussionUnitPriceMin = roundRange({ min: item.technicalDiscussionUnitPriceMin, max: item.technicalDiscussionUnitPriceMin }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalDiscussionUnitPriceMax)) item.technicalDiscussionUnitPriceMax = roundRange({ min: item.technicalDiscussionUnitPriceMax, max: item.technicalDiscussionUnitPriceMax }, tarifs.rounding).max;
    if (Number.isFinite(item.technicalDiscussionTotalMin)) item.technicalDiscussionTotalMin = roundRange({ min: item.technicalDiscussionTotalMin, max: item.technicalDiscussionTotalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.technicalDiscussionTotalMax)) item.technicalDiscussionTotalMax = roundRange({ min: item.technicalDiscussionTotalMax, max: item.technicalDiscussionTotalMax }, tarifs.rounding).max;
    (item.costComponents || []).forEach((component) => {
      if (Number.isFinite(component.min)) component.min = roundRange({ min: component.min, max: component.min }, tarifs.rounding).min;
      if (Number.isFinite(component.max)) component.max = roundRange({ min: component.max, max: component.max }, tarifs.rounding).max;
      if (Number.isFinite(component.billedMin)) component.billedMin = roundRange({ min: component.billedMin, max: component.billedMin }, tarifs.rounding).min;
      if (Number.isFinite(component.billedMax)) component.billedMax = roundRange({ min: component.billedMax, max: component.billedMax }, tarifs.rounding).max;
    });
  }
  for (const item of result.itemResults) {
    if (item.technicalValue) item.technicalValue = roundRange(item.technicalValue, tarifs.rounding);
    if (item.billedEstimate) item.billedEstimate = roundRange(item.billedEstimate, tarifs.rounding);
    if (item.inKindContribution) item.inKindContribution = roundRange(item.inKindContribution, tarifs.rounding);
    for (const line of item.items || []) {
      if (Number.isFinite(line.unitPriceMin)) line.unitPriceMin = roundRange({ min: line.unitPriceMin, max: line.unitPriceMin }, tarifs.rounding).min;
      if (Number.isFinite(line.unitPriceMax)) line.unitPriceMax = roundRange({ min: line.unitPriceMax, max: line.unitPriceMax }, tarifs.rounding).max;
      if (Number.isFinite(line.totalMin)) line.totalMin = roundRange({ min: line.totalMin, max: line.totalMin }, tarifs.rounding).min;
      if (Number.isFinite(line.totalMax)) line.totalMax = roundRange({ min: line.totalMax, max: line.totalMax }, tarifs.rounding).max;
      if (Number.isFinite(line.displayUnitPriceMin)) line.displayUnitPriceMin = roundRange({ min: line.displayUnitPriceMin, max: line.displayUnitPriceMin }, tarifs.rounding).min;
      if (Number.isFinite(line.displayUnitPriceMax)) line.displayUnitPriceMax = roundRange({ min: line.displayUnitPriceMax, max: line.displayUnitPriceMax }, tarifs.rounding).max;
      if (Number.isFinite(line.displayTotalMin)) line.displayTotalMin = roundRange({ min: line.displayTotalMin, max: line.displayTotalMin }, tarifs.rounding).min;
      if (Number.isFinite(line.displayTotalMax)) line.displayTotalMax = roundRange({ min: line.displayTotalMax, max: line.displayTotalMax }, tarifs.rounding).max;
    }
  }
  reconcileBilledTotals(result);
  finalizePricingAudit(result);
  result.pricingAudit = roundPricingAudit(result.pricingAudit, tarifs.rounding);

  const hasIncomplete = result.itemResults.some((item) => item.status === "incomplete");
  const businessStatus = businessStatusFromItems(result.itemResults, result.items);
  result.status = hasIncomplete && businessStatus === "estimated" ? "partial" : businessStatus;
  applyBilledRangeLimit(result, tarifs);
  result.exclusions = [...new Set([...result.exclusions, ...tarifs.disclaimers])];
  result.warnings = [...new Set(result.warnings)];
  result.assumptions = [...new Set(result.assumptions)];
  return result;
}

function calculateQuote(configOrTarifs, quoteState) {
  if (quoteState.items || configOrTarifs.tarifs) {
    return aggregateQuote(configOrTarifs, quoteState || { items: [] });
  }
  return calculateSingleQuote(configOrTarifs, quoteState);
}

function assertNoDuplicateTrainingLines(result) {
  const seen = new Set();
  for (const requirement of result.trainingRequirements || []) {
    const key = `${requirement.personId}:${requirement.instrumentId}:${requirement.requirementType}`;
    if (seen.has(key)) throw new Error(`Formation dupliquée: ${key}`);
    seen.add(key);
  }
  return true;
}

function addChemometricOverlapWarning(result, sourceItems = []) {
  const maintenanceTypes = sourceItems
    .filter((item) => item.requestType === "model_maintenance")
    .map((item) => migratedMaintenanceType(item.answers?.maintenanceType))
    .filter((type) => ["performance_audit", "contextual_validation", "bias_correction", "model_update"].includes(type));
  const hasCalibration = sourceItems.some((item) => item.requestType === "validated_calibration");
  const unique = [...new Set(maintenanceTypes)];
  if (unique.length > 1 || (hasCalibration && unique.length)) {
    result.warnings.push("Certaines prestations sélectionnées peuvent correspondre à des étapes successives d'une même intervention. Le plateau vérifiera leur articulation afin d'éviter les doublons de périmètre.");
    result.pricingAudit = result.pricingAudit || {};
    result.pricingAudit.overlapWarnings = unique;
  }
}

NIRSApp.calculateQuote = calculateQuote;
NIRSApp.calculateSingleQuote = calculateSingleQuote;
NIRSApp.calculateAnnualDepreciation = calculateAnnualDepreciation;
NIRSApp.calculateInstrumentAnnualCost = calculateInstrumentAnnualCost;
NIRSApp.calculateMachineHalfDayCost = calculateMachineHalfDayCost;
NIRSApp.calculateSelfServiceHalfDayCost = calculateSelfServiceHalfDayCost;
NIRSApp.calculateAssistedHalfDayCost = calculateAssistedHalfDayCost;
NIRSApp.calculateAutonomousSupportedComponents = calculateAutonomousSupportedComponents;
NIRSApp.calculatePlateauOperatedComponents = calculatePlateauOperatedComponents;
NIRSApp.resolveInstrumentHalfDayPrice = resolveInstrumentHalfDayPrice;
NIRSApp.resolveConfiguredPrice = resolveConfiguredPrice;
NIRSApp.resolveAdministrativeFee = resolveAdministrativeFee;
NIRSApp.collectGlobalTrainingRequirements = collectGlobalTrainingRequirements;
NIRSApp.applyNegotiatedPartnershipContext = applyNegotiatedPartnershipContext;
NIRSApp.assertNoDuplicateTrainingLines = assertNoDuplicateTrainingLines;

})();
