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

  function validateItem(prestations, requestType, answers) {
    const errors = {};
    for (const field of allVisibleFields(prestations, requestType, answers)) {
      const value = answers[field.id];
      if (field.type === "number") {
        const number = Number(value);
        if (!Number.isFinite(number)) errors[field.id] = "Saisissez un nombre valide.";
        else if (field.min !== undefined && number < field.min) errors[field.id] = `La valeur minimale est ${field.min}.`;
        else if (field.max !== undefined && number > field.max) errors[field.id] = `La valeur maximale est ${field.max}.`;
        else if (field.integer && !Number.isInteger(number)) errors[field.id] = "Saisissez un entier.";
      }
      if ((field.type === "select" || field.type === "radio") && (value === undefined || value === "")) {
        errors[field.id] = "Choisissez une option.";
      }
      if ((field.type === "text" || field.type === "email" || field.type === "date" || field.type === "textarea") && field.required && !String(value || "").trim()) {
        errors[field.id] = `Complétez le champ « ${field.label} ».`;
      }
    }
    if (requestType === "spectra_acquisition" && answers?.serviceMode === "self_service") {
      const operators = Array.isArray(answers.operators) ? answers.operators : [];
      if (!operators.length) {
        errors.operatorIds = "Sélectionnez au moins un utilisateur de l'instrument.";
      }
      operators.forEach((operator, index) => {
        const label = `Utilisateur ${index + 1}`;
        const key = `people.${operator.id || index}`;
        if (!String(operator.firstName || "").trim()) errors[`${key}.firstName`] = `${label} : prénom obligatoire.`;
        if (!String(operator.lastName || "").trim()) errors[`${key}.lastName`] = `${label} : nom obligatoire.`;
        const status = trainingStatusFor(operator, answers.instrument);
        const explicitCoverage = answers._explicitTrainingKeys instanceof Set
          && answers._explicitTrainingKeys.has(personInstrumentKey(operator.id, answers.instrument));
        if (!explicitCoverage && !["trained", "untrained", "unknown"].includes(status)) {
          errors[`${key}.trainingStatus`] = `${label} : statut de formation obligatoire.`;
        }
      });
    }
    if (requestType === "initial_training") {
      const participants = Array.isArray(answers.participants) ? answers.participants : [];
      if (!participants.length) errors.participantIds = "Sélectionnez au moins un participant à former.";
      participants.forEach((participant, index) => {
        const label = `Participant ${index + 1}`;
        const key = `people.${participant.id || index}`;
        if (!String(participant.firstName || "").trim()) errors[`${key}.firstName`] = `${label} : prénom obligatoire.`;
        if (!String(participant.lastName || "").trim()) errors[`${key}.lastName`] = `${label} : nom obligatoire.`;
      });
    }
    return errors;
  }

  function trainingStatusFor(person, instrumentId) {
    const scoped = person?.trainingStatusByInstrument?.[instrumentId] || person?.trainedInstruments?.[instrumentId];
    if (typeof scoped === "string") return scoped;
    return scoped?.status || person?.trainingStatus || "";
  }

  function personInstrumentKey(personId, instrumentId) {
    return `${String(personId || "").trim()}:${String(instrumentId || "").trim()}`;
  }

  function defaultAnswersForRequest(prestations, requestType) {
    const answers = { requestType };
    for (const field of requestFields(prestations, requestType)) {
      if (Object.prototype.hasOwnProperty.call(field, "default")) answers[field.id] = field.default;
    }
    return answers;
  }

  function pruneHiddenAnswers(prestations, requestType, answers) {
    const next = { requestType };
    for (const field of allVisibleFields(prestations, requestType, answers)) {
      if (Object.prototype.hasOwnProperty.call(answers, field.id)) next[field.id] = answers[field.id];
      else if (Object.prototype.hasOwnProperty.call(field, "default")) next[field.id] = field.default;
    }
    if (requestType === "spectra_acquisition" && next.serviceMode === "self_service" && Array.isArray(answers.operatorIds)) {
      next.operatorIds = answers.operatorIds;
    }
    if (requestType === "spectra_acquisition" && next.serviceMode === "self_service" && Array.isArray(answers.operators)) {
      next.operators = answers.operators;
    }
    if (requestType === "initial_training" && Array.isArray(answers.participantIds)) {
      next.participantIds = answers.participantIds;
      next.people = answers.participantIds.length || next.people;
    }
    if (requestType === "initial_training" && Array.isArray(answers.participants)) {
      next.participants = answers.participants;
      next.people = answers.participants.length || next.people;
    }
    return next;
  }

  function fieldOptions(config, field) {
    if (field.source === "instruments") {
      return Object.entries(config.tarifs.instruments).map(([value, instrument]) => ({ value, label: instrument.label }));
    }
    if (field.source === "contexts") {
      return Object.entries(config.tarifs.contexts).map(([value, context]) => ({ value, label: context.label, description: context.description }));
    }
    return field.options || [];
  }

  function describeAnswers(config, requestType, answers) {
    const labels = [];
    const instrumentId = answers.instrument || answers.sourceInstrument;
    if (instrumentId && config.tarifs.instruments[instrumentId]) labels.push(config.tarifs.instruments[instrumentId].shortLabel || config.tarifs.instruments[instrumentId].label);
    if (answers.serviceMode) {
      const field = requestFields(config.prestations, requestType).find((entry) => entry.id === "serviceMode");
      const option = field?.options?.find((entry) => entry.value === answers.serviceMode);
      if (option) labels.push(option.label);
    }
    if (answers.hours) labels.push(`${answers.hours} h`);
    if (answers.reservedDays) labels.push(`${answers.reservedDays} jour(s)`);
    if (Array.isArray(answers.operators) && answers.operators.length) labels.push(`${answers.operators.length} utilisateur(s)`);
    if (Array.isArray(answers.participants) && answers.participants.length) labels.push(`${answers.participants.length} participant(s)`);
    if (answers.samples) labels.push(`${answers.samples} échantillons`);
    if (answers.spectra) labels.push(`${answers.spectra} spectres`);
    if (answers.properties) labels.push(`${answers.properties} propriété(s)`);
    if (answers.models) labels.push(`${answers.models} modèle(s)`);
    return labels.join(", ");
  }

  NIRSApp.isVisible = isVisible;
  NIRSApp.allVisibleFields = allVisibleFields;
  NIRSApp.validateItem = validateItem;
  NIRSApp.defaultAnswersForRequest = defaultAnswersForRequest;
  NIRSApp.pruneHiddenAnswers = pruneHiddenAnswers;
  NIRSApp.fieldOptions = fieldOptions;
  NIRSApp.describeAnswers = describeAnswers;
})();
