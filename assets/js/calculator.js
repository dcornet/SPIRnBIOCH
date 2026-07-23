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
    items: [],
    exclusions: [],
    warnings: [],
    assumptions: []
  };
}

function roundRange(range, rounding) {
  const precision = Number(rounding?.precision ?? 1);
  const factor = precision > 0 ? 1 / precision : 1;
  return {
    min: Math.round(range.min * factor) / factor,
    max: Math.round(range.max * factor) / factor
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

function contextFrom(tarifs, id) {
  const contextId = id === "point_support" ? "occasional_help" : (id || "occasional_help");
  return {
    id: contextId,
    context: tarifs.contexts[contextId] || tarifs.contexts.occasional_help || Object.values(tarifs.contexts)[0]
  };
}

function addRangeItem(result, id, label, quantity, unit, price, reason, mandatory = false) {
  if (price.pricingMode === "quote") {
    result.items.push({
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
      reason
    });
    return;
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
    reason
  };
  result.items.push(item);
  result.technicalValue.min += item.totalMin;
  result.technicalValue.max += item.totalMax;
}

function addDerivedItem(result, id, label, quantity, unit, unitMin, unitMax, reason, mandatory = false) {
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
    reason
  };
  result.items.push(item);
  result.technicalValue.min += item.totalMin;
  result.technicalValue.max += item.totalMax;
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
    reason
  });
}

function addOption(result, tarifs, key, quantity, reason, mandatory = false) {
  const price = priceFrom(tarifs.options, key);
  addRangeItem(result, key, price.label, quantity, price.unit, price, reason, mandatory);
}

function addChemometric(result, tarifs, key, quantity, reason, mandatory = true) {
  const price = priceFrom(tarifs.chemometrics, key);
  if (price.pricingMode === "quote") {
    addQuoteItem(result, key, price.label || price.labelForQuote || "Sur devis", reason, mandatory);
    return;
  }
  addRangeItem(result, key, price.label, quantity, price.unit, price, reason, mandatory);
}

function addInstrumentPrice(result, instrument, key, quantity, reason, mandatory = true) {
  const price = priceFrom(instrument.prices, key);
  addRangeItem(result, key, `${price.label} - ${instrument.label}`, quantity, price.unit, price, reason, mandatory);
}

function addPreparationIfNeeded(result, tarifs, choices, reason) {
  let hours = Number(choices.preparationHours ?? 0);
  if (!Number.isFinite(hours) || hours < 0) hours = 0;
  if (!asBool(choices.sampleReady) && hours === 0) {
    hours = Number(tarifs.calculation.defaultPreparationHours);
    result.assumptions.push("Une préparation minimale a été ajoutée car les échantillons ne sont pas déclarés prêts à mesurer.");
  }
  if (hours > 0) {
    assertQuantity(hours, "Heures de préparation", { allowZero: false });
    addOption(result, tarifs, "special_preparation_hourly", hours, reason);
  }
}

function addScientificInterpretation(result, tarifs, choices) {
  const hours = Number(choices.scientificInterpretationHours ?? 0);
  if (hours > 0) {
    assertQuantity(hours, "Heures d'interprétation scientifique", { allowZero: false });
    addOption(result, tarifs, "scientific_interpretation_hourly", hours, "Option d'interprétation scientifique");
  }
}

function participantName(person) {
  return [person?.firstName, person?.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

function trainingStatusFor(person, instrumentId) {
  const scoped = person?.trainingStatusByInstrument?.[instrumentId] || person?.trainedInstruments?.[instrumentId];
  if (typeof scoped === "string") return scoped;
  return scoped?.status || person?.trainingStatus || "";
}

function operatorsForInstrument(choices, instrumentId) {
  return (Array.isArray(choices.operators) ? choices.operators : [])
    .map((person, index) => ({
      id: person.id || `operator-${index + 1}`,
      firstName: person.firstName || "",
      lastName: person.lastName || "",
      trainingStatus: trainingStatusFor(person, instrumentId)
    }));
}

function operatorsRequiringTraining(choices, instrumentId) {
  return operatorsForInstrument(choices, instrumentId)
    .filter((person) => trainingStatusFor(person, instrumentId) !== "trained");
}

function addTrainingForPeople(result, tarifs, instrumentId, people, reason, idPrefix = "") {
  if (!people.length) return;
  const instrument = instrumentFrom(tarifs, instrumentId);
  const names = people.map(participantName).filter(Boolean).join(", ");
  const detail = names ? `${reason} : ${names}` : reason;
  addInstrumentPrice(result, instrument, "initial_training", 1, detail, true);
  if (idPrefix) result.items[result.items.length - 1].id = `${idPrefix}initial_training_${instrumentId}`;
  if (people.length > 1) {
    addOption(result, tarifs, "training_extra_person", people.length - 1, detail, true);
    if (idPrefix) result.items[result.items.length - 1].id = `${idPrefix}training_extra_person_${instrumentId}`;
  }
}

function addGroupedTrainingLine(result, tarifs, instrumentId, people) {
  if (!people.length) return;
  const instrument = instrumentFrom(tarifs, instrumentId);
  const base = priceFrom(instrument.prices, "initial_training");
  const extra = priceFrom(tarifs.options, "training_extra_person");
  const extraCount = Math.max(0, people.length - 1);
  const totalMin = Number(base.min) + extraCount * Number(extra.min);
  const totalMax = Number(base.max) + extraCount * Number(extra.max);
  const names = people.map(participantName).filter(Boolean).join(", ");
  const sources = new Set(people.map((person) => person.source).filter(Boolean));
  const sourceLabel = sources.has("explicit+autonomous") || (sources.has("explicit") && sources.has("autonomous"))
    ? "formation demandée explicitement et exigence liée à l'utilisation autonome"
    : sources.has("explicit")
      ? "formation demandée explicitement"
      : "formation obligatoire liée à l'utilisation autonome";
  addDerivedItem(
    result,
    `global_initial_training_${instrumentId}`,
    `Formation initiale nominative - ${instrument.label}`,
    people.length,
    "participant",
    people.length ? totalMin / people.length : totalMin,
    people.length ? totalMax / people.length : totalMax,
    `${sourceLabel}${names ? ` : ${names}` : ""}`,
    true
  );
  const line = result.items[result.items.length - 1];
  line.totalMin = totalMin;
  line.totalMax = totalMax;
  line.instrumentId = instrumentId;
  line.participantIds = people.map((person) => person.id).filter(Boolean);
  line.participants = people.map((person) => ({
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName
  }));
  line.parentLabel = "Formations nominatives";
  line.parentItemId = people.find((person) => person.parentItemId)?.parentItemId || null;
  result.technicalValue.min += totalMin - (people.length * line.unitPriceMin);
  result.technicalValue.max += totalMax - (people.length * line.unitPriceMax);
}

function addCommonOptions(_result, _tarifs, _choices) {
  // Aucun frais administratif externe n'est exposé ni calculé dans cette version.
}

function calculateSpectraAcquisition(result, tarifs, choices, settings = {}) {
  const instrument = instrumentFrom(tarifs, choices.instrument);
  const mode = choices.serviceMode || "self_service";

  if (mode === "self_service") {
    if (instrument.autonomousReservationUnit === "day") {
      const days = assertQuantity(choices.reservedDays || 1, "Nombre de journées réservées", { integer: true });
      const hourly = priceFrom(instrument.prices, "self_service_hourly");
      const hoursPerDay = Number(instrument.hoursPerDay || tarifs.calculation.hoursPerDay || 7);
      addDerivedItem(
        result,
        "self_service_daily",
        `Réservation autonome à la journée - ${instrument.label}`,
        days,
        "day",
        Number(hourly.min) * hoursPerDay,
        Number(hourly.max) * hoursPerDay,
        `Tarif journalier dérivé de ${hoursPerDay} heures d'utilisation autonome`,
        true
      );
    } else {
      const hours = assertQuantity(choices.hours, "Nombre d'heures");
      addInstrumentPrice(result, instrument, "self_service_hourly", hours, "Réservation autonome nominative de l'instrument");
    }
    const peopleToTrain = operatorsRequiringTraining(choices, choices.instrument);
    if (settings.includeAutonomousTraining !== false) {
      addTrainingForPeople(result, tarifs, choices.instrument, peopleToTrain, `Formation nominative obligatoire - ${instrument.label}`);
    }
    if (peopleToTrain.length) {
      result.warnings.push(`Formation nominative obligatoire ajoutée pour ${instrument.label} pour chaque utilisateur non habilité ou au statut inconnu.`);
    }
    result.assumptions.push("L'utilisateur réalise lui-même les mesures après habilitation sur l'instrument.");
  } else if (mode === "assisted") {
    const hours = assertQuantity(choices.hours, "Nombre d'heures");
    addInstrumentPrice(result, instrument, "assisted_hourly", hours, "Utilisation accompagnée avec personnel du plateau");
    addPreparationIfNeeded(result, tarifs, choices, "Préparation demandée pour l'utilisation accompagnée");
    if (asBool(choices.simpleInterpretation)) {
      addOption(result, tarifs, "simple_interpretation", 1, "Option d'interprétation simple");
    }
    addScientificInterpretation(result, tarifs, choices);
  } else if (mode === "full_service") {
    const samples = assertQuantity(choices.samples, "Nombre d'échantillons", { integer: true });
    const replicates = assertQuantity(choices.replicates || 1, "Nombre de répétitions", { integer: true });
    const samplePrice = priceFrom(instrument.prices, "platform_sample_measure");
    addInstrumentPrice(result, instrument, "batch_setup", 1, "Forfait de mise en route du lot");
    addInstrumentPrice(result, instrument, "platform_sample_measure", samples, "Mesures réalisées par le plateau");
    if (replicates > 1) {
      const extra = tarifs.calculation.extraRepetitionMultiplier;
      addDerivedItem(
        result,
        "extra_repetitions",
        `Répétitions supplémentaires - ${instrument.label}`,
        samples * (replicates - 1),
        "répétition",
        Number(samplePrice.min) * Number(extra.min),
        Number(samplePrice.max) * Number(extra.max),
        "Coût configurable des répétitions au-delà de la première"
      );
    }
    addPreparationIfNeeded(result, tarifs, choices, "Préparation particulière des échantillons");
    if (asBool(choices.simpleInterpretation)) addOption(result, tarifs, "simple_interpretation", 1, "Option d'interprétation simple");
    addScientificInterpretation(result, tarifs, choices);
    if (asBool(choices.formalReport)) addOption(result, tarifs, "formal_report", 1, "Rapport formalisé demandé");
  }

  if (choices.instrument === "asd_labspec" && choices.measurementLocation === "field") {
    const fieldDays = assertQuantity(choices.fieldDays || 1, "Jours terrain", { integer: true });
    addInstrumentPrice(result, instrument, "field_day_availability", fieldDays, "Mise à disposition terrain de l'ASD LabSpec");
    const staffHours = Number(choices.fieldStaffHours ?? 0);
    if (staffHours > 0) addOption(result, tarifs, "field_staff_hourly", staffHours, "Temps du personnel sur le terrain");
    addQuoteItem(result, "travel_expenses", "Déplacement sur site", "Frais de déplacement à confirmer");
    addQuoteItem(result, "accommodation_expenses", "Hébergement ou frais au réel", "Frais réels non inclus dans l'estimation");
  }
}

function calculateInitialTraining(result, tarifs, choices) {
  const instrument = instrumentFrom(tarifs, choices.instrument);
  const people = assertQuantity(choices.people, "Nombre de personnes", { integer: true });
  addInstrumentPrice(result, instrument, "initial_training", 1, "Forfait pour la première personne");
  if (people > 1) {
    addOption(result, tarifs, "training_extra_person", people - 1, "Supplément par personne supplémentaire");
  }
  result.assumptions.push("L'habilitation est nominative et propre à chaque instrument.");
}

function calculateFeasibility(result, tarifs, choices) {
  const properties = assertQuantity(choices.properties, "Nombre de propriétés", { integer: true });
  const matrices = assertQuantity(choices.matrices, "Nombre de matrices", { integer: true });
  assertQuantity(choices.samples, "Nombre d'échantillons", { integer: true });
  addChemometric(result, tarifs, "feasibility_study", properties * matrices, "Périmètre défini par propriété et matrice");
  if (!asBool(choices.spectraAvailable)) result.exclusions.push("Acquisition des spectres non incluse dans cette estimation de faisabilité.");
  if (!asBool(choices.referenceValuesAvailable)) result.exclusions.push("Analyses de référence non incluses, à chiffrer selon les méthodes et laboratoires concernés.");
}

function calculateExploratoryModel(result, tarifs, choices) {
  const properties = assertQuantity(choices.properties, "Nombre de propriétés", { integer: true });
  const matrices = assertQuantity(choices.matrices, "Nombre de matrices", { integer: true });
  addChemometric(result, tarifs, "exploratory_model", properties * matrices, "Modèle exploratoire par propriété et matrice");
  if (!asBool(choices.cleanData)) {
    addOption(result, tarifs, "special_preparation_hourly", Number(tarifs.calculation.defaultPreparationHours), "Structuration minimale des données");
  }
  if (asBool(choices.methodReport)) addOption(result, tarifs, "formal_report", 1, "Rapport méthodologique souhaité");
}

function calculateValidatedCalibration(result, tarifs, choices) {
  const properties = assertQuantity(choices.properties, "Nombre de propriétés", { integer: true });
  const matrices = assertQuantity(choices.matrices, "Nombre de matrices", { integer: true });
  assertQuantity(choices.samples, "Nombre d'échantillons", { integer: true });
  addChemometric(result, tarifs, "validated_calibration", properties * matrices, "Calibration validée par propriété et matrice");
  if (asBool(choices.independentValidation)) {
    addChemometric(result, tarifs, "local_model_validation", 1, "Validation indépendante demandée");
  }
  if (asBool(choices.multiInstrumentModel)) {
    addChemometric(result, tarifs, "calibration_transfer", 1, "Modèle destiné à plusieurs instruments");
  }
  if (asBool(choices.formalReport)) addOption(result, tarifs, "formal_report", 1, "Rapport complet demandé");
  result.exclusions.push("Analyses de référence : non incluses, à chiffrer selon les méthodes et laboratoires concernés.");
  if (!asBool(choices.referenceAnalysesExist)) {
    result.warnings.push("Les analyses de référence devront être obtenues avant une calibration validée.");
  }
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
  const models = assertQuantity(choices.models, "Nombre de modèles", { integer: true });
  assertQuantity(choices.transferSamples, "Échantillons de transfert", { integer: true });
  addChemometric(result, tarifs, "calibration_transfer", models, "Transfert par modèle");
  if (choices.instrumentSimilarity === "different_technology") {
    addOption(result, tarifs, "scientific_interpretation_hourly", Number(tarifs.calculation.defaultScientificInterpretationHours), "Analyse complémentaire pour technologies différentes");
  }
}

function calculatePredictions(result, tarifs, choices) {
  const spectra = assertQuantity(choices.spectra, "Nombre de spectres", { integer: true });
  const models = assertQuantity(choices.models, "Nombre de modèles", { integer: true });
  const instrument = instrumentFrom(tarifs, choices.instrument);
  addChemometric(result, tarifs, "prediction_batch_setup", 1, "Préparation du lot de prédictions");
  if (!asBool(choices.spectraAlreadyAcquired)) {
    addInstrumentPrice(result, instrument, "platform_sample_measure", spectra, "Acquisition des spectres par le plateau");
  }
  addChemometric(result, tarifs, "prediction_per_spectrum", spectra, "Application du premier modèle");
  if (models > 1) {
    addOption(result, tarifs, "prediction_additional_model_per_spectrum", spectra * (models - 1), "Modèles ou propriétés supplémentaires");
  }
  if (asBool(choices.outlierCheck)) addOption(result, tarifs, "quality_control", 1, "Contrôle scientifique des valeurs aberrantes");
  if (asBool(choices.formalReport)) addOption(result, tarifs, "formal_report", 1, "Rapport souhaité");
}

function calculateMaintenance(result, tarifs, choices) {
  const models = assertQuantity(choices.models, "Nombre de modèles", { integer: true });
  assertQuantity(choices.properties, "Nombre de propriétés", { integer: true });
  const newSamples = assertQuantity(choices.newSamples ?? 0, "Nouveaux échantillons", { integer: true, allowZero: true });
  const map = {
    annual_audit: "annual_audit",
    limited_new_samples: "light_update",
    bias_correction: "bias_correction",
    light_update: "light_update",
    major_recalibration: "major_recalibration"
  };
  addChemometric(result, tarifs, map[choices.maintenanceType] || "annual_audit", models, "Maintenance par modèle");
  if (newSamples > 0 && choices.maintenanceType !== "major_recalibration") {
    addOption(result, tarifs, "quality_control", 1, "Contrôle du lot de nouveaux échantillons");
  }
  if (asBool(choices.comparativeReport)) addOption(result, tarifs, "formal_report", 1, "Rapport comparatif demandé");
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
  const baseMin = result.technicalValue.min;
  const baseMax = result.technicalValue.max;
  if (baseMin <= 0 && baseMax <= 0) return;
  addDerivedItem(
    result,
    "urgent_markup",
    urgent.label,
    1,
    urgent.unit,
    baseMin * Number(urgent.min),
    baseMax * Number(urgent.max),
    "Majoration appliquée aux éléments calculables concernés"
  );
}

function applyBillingMinimum(result, tarifs) {
  const minimum = priceFrom(tarifs.options, "billing_minimum");
  if (result.technicalValue.min === 0 && result.technicalValue.max === 0) return;
  const addMin = Math.max(0, Number(minimum.min) - result.technicalValue.min);
  const addMax = Math.max(0, Number(minimum.max) - result.technicalValue.max);
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
      reason: "Minimum configurable appliqué uniquement lorsque le total technique est inférieur"
    };
    result.items.push(item);
    result.technicalValue.min += addMin;
    result.technicalValue.max += addMax;
  }
}

function applyContext(result, tarifs, choices) {
  const resolved = contextFrom(tarifs, choices.context);
  const contextId = resolved.id;
  const context = resolved.context;
  result.context = {
    id: contextId,
    label: context.label,
    description: context.description,
    display: context.display || null
  };

  if (context.mode === "in_kind") {
    const share = context.billedShare;
    result.billedEstimate = {
      min: result.technicalValue.min * Number(share.min),
      max: result.technicalValue.max * Number(share.max)
    };
    result.inKindContribution = {
      min: Math.max(0, result.technicalValue.min - result.billedEstimate.max),
      max: Math.max(0, result.technicalValue.max - result.technicalValue.max * Number(share.min))
    };
    result.assumptions.push(context.notice);
    return;
  }

  const coefficient = context.costCoefficient || { min: 1, max: 1 };
  result.billedEstimate = {
    min: result.technicalValue.min * Number(coefficient.min),
    max: result.technicalValue.max * Number(coefficient.max)
  };

  if (context.mode === "markup") {
    result.items.push({
      id: "context_markup",
      label: `Majoration de contexte - ${context.label}`,
      quantity: 1,
      unit: "coefficient",
      unitPriceMin: Number(coefficient.min),
      unitPriceMax: Number(coefficient.max),
      totalMin: result.billedEstimate.min - result.technicalValue.min,
      totalMax: result.billedEstimate.max - result.technicalValue.max,
      pricingMode: "coefficient",
      mandatory: true,
      reason: context.description
    });
  }
}

function markStatus(result) {
  const quoteCount = result.items.filter((item) => item.pricingMode === "quote").length;
  if (quoteCount === 0) {
    result.status = "estimated";
  } else if (result.technicalValue.min > 0 || result.technicalValue.max > 0) {
    result.status = "partial";
  } else {
    result.status = "quote_required";
  }
}

function calculateSingleQuote(tarifs, choices, options = {}) {
  const settings = {
    applyCommonOptions: true,
    applyUrgency: true,
    applyBillingMinimum: true,
    applyContext: true,
    addDisclaimers: true,
    ...options
  };
  if (!tarifs?.metadata) throw new Error("Configuration tarifaire invalide");
  if (!choices?.requestType) throw new Error("Type de demande manquant");

  const result = makeEmptyResult(tarifs);

  switch (choices.requestType) {
    case "spectra_acquisition":
      calculateSpectraAcquisition(result, tarifs, choices, settings);
      break;
    case "initial_training":
      calculateInitialTraining(result, tarifs, choices);
      break;
    case "feasibility_study":
      calculateFeasibility(result, tarifs, choices);
      break;
    case "exploratory_model":
      calculateExploratoryModel(result, tarifs, choices);
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
    case "instrument_qualification":
      calculateInstrumentQualification(result, tarifs, choices);
      break;
    default:
      throw new Error(`Type de demande inconnu: ${choices.requestType}`);
  }

  if (settings.applyCommonOptions) addCommonOptions(result, tarifs, choices);
  if (settings.applyUrgency) addUrgency(result, tarifs, choices);
  if (settings.applyBillingMinimum) applyBillingMinimum(result, tarifs);
  if (settings.applyContext) applyContext(result, tarifs, choices);
  if (!settings.applyContext) {
    result.billedEstimate = { ...result.technicalValue };
    result.context = null;
  }
  markStatus(result);

  result.technicalValue = roundRange(result.technicalValue, tarifs.rounding);
  result.billedEstimate = roundRange(result.billedEstimate, tarifs.rounding);
  result.inKindContribution = roundRange(result.inKindContribution, tarifs.rounding);
  for (const item of result.items) {
    if (Number.isFinite(item.totalMin)) item.totalMin = roundRange({ min: item.totalMin, max: item.totalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.totalMax)) item.totalMax = roundRange({ min: item.totalMax, max: item.totalMax }, tarifs.rounding).max;
  }

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
    contextMarkup: { min: 0, max: 0 },
    trainingGroups: [],
    items: [],
    exclusions: [],
    warnings: [],
    assumptions: []
  };
}

function cleanAnswersForRequest(prestations, requestType, answers, people = []) {
  if (!NIRSApp.allVisibleFields) return { ...answers };
  const clean = { requestType };
  for (const field of NIRSApp.allVisibleFields(prestations, requestType, answers || {})) {
    if (Object.prototype.hasOwnProperty.call(answers || {}, field.id)) {
      clean[field.id] = answers[field.id];
    } else if (Object.prototype.hasOwnProperty.call(field, "default")) {
      clean[field.id] = field.default;
    }
  }
  clean._people = people;
  clean._explicitTrainingKeys = answers?._explicitTrainingKeys;
  const peopleById = new Map((Array.isArray(people) ? people : []).map((person) => [person.id, person]));
  if (requestType === "spectra_acquisition" && clean.serviceMode === "self_service" && Array.isArray(answers?.operatorIds)) {
    clean.operatorIds = [...new Set(answers.operatorIds)];
    clean.operators = clean.operatorIds.map((id) => peopleById.get(id)).filter(Boolean);
  }
  if (requestType === "spectra_acquisition" && clean.serviceMode === "self_service" && Array.isArray(answers?.operators)) {
    clean.operators = clean.operators || answers.operators;
  }
  if (requestType === "initial_training" && Array.isArray(answers?.participantIds)) {
    clean.participantIds = [...new Set(answers.participantIds)];
    clean.participants = clean.participantIds.map((id) => peopleById.get(id)).filter(Boolean);
    clean.people = clean.participants.length || clean.people;
  }
  if (requestType === "initial_training" && Array.isArray(answers?.participants)) {
    clean.participants = clean.participants || answers.participants;
    clean.people = answers.participants.length || clean.people;
  }
  return clean;
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
  const baseMin = result.technicalValue.min;
  const baseMax = result.technicalValue.max;
  if (baseMin <= 0 && baseMax <= 0) return;
  addDerivedItem(
    result,
    "global_urgent_markup",
    urgent.label,
    1,
    urgent.unit,
    baseMin * Number(urgent.min),
    baseMax * Number(urgent.max),
    "Majoration d'urgence appliquée une seule fois au total calculable",
    true
  );
}

function participantKey(person, instrumentId) {
  const id = String(person?.id || "").trim();
  if (id) return `${id}:${instrumentId}`;
  const name = participantName(person).toLowerCase();
  return name ? `${name}:${instrumentId}` : "";
}

function upsertTrainingRequirement(trainingRequirements, key, person, instrumentId, source, quoteItem, request) {
  if (!key) return;
  const existing = trainingRequirements.get(key);
  trainingRequirements.set(key, {
    ...(existing || {}),
    ...person,
    instrumentId,
    source: existing?.source && existing.source !== source ? "explicit+autonomous" : source,
    parentItemId: existing?.parentItemId || quoteItem?.id || null,
    parentLabel: existing?.parentLabel || request?.label || ""
  });
}

function collectExplicitTrainingRequirements(trainingRequirements, sourceItems, prestations, people) {
  for (const quoteItem of Array.isArray(sourceItems) ? sourceItems : []) {
    if (quoteItem.requestType !== "initial_training") continue;
    const answers = cleanAnswersForRequest(prestations, quoteItem.requestType, {
      ...(quoteItem.answers || {}),
      requestType: quoteItem.requestType
    }, people);
    const instrumentId = answers.instrument;
    if (!instrumentId || !Array.isArray(answers.participants)) continue;
    answers.participants.forEach((person) => {
      const key = participantKey(person, instrumentId);
      upsertTrainingRequirement(trainingRequirements, key, person, instrumentId, "explicit", quoteItem, { label: "Formation initiale" });
    });
  }
}

function collectAutonomousTraining(trainingRequirements, quoteItem, request, answers) {
  if (answers.requestType !== "spectra_acquisition" || answers.serviceMode !== "self_service" || !answers.instrument) return;
  for (const person of operatorsRequiringTraining(answers, answers.instrument)) {
    const key = participantKey(person, answers.instrument);
    upsertTrainingRequirement(trainingRequirements, key, person, answers.instrument, "autonomous", quoteItem, request);
  }
}

function addAggregateTrainingRequirements(result, tarifs, trainingRequirements) {
  const byInstrument = new Map();
  trainingRequirements.forEach((person) => {
    const group = byInstrument.get(person.instrumentId) || [];
    group.push(person);
    byInstrument.set(person.instrumentId, group);
  });
  byInstrument.forEach((people, instrumentId) => {
    addGroupedTrainingLine(result, tarifs, instrumentId, people);
    result.trainingGroups.push({
      instrumentId,
      participantIds: people.map((person) => person.id).filter(Boolean),
      participants: people.map((person) => ({
        id: person.id,
        firstName: person.firstName || "",
        lastName: person.lastName || ""
      }))
    });
    return;
    const instrument = instrumentFrom(tarifs, instrumentId);
    addTrainingForPeople(
      result,
      tarifs,
      instrumentId,
      people,
      `Formation autonome nominative à prévoir - ${instrument.label}`,
      "global_"
    );
    const touched = result.items.slice(-Math.min(2, people.length > 1 ? 2 : 1));
    touched.forEach((item) => {
      item.parentLabel = "Formation automatique";
      item.parentItemId = people[0]?.parentItemId || null;
    });
  });
  if (trainingRequirements.size) {
    result.warnings.push("Les formations automatiques sont dédupliquées par utilisateur et par instrument.");
    result.assumptions.push("Une habilitation déclarée comme déjà acquise devra être confirmée par le plateau.");
  }
}

function applyAggregateBillingMinimum(result, tarifs) {
  // Minimum administratif global : appliqué une seule fois au pré-devis agrégé.
  applyBillingMinimum(result, tarifs);
  const item = result.items.find((entry) => entry.id === "billing_minimum_adjustment");
  if (item) item.id = "global_billing_minimum_adjustment";
}

function applyAggregateContext(result, tarifs, quoteState) {
  const resolved = contextFrom(tarifs, quoteState.context);
  const contextId = resolved.id;
  const context = resolved.context;
  result.context = {
    id: contextId,
    label: context.label,
    description: context.description,
    display: context.display || null
  };

  if (context.mode === "in_kind") {
    const share = context.billedShare;
    result.billedEstimate = {
      min: result.technicalValue.min * Number(share.min),
      max: result.technicalValue.max * Number(share.max)
    };
    result.inKindContribution = {
      min: Math.max(0, result.technicalValue.min - result.billedEstimate.max),
      max: Math.max(0, result.technicalValue.max - result.technicalValue.max * Number(share.min))
    };
    result.assumptions.push(context.notice);
    return;
  }

  const coefficient = context.costCoefficient || { min: 1, max: 1 };
  result.billedEstimate = {
    min: result.technicalValue.min * Number(coefficient.min),
    max: result.technicalValue.max * Number(coefficient.max)
  };
  result.contextMarkup = {
    min: result.billedEstimate.min - result.technicalValue.min,
    max: result.billedEstimate.max - result.technicalValue.max
  };

  if (context.mode === "markup") {
    result.items.push({
      id: "context_markup",
      label: `Majoration de contexte - ${context.label}`,
      quantity: 1,
      unit: "coefficient",
      unitPriceMin: Number(coefficient.min),
      unitPriceMax: Number(coefficient.max),
      totalMin: result.contextMarkup.min,
      totalMax: result.contextMarkup.max,
      pricingMode: "coefficient",
      mandatory: true,
      reason: context.description
    });
  }
}

function aggregateQuote(config, quoteState) {
  const tarifs = config.tarifs || config;
  const prestations = config.prestations || {};
  const result = emptyAggregate(config);
  const sourceItems = Array.isArray(quoteState.items) ? quoteState.items : [];
  const people = Array.isArray(quoteState.people) ? quoteState.people : [];
  const trainingRequirements = new Map();
  collectExplicitTrainingRequirements(trainingRequirements, sourceItems, prestations, people);
  const explicitTrainingKeys = new Set([...trainingRequirements.keys()]);

  for (const quoteItem of sourceItems) {
    const request = prestations.requestTypes?.[quoteItem.requestType];
    if (!request) {
      result.warnings.push(`Prestation inconnue ignorée: ${quoteItem.requestType}`);
      continue;
    }
    const answers = cleanAnswersForRequest(prestations, quoteItem.requestType, {
      ...(quoteItem.answers || {}),
      requestType: quoteItem.requestType,
      _explicitTrainingKeys: explicitTrainingKeys
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
      const line = calculateSingleQuote(tarifs, answers, {
        applyCommonOptions: false,
        applyUrgency: false,
        applyBillingMinimum: false,
        applyContext: false,
        addDisclaimers: false,
        includeAutonomousTraining: false
      });
      line.itemId = quoteItem.id;
      line.requestType = quoteItem.requestType;
      line.label = request.label;
      line.summary = NIRSApp.describeAnswers ? NIRSApp.describeAnswers(config, quoteItem.requestType, answers) : request.label;
      result.itemResults.push(line);
      if (quoteItem.requestType === "initial_training") {
        line.summary = `${line.summary || request.label} - chiffrage regroupé dans les formations nominatives`;
        line.technicalValue = { min: 0, max: 0 };
        line.items = [];
      } else {
        result.technicalValue.min += line.technicalValue.min;
        result.technicalValue.max += line.technicalValue.max;
        result.items.push(...line.items.map((item) => ({ ...item, parentItemId: quoteItem.id, parentLabel: request.label })));
      }
      result.exclusions.push(...line.exclusions);
      result.warnings.push(...line.warnings);
      result.assumptions.push(...line.assumptions);
      collectAutonomousTraining(trainingRequirements, quoteItem, request, answers);
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

  addAggregateTrainingRequirements(result, tarifs, trainingRequirements);
  addAggregateUrgency(result, tarifs, quoteState);
  applyAggregateBillingMinimum(result, tarifs);
  applyAggregateContext(result, tarifs, quoteState);

  result.technicalValue = roundRange(result.technicalValue, tarifs.rounding);
  result.billedEstimate = roundRange(result.billedEstimate, tarifs.rounding);
  result.inKindContribution = roundRange(result.inKindContribution, tarifs.rounding);
  result.contextMarkup = roundRange(result.contextMarkup, tarifs.rounding);
  for (const item of result.items) {
    if (Number.isFinite(item.totalMin)) item.totalMin = roundRange({ min: item.totalMin, max: item.totalMin }, tarifs.rounding).min;
    if (Number.isFinite(item.totalMax)) item.totalMax = roundRange({ min: item.totalMax, max: item.totalMax }, tarifs.rounding).max;
  }

  const hasQuote = result.itemResults.some((item) => item.status === "partial" || item.status === "quote_required");
  const hasEstimated = result.technicalValue.min > 0 || result.technicalValue.max > 0;
  const hasIncomplete = result.itemResults.some((item) => item.status === "incomplete");
  result.status = hasQuote || hasIncomplete ? (hasEstimated ? "partial" : "quote_required") : (hasEstimated ? "estimated" : "quote_required");
  result.exclusions = [...new Set([...result.exclusions, ...tarifs.disclaimers])];
  result.warnings = [...new Set(result.warnings)];
  result.assumptions = [...new Set(result.assumptions)];
  return result;
}

function calculateQuote(configOrTarifs, quoteState) {
  if (quoteState?.items || configOrTarifs?.tarifs) {
    return aggregateQuote(configOrTarifs, quoteState || { items: [] });
  }
  return calculateSingleQuote(configOrTarifs, quoteState);
}

function assertNoDuplicateTrainingLines(result) {
  const seen = new Set();
  for (const item of result?.items || []) {
    if (!item.id?.startsWith("global_initial_training_")) continue;
    for (const personId of item.participantIds || []) {
      const key = `${personId}:${item.instrumentId || item.id}`;
      if (seen.has(key)) throw new Error(`Formation dupliquée: ${key}`);
      seen.add(key);
    }
  }
  return true;
}

NIRSApp.calculateQuote = calculateQuote;
NIRSApp.calculateSingleQuote = calculateSingleQuote;
NIRSApp.assertNoDuplicateTrainingLines = assertNoDuplicateTrainingLines;

})();


