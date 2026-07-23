import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

await import("../assets/js/generated-config.js");
await import("../assets/js/utils.js");
await import("../assets/js/validators.js");
await import("../assets/js/calculator.js");

const config = globalThis.NIRS_CONFIG;
const calculateQuote = globalThis.NIRSApp.calculateQuote;

function operator(instrument, status = "trained", id = "operator-1") {
  return {
    id,
    firstName: id === "operator-1" ? "Alice" : "Bruno",
    lastName: id === "operator-1" ? "Martin" : "Durand",
    trainedInstruments: { [instrument]: status }
  };
}

function participant(id = "participant-1") {
  return {
    id,
    firstName: id === "participant-1" ? "Alice" : "Bruno",
    lastName: id === "participant-1" ? "Martin" : "Durand",
    trainedInstruments: {}
  };
}

function item(requestType, answers = {}) {
  const mergedAnswers = {
    ...globalThis.NIRSApp.defaultAnswersForRequest(config.prestations, requestType),
    ...answers,
    requestType
  };
  if (requestType === "spectra_acquisition" && mergedAnswers.serviceMode === "self_service" && !mergedAnswers.operators && !mergedAnswers.operatorIds) {
    const status = mergedAnswers.trained === false ? "unknown" : "trained";
    mergedAnswers.operators = [operator(mergedAnswers.instrument, status)];
    delete mergedAnswers.trained;
  }
  if (requestType === "initial_training" && !mergedAnswers.participants && !mergedAnswers.participantIds) {
    const count = Math.max(1, Number.parseInt(mergedAnswers.people || 1, 10));
    mergedAnswers.participants = Array.from({ length: count }, (_entry, index) => participant(`participant-${index + 1}`));
    mergedAnswers.people = mergedAnswers.participants.length;
  }
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    requestType,
    answers: mergedAnswers,
    completed: true
  };
}

function quote(items, overrides = {}) {
  return calculateQuote(config, {
    quoteId: "test-quote",
    context: "occasional_help",
    urgent: false,
    people: [],
    items,
    ...overrides
  });
}

test("aucun type de prestation sélectionné au démarrage", () => {
  const state = { quoteId: "empty", context: "occasional_help", urgent: false, items: [] };
  assert.equal(state.items.length, 0);
  const result = calculateQuote(config, state);
  assert.equal(result.status, "quote_required");
});

test("calcul avec deux prestations différentes", () => {
  const result = quote([
    item("initial_training", { instrument: "bruker_tango", people: 1 }),
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "bruker_tango", hours: 5, operators: [operator("bruker_tango", "trained")] })
  ]);
  assert.equal(result.itemResults.length, 2);
  assert.deepEqual(result.technicalValue, { min: 375, max: 600 });
});

test("calcul avec deux occurrences du même type", () => {
  const result = quote([
    item("initial_training", { instrument: "viavi_micronir", people: 1 }),
    item("initial_training", { instrument: "bruker_tango", people: 1 })
  ]);
  assert.equal(result.itemResults.length, 2);
  assert.deepEqual(result.technicalValue, { min: 430, max: 680 });
});

test("suppression d'une prestation avant calcul", () => {
  const items = [
    item("initial_training", { instrument: "viavi_micronir", people: 1 }),
    item("validated_calibration", { properties: 1, matrices: 1, samples: 120 })
  ];
  const result = quote(items.slice(0, 1));
  assert.equal(result.itemResults.length, 1);
  assert.deepEqual(result.technicalValue, { min: 180, max: 280 });
});

test("duplication d'une prestation", () => {
  const first = item("existing_model_predictions", { spectra: 100, models: 1, spectraAlreadyAcquired: true });
  const duplicate = { ...structuredClone(first), id: "duplicate" };
  const result = quote([first, duplicate]);
  assert.deepEqual(result.technicalValue, { min: 320, max: 1040 });
});

test("formation automatique uniquement pour une ligne autonome avec utilisateur non habilité", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "bruker_tango", hours: 2, operators: [operator("bruker_tango", "unknown")] }),
    item("spectra_acquisition", { serviceMode: "assisted", instrument: "bruker_tango", hours: 2 })
  ]);
  const trainings = result.items.filter((line) => line.id === "global_initial_training_bruker_tango");
  assert.equal(trainings.length, 1);
  assert.equal(trainings[0].parentItemId, result.itemResults[0].itemId);
});

test("formation autonome nominative liée au même instrument quand l'utilisateur n'est pas habilité", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "asd_labspec", reservedDays: 2, operators: [operator("asd_labspec", "untrained")] })
  ]);
  const training = result.items.find((line) => line.id === "global_initial_training_asd_labspec");
  assert.ok(training);
  assert.match(training.label, /ASD LabSpec/);
  assert.equal(training.parentItemId, result.itemResults[0].itemId);
});

test("instrument portable autonome facturé à la journée dérivée du tarif horaire", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "asd_labspec", reservedDays: 2, operators: [operator("asd_labspec", "trained")] })
  ]);
  const reservation = result.items.find((line) => line.id === "self_service_daily");
  assert.ok(reservation);
  assert.equal(reservation.quantity, 2);
  assert.equal(reservation.unit, "day");
  assert.deepEqual(result.technicalValue, { min: 420, max: 700 });
});

test("deux utilisateurs non habilités au même instrument utilisent le tarif groupe de formation", () => {
  const result = quote([
    item("spectra_acquisition", {
      serviceMode: "self_service",
      instrument: "viavi_micronir",
      reservedDays: 1,
      operators: [operator("viavi_micronir", "untrained", "operator-1"), operator("viavi_micronir", "unknown", "operator-2")]
    })
  ]);
  assert.ok(result.items.some((line) => line.id === "global_initial_training_viavi_micronir"));
  const training = result.items.find((line) => line.id === "global_initial_training_viavi_micronir");
  assert.equal(training.quantity, 2);
  assert.equal(result.items.filter((line) => line.id === "global_training_extra_person_viavi_micronir").length, 0);
});

test("formation explicite et formation automatique de la même personne ne sont pas doublées", () => {
  const samePerson = participant("person-1");
  const result = quote([
    item("initial_training", { instrument: "bruker_tango", participants: [samePerson], people: 1 }),
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "bruker_tango", hours: 2, operators: [{ ...samePerson, trainedInstruments: { bruker_tango: "untrained" } }] })
  ]);
  assert.equal(result.items.filter((line) => line.id === "initial_training").length, 0);
  assert.equal(result.items.filter((line) => line.id === "global_initial_training_bruker_tango").length, 1);
  assert.equal(result.items.find((line) => line.id === "global_initial_training_bruker_tango").quantity, 1);
  assert.equal(globalThis.NIRSApp.assertNoDuplicateTrainingLines(result), true);
});

test("registre global des personnes avec references operatorIds et participantIds", () => {
  const alice = {
    id: "person-alice",
    firstName: "Alice",
    lastName: "Martin",
    trainingStatusByInstrument: { bruker_tango: { status: "untrained", source: "autonomous_use" } }
  };
  const result = quote([
    item("initial_training", { instrument: "bruker_tango", participantIds: [alice.id] }),
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "bruker_tango", hours: 2, operatorIds: [alice.id] })
  ], { people: [alice] });
  const trainings = result.items.filter((line) => line.id === "global_initial_training_bruker_tango");
  assert.equal(trainings.length, 1);
  assert.deepEqual(trainings[0].participantIds, [alice.id]);
  assert.equal(globalThis.NIRSApp.assertNoDuplicateTrainingLines(result), true);
});

test("total technique égal à la somme des résultats chiffrables plus formations globales", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "bruker_tango", hours: 2, operators: [operator("bruker_tango", "untrained")] }),
    item("validated_calibration", { properties: 1, matrices: 1, samples: 120, formalReport: false })
  ]);
  const sumMin = result.itemResults.reduce((sum, entry) => sum + entry.technicalValue.min, 0);
  const sumMax = result.itemResults.reduce((sum, entry) => sum + entry.technicalValue.max, 0);
  assert.deepEqual(result.technicalValue, { min: sumMin + 250, max: sumMax + 400 });
});

test("collaboration appliquée au total global", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "bruker_tango", hours: 10, operators: [operator("bruker_tango", "trained")] })
  ], { context: "collaborative_project" });
  assert.deepEqual(result.billedEstimate, { min: 125, max: 400 });
  assert.deepEqual(result.inKindContribution, { min: 0, max: 275 });
});

test("contribution en nature jamais ajoutée au montant facturé", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "bruker_tango", hours: 10, operators: [operator("bruker_tango", "trained")] })
  ], { context: "collaborative_project" });
  assert.ok(result.billedEstimate.max <= result.technicalValue.max);
});

test("sous-traitance appliquée une seule fois au total", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "viavi_micronir", reservedDays: 1, operators: [operator("viavi_micronir", "trained")] }),
    item("initial_training", { instrument: "viavi_micronir", people: 1 })
  ], { context: "subcontracting" });
  assert.equal(result.items.filter((line) => line.id === "context_markup").length, 1);
});

test("urgence appliquée une seule fois", () => {
  const result = quote([
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "viavi_micronir", reservedDays: 1, operators: [operator("viavi_micronir", "trained")] }),
    item("initial_training", { instrument: "viavi_micronir", people: 1 })
  ], { urgent: true });
  assert.equal(result.items.filter((line) => line.id === "global_urgent_markup").length, 1);
});

test("mélange de lignes chiffrables et de lignes sur devis", () => {
  const result = quote([
    item("instrument_qualification", { instrument: "viavi_micronir", instrumentsCount: 1, formalReport: true }),
    item("spectra_acquisition", { serviceMode: "self_service", instrument: "viavi_micronir", reservedDays: 1, operators: [operator("viavi_micronir", "trained")] })
  ]);
  assert.equal(result.status, "partial");
  assert.ok(result.items.some((line) => line.pricingMode === "quote"));
  assert.ok(result.technicalValue.min > 0);
});

test("prestation incomplète exclue du calcul final avec message clair", () => {
  const incomplete = item("spectra_acquisition", { serviceMode: "self_service", instrument: "viavi_micronir", reservedDays: -1, operators: [operator("viavi_micronir", "trained")] });
  const result = quote([incomplete, item("initial_training", { instrument: "viavi_micronir", people: 1 })]);
  assert.equal(result.itemResults[0].status, "incomplete");
  assert.deepEqual(result.technicalValue, { min: 180, max: 280 });
});

test("suppression d'une option devenue invisible", () => {
  const answers = globalThis.NIRSApp.pruneHiddenAnswers(config.prestations, "spectra_acquisition", {
    requestType: "spectra_acquisition",
    serviceMode: "self_service",
    instrument: "viavi_micronir",
    hours: 2,
    operators: [operator("viavi_micronir", "trained")],
    formalReport: true
  });
  assert.equal(Object.hasOwn(answers, "formalReport"), false);
  assert.equal(answers.operators.length, 1);
});

test("absence de double comptage après modification", () => {
  const result = quote([
    item("existing_model_predictions", { spectra: 10, models: 1, outlierCheck: true, formalReport: true })
  ]);
  assert.equal(result.items.filter((line) => line.id === "quality_control").length, 1);
  assert.equal(result.items.filter((line) => line.id === "formal_report").length, 1);
});

test("sérialisation et restauration de plusieurs prestations", () => {
  const state = {
    quoteId: "serial",
    context: "occasional_help",
    urgent: false,
    items: [item("initial_training"), item("validated_calibration")]
  };
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(restored.items.length, 2);
  assert.equal(restored.items[0].requestType, "initial_training");
});

test("synchronisation correcte entre les JSON et generated-config.js", () => {
  const check = spawnSync("python", ["tools/generate-runtime-config.py", "--check"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});
