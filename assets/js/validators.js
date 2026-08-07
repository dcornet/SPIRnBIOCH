(function () {
  "use strict";

  const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};

  function isVisible(field, state) {
    if (!field.visibleWhen) return true;
    if (Array.isArray(field.visibleWhen.all)) {
      return field.visibleWhen.all.every((condition) => matchesCondition(condition, state));
    }
    if (Array.isArray(field.visibleWhen.any)) {
      return field.visibleWhen.any.some((condition) => matchesCondition(condition, state));
    }
    return matchesCondition(field.visibleWhen, state);
  }

  function matchesCondition(condition, state) {
    if (Array.isArray(condition.all)) return condition.all.every((entry) => matchesCondition(entry, state));
    if (Array.isArray(condition.any)) return condition.any.some((entry) => matchesCondition(entry, state));
    const current = state[condition.field];
    if (Object.prototype.hasOwnProperty.call(condition, "equals")) return current === condition.equals;
    if (Array.isArray(condition.in)) return condition.in.includes(current);
    if (Object.prototype.hasOwnProperty.call(condition, "notEquals")) return current !== condition.notEquals;
    return true;
  }

  function requestFields(prestations, requestType) {
    return prestations.requestTypes?.[requestType]?.fields || [];
  }

  function allVisibleFields(prestations, requestType, state) {
    return requestFields(prestations, requestType).filter((field) => isVisible(field, state));
  }

  function isRequired(field, answers) {
    if (field.requiredWhen) return matchesCondition(field.requiredWhen, answers);
    return field.required === true;
  }

  function validateItem(prestations, requestType, answers) {
    const errors = {};
    const normalizedAnswers = migrateLegacyAnswers(requestType, answers || {});
    for (const field of allVisibleFields(prestations, requestType, normalizedAnswers)) {
      const value = normalizedAnswers[field.id];
      const required = isRequired(field, normalizedAnswers);
      const empty = value === undefined || value === null || value === "";
      if (field.type === "number") {
        if (!required && empty) continue;
        const number = Number(value);
        if (!Number.isFinite(number)) errors[field.id] = "Saisissez un nombre valide.";
        else if (field.min !== undefined && number < field.min) errors[field.id] = `La valeur minimale est ${field.min}.`;
        else if (field.max !== undefined && number > field.max) errors[field.id] = `La valeur maximale est ${field.max}.`;
        else if (field.integer && !Number.isInteger(number)) errors[field.id] = "Saisissez un entier.";
      }
      if ((field.type === "select" || field.type === "radio") && required && empty) {
        errors[field.id] = field.id === "measurementDevice"
          ? "Choisissez une sonde ou un dispositif de mesure."
          : "Choisissez une option.";
      }
      if ((field.type === "text" || field.type === "email" || field.type === "date" || field.type === "textarea") && required && !String(value || "").trim()) {
        errors[field.id] = `Complétez le champ « ${field.label} ».`;
      }
      if ((field.type === "text" || field.type === "textarea") && field.maxLength && String(value || "").length > Number(field.maxLength)) {
        errors[field.id] = `Renseignez au maximum ${field.maxLength} caractères pour « ${field.label} ».`;
      }
      if ((field.type === "text" || field.type === "textarea") && field.minLength && String(value || "").trim().length > 0 && String(value || "").trim().length < Number(field.minLength)) {
        errors[field.id] = `Renseignez au moins ${field.minLength} caractères pour « ${field.label} ».`;
      }
    }
    if (requestType === "spectra_acquisition") {
      const halfDays = Number(answers.halfDays);
      if (!Number.isInteger(halfDays) || halfDays <= 0) {
        errors.halfDays = "Renseignez un nombre entier de demi-journées.";
      }
      const devices = NIRSApp.fieldOptions?.(
        { tarifs: globalThis.NIRS_CONFIG?.tarifs || {} },
        { source: "measurementDevices", currentInstrument: answers.instrument }
      ) || [];
      if (answers.measurementDevice && !devices.some((device) => device.value === answers.measurementDevice)) {
        errors.measurementDevice = "Le dispositif sélectionné n’est pas compatible avec ce spectromètre.";
      }
      const instrument = globalThis.NIRS_CONFIG?.tarifs?.instruments?.[answers.instrument] || {};
      if (instrument.transportPolicy === "forbidden" && answers.measurementLocation === "transport_required") {
        errors.measurementLocation = "Ce spectromètre est utilisé uniquement au laboratoire Bioch&SPIR.";
      }
    }
    if (requestType === "model_maintenance") {
      Object.assign(errors, validateMaintenanceItem(normalizedAnswers));
    }
    if (requestType === "initial_training") {
      if (!Array.isArray(normalizedAnswers.participantIds) || normalizedAnswers.participantIds.length < 1) {
        errors.participantIds = "Sélectionnez au moins un participant à former.";
      }
    }
    return errors;
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0;
  }

  function hasText(value) {
    return String(value || "").trim().length > 0;
  }

  function requireText(errors, answers, fieldId, message) {
    if (!hasText(answers[fieldId])) errors[fieldId] = message;
  }

  function requirePositive(errors, answers, fieldId, message) {
    if (!positiveNumber(answers[fieldId])) errors[fieldId] = message;
  }

  function validateMaintenanceItem(answers) {
    const errors = {};
    const type = migrateMaintenanceType(answers.maintenanceType);
    const allowed = new Set(["performance_audit", "contextual_validation", "bias_correction", "model_update", "instrument_transfer"]);
    if (!allowed.has(type)) errors.maintenanceType = "Choisissez un type d'intervention.";
    return errors;
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
  }

  function trainingStatusFor(person, instrumentId) {
    const assignment = person?.instrumentAssignments?.[instrumentId];
    if (assignment?.assigned) return assignment.trainingStatus || "";
    const scoped = person?.trainingStatusByInstrument?.[instrumentId] || person?.trainedInstruments?.[instrumentId];
    if (typeof scoped === "string") return scoped;
    return scoped?.status || person?.trainingStatus || "";
  }

  function trainingDateFor(person, instrumentId) {
    const assignment = person?.instrumentAssignments?.[instrumentId];
    if (assignment?.assigned) return assignment.trainingDate || "";
    const scoped = person?.trainingStatusByInstrument?.[instrumentId] || person?.trainedInstruments?.[instrumentId];
    return typeof scoped === "object" ? (scoped.date || scoped.trainingDate || "") : (person?.trainingDate || "");
  }

  function personInstrumentKey(personId, instrumentId) {
    return `${String(personId || "").trim()}:${String(instrumentId || "").trim()}`;
  }

  function parseLocalDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }

  function addOneCalendarYear(date) {
    const next = new Date(date.getFullYear() + 1, date.getMonth(), date.getDate());
    if (next.getMonth() !== date.getMonth()) return new Date(date.getFullYear() + 1, date.getMonth() + 1, 0);
    return next;
  }

  function isTrainingOlderThanOneYear(trainingDate, referenceDate) {
    const training = parseLocalDate(trainingDate);
    const reference = parseLocalDate(referenceDate);
    if (!training || !reference) return false;
    return reference.getTime() > addOneCalendarYear(training).getTime();
  }

  function instrumentAssignment(person, instrumentId) {
    const assignment = person?.instrumentAssignments?.[instrumentId];
    if (assignment) return assignment;
    return {
      assigned: false,
      trainingStatus: trainingStatusFor(person, instrumentId),
      trainingDate: trainingDateFor(person, instrumentId),
      trainingRequested: false
    };
  }

  function collectSelectedSpectraInstruments(state, config = {}) {
    const instruments = new Map();
    for (const item of state?.items || []) {
      if (item?.requestType !== "spectra_acquisition") continue;
      const instrumentId = item.answers?.instrument;
      if (!instrumentId) continue;
      const serviceMode = canonicalServiceMode(item.answers?.serviceMode || "autonomous_supported");
      if (serviceMode !== "autonomous_supported") continue;
      const instrumentConfig = config.tarifs?.instruments?.[instrumentId] || {};
      const current = instruments.get(instrumentId) || {
        id: instrumentId,
        label: instrumentConfig.label || instrumentId,
        shortLabel: instrumentConfig.shortLabel || instrumentConfig.label || instrumentId,
        effectiveMode: "autonomous_supported",
        hasAutonomousSupportedUse: false,
        hasPlateauOperatedUse: false,
        modes: new Set(),
        itemIds: []
      };
      current.itemIds.push(item.id);
      current.modes.add(serviceMode);
      current.hasAutonomousSupportedUse = true;
      instruments.set(instrumentId, current);
    }
    return Array.from(instruments.values()).map((entry) => ({
      ...entry,
      modes: Array.from(entry.modes)
    }));
  }

  function validateGlobalSpectraUsers(state, config = {}) {
    const selectedInstruments = collectSelectedSpectraInstruments(state, config);
    const people = Array.isArray(state?.people) ? state.people.filter((person) => !person.deleted) : [];
    const errors = {};
    const plannedStart = state?.project?.plannedStartDate || "";
    const plannedStartDate = parseLocalDate(plannedStart);
    if (!selectedInstruments.length) return { valid: true, errors, selectedInstruments, people };
    if (!people.length) errors.people = "Ajoutez au moins un utilisateur prévu pour les mesures.";
    for (const person of people) {
      const key = `people.${person.id}`;
      if (!String(person.firstName || "").trim()) errors[`${key}.firstName`] = "Prénom obligatoire.";
      if (!String(person.lastName || "").trim()) errors[`${key}.lastName`] = "Nom obligatoire.";
      if (!String(person.email || "").trim()) errors[`${key}.email`] = "Mail de contact obligatoire.";
      else if (!isEmail(person.email)) errors[`${key}.email`] = "Mail de contact invalide.";
      let hasAssignment = false;
      for (const instrument of selectedInstruments) {
        const assignment = instrumentAssignment(person, instrument.id);
        if (!assignment.assigned) continue;
        hasAssignment = true;
        if (!["trained", "untrained"].includes(assignment.trainingStatus)) {
          errors[`${key}.${instrument.id}.trainingStatus`] = "Formation effectuée à renseigner.";
        }
        if (assignment.trainingStatus === "trained") {
          const trainingDate = parseLocalDate(assignment.trainingDate);
          if (!assignment.trainingDate) errors[`${key}.${instrument.id}.trainingDate`] = "Date de formation obligatoire.";
          else if (!trainingDate) errors[`${key}.${instrument.id}.trainingDate`] = "Date de formation invalide.";
          else if (plannedStartDate && trainingDate.getTime() > plannedStartDate.getTime()) {
            errors[`${key}.${instrument.id}.trainingDate`] = "La date de formation ne peut pas être postérieure au début envisagé.";
          }
        }
      }
      if (!hasAssignment) errors[`${key}.instrumentAssignments`] = "Sélectionnez au moins un instrument pour cette personne.";
    }
    for (const instrument of selectedInstruments) {
      const covered = people.some((person) => instrumentAssignment(person, instrument.id).assigned);
      if (!covered) errors[`instruments.${instrument.id}`] = `Ajoutez au moins un utilisateur pour ${instrument.shortLabel}.`;
    }
    return {
      valid: Object.keys(errors).length === 0,
      errors,
      selectedInstruments,
      people
    };
  }

  function defaultAnswersForRequest(prestations, requestType) {
    const answers = { requestType };
    for (const field of requestFields(prestations, requestType)) {
      if (Object.prototype.hasOwnProperty.call(field, "default")) answers[field.id] = field.default;
    }
    return answers;
  }

  function pruneHiddenAnswers(prestations, requestType, answers) {
    const migrated = migrateLegacyAnswers(requestType, answers || {});
    const next = { requestType };
    for (const field of allVisibleFields(prestations, requestType, migrated)) {
      if (Object.prototype.hasOwnProperty.call(migrated, field.id)) next[field.id] = migrated[field.id];
      else if (Object.prototype.hasOwnProperty.call(field, "default")) next[field.id] = field.default;
    }
    if (requestType === "spectra_acquisition" && canonicalServiceMode(next.serviceMode) === "autonomous_supported" && Array.isArray(migrated.operatorIds)) {
      next.operatorIds = migrated.operatorIds;
    }
    if (requestType === "spectra_acquisition" && canonicalServiceMode(next.serviceMode) === "autonomous_supported" && Array.isArray(migrated.operators)) {
      next.operators = migrated.operators;
    }
    if (requestType === "spectra_acquisition" && migrated.legacySpectraDetails) {
      next.legacySpectraDetails = migrated.legacySpectraDetails;
    }
    if (requestType === "spectra_acquisition" && migrated.measurementDeviceByInstrument) {
      next.measurementDeviceByInstrument = migrated.measurementDeviceByInstrument;
    }
    if (requestType === "initial_training" && Array.isArray(migrated.participantIds)) {
      next.participantIds = migrated.participantIds;
      next.people = migrated.participantIds.length || next.people;
    }
    if (requestType === "initial_training" && Array.isArray(migrated.participants)) {
      next.participants = migrated.participants;
      next.people = migrated.participants.length || next.people;
    }
    if (requestType === "model_maintenance") {
      next.legacyMaintenanceAnswers = migrated.legacyMaintenanceAnswers || legacyMaintenanceAnswers(migrated);
      next.maintenanceComment = migrated.maintenanceComment || "";
    }
    return next;
  }

  function migrateLegacyAnswers(requestType, answers) {
    const next = { ...(answers || {}) };
    if (requestType === "spectra_acquisition") {
      if ((next.samples !== undefined || next.replicates !== undefined) && !next.legacySpectraDetails) {
        next.legacySpectraDetails = {
          samples: next.samples,
          replicates: next.replicates
        };
      }
      if (!next.halfDays) {
        if (Number(next.hours) > 0) next.halfDays = Math.ceil(Number(next.hours) / 4);
        else if (Number(next.reservedDays) > 0) next.halfDays = Number(next.reservedDays) * 2;
      }
      if (next.measurementLocation === "platform" || next.measurementLocation === "field") {
        next.measurementLocation = next.measurementLocation === "field" ? "transport_required" : "bioch_spir_lab";
      }
      next.serviceMode = canonicalServiceMode(next.serviceMode);
      const instrument = globalThis.NIRS_CONFIG?.tarifs?.instruments?.[next.instrument] || {};
      if (instrument.transportPolicy === "forbidden" && next.measurementLocation === "transport_required") {
        next.measurementLocation = "bioch_spir_lab";
        next.transportMigrationWarning = "Ancien transport supprimé : mesures réalisées uniquement au laboratoire Bioch&SPIR.";
      }
    }
    if (requestType === "existing_model_predictions" && next.outlierCheck === true) {
      next.dataPreparationRequired = true;
    }
    if (requestType === "model_maintenance") {
      const previousType = next.maintenanceType;
      next.maintenanceType = migrateMaintenanceType(previousType);
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
      modelName: "Modèle",
      instrument: "Instrument",
      propertyName: "Propriété ou trait",
      spectra: "Spectres",
      models: "Modèles ou propriétés",
      referenceSampleCount: "Valeurs de référence",
      modelsForValidation: "Modèles à valider",
      instrumentsCount: "Instruments concernés",
      predictionCount: "Couples prédiction-référence",
      biasProperties: "Propriétés",
      biasInstrumentsCount: "Instruments pour le biais",
      updateReason: "Motif de mise à jour",
      updateReasonOther: "Autre motif",
      newSpectra: "Nouvelles données",
      updateProperties: "Propriétés à mettre à jour",
      sourceInstrument: "Spectromètre source",
      targetInstrument: "Spectromètre cible",
      pairedSpectraStatus: "Échantillons appariés",
      pairedSampleCount: "Nombre d'échantillons appariés",
      referenceDataAvailability: "Valeurs de référence disponibles",
      propertiesCount: "Propriétés concernées",
      independentTargetValidation: "Jeu indépendant cible",
      independentValidationSampleCount: "Échantillons du jeu indépendant",
      transferTraits: "Traits à transférer",
      transferSamples: "Échantillons de transfert"
    };
    const legacyLines = Object.entries(legacy)
      .filter(([key, value]) => key !== "maintenanceComment" && key !== "comment" && value !== undefined && value !== null && String(value).trim() !== "")
      .map(([key, value]) => `${labels[key] || key} : ${value}.`);
    return [existing, ...legacyLines].filter(Boolean).join("\n");
  }

  function migrateMaintenanceType(type) {
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
      calibration_transfer: "instrument_transfer",
      other: "other"
    }[type] || type || "performance_audit";
  }

  function canonicalServiceMode(mode) {
    return {
      self_service: "autonomous_supported",
      assisted: "plateau_operated",
      full_service: "plateau_operated"
    }[mode] || mode || "autonomous_supported";
  }

  function fieldOptions(config, field) {
    if (field.source === "instruments") {
      return Object.entries(config.tarifs.instruments).map(([value, instrument]) => ({ value, label: instrument.label }));
    }
    if (field.source === "contexts") {
      return Object.entries(config.tarifs.contexts)
        .filter(([, context]) => context.publicVisible !== false)
        .sort((left, right) => Number(left[1].order || 999) - Number(right[1].order || 999))
        .map(([value, context]) => ({ value, label: context.label, description: context.description }));
    }
    if (field.source === "matrixPresentations") {
      return config.tarifs.matrixPresentations || [];
    }
    if (field.source === "measurementDevices") {
      return Object.entries(config.tarifs.spectralThroughputProfiles?.[field.currentInstrument || ""] || {})
        .map(([value, device]) => ({
          value,
          label: device.label,
          default: device.default === true,
          measurementWindow: device.measurementWindow,
          samplesPerHour: device.samplesPerHour,
          requiresValidation: device.requiresValidation === true
        }));
    }
    return field.options || [];
  }

  function describeAnswers(config, requestType, answers) {
    const labels = [];
    const migrated = migrateLegacyAnswers(requestType, answers || {});
    if (requestType === "model_maintenance") {
      const maintenanceType = migrated.maintenanceType;
      const typeField = requestFields(config.prestations, requestType).find((entry) => entry.id === "maintenanceType");
      const typeLabel = typeField?.options?.find((entry) => entry.value === maintenanceType)?.label;
      if (typeLabel) labels.push(typeLabel);
      if (migrated.maintenanceComment) labels.push(String(migrated.maintenanceComment).trim().slice(0, 120));
      return labels.join(", ");
    }
    if (requestType === "other_chemometrics") {
      if (answers.shortTitle) labels.push(answers.shortTitle);
      if (answers.description) labels.push(String(answers.description).trim().slice(0, 120));
      return labels.join(", ");
    }
    const instrumentId = answers.instrument || answers.sourceInstrument;
    if (instrumentId && config.tarifs.instruments[instrumentId]) labels.push(config.tarifs.instruments[instrumentId].shortLabel || config.tarifs.instruments[instrumentId].label);
    if (answers.serviceMode) {
      const field = requestFields(config.prestations, requestType).find((entry) => entry.id === "serviceMode");
      const option = field?.options?.find((entry) => entry.value === canonicalServiceMode(answers.serviceMode));
      if (option) labels.push(option.label);
    }
    if (requestType === "spectra_acquisition" && instrumentId && config.tarifs.instruments[instrumentId]) {
      const instrument = config.tarifs.instruments[instrumentId];
      if (instrument.transportPolicy === "forbidden") {
        labels.push("Mesures réalisées uniquement au laboratoire Bioch&SPIR");
      } else if (answers.measurementLocation === "transport_required" && instrument.transportPolicy === "included_portable") {
        labels.push("Utilisation hors laboratoire — instrument portable, sans supplément de transport");
      } else if (answers.measurementLocation === "transport_required" && instrument.transportPolicy === "fixed_fee") {
        const transportAmount = Number(instrument.transportFee ?? config.tarifs.options?.instrument_transport?.amount);
        labels.push(`Transport du spectromètre — ${NIRSApp.money ? NIRSApp.money(transportAmount, config.tarifs.metadata?.currency || "EUR") : `${transportAmount} €`} HT`);
      }
    }
    if (answers.halfDays) labels.push(`${answers.halfDays} demi-journée(s)`);
    if (answers.measurementDevice && config.tarifs.spectralThroughputProfiles?.[instrumentId]?.[answers.measurementDevice]) {
      labels.push(config.tarifs.spectralThroughputProfiles[instrumentId][answers.measurementDevice].label);
    }
    if (answers.spectra) labels.push(`${answers.spectra} spectres`);
    if (answers.properties) labels.push(`${answers.properties} propriété(s)`);
    if (answers.models) labels.push(`${answers.models} modèle(s)`);
    if (answers.comment) labels.push(String(answers.comment).trim().slice(0, 120));
    return labels.join(", ");
  }

  NIRSApp.isVisible = isVisible;
  NIRSApp.isRequired = isRequired;
  NIRSApp.allVisibleFields = allVisibleFields;
  NIRSApp.validateItem = validateItem;
  NIRSApp.defaultAnswersForRequest = defaultAnswersForRequest;
  NIRSApp.pruneHiddenAnswers = pruneHiddenAnswers;
  NIRSApp.fieldOptions = fieldOptions;
  NIRSApp.describeAnswers = describeAnswers;
  NIRSApp.trainingStatusFor = trainingStatusFor;
  NIRSApp.trainingDateFor = trainingDateFor;
  NIRSApp.personInstrumentKey = personInstrumentKey;
  NIRSApp.isTrainingOlderThanOneYear = isTrainingOlderThanOneYear;
  NIRSApp.collectSelectedSpectraInstruments = collectSelectedSpectraInstruments;
  NIRSApp.validateGlobalSpectraUsers = validateGlobalSpectraUsers;
})();
