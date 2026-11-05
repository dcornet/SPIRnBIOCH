import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

await import("../assets/js/generated-config.js");
await import("../assets/js/utils.js");
await import("../assets/js/validators.js");
await import("../assets/js/calculator.js");
await import("../assets/js/quote-renderer.js");
await import("../assets/js/pdf-export.js");
await import("../assets/js/xlsx-export.js");

const config = globalThis.NIRS_CONFIG;
const app = globalThis.NIRSApp;
const calculateQuote = app.calculateQuote;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function operator(instrument, status = "trained", date = "2026-07-01", id = "operator-1") {
  return {
    id,
    firstName: id === "operator-1" ? "Alice" : "Bruno",
    lastName: id === "operator-1" ? "Martin" : "Durand",
    email: id === "operator-1" ? "alice.martin@example.test" : "bruno.durand@example.test",
    trainingStatusByInstrument: { [instrument]: { status, date } },
    instrumentAssignments: {
      [instrument]: {
        assigned: true,
        trainingStatus: status,
        trainingDate: date,
        trainingRequested: false
      }
    }
  };
}

function participant(id = "participant-1", instrument = "viavi_micronir", status = "untrained", date = "") {
  return {
    id,
    firstName: "Alice",
    lastName: "Martin",
    email: "alice.martin@example.test",
    trainingStatusByInstrument: { [instrument]: { status, date } }
  };
}

function item(requestType, answers = {}) {
  const mergedAnswers = {
    ...app.defaultAnswersForRequest(config.prestations, requestType),
    ...(requestType === "spectra_acquisition" ? { samples: 100 } : {}),
    ...answers,
    requestType
  };
  if (requestType === "spectra_acquisition" && !mergedAnswers.measurementDevice) {
    mergedAnswers.measurementDevice = Object.keys(config.tarifs.spectralThroughputProfiles[mergedAnswers.instrument || "viavi_micronir"] || {})[0];
  }
  if (requestType === "spectra_acquisition" && ["self_service", "autonomous_supported"].includes(mergedAnswers.serviceMode) && !mergedAnswers.operators && !mergedAnswers.operatorIds) {
    mergedAnswers.operators = [operator(mergedAnswers.instrument || "viavi_micronir")];
  }
  if (requestType === "initial_training" && !mergedAnswers.participants && !mergedAnswers.participantIds) {
    mergedAnswers.participants = [participant("participant-1", mergedAnswers.instrument || "viavi_micronir")];
    mergedAnswers.people = 1;
  }
  if (requestType === "existing_model_predictions" && !mergedAnswers.comment) {
    mergedAnswers.comment = "Informations de test suffisantes pour préparer la discussion avec le plateau.";
  }
  if (requestType === "model_maintenance" && !mergedAnswers.maintenanceComment) {
    mergedAnswers.maintenanceComment = "";
  }
  if (requestType === "other_chemometrics" && !mergedAnswers.description) {
    mergedAnswers.description = "Informations de test suffisantes pour préparer la discussion avec le plateau.";
  }
  return { id: `item-${Math.random().toString(36).slice(2)}`, requestType, answers: mergedAnswers, completed: true };
}

function quote(items, overrides = {}) {
  const embeddedPeople = items
    .flatMap((entry) => [...(entry.answers.operators || []), ...(entry.answers.participants || [])])
    .filter(Boolean);
  return calculateQuote(config, {
    quoteId: "test-quote",
    context: "subcontracting",
    urgent: false,
    urgentSource: "none",
    people: embeddedPeople,
    items,
    ...overrides
  });
}

test("catalogue public avec quatre contextes ordonnes et sans aide ponctuelle", () => {
  const visibleContexts = Object.entries(config.tarifs.contexts)
    .filter(([, c]) => c.publicVisible !== false)
    .sort((left, right) => Number(left[1].order || 999) - Number(right[1].order || 999))
    .map(([id]) => id);
  assert.deepEqual(visibleContexts, ["internal_agap", "public_research_lab", "partnership", "subcontracting"]);
  assert.equal(config.tarifs.contexts.internal_agap.label, "UMR AGAP Institut — demande interne");
  assert.equal(config.tarifs.contexts.public_research_lab.costCoefficient.min, 1.1);
  assert.equal(config.tarifs.options.externalAdministrativeFee.contexts.public_research_lab.amount, 150);
  assert.equal(config.tarifs.contexts.partnership.mode, "negotiated_partnership");
  assert.equal(config.prestations.requestGroups.some((group) => group.orientation), false);
});

test("catalogue avec une carte par spectrometre et formations non ajoutables", () => {
  const cards = config.prestations.catalogCards;
  assert.equal(cards.filter((card) => card.requestType === "spectra_acquisition").length, 4);
  assert.equal(cards.find((card) => card.id === "training_instrument")?.catalogVisible, false);
  assert.equal(cards.find((card) => card.id === "training_theoretical_nirs")?.catalogVisible, false);
  assert.deepEqual(cards.filter((card) => card.categoryId === "chemometrics" && !card.disabled).map((card) => card.requestType), [
    "validated_calibration",
    "existing_model_predictions",
    "model_maintenance",
    "other_chemometrics"
  ]);
});

test("catalogue formule les prestations et référence les icônes locales", () => {
  const cardsById = Object.fromEntries(config.prestations.catalogCards.map((card) => [card.id, card]));
  assert.equal(cardsById.spectra_viavi_micronir.label, "VIAVI MicroNIR");
  assert.equal(cardsById.training_instrument.label, "Formation à un instrument");
  assert.equal(cardsById.training_theoretical_nirs.label, "Formation théorique NIRS");
  assert.equal(cardsById.calibrate.label, "Calibrer");
  assert.equal(cardsById.predict.label, "Prédire");
  assert.equal(cardsById.predict_with_reference, undefined);
  assert.equal(cardsById.maintain.label, "Vérifier et adapter un modèle");
  assert.equal(cardsById.other_chemometrics.label, "Autre demande");
  for (const card of config.prestations.catalogCards) {
    assert.match(card.description, /^(Acquérir|Apprendre|Construire|Utiliser|Vérifier|Décrire|Comprendre)\b/);
    assert.match(card.iconPath, /^\.\/assets\/icons\/[-a-z0-9]+\.(svg|png)$/);
    assert.equal(existsSync(path.join(rootDir, card.iconPath)), true, `${card.id} icon is missing`);
  }
});

test("menu entretenir expose cinq interventions et un seul commentaire public", () => {
  const request = config.prestations.requestTypes.model_maintenance;
  const field = request.fields.find((entry) => entry.id === "maintenanceType");
  assert.deepEqual(field.options.map((option) => option.value), [
    "performance_audit",
    "contextual_validation",
    "bias_correction",
    "model_update",
    "instrument_transfer"
  ]);
  const fieldIds = request.fields.map((entry) => entry.id);
  assert.deepEqual(fieldIds, ["maintenanceType", "maintenanceComment"]);
  assert.equal(request.fields.filter((entry) => entry.type === "textarea").length, 1);
  assert.equal(request.fields.find((entry) => entry.id === "maintenanceComment").required, false);
  assert.equal(request.fields.find((entry) => entry.id === "maintenanceComment").maxLength, 2000);
  assert.equal(Object.keys(request.maintenanceInterventions).length, 5);
  for (const [type, meta] of Object.entries(request.maintenanceInterventions)) {
    assert.equal(Array.isArray(meta.usefulInformation), true, type);
    assert.ok(meta.usefulInformation.length >= 7, type);
  }
  const labels = field.options.map((option) => option.label).join(" | ");
  assert.doesNotMatch(labels, /Autre entretien|Qualifier|etalonner/i);
  assert.ok(config.prestations.catalogCards.some((card) => card.requestType === "other_chemometrics" && !card.disabled));
});

test("validation entretien accepte uniquement type et commentaire vide", () => {
  for (const maintenanceType of ["performance_audit", "contextual_validation", "bias_correction", "model_update", "instrument_transfer"]) {
    const errors = app.validateItem(config.prestations, "model_maintenance", {
      requestType: "model_maintenance",
      maintenanceType,
      maintenanceComment: ""
    });
    assert.deepEqual(errors, {}, maintenanceType);
  }
});

test("transfert public ne depend plus de la classification automatique", () => {
  const result = quote([item("model_maintenance", {
    maintenanceType: "instrument_transfer",
    maintenanceComment: ""
  })], { context: "" });
  assert.equal(result.status, "estimated");
  const line = result.items.find((entry) => entry.id === "maintenance_instrument_transfer");
  assert.ok(line);
  assert.equal(line.pricingMode, "range");
  assert.equal(line.technicalReferenceTotal, 2000);
  assert.equal(line.totalMin, 1700);
  assert.equal(line.totalMax, 2300);
  assert.equal(line.discussionRangeRate, 0.15);
  assert.equal(line.requiresPlateauReview, true);
  assert.deepEqual(result.pricingAudit.maintenance[0].technicalDiscussionRange, { min: 1700, max: 2300 });
  assert.deepEqual(result.pricingAudit.maintenance[0].technicalReferenceAmount, { min: 2000, max: 2000 });
});

test("forfait de gestion ajoute une seule fois et vaut 150 en demande interne", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "viavi_micronir", halfDays: 1, operators: [operator("viavi_micronir")] }),
    item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "viavi_micronir", halfDays: 1, operators: [operator("viavi_micronir", "trained", "2026-07-01", "operator-2")] })
  ], { context: "internal_agap" });
  const fees = result.items.filter((line) => line.id === "global_external_administrative_fee");
  assert.equal(fees.length, 1);
  assert.equal(fees[0].label, "Forfait de gestion");
  assert.equal(fees[0].contextId, "internal_agap");
  assert.deepEqual({ min: fees[0].totalMin, max: fees[0].totalMax }, { min: 150, max: 150 });
});

test("forfait de gestion vaut 300 en sous-traitance et n'est pas majore", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "bruker_tango", halfDays: 1, measurementLocation: "transport_required" })
  ], { context: "subcontracting", urgent: true, urgentSource: "manual" });
  const fees = result.items.filter((line) => line.id === "global_external_administrative_fee");
  assert.equal(fees.length, 1);
  assert.equal(fees[0].label, "Forfait de gestion");
  assert.equal(fees[0].contextId, "subcontracting");
  assert.deepEqual({ min: fees[0].totalMin, max: fees[0].totalMax }, { min: 300, max: 300 });
  assert.ok(result.items.some((line) => line.id === "global_urgent_markup"));
  assert.ok(result.items.some((line) => line.id === "instrument_transport"));
  assert.equal(result.items.some((line) => line.id === "context_markup"), false);
  const assisted = result.items.find((line) => line.id === "plateau_operated_half_day");
  assert.ok(assisted.displayTotalMin > assisted.totalMin);
  assert.ok(assisted.displayTotalMax > assisted.totalMax);
});

test("forfait de gestion reste configurable en fixe fourchette et desactive", () => {
  assert.deepEqual(
    pickPrice(app.resolveConfiguredPrice({ enabled: true, pricingMode: "fixed", amount: 350 })),
    { min: 350, max: 350, pricingMode: "fixed" }
  );
  assert.deepEqual(
    pickPrice(app.resolveConfiguredPrice({ enabled: true, pricingMode: "range", min: 20, max: 40 })),
    { min: 20, max: 40, pricingMode: "range" }
  );
  assert.equal(app.resolveConfiguredPrice({ enabled: false, pricingMode: "fixed", amount: 1 }), null);
  assert.equal(app.resolveConfiguredPrice({ enabled: true, pricingMode: "range", min: 40, max: 20 }), null);
  assert.equal(app.resolveConfiguredPrice({ enabled: true, pricingMode: "fixed", amount: -1 }), null);

  const localConfig = structuredClone(config);
  localConfig.tarifs.options.externalAdministrativeFee.contexts.subcontracting.amount = 350;
  const result = calculateQuote(localConfig, {
    quoteId: "test-quote-json-admin",
    context: "subcontracting",
    urgent: false,
    urgentSource: "none",
    people: [],
    items: [item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "bruker_tango", halfDays: 1 })]
  });
  const fee = result.items.find((line) => line.id === "global_external_administrative_fee");
  assert.deepEqual({ min: fee.totalMin, max: fee.totalMax }, { min: 350, max: 350 });
});

function pickPrice(price) {
  return price ? { min: price.min, max: price.max, pricingMode: price.pricingMode } : null;
}

function assertClose(actual, expected, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function instrumentCost(instrumentId, serviceMode = "autonomous_supported", localConfig = config) {
  return app.resolveInstrumentHalfDayPrice(
    localConfig.tarifs.instruments[instrumentId],
    serviceMode,
    localConfig.tarifs.instrumentCostModelSettings
  );
}

test("modele de cout annuel instrument calcule les valeurs de controle", () => {
  const settings = config.tarifs.instrumentCostModelSettings;
  const expected = {
    viavi_micronir: { annual: 6435.71, machine: 26.82, self: 35, assisted: 292 },
    bruker_tango: { annual: 12021.43, machine: 50.09, self: 61, assisted: 315 },
    asd_labspec: { annual: 11307.14, machine: 47.11, self: 57, assisted: 312 },
    mir_perkin_elmer: { annual: 7035.71, machine: 29.32, self: 41, assisted: 297 }
  };

  for (const [instrumentId, values] of Object.entries(expected)) {
    const model = config.tarifs.instruments[instrumentId].costModel;
    assert.equal(model.enabled, true);
    assert.equal(model.version, "2026.1");
    assertClose(app.calculateInstrumentAnnualCost(model, settings), values.annual);
    assertClose(app.calculateMachineHalfDayCost(model, settings), values.machine);
    assert.equal(instrumentCost(instrumentId, "autonomous_supported").min, values.self);
    assert.equal(instrumentCost(instrumentId, "autonomous_supported").max, values.self);
    assert.equal(instrumentCost(instrumentId, "plateau_operated").min, values.assisted);
    assert.equal(instrumentCost(instrumentId, "plateau_operated").max, values.assisted);
  }
});

test("modele instrument reste adaptable depuis le JSON et conserve un mode manuel", () => {
  const localConfig = structuredClone(config);
  assert.equal(instrumentCost("bruker_tango", "autonomous_supported", localConfig).min, 61);

  localConfig.tarifs.instruments.bruker_tango.costModel.capacity.targetHalfDaysPerYear = 120;
  assert.ok(instrumentCost("bruker_tango", "autonomous_supported", localConfig).min > 61);
  localConfig.tarifs.instruments.bruker_tango.costModel.capacity.targetHalfDaysPerYear = 240;

  localConfig.tarifs.instruments.bruker_tango.costModel.annualCosts.maintenance += 2400;
  assert.ok(instrumentCost("bruker_tango", "autonomous_supported", localConfig).min > 61);
  localConfig.tarifs.instruments.bruker_tango.costModel.annualCosts.maintenance -= 2400;

  localConfig.tarifs.instruments.bruker_tango.costModel.purchase.workingValue += 7000;
  assert.ok(instrumentCost("bruker_tango", "autonomous_supported", localConfig).min > 61);
  localConfig.tarifs.instruments.bruker_tango.costModel.purchase.workingValue -= 7000;

  localConfig.tarifs.instruments.bruker_tango.costModel.directServiceCosts.assistedDirectStaffHourlyRate = 70;
  assert.equal(instrumentCost("bruker_tango", "plateau_operated", localConfig).min, 315);
  delete localConfig.tarifs.instruments.bruker_tango.costModel.directServiceCosts.assistedDirectStaffHourlyRate;

  localConfig.tarifs.instruments.bruker_tango.costModel.pricing.mode = "manual";
  localConfig.tarifs.instruments.bruker_tango.costModel.pricing.manualOverride.selfServiceHalfDay.amount = 123;
  assert.deepEqual(pickPrice(instrumentCost("bruker_tango", "autonomous_supported", localConfig)), { min: 123, max: 123, pricingMode: undefined });
  assert.equal(instrumentCost("bruker_tango", "autonomous_supported", localConfig).source, "manual");
  localConfig.tarifs.instruments.bruker_tango.costModel.pricing.mode = "cost_model";
  assert.equal(instrumentCost("bruker_tango", "autonomous_supported", localConfig).min, 61);
});

test("urgence fixe a 15 pourcent appliquee une seule fois et hors forfait de gestion", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "bruker_tango", halfDays: 1, operators: [operator("bruker_tango")] })
  ], { context: "", urgent: true, urgentSource: "manual" });
  const urgency = result.items.filter((line) => line.id === "global_urgent_markup");
  assert.equal(urgency.length, 1);
  assert.equal(urgency[0].totalMin, 8);
  assert.ok(urgency[0].totalMax >= urgency[0].totalMin);
});

test("reservation autonome et accompagnee utilise le modele de cout a la demi-journee", () => {
  const auto = quote([item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "bruker_tango", halfDays: 2, operators: [operator("bruker_tango")] })], { context: "" });
  const autoLine = auto.items.find((line) => line.id === "autonomous_supported_half_day");
  assert.equal(autoLine.quantity, 2);
  assert.equal(autoLine.technicalReferenceUnitPrice, 61);
  assert.equal(autoLine.technicalReferenceTotal, 122);
  assert.equal(autoLine.unitPriceMin, 52);
  assert.equal(autoLine.totalMin, 104);
  assert.equal(autoLine.pricingSource, "cost_model");
  assert.equal(autoLine.costBasis.modelVersion, "2026.1");
  assert.equal(autoLine.costBasis.roundedHalfDayPrice, 61);
  const assisted = quote([item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "bruker_tango", halfDays: 2 })], { context: "" });
  const assistedLine = assisted.items.find((line) => line.id === "plateau_operated_half_day");
  assert.equal(assistedLine.quantity, 2);
  assert.equal(assistedLine.technicalReferenceUnitPrice, 315);
  assert.equal(assistedLine.technicalReferenceTotal, 630);
  assert.equal(assistedLine.unitPriceMin, 268);
  assert.equal(assistedLine.totalMin, 536);
});

test("capacite spectrale indicative selon le dispositif et 4 heures par demi-journee", () => {
  const cases = [
    ["asd_labspec", "contact_probe_2cm", 3200, 4000],
    ["asd_labspec", "clamp", 2400, 3200],
    ["asd_labspec", "microprobe_03cm", 2400, 3200],
    ["viavi_micronir", "direct_measurement", 3200, 4000],
    ["viavi_micronir", "tablet_probe", 3200, 4000],
    ["viavi_micronir", "vial_holder", 800, 1600],
    ["viavi_micronir", "liquid_drop_adapter", 600, 1000],
    ["bruker_tango", "direct_measurement", 3200, 4000],
    ["bruker_tango", "cup_5cm", 1200, 2400],
    ["bruker_tango", "cup_9cm", 1200, 2400],
    ["bruker_tango", "vial_or_bottle", 800, 1600],
    ["mir_perkin_elmer", "diamond_atr", 600, 1000]
  ];
  for (const [instrument, measurementDevice, min, max] of cases) {
    const result = quote([item("spectra_acquisition", { serviceMode: "plateau_operated", instrument, measurementDevice, halfDays: 10 })], { context: "" });
    assert.equal(result.itemResults[0].estimatedSpectralCapacity.min, min);
    assert.equal(result.itemResults[0].estimatedSpectralCapacity.max, max);
    assert.equal(result.itemResults[0].estimatedSpectralCapacity.hoursPerHalfDay, 4);
    assert.equal(result.itemResults[0].estimatedSpectralCapacity.unit, "spectrum");
  }
});

test("contextes publics referencent les icones locales", () => {
  for (const [id, context] of Object.entries(config.tarifs.contexts).filter(([, c]) => c.publicVisible !== false)) {
    assert.match(context.iconPath, /^\.\/assets\/images\/contextes\/[-a-z0-9]+\.png$/, id);
    assert.equal(existsSync(path.join(rootDir, context.iconPath)), true, `${id} context icon is missing`);
  }
  const trainingGroup = config.prestations.requestGroups.find((group) => group.id === "training");
  assert.equal(trainingGroup.catalogInfoOnly, true);
  assert.match(trainingGroup.description, /Formations théoriques/);
});

test("capacite MicroNIR mesure directe est indicative et non nulle", () => {
  const result = quote([item("spectra_acquisition", {
    serviceMode: "plateau_operated",
    instrument: "viavi_micronir",
    measurementDevice: "direct_measurement",
    halfDays: 1
  })], { context: "" });
  const capacity = result.itemResults[0].estimatedSpectralCapacity;
  assert.equal(capacity.requiresValidation, true);
  assert.equal(capacity.min, 320);
  assert.equal(capacity.max, 400);
  assert.deepEqual(capacity.ratePerHour, { min: 80, max: 100 });
});

test("capacite spectrale MIR affichee en utilisation accompagnee", () => {
  const result = quote([item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "mir_perkin_elmer", measurementDevice: "diamond_atr", halfDays: 10 })], { context: "" });
  assert.equal(result.itemResults[0].estimatedSpectralCapacity.min, 600);
  assert.equal(result.itemResults[0].estimatedSpectralCapacity.max, 1000);
});

test("capacite spectrale ne pre-remplit pas les echantillons reels de calibration", () => {
  const calibration = item("validated_calibration", { samples: 12, replicates: 2 });
  assert.equal(calibration.answers.samples, 12);
  assert.equal(calibration.answers.replicates, 2);
  assert.notEqual(calibration.answers.samples, 1000);
});

test("volume d’acquisition obligatoire, répétitions facultatives et absence d’effet tarifaire", () => {
  const base = item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "asd_labspec", halfDays: 2 });
  assert.equal(base.answers.replicates, 2);
  for (const samples of [undefined, "", 0, -1, 1.5]) {
    const errors = app.validateItem(config.prestations, base.requestType, { ...base.answers, samples });
    assert.ok(errors.samples, String(samples));
  }
  const first = quote([base]);
  const changed = quote([{ ...base, answers: { ...base.answers, samples: 1000, replicates: 10 } }]);
  const emptyReplicates = quote([{ ...base, answers: { ...base.answers, replicates: "" } }]);
  assert.equal(first.itemResults[0].status, "estimated");
  assert.deepEqual(first.billedEstimate, changed.billedEstimate);
  assert.deepEqual(first.billedEstimate, emptyReplicates.billedEstimate);
  const exported = app.buildQuoteExport({ items: [base] }, first);
  assert.equal(exported.configuredItems[0].answers.samples, 100);
  assert.equal(exported.configuredItems[0].answers.replicates, 2);
  const vm = app.buildPdfViewModel(config, { quoteId: "volume-test", requester: { unit: "AGAP" }, items: [base] }, first, { documentOptions: { storage: null, sequenceNumber: 1 } });
  assert.match(vm.serviceSummaries[0], /100 échantillon\(s\) estimé\(s\)/);
  assert.match(vm.serviceSummaries[0], /2 répétition\(s\)/);
  assert.ok(vm.acquisitionClauses.includes(config.textes.acquisition.reservationReview));
});

test("migration des volumes historiques et re-sélection explicite de l’ancienne fibre ASD", () => {
  const old = { instrument: "asd_labspec", measurementDevice: "optical_fiber", legacySpectraDetails: { samples: 42, replicates: 3 } };
  const restored = app.restoreAcquisitionDetails(old);
  assert.equal(restored.samples, 42);
  assert.equal(restored.replicates, 3);
  assert.equal(restored.measurementDevice, "");
  assert.equal(restored.measurementDeviceNeedsReview, true);
  assert.equal(old.measurementDevice, "optical_fiber");
  const clean = app.pruneHiddenAnswers(config.prestations, "spectra_acquisition", restored);
  assert.equal(clean.legacyMeasurementDevice, "optical_fiber");
  assert.equal(clean.measurementDeviceNeedsReview, true);
  assert.equal(clean.samples, 42);
  assert.equal(clean.replicates, 3);
});

test("prédiction : limites et politique de restitution présentes dans le résumé, le JSON et le PDF", () => {
  const prediction = item("existing_model_predictions");
  const state = { quoteId: "prediction-test", requester: { unit: "AGAP" }, items: [prediction] };
  const result = quote([prediction]);
  const exported = app.buildQuoteExport(state, result);
  const vm = app.buildPdfViewModel(config, state, result, { documentOptions: { storage: null, sequenceNumber: 1 } });
  for (const note of [config.textes.prediction.conformity, config.textes.prediction.withoutReference, config.textes.prediction.releasePolicy]) {
    assert.ok(result.warnings.includes(note));
    assert.ok(exported.warnings.includes(note));
    assert.ok(vm.predictionClauses.includes(note));
    assert.ok(app.buildSummary(state, result, config).includes(note));
  }
});

test("calibration ne demande plus si les analyses de reference existent", () => {
  const fields = config.prestations.requestTypes.validated_calibration.fields.map((field) => field.id);
  assert.equal(fields.includes("referenceAnalysesExist"), false);
  const result = quote([item("validated_calibration", {
    properties: 1,
    samples: 120,
    replicates: 1,
    dataPreparationRequired: false
  })], { context: "" });
  assert.equal(result.warnings.some((warning) => /analyses de référence devront/i.test(warning)), false);
});


test("migration des heures et jours vers demi-journees", () => {
  const fromHours = app.pruneHiddenAnswers(config.prestations, "spectra_acquisition", { requestType: "spectra_acquisition", serviceMode: "autonomous_supported", instrument: "bruker_tango", hours: 5 });
  assert.equal(fromHours.halfDays, 2);
  const fromDays = app.pruneHiddenAnswers(config.prestations, "spectra_acquisition", { requestType: "spectra_acquisition", serviceMode: "autonomous_supported", instrument: "asd_labspec", reservedDays: 3 });
  assert.equal(fromDays.halfDays, 6);
});

test("transport instrument est un forfait fixe non majore pour TANGO et LabSpec", () => {
  const bruker = quote([item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "bruker_tango", halfDays: 1, measurementLocation: "transport_required" })], { context: "" });
  const transport = bruker.items.find((line) => line.id === "instrument_transport");
  assert.ok(transport);
  assert.equal(transport.totalMin, 150);
  assert.equal(transport.totalMax, 150);
  assert.equal(transport.applyContextCoefficient, false);
  const labspec = quote([item("spectra_acquisition", {
    serviceMode: "autonomous_supported",
    instrument: "asd_labspec",
    halfDays: 2,
    measurementLocation: "transport_required",
    operators: [operator("asd_labspec", "untrained")]
  })], { context: "subcontracting" });
  const labspecReservation = labspec.items.find((line) => line.id === "autonomous_supported_half_day");
  const labspecTransport = labspec.items.find((line) => line.id === "instrument_transport");
  const labspecTraining = labspec.items.find((line) => line.id.startsWith("global_initial_training_asd_labspec"));
  const labspecFee = labspec.items.find((line) => line.id === "global_external_administrative_fee");
  assert.equal(labspecReservation.technicalReferenceTotal, 114);
  assert.equal(labspecReservation.totalMin, 97);
  assert.equal(labspecTransport.totalMin, 150);
  assert.equal(labspecTransport.displayTotalMin, 150);
  assert.ok(labspecTraining.totalMin > 0);
  assert.equal(labspecFee.totalMin, 300);
  const mir = quote([item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "mir_perkin_elmer", halfDays: 1, measurementLocation: "transport_required" })], { context: "" });
  assert.equal(mir.items.some((line) => line.id === "instrument_transport"), false);
});

test("contextes appliques apres le cout technique instrument", () => {
  const internal = quote([
    item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "mir_perkin_elmer", halfDays: 1 })
  ], { context: "internal_agap" });
  assert.equal(internal.itemResults[0].technicalValue.min, 252);
  assert.equal(internal.technicalValue.min, 252);
  assert.ok(internal.billedEstimate.min >= internal.technicalValue.min);
  assert.ok(internal.billedEstimate.max > internal.technicalValue.min);

  const partnership = quote([
    item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "mir_perkin_elmer", halfDays: 1 })
  ], { context: "partnership", project: { partnershipProjectName: "Projet" } });
  assert.equal(partnership.context.mode, "negotiated_partnership");
  assert.equal(partnership.partnershipBreakdown.billedShare.min, 1);
  assert.equal(partnership.partnershipBreakdown.billedShare.max, 1);
  assert.ok(partnership.partnershipBreakdown.offeredPersonnel.min > 0);
  assert.ok(partnership.partnershipBreakdown.negotiableBase.min > 0);
  assert.ok(partnership.partnershipBreakdown.billedEstimateBeforeAdministrativeFee.min > 0);
  assert.ok(partnership.billedEstimate.min >= 150);
  const partnershipLine = partnership.items.find((line) => line.id === "plateau_operated_half_day");
  assert.equal(partnershipLine.costComponents.find((component) => component.category === "instrument_staff").billedMin, 0);
  assert.match(partnershipLine.contextNote, /personnel apporté/);

  const subcontracting = quote([
    item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "mir_perkin_elmer", halfDays: 1 })
  ], { context: "subcontracting" });
  const line = subcontracting.items.find((itemLine) => itemLine.id === "plateau_operated_half_day");
  assert.equal(line.technicalReferenceTotal, 297);
  assert.equal(line.totalMin, 252);
  assert.ok(line.displayTotalMin > line.totalMin);
  assert.ok(line.displayTotalMax > line.displayTotalMin);
  assertClose(
    app.calculateInstrumentAnnualCost(config.tarifs.instruments.mir_perkin_elmer.costModel, config.tarifs.instrumentCostModelSettings),
    7035.71
  );
});

test("partenariat offre les formations et conserve leur valeur technique", () => {
  const person = operator("viavi_micronir", "untrained", "", "operator-partner");
  const result = quote([
    item("spectra_acquisition", {
      serviceMode: "autonomous_supported",
      instrument: "viavi_micronir",
      halfDays: 1,
      operators: [person]
    })
  ], {
    context: "partnership",
    project: { partnershipProjectName: "Projet" },
    people: [person]
  });
  const training = result.items.find((line) => line.configRule === "instrumentTraining");
  assert.ok(training);
  assert.equal(training.technicalTotalMin, 150);
  assert.equal(training.billedTotalMin, 0);
  assert.equal(training.offeredByPlatform, true);
  assert.equal(training.contextNote, "Formation offerte dans le cadre du partenariat");
  assert.equal(result.partnershipBreakdown.offeredTraining.min, 150);
});

test("partenariat garde la chimiometrie dans la base negociable", () => {
  const result = quote([
    item("existing_model_predictions", {
      instrument: "bruker_tango",
      spectra: 100,
      models: 3,
      spectraAlreadyAcquired: true
    })
  ], {
    context: "partnership",
    project: { partnershipProjectName: "Projet" }
  });
  const prediction = result.itemResults[0];
  assert.equal(prediction.offeredByPlatform, undefined);
  assert.equal(prediction.technicalValue.min, 213);
  assert.ok(prediction.billedEstimate.min > 0);
  assert.ok(result.partnershipBreakdown.negotiableBase.min > 0);
});

test("partenariat place la calibration dans la base negociable", () => {
  const result = quote([
    item("validated_calibration", {
      properties: 1,
      samples: 120,
      replicates: 1,
      dataPreparationRequired: false
    })
  ], {
    context: "partnership",
    project: { partnershipProjectName: "Projet" }
  });
  const line = result.items.find((entry) => entry.id === "validated_calibration");
  assert.equal(line.costComponents.find((component) => component.category === "scientific_expertise").min, 638);
  assert.equal(line.costComponents.find((component) => component.category === "computing_infrastructure").min, 638);
  assert.equal(result.partnershipBreakdown.offeredPersonnel.min, 0);
  assert.equal(result.partnershipBreakdown.negotiableBase.min, 1275);
  assert.ok(result.partnershipBreakdown.billedEstimateBeforeAdministrativeFee.min > 0);
  assert.equal(result.itemResults[0].offeredByPlatform, undefined);
});

test("partenariat place le transfert simplifie dans la base negociable", () => {
  const result = quote([
    item("model_maintenance", {
      maintenanceType: "instrument_transfer",
      maintenanceComment: "Transfert complet avec echantillons apparies, valeurs de reference et validation cible."
    })
  ], {
    context: "partnership",
    project: { partnershipProjectName: "Projet" }
  });
  const line = result.items.find((entry) => entry.id === "maintenance_instrument_transfer");
  assert.equal(line.partnershipTreatment, "negotiated");
  assert.equal(result.partnershipBreakdown.offeredPersonnel.min, 0);
  assert.equal(result.partnershipBreakdown.negotiableBase.min, 1700);
  assert.equal(result.partnershipBreakdown.negotiableBase.max, 2300);
  assert.ok(result.partnershipBreakdown.billedEstimateBeforeAdministrativeFee.min > 0);
  assert.ok(result.itemResults[0].billedEstimate.min > 0);
});

test("formation recente sans cout, ancienne a 50 pourcent, non forme initiale", () => {
  const project = { plannedStartDate: "2026-10-01" };
  const recent = quote([item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "viavi_micronir", halfDays: 1, operators: [operator("viavi_micronir", "trained", "2026-07-01")] })], { context: "", project });
  assert.equal(recent.items.some((line) => line.id.startsWith("global_initial_training_") || line.id.startsWith("global_refresher_training_")), false);
  const old = quote([item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "viavi_micronir", halfDays: 1, operators: [operator("viavi_micronir", "trained", "2024-01-01")] })], { context: "", project });
  assert.ok(old.items.find((line) => line.id.startsWith("global_refresher_training_viavi_micronir")));
  const untrained = quote([item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "viavi_micronir", halfDays: 1, operators: [operator("viavi_micronir", "untrained", "", "operator-2")] })], { context: "", project });
  assert.ok(untrained.items.find((line) => line.id.startsWith("global_initial_training_viavi_micronir")));
});

test("realisation par le plateau ne declenche pas de formation demandeur", () => {
  const project = { plannedStartDate: "2026-10-01" };
  const person = operator("bruker_tango", "trained", "2024-01-01");
  person.instrumentAssignments.bruker_tango.trainingRequested = false;
  const result = quote([
    item("spectra_acquisition", {
      serviceMode: "plateau_operated",
      instrument: "bruker_tango",
      measurementDevice: "direct_measurement",
      halfDays: 1
    })
  ], { context: "", project, people: [person] });
  const refresher = result.items.find((line) => line.id.startsWith("global_refresher_training_bruker_tango"));
  assert.equal(refresher, undefined);
});

test("formations utilisent un montant fixe base sur la valeur basse", () => {
  const project = { plannedStartDate: "2026-10-01" };
  const result = quote([
    item("spectra_acquisition", {
      serviceMode: "autonomous_supported",
      instrument: "asd_labspec",
      halfDays: 1,
      operators: [
        operator("asd_labspec", "untrained", "", "operator-1"),
        operator("asd_labspec", "trained", "2024-01-01", "operator-2")
      ]
    })
  ], { context: "", project });
  const initial = result.items.find((line) => line.id.startsWith("global_initial_training_asd_labspec"));
  const refresher = result.items.find((line) => line.id.startsWith("global_refresher_training_asd_labspec"));
  assert.equal(initial.unitPriceMin, 250);
  assert.equal(initial.unitPriceMax, 250);
  assert.equal(initial.totalMin, 250);
  assert.equal(initial.totalMax, 250);
  assert.equal(refresher.unitPriceMin, 125);
  assert.equal(refresher.unitPriceMax, 125);
  assert.equal(refresher.totalMin, 125);
  assert.equal(refresher.totalMax, 125);
});

test("chaque spectrometre selectionne doit avoir un utilisateur associe", () => {
  const state = {
    project: { plannedStartDate: "2026-10-01" },
    people: [
      {
        id: "person-1",
        firstName: "Alice",
        lastName: "Martin",
        email: "alice.martin@example.test",
        instrumentAssignments: {
          bruker_tango: {
            assigned: true,
            trainingStatus: "trained",
            trainingDate: "2026-07-01",
            trainingRequested: false
          }
        }
      }
    ],
    items: [
      item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "bruker_tango", measurementDevice: "direct_measurement", halfDays: 1 }),
      item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "mir_perkin_elmer", measurementDevice: "diamond_atr", halfDays: 1 })
    ]
  };
  const validation = app.validateGlobalSpectraUsers(state, config);
  assert.equal(validation.valid, false);
  assert.match(validation.errors["instruments.mir_perkin_elmer"], /PerkinElmer/);
});

test("preparation des donnees calcule un forfait par tranche selon les scans", () => {
  const result = quote([item("validated_calibration", { properties: 1, samples: 200, replicates: 2, dataPreparationRequired: true })], { context: "" });
  const prep = result.items.find((line) => line.id === "chemometric_data_preparation");
  assert.equal(prep.quantity, 1);
  assert.equal(prep.scans, 400);
  assert.equal(prep.technicalReferenceTotal, 200);
  assert.equal(prep.totalMin, 170);
  assert.equal(prep.totalMax, 230);
});

test("preparation des donnees non cochee avertit sans ligne de nettoyage", () => {
  const result = quote([item("validated_calibration", { properties: 1, samples: 120, replicates: 3, dataPreparationRequired: false })], { context: "" });
  assert.equal(result.items.some((line) => line.id === "chemometric_data_preparation"), false);
  assert.ok(result.warnings.some((warning) => /données sont directement exploitables/.test(warning)));
});

test("calibration utilise les echantillons independants et un supplement par trait", () => {
  const result = quote([item("validated_calibration", { properties: 3, samples: 120, replicates: 1, dataPreparationRequired: false })], { context: "" });
  const base = result.items.find((line) => line.id === "validated_calibration");
  const extra = result.items.find((line) => line.id === "validated_calibration_additional_trait");
  assert.equal(base.quantity, 1);
  assert.equal(base.unit, "database");
  assert.equal(base.scans, 120);
  assert.equal(base.samples, 120);
  assert.equal(base.technicalReferenceTotal, 1500);
  assert.equal(base.totalMin, 1275);
  assert.equal(base.totalMax, 1725);
  assert.equal(extra.quantity, 2);
  assert.equal(extra.technicalReferenceTotal, 600);
  assert.equal(extra.totalMin, 510);
  assert.equal(extra.totalMax, 690);
  assert.match(base.reason, /120 échantillon/);
  assert.match(extra.reason, /2 trait/);
});

test("note explicative calibration disponible pour le résumé et le PDF", () => {
  const note = config.textes.pdf.calibrationNote;
  assert.equal(note.title, "Calibration chimiométrique");
  assert.ok(note.paragraphs.some((paragraph) => /nirs4all/.test(paragraph)));
  assert.ok(note.paragraphs.some((paragraph) => /AOM-PLS/.test(paragraph)));
});

test("calibration utilise la tranche d'echantillons independants sans multiplier les matrices legacy", () => {
  const result = app.calculateSingleQuote(config.tarifs, {
    requestType: "validated_calibration",
    properties: 1,
    matrices: 2,
    samples: 500,
    replicates: 2,
    dataPreparationRequired: false
  });
  const base = result.items.find((line) => line.id === "validated_calibration");
  assert.equal(base.quantity, 1);
  assert.equal(base.scans, 1000);
  assert.equal(base.samples, 500);
  assert.equal(base.technicalReferenceTotal, 2000);
  assert.equal(base.totalMin, 1700);
  assert.equal(base.totalMax, 2300);
  assert.ok(result.warnings.some((warning) => /plusieurs matrices/.test(warning)));
});

test("calibration applique les nouvelles tranches et laisse plus de 2000 sur devis", () => {
  const low = quote([item("validated_calibration", { properties: 1, samples: 200, replicates: 5, dataPreparationRequired: false })], { context: "" });
  assert.equal(low.items.find((line) => line.id === "validated_calibration").technicalReferenceTotal, 1500);
  const middle = quote([item("validated_calibration", { properties: 1, samples: 500, replicates: 1, dataPreparationRequired: false })], { context: "" });
  assert.equal(middle.items.find((line) => line.id === "validated_calibration").technicalReferenceTotal, 2000);
  const high = quote([item("validated_calibration", { properties: 1, samples: 1000, replicates: 1, dataPreparationRequired: false })], { context: "" });
  assert.equal(high.items.find((line) => line.id === "validated_calibration").technicalReferenceTotal, 2500);
  const quoteRequired = quote([item("validated_calibration", { properties: 1, samples: 2501, replicates: 1, dataPreparationRequired: false })], { context: "" });
  assert.ok(quoteRequired.items.some((line) => line.id === "validated_calibration" && line.pricingMode === "quote"));
});

test("prestations d'entretien utilisent directement leurs montants de référence avec fourchette standard sans seconde marge", () => {
  const expected = {
    performance_audit: [1000, 850, 1150],
    contextual_validation: [1650, 1403, 1898],
    bias_correction: [1000, 850, 1150],
    model_update: [2500, 2125, 2875],
    instrument_transfer: [2000, 1700, 2300]
  };
  for (const [maintenanceType, [reference, min, max]] of Object.entries(expected)) {
    const result = quote([item("model_maintenance", { maintenanceType, maintenanceComment: "" })], { context: "" });
    const line = result.items.find((entry) => entry.id === `maintenance_${maintenanceType}`);
    assert.ok(line, maintenanceType);
    assert.equal(line.technicalReferenceTotal, reference, maintenanceType);
    assert.equal(line.totalMin, min, maintenanceType);
    assert.equal(line.totalMax, max, maintenanceType);
    assert.equal(line.technicalDiscussionTotalMin, min, maintenanceType);
    assert.equal(line.technicalDiscussionTotalMax, max, maintenanceType);
    assert.equal(line.discussionRangeRate, 0.15, maintenanceType);
    assert.equal(line.pricingMode, "range", maintenanceType);
    assert.equal(line.pricingConfidence, "low", maintenanceType);
    assert.equal(line.requiresPlateauReview, true, maintenanceType);
  }
});

test("sous-traitance applique le contexte aux entretiens sans afficher le coefficient", () => {
  const result = quote([item("model_maintenance", { maintenanceType: "instrument_transfer", maintenanceComment: "" })], { context: "subcontracting" });
  const line = result.items.find((entry) => entry.id === "maintenance_instrument_transfer");
  assert.equal(line.billedTotalMin, 2295);
  assert.equal(line.billedTotalMax, 3105);
  assert.equal(result.pricingAudit.maintenance[0].contextCoefficient, 1.35);
  assert.deepEqual(result.pricingAudit.maintenance[0].billedRange, { min: 2295, max: 3105 });
});

test("prediction superieure a 10000 spectres reste sur devis", () => {
  const result = quote([item("existing_model_predictions", { spectra: 10001, models: 1, spectraAlreadyAcquired: true })], { context: "" });
  assert.ok(result.items.some((line) => line.id === "existing_model_predictions" && line.pricingMode === "quote"));
});

test("tarifs de prediction utilisent la formule et une fourchette de 15 pourcent", () => {
  const result = quote([
    item("existing_model_predictions", {
      spectra: 100,
      models: 1,
      spectraAlreadyAcquired: true
    })
  ], { context: "subcontracting" });
  const prediction = result.items.find((line) => line.id === "existing_model_predictions");
  assert.equal(prediction.technicalReferenceTotal, 250);
  assert.equal(prediction.totalMin, 213);
  assert.equal(prediction.totalMax, 288);
  assert.equal(prediction.discussionRangeRate, 0.15);
  assert.ok(result.billedEstimate.min < result.billedEstimate.max);
});

test("les politiques de fourchette sont explicites selon la famille de prestation", () => {
  const result = quote([
    item("existing_model_predictions", { spectra: 100, models: 3, spectraAlreadyAcquired: true }),
    item("model_maintenance", { maintenanceType: "instrument_transfer", maintenanceComment: "Transfert à cadrer avec le plateau." }),
    item("validated_calibration", { properties: 2, samples: 120, replicates: 2, dataPreparationRequired: true })
  ], { context: "" });
  const prediction = result.items.find((line) => line.id === "existing_model_predictions");
  const maintenance = result.items.find((line) => line.id === "maintenance_instrument_transfer");
  const calibration = result.items.find((line) => line.id === "validated_calibration");
  const preparation = result.items.find((line) => line.id === "chemometric_data_preparation");
  assert.equal(prediction.discussionRangeRate, 0.15);
  assert.equal(maintenance.discussionRangeRate, 0.15);
  assert.equal(calibration.discussionRangeRate, 0.15);
  assert.equal(preparation.discussionRangeRate, 0.15);
});

test("prediction ajoute la preparation et le nettoyage des donnees", () => {
  const result = quote([
    item("existing_model_predictions", {
      spectra: 100,
      models: 1,
      spectraAlreadyAcquired: true,
      dataPreparationRequired: true
    })
  ], { context: "" });
  const prep = result.items.find((line) => line.id === "chemometric_data_preparation");
  assert.ok(prep);
  assert.equal(prep.label, "Préparation et nettoyage des données");
  assert.equal(prep.technicalReferenceTotal, 200);
  assert.equal(prep.totalMin, 170);
  assert.equal(prep.scans, 100);
  assert.equal(result.items.some((line) => line.id === "quality_control"), false);
});

test("chimie humide : tarifs par contexte, quantité fixée à 10 % arrondie au supérieur", () => {
  const amounts = { internal_agap: 10, public_research_lab: 40, partnership: 20, subcontracting: 50 };
  for (const [context, amount] of Object.entries(amounts)) {
    const prediction = item("existing_model_predictions", {
      predictionMode: "with_reference", spectra: 303, replicates: 3, models: 3, referenceProperties: ["starch", "protein", "starch"]
    });
    const result = quote([prediction], { context, urgent: true });
    const starch = result.items.find((line) => line.id === "prediction_reference_starch");
    const protein = result.items.find((line) => line.id === "prediction_reference_protein");
    assert.ok(starch, JSON.stringify(result.warnings));
    assert.equal(result.items.filter((line) => line.configRule === "predictionReferenceAnalyses").length, 2);
    assert.deepEqual(starch.referenceAnalysis.quantity, { min: 11, max: 11 });
    assert.equal(starch.quantity, 11);
    assert.equal(starch.quantityMax, 11);
    assert.equal(starch.unitPriceMin, amount);
    assert.equal(starch.unitPriceMax, amount);
    assert.equal(starch.totalMin, 11 * amount);
    assert.equal(starch.totalMax, 11 * amount);
    assert.equal(starch.billedTotalMin, 11 * amount);
    assert.equal(starch.billedTotalMax, 11 * amount);
    assert.equal(protein.billedTotalMin, 550);
    assert.equal(protein.billedTotalMax, 550);
    assert.deepEqual(starch.contextCoefficient, { min: 1, max: 1 });
    assert.equal(starch.discussionRangeRate, 0);
    const without = quote([item("existing_model_predictions", { spectra: 303, models: 3 })], { context, urgent: true });
    const urgency = (quote) => quote.items.filter((line) => line.id === "global_urgent_markup").map((line) => [line.totalMin, line.totalMax]);
    assert.deepEqual(urgency(result), urgency(without), context);
  }
});

test("chimie humide : nombre d’échantillons distinct des spectres et absence de double arrondi", () => {
  for (const [samples, quantities] of [[1, [1, 1]], [11, [2, 2]], [70, [7, 7]], [100, [10, 10]]]) {
    const result = quote([item("existing_model_predictions", {
      predictionMode: "with_reference", spectra: samples * 3, replicates: 3, referenceProperties: ["starch"]
    })], { context: "internal_agap" });
    const line = result.items.find((line) => line.id === "prediction_reference_starch");
    assert.deepEqual([line.quantity, line.quantityMax], quantities, String(samples));
  }
});

test("chimie humide : validation conditionnelle, autres propriétés sur devis et anciens brouillons", () => {
  const base = item("existing_model_predictions", { predictionMode: "with_reference", replicates: 1, spectra: 100, referenceProperties: ["starch"] });
  for (const [field, value] of [["replicates", ""], ["replicates", 0], ["replicates", 1.5], ["referenceProperties", []], ["referenceProperties", ["unknown"]], ["referenceProperties", ["starch", "protein"]]]) {
    assert.ok(app.validateItem(config.prestations, base.requestType, { ...base.answers, [field]: value })[field]);
  }
  assert.deepEqual(app.validateItem(config.prestations, base.requestType, { ...base.answers, predictionMode: "without_reference", samples: "", referenceProperties: [] }), {});
  const old = { ...base.answers };
  delete old.predictionMode;
  const restored = app.pruneHiddenAnswers(config.prestations, base.requestType, old);
  assert.equal(restored.predictionMode, "without_reference");
  assert.equal(restored.samples, 100);
  assert.equal(restored.referenceProperties, undefined);
  const other = quote([item("existing_model_predictions", { predictionMode: "with_reference", samples: 100, referenceProperties: ["other"] })]);
  assert.equal(other.status, "partial");
  assert.equal(other.items.find((line) => line.id === "prediction_reference_other").pricingMode, "quote");
});

test("prédiction : les répétitions déterminent les échantillons dans les deux modes", () => {
  for (const predictionMode of ["with_reference", "without_reference"]) {
    const prediction = item("existing_model_predictions", {
      predictionMode, spectra: 301, replicates: 3, samples: 9999, referenceProperties: ["starch"], comment: "X"
    });
    assert.deepEqual(app.validateItem(config.prestations, prediction.requestType, prediction.answers), {});
    const clean = app.pruneHiddenAnswers(config.prestations, prediction.requestType, prediction.answers);
    assert.equal(clean.samples, 101);
    const result = quote([prediction], { context: "internal_agap" });
    const reference = result.items.find((line) => line.referenceAnalysis);
    assert.equal(reference?.quantity, predictionMode === "with_reference" ? 11 : undefined);
    const description = app.describeAnswers(config, prediction.requestType, clean);
    assert.match(description, /101 échantillon/);
    assert.match(description, /3 répétition/);
  }
  const other = item("other_chemometrics", { shortTitle: "Test", description: "X" });
  assert.deepEqual(app.validateItem(config.prestations, other.requestType, other.answers), {});
});

test("prédiction : migration des répétitions et suppression de l’acquisition implicite", () => {
  const legacy = { spectra: 300, samples: 100, spectraAlreadyAcquired: false };
  const prepared = app.preparePredictionAnswers(legacy, 2);
  assert.equal(prepared.replicates, 3);
  assert.equal(prepared.samples, 100);
  assert.equal(prepared.spectraAlreadyAcquired, undefined);
  assert.deepEqual(prepared.legacyPredictionAnswers, { samples: 100, spectraAlreadyAcquired: false });
  assert.deepEqual(legacy, { spectra: 300, samples: 100, spectraAlreadyAcquired: false });
  assert.equal(app.preparePredictionAnswers({ spectra: 301, samples: 100 }, 2).samples, 151);
  assert.equal(app.preparePredictionAnswers({ spectra: 300, replicates: "" }, 2).samples, "");
  const base = item("existing_model_predictions", { spectra: 300, spectraAlreadyAcquired: false });
  const result = quote([base]);
  assert.equal(result.status, "estimated");
  assert.ok(result.items.every((line) => !/spectra_acquisition/.test(line.id)));
});

test("prédiction : les traits vérifiés ne dépassent pas les modèles demandés", () => {
  for (const models of [1, 2, 3]) {
    for (const referenceProperties of [["starch"], ["starch", "protein"], ["starch", "protein", "other"]]) {
      const prediction = item("existing_model_predictions", { predictionMode: "with_reference", models, referenceProperties });
      const errors = app.validateItem(config.prestations, prediction.requestType, prediction.answers);
      assert.equal(Boolean(errors.referenceProperties), referenceProperties.length > models);
      const result = quote([prediction]);
      if (referenceProperties.length > models) assert.equal(result.itemResults[0].status, "incomplete");
    }
  }
});

test("fourchette : le cas 3 464 à 4 604 EUR correspond à ±14,1 %", () => {
  const result = { context: "public_research_lab", status: "partial", currency: "EUR", billedEstimate: { min: 3464, max: 4604 } };
  const message = app.billingRangeExplanation(config, result);
  assert.match(message, /±14,1\s*%/);
  assert.match(message, /4\s*034\s*€/);
  assert.match(message, /±15\s*%/);
  assert.equal(app.billingRangeExplanation(config, { ...result, status: "quote_required" }), "");
});

test("chimie humide : plafond de 100 échantillons vérifiés par propriété et par prestation", () => {
  for (const [samples, expected] of [[999, [100, 100]], [1000, [100, 100]], [1500, [100, 100]], [2000, [100, 100]], [5000, [100, 100]]]) {
    const result = quote([item("existing_model_predictions", {
      predictionMode: "with_reference", replicates: 1, spectra: samples, models: 2, referenceProperties: ["starch", "protein"]
    })], { context: "partnership" });
    const lines = result.items.filter((line) => line.referenceAnalysis);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.deepEqual([line.quantity, line.quantityMax], expected);
      assert.equal(line.referenceAnalysis.maxReferenceSamples, 100);
    }
  }
});

test("partenariat : une seule fourchette, pas de seconde réduction automatique", () => {
  const result = quote([item("existing_model_predictions", { spectra: 1000 })], { context: "partnership" });
  assert.deepEqual(result.partnershipBreakdown.billedShare, { min: 1, max: 1 });
  assert.deepEqual(result.partnershipBreakdown.negotiatedReduction, { min: 0, max: 0 });
  const line = result.items.find((entry) => entry.id === "existing_model_predictions");
  assert.equal(line.billedTotalMin, line.technicalTotalMin);
  assert.equal(line.billedTotalMax, line.technicalTotalMax);
  assert.equal(result.billingRangeReview.required, false);
});

test("plafond global : aucun total présenté au-delà de ±15 %, les coûts ne sont jamais écrêtés", () => {
  for (const context of ["internal_agap", "public_research_lab", "partnership", "subcontracting"]) {
    for (const samples of [1, 11, 100, 1000, 2000, 5000]) {
      const prediction = item("existing_model_predictions", { predictionMode: "with_reference", replicates: 1, spectra: samples, models: 2, referenceProperties: ["starch", "protein"] });
      const state = { quoteId: "range-check", context, requester: { unit: "AGAP" }, items: [prediction] };
      const result = calculateQuote(config, state);
      const exported = app.buildQuoteExport(state, result);
      const rate = (result.billedEstimate.max - result.billedEstimate.min) / (result.billedEstimate.max + result.billedEstimate.min);
      if (rate > 0.15 + 1e-12) {
        assert.equal(result.status, "quote_required", `${context} / ${samples}`);
        assert.equal(result.billingRangeReview.required, true);
        assert.equal(exported.clientPricing.billedEstimate, null);
        assert.equal(exported.totals.billedEstimate, null);
        assert.deepEqual(exported.platformPricingAudit.billingRangeReview.computedEstimate, result.billedEstimate);
        assert.match(app.buildSummary(state, result, config), /Montant à définir avec le plateau : Sur devis/);
      } else {
        assert.equal(result.billingRangeReview.required, false);
        assert.equal(result.status, "estimated");
        assert.deepEqual(exported.clientPricing.billedEstimate, result.billedEstimate);
      }
      const protein = result.items.find((line) => line.id === "prediction_reference_protein");
      assert.equal(protein.billedTotalMin, protein.quantity * 50);
      assert.equal(protein.billedTotalMax, protein.quantityMax * 50);
    }
  }
});

test("chimie humide : données tarifaires modifiables sans repli économique silencieux", () => {
  const local = structuredClone(config);
  local.tarifs.predictionReferenceAnalyses.samplingRate = { min: 0.12, max: 0.18 };
  local.tarifs.predictionReferenceAnalyses.analyses.starch.contextAmounts.internal_agap = 13;
  const state = { context: "internal_agap", items: [item("existing_model_predictions", { predictionMode: "with_reference", spectra: 100, replicates: 1, referenceProperties: ["starch"] })] };
  const result = calculateQuote(local, state);
  const line = result.items.find((line) => line.id === "prediction_reference_starch");
  assert.equal(line.billedTotalMin, 156);
  assert.equal(line.billedTotalMax, 234);
  assert.ok(result.warnings.some((text) => /12\s*% à 18\s*%/.test(text)));
  delete local.tarifs.predictionReferenceAnalyses.analyses.starch.contextAmounts.internal_agap;
  const missing = calculateQuote(local, state);
  assert.equal(missing.itemResults[0].status, "incomplete");
  assert.match(missing.itemResults[0].errors._global, /Tarif de référence starch/);
});

test("chimie humide à 10 % fixe : l’estimation reste chiffrée et les prestations s’additionnent sans surcoût", () => {
  const prediction = item("existing_model_predictions", { predictionMode: "with_reference", spectra: 1000, replicates: 1, referenceProperties: ["starch"] });
  const single = quote([prediction], { context: "partnership" });
  assert.equal(single.status, "estimated");
  assert.equal(single.billingRangeReview.required, false);
  assert.deepEqual(single.billedEstimate, { min: 2575, max: 2725 });
  const reference = single.items.find((line) => line.referenceAnalysis);
  assert.deepEqual(reference.referenceAnalysis.samplingRate, { min: 0.1, max: 0.1 });
  assert.equal(reference.billedTotalMin, 2000);
  assert.equal(reference.billedTotalMax, 2000);
  const duplicate = { ...prediction, id: "second-prediction" };
  const combined = quote([prediction, duplicate], { context: "partnership" });
  assert.equal(combined.status, "estimated");
  assert.equal(combined.items.filter((line) => line.configRule === "externalAdministrativeFee").length, 1);
  assert.deepEqual(combined.billedEstimate, { min: 5000, max: 5300 });
});

test("plafond global : le garde-fou reste actif si une autre règle dépasse ±15 %", () => {
  const local = structuredClone(config);
  local.tarifs.chemometrics.existing_model_predictions.discussionRangePolicy.rate = 0.5;
  const state = { context: "partnership", items: [item("existing_model_predictions", { spectra: 1000 })] };
  const result = calculateQuote(local, state);
  assert.equal(result.status, "quote_required");
  assert.equal(result.billingRangeReview.required, true);
  assert.deepEqual(result.billingRangeReview.computedEstimate, { min: 400, max: 900 });
  assert.equal(app.buildQuoteExport(state, result).clientPricing.billedEstimate, null);
});

test("chimie humide : PDF, JSON et classeur plateau conservent hypothèses et détails", () => {
  const prediction = item("existing_model_predictions", { predictionMode: "with_reference", spectra: 300, replicates: 3, referenceProperties: ["starch"] });
  const state = { quoteId: "reference-test", context: "partnership", requester: { unit: "AGAP" }, items: [prediction] };
  const result = calculateQuote(config, state);
  const exported = app.buildQuoteExport(state, result);
  assert.equal(exported.configuredItems[0].answers.samples, 100);
  const ref = exported.items.find((line) => line.referenceAnalysis);
  assert.deepEqual(ref.referenceAnalysis.quantity, { min: 10, max: 10 });
  assert.equal(ref.referenceAnalysis.unitPrice, 20);
  const vm = app.buildPdfViewModel(config, state, result, { documentOptions: { storage: null, sequenceNumber: 1 } });
  assert.ok(vm.predictionClauses.some((text) => /sur 10\s*%/.test(text)));
  assert.ok(!vm.predictionClauses.includes(config.textes.prediction.withoutReference));
  assert.ok(vm.services.some((line) => /10 analyses pour 100/.test(line.description)));
  const workbook = app.buildPlatformWorkbookModel(config, state, result, exported);
  assert.ok(workbook.lines.some((line) => /10 analyses pour 100/.test(line.description)));
  const notice = app.predictionNotes(config, prediction.answers)[1];
  for (const text of ["en amont", "à l’issue du diagnostic", "validée avec le demandeur"]) {
    assert.ok(notice.includes(text), text);
  }
  assert.ok(result.warnings.includes(notice));
  assert.ok(exported.warnings.includes(notice));
  assert.ok(vm.predictionClauses.includes(notice));
  assert.ok(app.buildSummary(state, result, config).includes(notice));
  assert.ok(workbook.quoteRows.some((row) => row.includes(notice)));
  assert.doesNotMatch(notice, /10\s*% à 10\s*%|5\s*%/);
  assert.doesNotMatch(notice, /nouveaux spectres \(X\)|valeurs de référence \(Y\)|sans coefficient|ne garantit pas/);
  assert.doesNotMatch(ref.reason, /10 à 10 analyses/);
  assert.doesNotMatch(app.buildPlatformCsv(workbook), /\[object Object\]/);
});

test("ancien controle des valeurs aberrantes migre vers le nettoyage des donnees", () => {
  const result = quote([
    item("existing_model_predictions", {
      spectra: 100,
      models: 1,
      spectraAlreadyAcquired: true,
      outlierCheck: true
    })
  ], { context: "" });
  assert.ok(result.items.find((line) => line.id === "chemometric_data_preparation"));
  assert.equal(result.items.some((line) => line.id === "quality_control"), false);
});

test("autre demande chimiometrique reste sur devis sans bloquer les autres lignes", () => {
  const result = quote([
    item("existing_model_predictions", { spectra: 10, models: 1, spectraAlreadyAcquired: true }),
    item("other_chemometrics", { shortTitle: "Cas atypique", description: "Demande atypique à qualifier avec le plateau.", availableData: "Spectres" })
  ], { context: "" });
  assert.equal(result.status, "partial");
  assert.ok(result.itemResults.some((entry) => entry.requestType === "other_chemometrics" && entry.status === "quote_required"));
  assert.ok(result.technicalValue.min > 0);
});

test("resume texte affiche sur devis pour une prestation sans montant chiffre", () => {
  const result = quote([
    item("other_chemometrics", { shortTitle: "Cas atypique", description: "Demande atypique à qualifier avec le plateau.", availableData: "Spectres" })
  ], { context: "" });
  const summary = app.buildSummary({ quoteId: "test-quote", items: [] }, result, config);
  const itemLine = summary.split("\n").find((line) => line.includes("Autre demande") && line.includes("Sur devis"));
  assert.ok(itemLine);
  assert.doesNotMatch(itemLine, /0\s*€/);
});

test("jours ouvres francais et demi-journees suggerees", () => {
  assert.equal(app.isWorkingDay(new Date(2026, 7, 15)), false);
  assert.equal(app.frenchHolidays(2026).has("2026-04-06"), true);
  assert.equal(app.frenchHolidays(2026).has("2026-05-14"), true);
  assert.equal(app.frenchHolidays(2026).has("2026-05-25"), true);
  assert.equal(app.suggestedHalfDays("2026-04-06", "2026-04-10"), 8);
});

test("reference PDF utilise l'annee pour AN et une unite normalisee", () => {
  assert.equal(app.normalizeReferencePart("UMR AGAP"), "UMRAGAP");
  assert.equal(app.normalizeReferencePart("Unite de chimie du bois"), "UNITECHIMIE");
  assert.equal(app.formatSequenceNumber(12), "0012");
  assert.equal(app.compactDateYYMMDD("2026-08-04T13:06:00+02:00"), "260804");
  const reference = app.buildQuoteReference({
    requester: { unit: "UMR AGAP" },
    sequenceNumber: 12,
    generatedAt: "2026-08-04T13:06:00+02:00"
  });
  assert.equal(reference, "PRD_2026_SPIR_0012_UMRAGAP_260804");
  assert.equal(app.filenameFromReference(reference, "pdf"), "PRD_2026_SPIR_0012_UMRAGAP_260804.pdf");
  assert.doesNotMatch(reference, /[\s/\\:<>|?*\u00c0-\u017f]/);
  assert.throws(() => app.buildQuoteReference({
    requester: { unit: "" },
    sequenceNumber: 1,
    generatedAt: "2026-08-04T13:06:00+02:00"
  }), /unite/);
});

test("reference locale stable pour le meme pre-devis et incremente un nouveau pre-devis", () => {
  const storage = new Map();
  const fakeStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value))
  };
  const first = { requester: { unit: "UMR AGAP" } };
  const document = app.ensureQuoteDocument(first, config, { storage: fakeStorage, generatedAt: "2026-08-04T13:06:00+02:00" });
  assert.equal(document.reference, "PRD_2026_SPIR_0001_UMRAGAP_260804");
  assert.equal(app.ensureQuoteDocument(first, config, { storage: fakeStorage, generatedAt: "2026-08-04T13:06:00+02:00" }).reference, document.reference);
  const second = { requester: { unit: "UMR AGAP" } };
  assert.equal(app.ensureQuoteDocument(second, config, { storage: fakeStorage, generatedAt: "2026-08-04T13:06:00+02:00" }).reference, "PRD_2026_SPIR_0002_UMRAGAP_260804");
});

test("modele PDF reprend reference client plateau forfait et logo Bioch", () => {
  const state = {
    quoteId: "test-quote-pdf",
    requester: {
      firstName: "Alice",
      lastName: "Martin",
      email: "alice.martin@example.test",
      organization: "CIRAD",
      unit: "UMR AGAP"
    },
    project: {
      title: "Essai NIRS",
      partnershipProjectName: "NIRS4Agro",
      partnershipProjectReference: "AGAP-26-01",
      plannedStartDate: "2026-09-15",
      plannedEndDate: "2026-09-16"
    },
    context: "partnership",
    urgent: false,
    urgentSource: "none",
    people: [],
    items: [
      item("spectra_acquisition", { serviceMode: "plateau_operated", instrument: "bruker_tango", measurementDevice: "cup_9cm", halfDays: 2 }),
      item("validated_calibration", { properties: 3, samples: 120, replicates: 2, dataPreparationRequired: false }),
      item("model_maintenance", {
        maintenanceType: "instrument_transfer",
        maintenanceComment: "Transfert d'un modèle TANGO vers ASD LabSpec à discuter avec le plateau."
      })
    ]
  };
  const result = calculateQuote(config, state);
  const vm = app.buildPdfViewModel(config, state, result, {
    documentOptions: { storage: null, sequenceNumber: 12, generatedAt: "2026-08-04T13:06:00+02:00" }
  });
  assert.equal(vm.reference, "PRD_2026_SPIR_0012_UMRAGAP_260804");
  assert.equal(vm.fileName, "PRD_2026_SPIR_0012_UMRAGAP_260804.pdf");
  assert.equal(vm.provider.name, "Plateau Bioch&Spir");
  assert.match(vm.logo.filename, /bioch/i);
  assert.ok(!/cirad|inrae|agap/i.test(vm.logo.filename));
  assert.equal(vm.administrativeFee.label, "Forfait de gestion");
  assert.equal(vm.administrativeFee.totalMin, 150);
  assert.ok(vm.services.some((line) => /Forfait de gestion/.test(line.description)));
  assert.ok(vm.footerBanner.startsWith("data:image/png;base64,"));
  assert.ok(vm.requesterRows.some(([label, value]) => label === "Unité" && value === "UMR AGAP"));
  assert.ok(vm.requesterRows.some(([label, value]) => label === "Période" && value === "du 15 septembre 2026 au 16 septembre 2026"));
  assert.equal(vm.requesterRows.some(([label]) => label === "Contexte"), false);
  assert.equal(vm.requesterRows.some(([label]) => label === "Projet partenaire"), false);
  assert.equal(vm.requesterRows.some(([label]) => label === "Référence projet"), false);
  assert.equal(vm.contextLabel, "Partenariat scientifique avec Bioch&SPIR");
  assert.ok(vm.contextRows.some(([label, value]) => label === "Projet" && value === "NIRS4Agro"));
  assert.ok(vm.contextRows.some(([label, value]) => label === "Référence projet" && value === "AGAP-26-01"));
  assert.equal(vm.contextRows.some(([label]) => label === "Implication prévue de Bioch&SPIR"), false);
  assert.ok(vm.partnershipBreakdown);
  assert.ok(vm.serviceSummaries.some((line) => /Prendre des spectres - spectromètre Bruker TANGO II - sonde\/dispositif Coupelle 9 cm - 100 échantillon\(s\) estimé\(s\) - 2 répétition\(s\) spectrale\(s\) par échantillon - 240 à 480 spectres indicatifs/.test(line)));
  assert.ok(vm.serviceSummaries.some((line) => /Calibrer - 3 propriétés - 120 échantillons indépendants × 2 répétitions = 240 spectres/.test(line)));
  assert.ok(vm.serviceSummaries.some((line) => /Vérifier et adapter un modèle - Transférer vers un autre spectromètre/.test(line)));
  assert.equal(vm.totals.contextId, "partnership");
});

test("export JSON expose le contexte partenariat et sa repartition", () => {
  const state = {
    quoteId: "test-quote-export",
    requester: { firstName: "Alice", lastName: "Martin", email: "alice.martin@example.test", unit: "UMR AGAP", unitCode: "A10800-AGAP" },
    project: {
      title: "Essai NIRS",
      partnershipProjectName: "NIRS4Agro",
      partnershipProjectReference: "AGAP-26-01"
    },
    context: "partnership",
    urgent: false,
    urgentSource: "none",
    people: [],
    items: [
      item("validated_calibration", { properties: 1, samples: 120, replicates: 2, dataPreparationRequired: false })
    ]
  };
  const result = calculateQuote(config, state);
  const exported = app.buildQuoteExport(state, result);
  assert.equal(exported.context.id, "partnership");
  assert.equal(exported.context.mode, "negotiated_partnership");
  assert.deepEqual(exported.context.billedShare, { min: 1, max: 1 });
  assert.equal(exported.context.requiresDiscussion, true);
  assert.equal("biochSpirInvolvement" in exported.project, false);
  assert.deepEqual(exported.partnershipBreakdown.inKindContribution, { min: 0, max: 0 });
});

test("export JSON entretien conserve commentaire et audit de fourchette standard", () => {
  const state = {
    quoteId: "test-maintenance-export",
    requester: { firstName: "Alice", lastName: "Martin", email: "alice.martin@example.test", unit: "UMR AGAP", unitCode: "A10800-AGAP" },
    project: { title: "Transfert simplifie" },
    context: "subcontracting",
    urgent: false,
    urgentSource: "none",
    people: [],
    items: [
      item("model_maintenance", {
        maintenanceType: "instrument_transfer",
        maintenanceComment: "Transfert d'un modèle TANGO vers MicroNIR avec données à vérifier."
      })
    ]
  };
  const result = calculateQuote(config, state);
  const exported = app.buildQuoteExport(state, result);
  assert.equal(exported.configuredItems[0].maintenance.type, "instrument_transfer");
  assert.equal(exported.configuredItems[0].maintenance.pricingConfidence, "low");
  assert.equal(exported.configuredItems[0].maintenance.requiresPlateauReview, true);
  assert.match(exported.configuredItems[0].maintenance.comment, /TANGO vers MicroNIR/);
  assert.deepEqual(exported.platformPricingAudit.maintenance[0].technicalDiscussionRange, { min: 1700, max: 2300 });
  assert.deepEqual(exported.platformPricingAudit.maintenance[0].technicalReferenceAmount, { min: 2000, max: 2000 });
  assert.deepEqual(exported.platformPricingAudit.maintenance[0].billedRange, { min: 2295, max: 3105 });
});

test("les paramètres économiques critiques restent pilotés par data/tarifs.json", () => {
  const localConfig = structuredClone(config);
  localConfig.tarifs.contexts.subcontracting.costCoefficient = { min: 1.4, max: 1.4 };
  localConfig.tarifs.options.instrument_transport.amount = 175;
  localConfig.tarifs.instruments.bruker_tango.transportFee = 175;
  localConfig.tarifs.instrumentCostModelSettings.autonomousTechnicalSupportRate = 0.12;
  localConfig.tarifs.chemometrics.existing_model_predictions.discussionRangePolicy = { mode: "custom_rate", rate: 0.2 };

  const result = calculateQuote(localConfig, {
    quoteId: "config-driven", context: "subcontracting", urgent: false, urgentSource: "none",
    people: [operator("bruker_tango")],
    items: [item("spectra_acquisition", { serviceMode: "autonomous_supported", instrument: "bruker_tango", halfDays: 1, measurementLocation: "transport_required", operators: [operator("bruker_tango")] })]
  });
  const transport = result.items.find((line) => line.id === "instrument_transport");
  assert.equal(transport.totalMin, 175);
  assert.equal(result.contextCoefficient.min, 1.4);

  const predictionResult = calculateQuote(localConfig, {
    quoteId: "config-driven-pred", context: "", urgent: false, urgentSource: "none", people: [],
    items: [item("existing_model_predictions", { spectra: 100, models: 1, spectraAlreadyAcquired: true })]
  });
  const prediction = predictionResult.items.find((line) => line.id === "existing_model_predictions");
  assert.equal(prediction.discussionRangeRate, 0.2);
});

test("la génération du PDF déclenche aussi le classeur XLSX plateau lorsque configuré", async () => {
  const originalPdf = app.downloadPdfA4;
  const originalXlsx = app.downloadPlatformWorkbook;
  const calls = [];
  app.downloadPdfA4 = async () => { calls.push("pdf"); };
  app.downloadPlatformWorkbook = async () => { calls.push("xlsx"); };
  try {
    const outcomes = await app.downloadQuoteDocuments({}, {}, { tarifs: { internalExports: { enabled: true, autoGenerateWithPdf: true } } });
    assert.equal(outcomes.length, 2);
    assert.deepEqual(new Set(calls), new Set(["pdf", "xlsx"]));
  } finally {
    app.downloadPdfA4 = originalPdf;
    app.downloadPlatformWorkbook = originalXlsx;
  }
});

test("configuration generee synchronisee", () => {
  const check = spawnSync("python", ["tools/generate-runtime-config.py", "--check"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test("audit tarifaire distingue reference technique, discussion et montant facture", () => {
  const state = {
    quoteId: "test-audit",
    requester: { firstName: "Alice", lastName: "Martin", email: "alice.martin@example.test", unit: "UMR AGAP", unitCode: "A10800-AGAP" },
    project: { title: "Audit tarifaire" },
    context: "subcontracting",
    urgent: false,
    urgentSource: "none",
    people: [],
    items: [
      item("existing_model_predictions", {
        instrument: "bruker_tango",
        spectra: 100,
        models: 2,
        comment: "Lot de prediction prepare pour verifier la ventilation plateau."
      })
    ]
  };
  const result = calculateQuote(config, state);
  const audit = result.pricingAudit;
  assert.ok(audit.technicalReferenceAmount.min > 0);
  assert.ok(audit.technicalDiscussionRange.min < audit.technicalReferenceAmount.min);
  assert.ok(audit.technicalDiscussionRange.max > audit.technicalReferenceAmount.max);
  assert.ok(audit.billedEstimate.min > audit.technicalDiscussionRange.min);
  assert.equal(audit.contextId, "subcontracting");
  assert.equal(audit.contextCoefficient.min, config.tarifs.contexts.subcontracting.costCoefficient.min);
});

test("modele classeur plateau expose les onglets et lignes attendus", () => {
  const state = {
    quoteId: "test-xlsx",
    requester: { firstName: "Alice", lastName: "Martin", email: "alice.martin@example.test", unit: "UMR AGAP", unitCode: "A10800-AGAP" },
    project: { title: "Export plateau" },
    context: "partnership",
    urgent: false,
    urgentSource: "none",
    people: [],
    items: [
      item("validated_calibration", { properties: 3, samples: 120, replicates: 2, dataPreparationRequired: false }),
      item("model_maintenance", {
        maintenanceType: "instrument_transfer",
        maintenanceComment: "Transfert d'un modèle TANGO vers MicroNIR avec revue plateau."
      }),
      item("other_chemometrics", { description: "Demande specifique a discuter avec le plateau avant chiffrage." })
    ]
  };
  const result = calculateQuote(config, state);
  const exported = app.buildQuoteExport(state, result);
  const model = app.buildPlatformWorkbookModel(config, state, result, exported);
  assert.deepEqual(model.sheets, [
    "MODE_EMPLOI",
    "SYNTHESE_DOSSIER",
    "PARAMETRES_DOSSIER",
    "LIGNES_PRESTATIONS",
    "CHIMIOMETRIE",
    "PARTENARIAT",
    "SUR_DEVIS_ET_QUESTIONS"
  ]);
  assert.match(model.filenames.xlsx, /^FT_PRD_.*_PLATEAU\.xlsx$/);
  assert.ok(model.lines.some((line) => line.parentLabel === "Calibrer" && line.discussionRangeRate === 0.15));
  assert.ok(model.quoteRows.length > 0);
  const maintenanceRow = model.chemometricsRows.find((row) => row[1] === "model_maintenance");
  assert.ok(maintenanceRow);
  assert.match(maintenanceRow[8], /spectrometre source/);
  assert.match(maintenanceRow[9], /1.?700.*2.?300/);
  assert.equal(maintenanceRow[13], "Oui");
});

test("csv plateau utilise bom utf8 point-virgule et conserve sur devis", () => {
  const state = {
    quoteId: "test-csv",
    requester: { firstName: "Alice", lastName: "Martin", email: "alice.martin@example.test", unit: "UMR AGAP", unitCode: "A10800-AGAP" },
    project: { title: "Export CSV" },
    context: "subcontracting",
    urgent: false,
    urgentSource: "none",
    people: [],
    items: [
      item("other_chemometrics", { description: "Demande specifique a discuter avec le plateau avant chiffrage." })
    ]
  };
  const result = calculateQuote(config, state);
  const model = app.buildPlatformWorkbookModel(config, state, result, app.buildQuoteExport(state, result));
  const csv = app.buildPlatformCsv(model);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /;/);
  assert.ok(model.quoteRows.length > 0);
  assert.doesNotMatch(csv, /;0;0;Sur devis/);
});

test("validateur generique ignore les champs masques et facultatifs vides", () => {
  const prestations = {
    requestTypes: {
      demo: {
        fields: [
          { id: "mode", type: "select", required: true, options: [{ value: "simple", label: "Simple" }, { value: "advanced", label: "Avance" }] },
          { id: "optionalNumber", type: "number", required: false },
          { id: "optionalList", type: "checkboxList", required: false },
          { id: "hiddenRequired", type: "text", required: true, visibleWhen: { field: "mode", equals: "advanced" } },
          { id: "visibleRequired", type: "text", required: true }
        ]
      }
    }
  };
  const errors = app.validateItem(prestations, "demo", {
    mode: "simple",
    optionalNumber: "",
    optionalList: [],
    hiddenRequired: "",
    visibleRequired: ""
  });
  assert.equal(errors.optionalNumber, undefined);
  assert.equal(errors.optionalList, undefined);
  assert.equal(errors.hiddenRequired, undefined);
  assert.match(errors.visibleRequired, /Complétez/);
});

test("aucun champ public masque d'entretien ne peut bloquer", () => {
  const request = config.prestations.requestTypes.model_maintenance;
  const fieldIds = request.fields.map((field) => field.id);
  assert.deepEqual(fieldIds, ["maintenanceType", "maintenanceComment"]);
  for (const forbidden of [
    "modelName",
    "propertyName",
    "sourceInstrument",
    "targetInstrument",
    "pairedSpectraStatus",
    "pairedSampleCount",
    "referenceDataAvailability",
    "referenceSampleCount",
    "independentTargetValidation"
  ]) {
    assert.equal(fieldIds.includes(forbidden), false, forbidden);
  }
  const pruned = app.pruneHiddenAnswers(config.prestations, "model_maintenance", {
    maintenanceType: "instrument_transfer",
    sourceInstrument: "bruker_tango",
    targetInstrument: "viavi_micronir",
    propertyName: "MS"
  });
  assert.equal(pruned.maintenanceType, "instrument_transfer");
  assert.match(pruned.maintenanceComment, /Spectromètre source : bruker_tango/);
  assert.equal(pruned.legacyMaintenanceAnswers.sourceInstrument, "bruker_tango");
  assert.deepEqual(app.validateItem(config.prestations, "model_maintenance", pruned), {});
});

test("audit : les prix unitaires facturés et les traitements suivent le contexte final", () => {
  for (const context of ["internal_agap", "public_research_lab", "partnership", "subcontracting"]) {
    const result = quote([item("existing_model_predictions", { spectra: 1000 })], { context });
    const line = result.items.find((entry) => entry.id === "existing_model_predictions");
    assert.equal(line.billedUnitPriceMin * line.quantity, line.billedTotalMin, context);
    assert.equal(line.billedUnitPriceMax * line.quantity, line.billedTotalMax, context);
    assert.equal(line.partnershipTreatment, context === "partnership" ? "negotiated" : "context_coefficient");
    const maintenance = quote([item("model_maintenance", { maintenanceType: "performance_audit" })], { context });
    assert.equal(maintenance.pricingAudit.maintenance[0].partnershipTreatment, context === "partnership" ? "negotiated" : "context_coefficient");
  }
  const person = operator("viavi_micronir", "untrained", "");
  const result = quote([item("spectra_acquisition", { operators: [person] })], { context: "partnership", people: [person] });
  const training = result.items.find((line) => line.configRule === "instrumentTraining");
  assert.equal(training.billedUnitPriceMin, 0);
  assert.equal(training.billedUnitPriceMax, 0);
  assert.equal(training.partnershipTreatment, "offered");
});

test("audit : le total facturé est la somme des lignes arrondies du pré-devis", () => {
  for (const context of ["internal_agap", "public_research_lab", "partnership", "subcontracting"]) {
    const result = quote([item("existing_model_predictions"), item("existing_model_predictions")], { context });
    const sum = result.items.filter((line) => line.pricingMode !== "quote").reduce((sum, line) => ({ min: sum.min + line.billedTotalMin, max: sum.max + line.billedTotalMax }), { min: 0, max: 0 });
    assert.deepEqual(result.billedEstimate, sum, context);
    assert.deepEqual(result.pricingAudit.billedEstimate, sum, context);
    if (result.partnershipBreakdown) assert.deepEqual(result.partnershipBreakdown.billedEstimate, sum);
    for (const item of result.itemResults) {
      const lines = result.items.filter((line) => line.parentItemId === item.itemId && line.pricingMode !== "quote");
      assert.equal(item.billedEstimate.min, lines.reduce((sum, line) => sum + line.billedTotalMin, 0));
      assert.equal(item.billedEstimate.max, lines.reduce((sum, line) => sum + line.billedTotalMax, 0));
    }
  }
});

test("audit : les champs numériques nécessaires à la prédiction ne sont pas facultatifs", () => {
  for (const predictionMode of ["without_reference", "with_reference"]) {
    const base = item("existing_model_predictions", { predictionMode, samples: 100, referenceProperties: ["starch"] });
    for (const field of ["spectra", "models", "replicates"]) {
      assert.ok(app.validateItem(config.prestations, base.requestType, { ...base.answers, [field]: "" })[field], `${predictionMode} / ${field}`);
    }
  }
});

test("audit : le CSV protège les textes contre les formules sans altérer les nombres", () => {
  const csv = app.buildPlatformCsv({ lines: [{ comment: "=1+1", amount: -12 }] });
  assert.match(csv, /\r\n'=1\+1;-12$/);
  for (const text of ["+SUM(1)", "-cmd", "@SUM(1)", "\t=1+1"]) {
    assert.ok(app.buildPlatformCsv({ lines: [{ comment: text }] }).includes(`'${text}`));
  }
});
