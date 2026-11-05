(function () {
  "use strict";

  const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};
  const STORAGE_KEY = "nirs_spir_quote_draft_v2";
  const STEPS = ["Votre demande", "Composer le pré-devis", "Configurer les prestations", "Résumé"];

  function initForm(config) {
    const root = document.querySelector("#app");
    let state = createEmptyState(config);
    let step = 1;
    let highlightedGroup = "";
    let liveMessage = "";
    let storage = NIRSApp.safeStorage();
    let touchedFields = new Set();
    let attemptedSteps = new Set();
    let shouldFocusStepStart = false;

    function announce(message) {
      liveMessage = message;
      const live = document.querySelector("#live-message");
      if (live) live.textContent = message;
    }

    function saveDraft() {
      if (!storage) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(draftState(state, step, config)));
      } catch (_error) {
        announce("Le brouillon n'a pas pu être enregistré localement.");
      }
    }

    function fullRender() {
      state.people = Array.isArray(state.people) ? state.people : [];
      syncUrgencyFromPlannedStart();
      state.items.forEach(ensureMeasurementDeviceCompatibility);
      root.innerHTML = "";
      root.append(renderInstitutionalBanner(config));
      root.append(renderHeader(config, step));
      root.append(renderDraftNotice(storage, state, replaceState, reset));
      const progress = renderProgress(step, state, itemStatus, config);
      root.append(progress);
      attachProgressEvents(progress);
      root.append(renderLiveEstimateSafely());
      const form = NIRSApp.createElement("form", "wizard");
      form.noValidate = true;
      form.addEventListener("submit", (event) => event.preventDefault());
      try {
        if (step === 1) renderRequestDetails(form);
        if (step === 2) renderCatalog(form);
        if (step === 3) renderConfiguration(form);
        if (step === 4) renderSummary(form);
      } catch (error) {
        console.error("Erreur de rendu du formulaire", error);
        form.append(renderStepRenderError());
      }
      root.append(form);
      const currentStepElement = form.querySelector(".app-step") || form;
      root.append(renderEducational(config));
      const live = NIRSApp.createElement("div", "live-message");
      live.id = "live-message";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      live.textContent = liveMessage;
      root.append(live);
      if (shouldFocusStepStart) {
        shouldFocusStepStart = false;
        requestAnimationFrame(() => focusStepStart(currentStepElement));
      }
    }

    function renderStepRenderError() {
      const panel = NIRSApp.createElement("section", "step-panel app-step config-panel--error");
      panel.innerHTML = `
        <h2>Le formulaire n'a pas pu être affiché.</h2>
        <p class="error">Une erreur de rendu empêche l'affichage complet de cette étape. Les données du brouillon local sont conservées.</p>
        <button type="button" class="button-secondary" data-go-catalog>Revenir au catalogue</button>
      `;
      panel.querySelector("[data-go-catalog]").addEventListener("click", () => setStep(2));
      return panel;
    }

    function renderLiveEstimateSafely() {
      try {
        return renderLiveEstimate();
      } catch (error) {
        console.error("Erreur de rendu du montant dynamique", error);
        return renderLiveEstimateFallback();
      }
    }

    function renderLiveEstimateFallback() {
      const node = NIRSApp.createElement("aside", "live-estimate live-estimate--error");
      node.id = "live-estimate";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.innerHTML = `
        <div>
          <span>Fourchette indicative</span>
          <strong>À compléter</strong>
          <small>Contexte à choisir</small>
        </div>
        <div>
          <span>Coût complet</span>
          <strong>Indisponible temporairement</strong>
        </div>
      `;
      return node;
    }

    function replaceState(next) {
      state = next;
      step = Number.isInteger(next.currentStep) ? Math.min(4, Math.max(1, next.currentStep)) : step;
      shouldFocusStepStart = true;
      saveDraft();
      fullRender();
    }

    function reset() {
      state = createEmptyState(config);
      step = 1;
      if (storage) storage.removeItem(STORAGE_KEY);
      announce("Le pré-devis a été réinitialisé.");
      fullRender();
    }

    function setStep(next) {
      const resolved = Math.min(4, Math.max(1, next));
      if (resolved === step) return;
      step = resolved;
      shouldFocusStepStart = true;
      saveDraft();
      fullRender();
    }

    function requestStepChange(next) {
      attemptedSteps.add(step);
      if (!canContinueFromStep(step, state, itemStatus, config)) {
        fullRender();
        requestAnimationFrame(focusFirstError);
        return;
      }
      setStep(next);
    }

    function requestDirectStepChange(next) {
      const resolved = Math.min(4, Math.max(1, Number(next)));
      if (!resolved || resolved === step) return;
      if (resolved < step) {
        setStep(resolved);
        return;
      }
      const blockingStep = firstBlockingStepBefore(resolved, state, itemStatus, config);
      if (blockingStep) {
        attemptedSteps.add(blockingStep);
        if (blockingStep === step) {
          fullRender();
          requestAnimationFrame(focusFirstError);
          return;
        }
        step = blockingStep;
        shouldFocusStepStart = true;
        saveDraft();
        fullRender();
        requestAnimationFrame(focusFirstError);
        return;
      }
      setStep(resolved);
    }

    function attachProgressEvents(scope) {
      scope.querySelectorAll("[data-step-target]").forEach((control) => {
        control.addEventListener("click", () => requestDirectStepChange(control.dataset.stepTarget));
      });
    }

    function addItem(requestType, presetAnswers = {}) {
      const request = config.prestations.requestTypes[requestType];
      if (!request) return;
      const item = {
        id: NIRSApp.makeId("item"),
        requestType,
        answers: {
          ...NIRSApp.defaultAnswersForRequest(config.prestations, requestType),
          ...presetAnswers,
          requestType
        },
        completed: false
      };
      ensureMeasurementDeviceCompatibility(item);
      ensureCustomAnswers(item);
      item.completed = Object.keys(NIRSApp.validateItem(config.prestations, requestType, answersForItem(item))).length === 0;
      state.items.push(item);
      announce(`${request.label} ajouté au pré-devis.`);
      saveDraft();
      fullRender();
    }

    function removeItem(itemId) {
      const item = state.items.find((entry) => entry.id === itemId);
      state.items = state.items.filter((entry) => entry.id !== itemId);
      announce(`${item ? config.prestations.requestTypes[item.requestType].label : "Prestation"} supprimée.`);
      saveDraft();
      fullRender();
    }

    function duplicateItem(itemId) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      state.items.push({ ...NIRSApp.clone(item), id: NIRSApp.makeId("item") });
      announce(`${config.prestations.requestTypes[item.requestType].label} dupliquée.`);
      saveDraft();
      fullRender();
    }

    function updateContext(key, value) {
      if (key === "urgent") {
        state.urgent = value;
        state.urgentSource = value ? "manual" : "none";
        saveDraft();
        updateLiveEstimate();
        return;
      }
      state[key] = value;
      saveDraft();
      fullRender();
    }

    function updateRequester(key, value) {
      const next = {
        ...defaultRequester(),
        ...(state.requester || {}),
        [key]: value
      };
      state.requester = normalizeRequesterUnit(next, config);
      saveDraft();
      if (key === "unitCode") {
        fullRender();
        return;
      }
      refreshVisibleRequestErrors();
      updateNavigationState();
      updateLiveEstimate();
    }

    function updateProject(key, value) {
      state.project = {
        ...defaultProject(),
        ...(state.project || {}),
        [key]: value
      };
      syncUrgencyFromPlannedStart();
      saveDraft();
      refreshVisibleRequestErrors();
      refreshUrgencyControls();
      updateNavigationState();
      updateLiveEstimate();
    }

    function markFieldTouched(fieldKey) {
      touchedFields.add(fieldKey);
      refreshVisibleRequestErrors();
      updateNavigationState();
    }

    function updateAnswer(itemId, fieldId, value, shouldRenderDependents) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const previousInstrument = item.answers.instrument;
      const previousMeasurementDevice = item.answers.measurementDevice;
      item.answers[fieldId] = value;
      if (item.requestType === "spectra_acquisition" && fieldId === "measurementDevice" && value) {
        delete item.answers.measurementDeviceNeedsReview;
      }
      syncDerivedItemAnswers(item, fieldId, { previousInstrument, previousMeasurementDevice });
      item.answers = NIRSApp.pruneHiddenAnswers(config.prestations, item.requestType, item.answers);
      ensureCustomAnswers(item);
      item.completed = Object.keys(NIRSApp.validateItem(config.prestations, item.requestType, answersForItem(item))).length === 0;
      saveDraft();
      refreshItemStatus(itemId);
      updateNavigationState();
      updateLiveEstimate();
      const affectsGlobalUsers = item.requestType === "spectra_acquisition" && ["instrument", "serviceMode"].includes(fieldId);
      if (shouldRenderDependents && affectsGlobalUsers) fullRender();
      else if (shouldRenderDependents) renderConfigurationPanelBody(itemId);
      else refreshFieldErrors(item);
    }

    function addPerson(itemId, collection) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const person = defaultPerson();
      state.people.push(person);
      setPersonSelected(item, collection, person.id, true);
      syncDerivedPeopleCount(item);
      item.completed = Object.keys(NIRSApp.validateItem(config.prestations, item.requestType, answersForItem(item))).length === 0;
      saveDraft();
      renderConfigurationPanelBody(itemId);
      refreshItemStatus(itemId);
      updateNavigationState();
      updateLiveEstimate();
    }

    function removePerson(itemId, collection, personId) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      setPersonSelected(item, collection, personId, false);
      syncDerivedPeopleCount(item);
      item.completed = Object.keys(NIRSApp.validateItem(config.prestations, item.requestType, answersForItem(item))).length === 0;
      saveDraft();
      renderConfigurationPanelBody(itemId);
      refreshItemStatus(itemId);
      updateNavigationState();
      updateLiveEstimate();
    }

    function updatePerson(itemId, collection, personId, key, value) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const person = state.people.find((entry) => entry.id === personId);
      if (!person) return;
      if (key === "trainingStatus" || key === "trainingDate") {
        const instrumentId = item.answers.instrument;
        const current = person.trainingStatusByInstrument?.[instrumentId] || {};
        person.trainingStatusByInstrument = {
          ...(person.trainingStatusByInstrument || {}),
          [instrumentId]: {
            ...current,
            [key === "trainingStatus" ? "status" : "date"]: value,
            source: key === "trainingStatus" && value !== "trained" ? "autonomous_use" : "user_declaration"
          }
        };
      } else {
        person[key] = value;
      }
      syncDerivedPeopleCount(item);
      item.completed = Object.keys(NIRSApp.validateItem(config.prestations, item.requestType, answersForItem(item))).length === 0;
      saveDraft();
      if (key === "trainingStatus") renderConfigurationPanelBody(itemId);
      refreshItemStatus(itemId);
      updateNavigationState();
      updateLiveEstimate();
    }

    function togglePersonSelection(itemId, collection, personId, selected) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      setPersonSelected(item, collection, personId, selected);
      syncDerivedPeopleCount(item);
      item.completed = Object.keys(NIRSApp.validateItem(config.prestations, item.requestType, answersForItem(item))).length === 0;
      saveDraft();
      renderConfigurationPanelBody(itemId);
      refreshItemStatus(itemId);
      updateNavigationState();
      updateLiveEstimate();
    }

    function setPersonSelected(item, collection, personId, selected) {
      const key = collection === "operators" ? "operatorIds" : "participantIds";
      const ids = new Set(Array.isArray(item.answers[key]) ? item.answers[key] : []);
      if (selected) ids.add(personId);
      else ids.delete(personId);
      item.answers[key] = [...ids];
    }

    function answersForItem(item) {
      const answers = {
        ...(item.answers || {}),
        _people: state.people || [],
        _explicitTrainingKeys: explicitTrainingKeysForState(item.id)
      };
      if (Array.isArray(answers.operatorIds)) {
        answers.operators = answers.operatorIds.map((id) => personById(id)).filter(Boolean);
      }
      if (Array.isArray(answers.participantIds)) {
        answers.participants = answers.participantIds.map((id) => personById(id)).filter(Boolean);
        answers.people = answers.participantIds.length || answers.people;
      }
      return answers;
    }

    function personById(personId) {
      return (state.people || []).find((person) => person.id === personId);
    }

    function trainingStatusForPerson(person, instrumentId) {
      return person.trainingStatusByInstrument?.[instrumentId]?.status || "";
    }

    function trainingDateForPerson(person, instrumentId) {
      return person.trainingStatusByInstrument?.[instrumentId]?.date || "";
    }

    function explicitTrainingKeysForState(exceptItemId = "") {
      const keys = new Set();
      state.items.forEach((entry) => {
        if (entry.id === exceptItemId || entry.requestType !== "initial_training") return;
        const instrumentId = entry.answers.instrument;
        if (!instrumentId) return;
        (entry.answers.participantIds || []).forEach((personId) => keys.add(personInstrumentKey(personId, instrumentId)));
      });
      return keys;
    }

    function hasExplicitTraining(personId, instrumentId, exceptItemId = "") {
      return state.items.some((entry) => entry.id !== exceptItemId
        && entry.requestType === "initial_training"
        && entry.answers.instrument === instrumentId
        && (entry.answers.participantIds || []).includes(personId));
    }

    function trainingCoverageLabel(item, personId, instrumentId) {
      const person = personById(personId);
      const name = personName(person);
      const instrument = config.tarifs.instruments[instrumentId].label || instrumentId;
      const status = trainingStatusForPerson(person, instrumentId);
      if (status === "trained") return `${name} — formation déjà suivie sur ${instrument}`;
      if (hasExplicitTraining(personId, instrumentId)) return `Formation prévue dans le pré-devis : ${name} — ${instrument}`;
      return `Formation initiale obligatoire — ${instrument}, ajoutée automatiquement pour l'utilisation autonome.`;
    }


    function localDateFromInput(value) {
      if (!value) return null;
      const parts = String(value).split("-").map(Number);
      if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function daysUntilLocalDate(value, now = new Date()) {
      const target = localDateFromInput(value);
      if (!target) return null;
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return Math.ceil((target.getTime() - today.getTime()) / 86400000);
    }

    function syncUrgencyFromPlannedStart() {
      const days = daysUntilLocalDate(state.project.plannedStartDate);
      if (days !== null && days >= 0 && days < 30) {
        state.urgent = true;
        state.urgentSource = "automatic";
      } else if (state.urgentSource === "automatic") {
        state.urgent = false;
        state.urgentSource = "none";
      }
    }

    function syncDerivedItemAnswers(item, fieldId, previous = {}) {
      if (item.requestType === "spectra_acquisition") {
        item.answers.serviceMode = canonicalServiceMode(item.answers.serviceMode);
      }
      if (item.requestType === "spectra_acquisition" && fieldId === "instrument") {
        rememberMeasurementDevice(item, previous.previousInstrument, previous.previousMeasurementDevice);
        if (config.tarifs.instruments[item.answers.instrument]?.transportPolicy === "forbidden") {
          item.answers.measurementLocation = "bioch_spir_lab";
        }
        ensureMeasurementDeviceCompatibility(item, previous.previousInstrument);
      }
      if (item.requestType !== "validated_calibration") return;
      if (fieldId === "samples") item.answers.samplesSource = "manual";
      if (fieldId === "replicates") item.answers.replicatesSource = "manual";
    }

    function ensureMeasurementDeviceCompatibility(item) {
      if (item.requestType !== "spectra_acquisition") return;
      const devices = config.tarifs.spectralThroughputProfiles?.[item.answers.instrument] || {};
      if (item.answers.instrument === "bruker_tango" && item.answers.measurementDevice === "cup") {
        item.answers.measurementDevice = "cup_9cm";
      }
      if (item.answers.measurementDevice && !devices[item.answers.measurementDevice]) {
        item.answers.measurementDevice = "";
      }
      const remembered = item.answers.measurementDeviceByInstrument?.[item.answers.instrument];
      if (!item.answers.measurementDevice && remembered && devices[remembered]) {
        item.answers.measurementDevice = remembered;
      }
      const defaultDevice = Object.entries(devices).find(([, device]) => device.default === true)?.[0] || "";
      if (!item.answers.measurementDevice && defaultDevice && !item.answers.measurementDeviceNeedsReview) {
        item.answers.measurementDevice = defaultDevice;
      }
      if (config.tarifs.instruments[item.answers.instrument]?.transportPolicy === "forbidden") {
        item.answers.measurementLocation = "bioch_spir_lab";
      }
    }

    function rememberMeasurementDevice(item, instrumentId, measurementDevice) {
      if (!instrumentId || !measurementDevice) return;
      const devices = config.tarifs.spectralThroughputProfiles?.[instrumentId] || {};
      if (!devices[measurementDevice]) return;
      item.answers.measurementDeviceByInstrument = {
        ...(item.answers.measurementDeviceByInstrument || {}),
        [instrumentId]: measurementDevice
      };
    }

    function renderRequestDetails(form) {
      syncUrgencyFromPlannedStart();
      const requester = { ...defaultRequester(), ...(state.requester || {}) };
      const project = { ...defaultProject(), ...(state.project || {}) };
      const errors = visibleRequestErrors(requestErrors(state));
      const urgentAutomatic = state.urgentSource === "automatic";
      const section = NIRSApp.createElement("section", "step-panel app-step");
      section.innerHTML = `
        <h2>Votre demande et vos coordonnées</h2>
        ${renderRequiredNote()}
        <p>Ces informations servent  préparer le pré-devis et à contextualiser votre demande. Aucune transmission automatique n'est activée dans cette version.</p>
        <fieldset class="field-section">
          <legend>Demandeur</legend>
          ${renderTextInput("requester", "firstName", "Prénom du demandeur", requester.firstName, errors["requester.firstName"], "given-name", "text", true)}
          ${renderTextInput("requester", "lastName", "Nom du demandeur", requester.lastName, errors["requester.lastName"], "family-name", "text", true)}
          ${renderTextInput("requester", "email", "Courriel professionnel", requester.email, errors["requester.email"], "email", "email", true)}
          ${renderTextInput("requester", "organization", "Organisme ou structure", requester.organization, errors["requester.organization"], "organization", "text", true)}
          ${renderLaboratorySelect(requester, errors)}
          ${renderTextInput("project", "phone", "Téléphone", project.phone, errors["project.phone"], "tel", "tel")}
        </fieldset>
        <fieldset class="field-section">
          <legend>Projet</legend>
          ${renderTextInput("project", "title", "Intitulé court de la demande", project.title, errors["project.title"], "", "text", true)}
          ${renderTextInput("project", "reference", "Référence interne éventuelle", project.reference, errors["project.reference"])}
          ${renderTextInput("project", "plannedStartDate", "Début de la période envisagée", project.plannedStartDate, errors["project.plannedStartDate"], "", "date", true)}
          ${renderTextInput("project", "plannedEndDate", "Fin de la période envisagée", project.plannedEndDate, errors["project.plannedEndDate"], "", "date", true)}
          <div class="field field-wide">
            <label for="project-comment">Commentaire ou précision</label>
            <textarea id="project-comment" rows="4" data-project-field="comment">${escapeHtml(project.comment)}</textarea>
          </div>
        </fieldset>
        <fieldset class="context-grid">
          <legend>Contexte d'intervention ${requiredMarker()}</legend>
          ${publicContexts(config).map(([id, context]) => `
            <label class="context-card">
              <input type="radio" name="context" value="${id}" required aria-required="true" ${state.context === id ? "checked" : ""}>
              ${context.iconPath ? `<img class="context-card__icon" src="${escapeHtml(context.iconPath)}" alt="" aria-hidden="true" loading="lazy" decoding="async">` : ""}
              <span>${context.label}</span>
              <small>${context.description}</small>
            </label>
          `).join("")}
          <p class="error" data-context-error ${errors.context ? "" : "hidden"}>${errors.context || ""}</p>
        </fieldset>
        ${state.context === "partnership" ? `
          <fieldset class="field-section">
            <legend>Projet de partenariat</legend>
            ${renderTextInput("project", "partnershipProjectName", "Nom du projet", project.partnershipProjectName, errors["project.partnershipProjectName"], "", "text", true)}
            ${renderTextInput("project", "partnershipProjectReference", "Référence du projet", project.partnershipProjectReference, errors["project.partnershipProjectReference"])}
            ${renderTextInput("project", "mainPartner", "Partenaire principal", project.mainPartner, errors["project.mainPartner"])}
            <p class="notice-inline">La part facturée sera définie avec le plateau. Les frais de personnel et les formations peuvent constituer une contribution du plateau au projet.</p>
          </fieldset>` : ""}
        <fieldset class="field-section">
          <legend>Options globales</legend>
          <div class="field field-wide">
            <label class="checkbox urgent-row"><input type="checkbox" name="urgent" ${state.urgent ? "checked" : ""} ${urgentAutomatic ? "disabled" : ""}>Demande urgente ${renderTooltip("urgent-help", "Une demande est considérée comme urgente lorsque le démarrage souhaité intervient dans moins de 30 jours calendaires. Une majoration de 15 % est alors appliquée aux prestations techniques concernées, sous réserve de disponibilité du plateau.")}</label>
            ${urgentAutomatic ? `<p class="notice-inline" data-urgent-automatic-notice>Urgence activée automatiquement : le démarrage est prévu dans moins de 30 jours.</p>` : ""}
          </div>
        </fieldset>
      `;
      form.append(section);
      form.append(renderNavigation());
      section.querySelectorAll("[data-requester-field]").forEach((control) => {
        control.addEventListener("input", () => updateRequester(control.dataset.requesterField, control.value));
        control.addEventListener("change", () => updateRequester(control.dataset.requesterField, control.value));
        control.addEventListener("blur", () => markFieldTouched(`requester.${control.dataset.requesterField}`));
      });
      section.querySelectorAll("[data-project-field]").forEach((control) => {
        control.addEventListener("input", () => updateProject(control.dataset.projectField, control.value));
        control.addEventListener("change", () => updateProject(control.dataset.projectField, control.value));
        control.addEventListener("blur", () => markFieldTouched(`project.${control.dataset.projectField}`));
      });
      section.querySelectorAll('input[name="context"]').forEach((input) => input.addEventListener("change", () => updateContext("context", input.value)));
      section.querySelector('input[name="urgent"]').addEventListener("change", (event) => updateContext("urgent", event.target.checked));
      attachTooltips(section);
    }

    function renderTextInput(scope, key, label, value, error, autocomplete = "", type = "text", required = false) {
      const id = `${scope}-${key}`;
      const dataset = scope === "requester" ? `data-requester-field="${key}"` : `data-project-field="${key}"`;
      return `
        <div class="field">
          <label for="${id}">${label}${required ? ` ${requiredMarker()}` : ""}</label>
          <input id="${id}" type="${type}" ${autocomplete ? `autocomplete="${autocomplete}"` : ""} ${dataset} value="${escapeHtml(value)}" ${required ? 'required aria-required="true"' : ""} ${error ? `aria-describedby="${id}-error"` : ""}>
          ${error ? `<p class="error" id="${id}-error">${error}</p>` : ""}
        </div>
      `;
    }

    function requiredMarker() {
      return `<span class="required-marker" aria-hidden="true">*</span>`;
    }

    function renderRequiredNote() {
      return `<p class="required-fields-note">Les champs marqués d’un <span aria-hidden="true">*</span> sont obligatoires.</p>`;
    }


    function renderTooltip(id, text) {
      return NIRSApp.tooltipHtml ? NIRSApp.tooltipHtml(id, text) : `
        <span class="help-tooltip">
          <button type="button" class="help-tooltip-trigger" aria-describedby="${id}" aria-label="Aide contextuelle">?</button>
          <span class="help-tooltip-popup help-popover" id="${id}" role="tooltip" hidden>${escapeHtml(text)}</span>
        </span>
      `;
    }

    function publicContexts(config) {
      return Object.entries(config.tarifs.contexts)
        .filter(([, context]) => context.publicVisible !== false)
        .sort((left, right) => Number(left[1].order || 999) - Number(right[1].order || 999));
    }

    function attachTooltips(scope) {
      if (NIRSApp.attachTooltips) NIRSApp.attachTooltips(scope);
    }

    function refreshVisibleRequestErrors() {
      const errors = visibleRequestErrors(requestErrors(state));
      document.querySelectorAll("[data-requester-field]").forEach((control) => {
        refreshRequestFieldError(control, `requester.${control.dataset.requesterField}`, errors);
      });
      document.querySelectorAll("[data-project-field]").forEach((control) => {
        refreshRequestFieldError(control, `project.${control.dataset.projectField}`, errors);
      });
      const contextError = document.querySelector("[data-context-error]");
      if (contextError) {
        contextError.textContent = errors.context || "";
        contextError.hidden = !errors.context;
      }
    }

    function refreshRequestFieldError(control, fieldKey, errors) {
      if (!control) return;
      const field = control.closest(".field");
      if (!field) return;
      const errorId = `${control.id}-error`;
      const previous = field.querySelector(`#${errorId}`);
      if (previous) previous.remove();
      if (errors[fieldKey]) {
        const error = NIRSApp.createElement("p", "error", errors[fieldKey]);
        error.id = errorId;
        field.append(error);
        control.setAttribute("aria-describedby", errorId);
      } else {
        control.removeAttribute("aria-describedby");
      }
    }

    function refreshUrgencyControls() {
      const urgentInput = document.querySelector('input[name="urgent"]');
      if (!urgentInput) return;
      const urgentAutomatic = state.urgentSource === "automatic";
      urgentInput.checked = Boolean(state.urgent);
      urgentInput.disabled = urgentAutomatic;
      const field = urgentInput.closest(".field");
      if (!field) return;
      let notice = field.querySelector("[data-urgent-automatic-notice]");
      if (urgentAutomatic && !notice) {
        notice = NIRSApp.createElement("p", "notice-inline", "Urgence activée automatiquement : le démarrage est prévu dans moins de 30 jours.");
        notice.dataset.urgentAutomaticNotice = "true";
        field.append(notice);
      } else if (!urgentAutomatic && notice) {
        notice.remove();
      }
    }

    function visibleRequestErrors(errors) {
      if (attemptedSteps.has(1)) return errors;
      return Object.fromEntries(Object.entries(errors).filter(([key]) => touchedFields.has(key) || isInvalidFilledRequestField(key)));
    }

    function isInvalidFilledRequestField(key) {
      const requester = { ...defaultRequester(), ...(state.requester || {}) };
      const project = { ...defaultProject(), ...(state.project || {}) };
      if (key === "requester.email") return Boolean(requester.email);
      if (key === "project.plannedEndDate") return Boolean(project.plannedStartDate && project.plannedEndDate);
      return false;
    }

    function focusFirstError() {
      const error = document.querySelector(".app-step .error");
      if (!error) return;
      const described = error.id ? document.querySelector(`[aria-describedby~="${error.id}"]`) : null;
      (described || error).focus?.({ preventScroll: true });
      error.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    }

    function renderCatalog(form) {
      const layout = NIRSApp.createElement("section", "catalog-layout app-step");
      const main = NIRSApp.createElement("div", "catalog-main");
      main.innerHTML = `
        <section class="step-panel">
          <h2>Composer le pré-devis</h2>
          <p>Choisissez directement une ou plusieurs prestations dans le catalogue interne.</p>
        </section>
      `;
      sortedGroups(config).forEach((group) => {
        const groupNode = NIRSApp.createElement("section", `service-category service-category--${group.id}`);
        groupNode.id = `group-${group.id}`;
        groupNode.innerHTML = `<header><h3>${group.label}</h3>${group.description ? `<p>${group.description}</p>` : ""}${group.note ? `<p class="service-category__note">${group.note}</p>` : ""}</header>`;
        const grid = NIRSApp.createElement("div", "service-card-grid");
        if (group.catalogInfoOnly) {
          main.append(groupNode);
          return;
        }
        catalogCardsForGroup(config, group.id).forEach((cardConfig) => {
          const count = state.items.filter((item) => cardMatchesItem(cardConfig, item)).length;
          const card = NIRSApp.createElement("article", `service-card service-card--${cardConfig.accent || group.id} ${count ? "is-selected" : ""} ${cardConfig.disabled ? "is-disabled" : ""}`);
          const cardText = catalogCardText(cardConfig);
          const content = NIRSApp.createElement("div", "service-card__content");
          content.append(NIRSApp.createElement("h4", "", cardText.title));
          if (cardText.subtitle) content.append(NIRSApp.createElement("p", "service-card__subtitle", cardText.subtitle));
          content.append(NIRSApp.createElement("p", "service-card__description", cardText.description || ""));
          const meta = NIRSApp.createElement("div", "service-card__meta");
          if (cardText.badge) meta.append(NIRSApp.createElement("span", "tag", cardText.badge));
          if (count) meta.append(NIRSApp.createElement("span", "selected-mark", `${count} occurrence(s)`));
          const button = NIRSApp.createElement("button", cardConfig.disabled ? "button-secondary" : "button-primary", cardConfig.disabled ? "Bientôt disponible" : (count ? "Ajouter une autre" : "Ajouter"));
          button.type = "button";
          if (cardConfig.disabled) button.disabled = true;
          else button.dataset.addCard = cardConfig.id;
          card.append(renderServiceIcon(cardConfig), content, meta, button);
          grid.append(card);
        });
        groupNode.append(grid);
        main.append(groupNode);
      });
      const cart = renderCart();
      layout.append(main, cart);
      form.append(layout);
      form.append(renderNavigation());
      form.querySelectorAll("[data-add-card]").forEach((button) => {
        button.addEventListener("click", () => {
          const card = (config.prestations.catalogCards || []).find((entry) => entry.id === button.dataset.addCard);
          if (card.requestType) addItem(card.requestType, card.presetAnswers || {});
        });
      });
      attachCartEvents(form);
    }

    function catalogCardsForGroup(config, groupId) {
      return (config.prestations.catalogCards || [])
        .filter((card) => card.categoryId === groupId && card.catalogVisible !== false)
        .sort((left, right) => (left.order || 0) - (right.order || 0));
    }

    function cardMatchesItem(card, item) {
      if (card.requestType !== item.requestType) return false;
      return Object.entries(card.presetAnswers || {}).every(([key, value]) => item.answers?.[key] === value);
    }

    function catalogCardText(cardConfig) {
      const metadata = cardConfig.preferCardText ? null : (config.catalogMetadata?.vignettes || []).find((entry) => entry.id === cardConfig.metadataId);
      return {
        title: metadata?.titre || cardConfig.label,
        subtitle: metadata?.sstitre || metadata?.subtitle || cardConfig.instrumentType || "",
        description: metadata?.description || cardConfig.description || "",
        badge: metadata?.badge || cardConfig.badge || ""
      };
    }

    function renderServiceIcon(cardConfig) {
      const wrap = NIRSApp.createElement("div", "service-card__icon-wrap");
      wrap.setAttribute("aria-hidden", "true");
      const icon = NIRSApp.createElement("img", "service-card__icon");
      icon.setAttribute("aria-hidden", "true");
      const iconPath = cardConfig.iconPath || "./assets/icons/autre-demande.svg";
      icon.src = iconPath;
      icon.alt = "";
      icon.loading = "lazy";
      icon.decoding = "async";
      wrap.append(icon);
      return wrap;
    }

    function renderCart() {
      const aside = NIRSApp.createElement("aside", "quote-cart");
      aside.innerHTML = `
        <h2>Mon pré-devis</h2>
        <p>${state.items.length} prestation(s) ajoutée(s)</p>
        <ol>
          ${state.items.map((item, index) => `
            <li>
              <span>${index + 1}. ${config.prestations.requestTypes[item.requestType].label}</span>
              <button type="button" class="button-ghost" data-remove-item="${item.id}" aria-label="Supprimer ${config.prestations.requestTypes[item.requestType].label}">Supprimer</button>
            </li>
          `).join("")}
        </ol>
        <button type="button" class="button-primary" data-go-config ${state.items.length ? "" : "disabled"}>Configurer ${state.items.length || "mes"} prestation(s)</button>
      `;
      return aside;
    }

    function renderConfiguration(form) {
      ensureGlobalSpectraPeople();
      const section = NIRSApp.createElement("section", "step-panel app-step");
      section.innerHTML = `
        <div class="section-head">
          <div>
            <h2>Configurer les prestations</h2>
            <p>Chaque ligne du pré-devis est configurée indépendamment.</p>
          </div>
          <button type="button" class="button-secondary" data-go-catalog>Ajouter une autre prestation</button>
        </div>
      `;
      if (!state.items.length) {
        section.append(NIRSApp.createElement("p", "muted", "Aucune prestation n'est encore ajoutée."));
      }
      sortedStateItems().forEach((item, index) => {
        try {
          section.append(renderItemPanel(item, index));
        } catch (error) {
          console.error("Erreur de rendu de la prestation", item, error);
          section.append(renderItemRenderError(item, error));
        }
      });
      const peopleSection = renderGlobalSpectraUsers();
      if (peopleSection) section.append(peopleSection);
      form.append(section);
      form.append(renderNavigation());
      form.querySelector("[data-go-catalog]").addEventListener("click", () => setStep(2));
      form.querySelectorAll("[data-remove-item]").forEach((button) => button.addEventListener("click", () => removeItem(button.dataset.removeItem)));
      form.querySelectorAll("[data-duplicate-item]").forEach((button) => button.addEventListener("click", () => duplicateItem(button.dataset.duplicateItem)));
      form.querySelectorAll("[data-toggle-panel]").forEach((button) => {
        button.addEventListener("click", () => {
          const body = document.getElementById(button.getAttribute("aria-controls"));
          const expanded = button.getAttribute("aria-expanded") === "true";
          button.setAttribute("aria-expanded", String(!expanded));
          body.hidden = expanded;
        });
      });
      attachFieldEvents(form);
      attachPersonEvents(form);
    }

    function renderItemRenderError(item, error) {
      const request = config.prestations.requestTypes[item.requestType];
      const panel = NIRSApp.createElement("article", "config-panel config-panel--error");
      panel.dataset.itemPanel = item.id;
      panel.innerHTML = `
        <header class="config-panel__head">
          <div>
            <h3>${request.label || item.requestType || "Prestation inconnue"}</h3>
            <p class="error">Cette prestation n'a pas pu être affichée. Les autres prestations restent configurables.</p>
            <small>${escapeHtml(error.message || "Erreur de rendu")}</small>
          </div>
          <div class="panel-actions">
            <button type="button" class="button-danger" data-remove-item="${item.id}">Supprimer</button>
          </div>
        </header>
      `;
      return panel;
    }

    function renderItemPanel(item, index) {
      const request = config.prestations.requestTypes[item.requestType];
      ensureMeasurementDeviceCompatibility(item);
      ensureCustomAnswers(item);
      const status = itemStatus(item);
      const panel = NIRSApp.createElement("article", "config-panel");
      const bodyId = `panel-body-${item.id}`;
      panel.dataset.itemPanel = item.id;
      panel.innerHTML = `
        <header class="config-panel__head">
          <button type="button" class="panel-toggle" data-toggle-panel aria-expanded="true" aria-controls="${bodyId}">
            <span>${index + 1}. ${request.label}</span>
            <small data-item-summary="${item.id}">${escapeHtml(NIRSApp.describeAnswers(config, item.requestType, answersForItem(item)) || "À compléter")}</small>
            <strong data-item-status="${item.id}">${status}</strong>
          </button>
          <div class="panel-actions">
            <button type="button" class="button-secondary" data-duplicate-item="${item.id}">Dupliquer</button>
            <button type="button" class="button-danger" data-remove-item="${item.id}">Supprimer</button>
          </div>
        </header>
        <div class="config-panel__body" id="${bodyId}" data-panel-body="${item.id}"></div>
      `;
      renderFieldsInto(panel.querySelector("[data-panel-body]"), item);
      return panel;
    }

    function sortedStateItems() {
      return [...state.items].sort((left, right) => {
        const leftOrder = config.prestations.requestTypes[left.requestType].configurationOrder ?? 70;
        const rightOrder = config.prestations.requestTypes[right.requestType].configurationOrder ?? 70;
        return leftOrder - rightOrder;
      });
    }

    function renderConfigurationPanelBody(itemId) {
      const item = state.items.find((entry) => entry.id === itemId);
      const body = document.querySelector(`[data-panel-body="${itemId}"]`);
      if (item && body) {
        renderFieldsInto(body, item);
        attachFieldEvents(body);
        attachPersonEvents(body);
      }
    }

    function renderFieldsInto(container, item) {
      if (!container || !item) return;
      const request = config.prestations.requestTypes[item.requestType];
      if (!request) {
        container.innerHTML = "";
        container.append(NIRSApp.createElement("p", "error", `Prestation inconnue : ${item.requestType}`));
        return;
      }

      ensureMeasurementDeviceCompatibility(item);
      ensureCustomAnswers(item);
      const hydratedAnswers = answersForItem(item);
      const errors = NIRSApp.validateItem(config.prestations, item.requestType, hydratedAnswers);
      const fields = NIRSApp.allVisibleFields(config.prestations, item.requestType, hydratedAnswers)
        .filter((field) => !(item.requestType === "initial_training" && field.id === "people"));
      const bySection = groupFieldsBySection(config, fields);

      container.innerHTML = "";
      if (request.legacy || request.catalogVisible === false) {
        const legacyNote = NIRSApp.createElement("p", "muted");
        legacyNote.innerHTML = request.legacy
          ? '<span class="tag">Ancienne prestation</span> Cette ligne reste compatible avec les anciens brouillons.'
          : '<span class="tag">Configuration</span> Cette prestation est ajoutée depuis une carte spécialisée du catalogue.';
        container.append(legacyNote);
      }

      if (item.requestType === "model_maintenance") {
        renderMaintenanceFieldsInto(container, item, hydratedAnswers, errors);
        return;
      }

      Object.entries(bySection).forEach(([sectionId, fieldsInSection]) => {
        const sectionMeta = config.prestations.fieldSections?.[sectionId] || { label: "Paramètres" };
        const fieldset = NIRSApp.createElement("fieldset", "field-section");
        if (sectionMeta.label) {
          fieldset.innerHTML = `<legend>${sectionMeta.label}</legend>${sectionMeta.description ? `<p>${sectionMeta.description}</p>` : ""}`;
        } else {
          fieldset.classList.add("field-section--plain");
          fieldset.setAttribute("aria-label", "Informations complémentaires");
        }
        fieldsInSection.forEach((field) => {
          const showError = attemptedSteps.has(3) || touchedFields.has(`${item.id}.${field.id}`);
          fieldset.append(renderField(item, field, showError ? errors[field.id] : ""));
        });
        if (item.requestType === "spectra_acquisition" && sectionId === "volume") {
          const capacitySlot = NIRSApp.createElement("div");
          capacitySlot.dataset.spectralCapacity = item.id;
          const capacityBlock = renderSpectralCapacityBlock(item);
          if (capacityBlock) capacitySlot.append(capacityBlock);
          fieldset.append(capacitySlot);
          fieldset.append(NIRSApp.createElement("p", "muted field-wide", config.textes.acquisition.reservationReview));
        }
        container.append(fieldset);
      });

      if (item.requestType === "spectra_acquisition") {
        container.append(NIRSApp.createElement("p", "muted", "Les utilisateurs et les formations sont renseignés une seule fois en fin de configuration."));
      }
      if (item.requestType === "initial_training") {
        container.append(renderParticipants(item, errors));
      }
      if (item.requestType === "existing_model_predictions") {
        const notes = config.textes.prediction;
        const notice = NIRSApp.createElement("section", "notice-inline");
        notice.innerHTML = `<h4>${escapeHtml(notes.title)}</h4>${NIRSApp.predictionNotes(config, hydratedAnswers).map((text) => `<p>${escapeHtml(text)}</p>`).join("")}`;
        container.append(notice);
      }
      container.append(renderSubtotal(calculateItemSubtotal(item)));
    }

    function renderMaintenanceFieldsInto(container, item, answers, errors) {
      const request = config.prestations.requestTypes.model_maintenance;
      const typeField = request.fields.find((field) => field.id === "maintenanceType");
      const commentField = request.fields.find((field) => field.id === "maintenanceComment");
      const typeFieldset = NIRSApp.createElement("fieldset", "field-section");
      typeFieldset.innerHTML = "<legend>Intervention</legend>";
      typeFieldset.append(renderField(item, typeField, errors.maintenanceType || ""));
      container.append(typeFieldset);

      const type = answers.maintenanceType || typeField.default || "performance_audit";
      const meta = request.maintenanceInterventions?.[type] || {};
      const subtotal = calculateItemSubtotal(item);
      const amount = subtotalAmountText(subtotal);
      const card = NIRSApp.createElement("section", "maintenance-card");
      card.innerHTML = `
        <div class="maintenance-card__head">
          <h4>${escapeHtml(meta.label || "Intervention")}</h4>
        </div>
        <div class="maintenance-card__info">
          <p>${escapeHtml(meta.info || "")}</p>
          ${meta.shortHelp ? `<p>${escapeHtml(meta.shortHelp)}</p>` : ""}
        </div>
        <div data-maintenance-comment></div>
        <div class="maintenance-card__checklist" aria-label="Informations utiles, si vous les connaissez">
          <strong>Informations utiles, si vous les connaissez</strong>
          <ul>${(meta.usefulInformation || []).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>
        </div>
        <div class="maintenance-card__price">
          <span>Estimation indicative HT</span>
          <strong>${escapeHtml(amount)}</strong>
          <p>${escapeHtml(request.maintenanceEstimateNote || "")}</p>
          ${state.context === "partnership" ? `<p>${escapeHtml(request.maintenancePartnershipNote || "")}</p>` : ""}
        </div>
      `;
      const commentTarget = card.querySelector("[data-maintenance-comment]");
      const textarea = renderField(item, { ...commentField, placeholder: meta.placeholder || commentField.placeholder || "" }, errors.maintenanceComment || "");
      commentTarget.replaceWith(textarea);
      container.append(card);
    }

    function renderField(item, field, error) {
      const wrapper = NIRSApp.createElement("div", field.type === "checkboxList" ? "field field-wide field-stack" : "field field-stack");
      const id = `${item.id}-${field.id}`;
      const errorId = `${id}-error`;
      const resolvedField = { ...field, currentInstrument: item.answers.instrument };
      if (field.type === "select") {
        const label = NIRSApp.createElement("label", "", field.label);
        label.htmlFor = id;
        const select = NIRSApp.createElement("select");
        select.id = id;
        select.name = field.id;
        select.dataset.itemId = item.id;
        select.dataset.fieldId = field.id;
        const currentValue = String(item.answers[field.id] ?? "");
        if (!currentValue) {
          const placeholderLabel = field.id === "measurementDevice" ? "Choisir une sonde ou un dispositif" : "Choisir une option";
          const placeholder = new Option(placeholderLabel, "", true, true);
          placeholder.disabled = true;
          select.append(placeholder);
        }
        NIRSApp.fieldOptions(config, resolvedField).forEach((option) => select.append(new Option(option.label, option.value, false, currentValue === String(option.value))));
        select.value = currentValue;
        wrapper.append(label, select);
      } else if (field.type === "number") {
        const label = NIRSApp.createElement("label", "", field.label);
        label.htmlFor = id;
        const input = NIRSApp.createElement("input");
        input.id = id;
        input.name = field.id;
        input.type = "number";
        input.value = item.answers[field.id] ?? "";
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        if (field.stepValue !== undefined) input.step = field.stepValue;
        input.dataset.itemId = item.id;
        input.dataset.fieldId = field.id;
        input.setAttribute("aria-describedby", error ? errorId : "");
        wrapper.append(label, input);
      } else if (field.type === "textarea") {
        const label = NIRSApp.createElement("label", "", field.label);
        label.htmlFor = id;
        const textarea = NIRSApp.createElement("textarea");
        textarea.id = id;
        textarea.name = field.id;
        textarea.rows = field.rows || 4;
        textarea.value = item.answers[field.id] ?? "";
        if (field.placeholder) textarea.placeholder = field.placeholder;
        if (field.maxLength) textarea.maxLength = Number(field.maxLength);
        textarea.dataset.itemId = item.id;
        textarea.dataset.fieldId = field.id;
        wrapper.append(label, textarea);
      } else if (field.type === "text" || field.type === "date") {
        const label = NIRSApp.createElement("label", "", field.label);
        label.htmlFor = id;
        const input = NIRSApp.createElement("input");
        input.id = id;
        input.name = field.id;
        input.type = field.type;
        input.value = item.answers[field.id] ?? "";
        input.dataset.itemId = item.id;
        input.dataset.fieldId = field.id;
        wrapper.append(label, input);
      } else if (field.type === "checkbox") {
        const label = NIRSApp.createElement("label", "checkbox");
        const input = NIRSApp.createElement("input");
        input.id = id;
        input.name = field.id;
        input.type = "checkbox";
        input.checked = field.readonly === true ? true : item.answers[field.id] === true;
        input.disabled = field.readonly === true;
        input.dataset.itemId = item.id;
        input.dataset.fieldId = field.id;
        label.append(input, document.createTextNode(field.label));
        wrapper.append(label);
      } else if (field.type === "checkboxList") {
        const fieldset = NIRSApp.createElement("fieldset", "checkbox-list");
        fieldset.id = id;
        fieldset.innerHTML = `<legend>${field.label}</legend>`;
        const selected = new Set(Array.isArray(item.answers[field.id]) ? item.answers[field.id] : []);
        checkboxListOptions(field).forEach((option) => {
          const label = NIRSApp.createElement("label", "checkbox");
          const input = NIRSApp.createElement("input");
          input.type = "checkbox";
          input.value = option.value;
          input.checked = selected.has(option.value);
          input.dataset.itemId = item.id;
          input.dataset.fieldId = field.id;
          input.dataset.checkboxList = "true";
          label.append(input, document.createTextNode(option.label));
          fieldset.append(label);
        });
        wrapper.append(fieldset);
      } else if (field.type === "radio") {
        const fieldset = NIRSApp.createElement("fieldset", "segmented");
        fieldset.innerHTML = `<legend>${field.label}</legend>`;
        NIRSApp.fieldOptions(config, resolvedField).forEach((option) => {
          const label = NIRSApp.createElement("label");
          const input = NIRSApp.createElement("input");
          input.type = "radio";
          input.name = id;
          input.value = option.value;
          input.checked = item.answers[field.id] === option.value;
          input.dataset.itemId = item.id;
          input.dataset.fieldId = field.id;
          label.append(input, NIRSApp.createElement("span", "", option.label));
          fieldset.append(label);
        });
        wrapper.append(fieldset);
      }
      const required = NIRSApp.isRequired(field, item.answers);
      const control = wrapper.querySelector(`#${id}`);
      if (required) {
        const label = wrapper.querySelector(`label[for="${id}"]`);
        if (label) label.insertAdjacentHTML("beforeend", ` ${requiredMarker()}`);
        const legend = wrapper.querySelector("legend");
        if (!label && legend) legend.insertAdjacentHTML("beforeend", ` ${requiredMarker()}`);
        if (control && control.tagName !== "FIELDSET") {
          control.required = true;
          control.setAttribute("aria-required", "true");
        }
      }
      if (error && control) {
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", errorId);
      }
      if (error) {
        const node = NIRSApp.createElement("p", "error", error);
        node.id = errorId;
        wrapper.append(node);
      }
      if (field.help) wrapper.append(NIRSApp.createElement("p", "muted field-help", field.help));
      if (item.requestType === "spectra_acquisition" && field.id === "measurementLocation") {
        const transportNote = renderTransportNote(item);
        if (transportNote) wrapper.append(transportNote);
      }
      if (item.requestType === "spectra_acquisition" && field.id === "measurementDevice") {
        if (item.answers.measurementDeviceNeedsReview) wrapper.append(NIRSApp.createElement("p", "notice-inline", config.textes.acquisition.obsoleteDevice));
        const deviceInfo = renderMeasurementDeviceInfo(item);
        if (deviceInfo) wrapper.append(deviceInfo);
      }
      if (item.requestType === "validated_calibration" && field.id === "samples" && item.answers.samplesSource === "derived") wrapper.append(NIRSApp.createElement("p", "muted", "Valeur préremplie à partir des prises de spectres sélectionnées."));
      if (item.requestType === "validated_calibration" && field.id === "replicates" && item.answers.replicatesWarning) wrapper.append(NIRSApp.createElement("p", "error", item.answers.replicatesWarning));
      if (item.requestType === "validated_calibration" && field.id === "dataPreparationRequired" && item.answers.dataPreparationRequired !== true) {
        wrapper.append(NIRSApp.createElement("p", "notice-inline", "Vous indiquez que les données sont directement exploitables. Si la jointure automatique entre les spectres et les valeurs de référence n'est pas possible, la réalisation des analyses pourra être retardée et un travail complémentaire pourra être proposé."));
      }
      return wrapper;
    }

    function checkboxListOptions(field) {
      if (field.source !== "spectraItems") return field.options || [];
      return state.items.filter((entry) => entry.requestType === "spectra_acquisition").map((entry, index) => ({
        value: entry.id,
        label: `${index + 1}. ${config.tarifs.instruments[entry.answers.instrument].shortLabel || "Prise de spectres"} - ${capacityLabel(calculateSpectralCapacity(entry))}`
      }));
    }

    function capacityLabel(capacity) {
      if (!capacity || capacity.requiresValidation) return "quantité de spectres indicative à valider";
      return `${formatInteger(capacity.min)} à ${formatInteger(capacity.max)} spectres indicatifs`;
    }

    function renderLaboratorySelect(requester, errors) {
      const labs = config.laboratories || [];
      const unitCode = requester.unitCode || "";
      const options = [
        '<option value="">Sélectionner une unité ou un laboratoire</option>',
        ...labs.map((lab) => `<option value="${escapeHtml(lab.code)}" ${unitCode === lab.code ? "selected" : ""}>${escapeHtml(lab.label)}</option>`)
      ].join("");
      return `
        <div class="field">
          <label for="requester-unitCode">Unité, laboratoire ou service ${requiredMarker()}</label>
          <select id="requester-unitCode" data-requester-field="unitCode" required aria-required="true" ${errors["requester.unitCode"] ? 'aria-describedby="requester-unitCode-error"' : ""}>
            ${options}
          </select>
          ${errors["requester.unitCode"] ? `<p class="error" id="requester-unitCode-error">${errors["requester.unitCode"]}</p>` : ""}
        </div>
        ${unitCode === "Autre" ? `
          <div class="field">
            <label for="requester-unitOther">Préciser l’unité, le laboratoire ou le service ${requiredMarker()}</label>
            <input id="requester-unitOther" type="text" data-requester-field="unitOther" value="${escapeHtml(requester.unitOther || "")}" required aria-required="true" ${errors["requester.unitOther"] ? 'aria-describedby="requester-unitOther-error"' : ""}>
            ${errors["requester.unitOther"] ? `<p class="error" id="requester-unitOther-error">${errors["requester.unitOther"]}</p>` : ""}
          </div>
        ` : ""}
        ${laboratoryContextWarning(requester, state.context)}
      `;
    }

    function laboratoryContextWarning(requester, contextId) {
      const label = requester.unitCode === "Autre" ? requester.unitOther : requester.unitLabel;
      if (!label || !contextId) return "";
      const isAgap = /^AGAP\s*-/i.test(label);
      if (isAgap && contextId === "public_research_lab") {
        return '<p class="notice-inline field-wide">Cette unité semble appartenir à l’UMR AGAP Institut. Vérifiez si le contexte « demande interne » est plus adapté.</p>';
      }
      if (!isAgap && contextId === "internal_agap") {
        return '<p class="notice-inline field-wide">L’unité sélectionnée ne semble pas appartenir à l’UMR AGAP Institut. Vérifiez le contexte de la demande.</p>';
      }
      return "";
    }

    function measurementDeviceProfile(item) {
      return config.tarifs.spectralThroughputProfiles?.[item.answers.instrument]?.[item.answers.measurementDevice] || null;
    }

    function calculateSpectralCapacity(item) {
      const profile = measurementDeviceProfile(item);
      const halfDays = Number(item.answers.halfDays || 0);
      const hoursPerHalfDay = Number(config.tarifs.reservation?.hoursPerHalfDay || 4);
      const allowedModes = profile?.quantityEstimateModes;
      const mode = canonicalServiceMode(item.answers.serviceMode || "autonomous_supported");
      const aliases = mode === "autonomous_supported" ? ["autonomous_supported", "self_service"] : ["plateau_operated", "assisted"];
      if (!profile || (Array.isArray(allowedModes) && !aliases.some((entry) => allowedModes.includes(entry))) || !Number.isInteger(halfDays) || halfDays <= 0) return null;
      const minRate = finitePositiveRate(profile.samplesPerHour?.min);
      const maxRate = finitePositiveRate(profile.samplesPerHour?.max);
      if (!Number.isFinite(minRate) || !Number.isFinite(maxRate) || maxRate < minRate) return null;
      return {
        min: halfDays * hoursPerHalfDay * minRate,
        max: halfDays * hoursPerHalfDay * maxRate,
        halfDays,
        hoursPerHalfDay,
        ratePerHour: {
          min: minRate,
          max: maxRate
        },
        label: profile.label,
        measurementWindow: profile.measurementWindow
      };
    }

    function finitePositiveRate(value) {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : null;
    }

    function renderMeasurementDeviceInfo(item) {
      const profile = measurementDeviceProfile(item);
      if (!profile?.measurementWindow) return null;
      const node = NIRSApp.createElement("div", "measurement-device-note field-derived-info");
      node.innerHTML = `<p><strong>Zone de mesure :</strong> ${escapeHtml(profile.measurementWindow)}</p>${profile.vigilance ? `<p><strong>Point de vigilance :</strong> ${escapeHtml(profile.vigilance)}</p>` : ""}`;
      return node;
    }

    function renderTransportNote(item) {
      const instrument = config.tarifs.instruments?.[item.answers.instrument];
      if (item.answers.measurementLocation !== "transport_required" || instrument?.transportPolicy !== "fixed_fee") return null;
      const node = NIRSApp.createElement("div", "transport-note field-derived-info");
      node.innerHTML = "<p>Le forfait couvre la préparation, le transport, l’installation et la remise en service de l’instrument, ainsi que les contraintes et vérifications supplémentaires liées à son utilisation hors laboratoire.</p>";
      return node;
    }

    function renderSpectralCapacityBlock(item) {
      const profile = measurementDeviceProfile(item);
      const capacity = calculateSpectralCapacity(item);
      if (!capacity) {
        if (!profile?.requiresValidation) return null;
        const node = NIRSApp.createElement("div", "spectral-capacity field-derived-info");
        node.innerHTML = `
          <div class="spectral-capacity__head"><strong>Quantité de spectres indicative : à valider</strong></div>
          <p>${escapeHtml(profile.measurementWindow || "Capacité indicative à valider par le plateau.")}</p>
        `;
        return node;
      }
      const node = NIRSApp.createElement("div", "spectral-capacity field-derived-info");
      const tooltip = renderTooltip(`spectral-capacity-help-${item.id}`, config.textes.acquisition.capacityHelp);
      node.innerHTML = `
        <div class="spectral-capacity__head"><strong>Quantité de spectres indicative : ${formatInteger(capacity.min)} à ${formatInteger(capacity.max)} spectres.</strong>${tooltip}</div>
        <p>Cette quantité correspond au produit du nombre d’échantillons par le nombre de répétitions spectrales.</p>
        <p>${escapeHtml(config.textes.acquisition.capacityHelp)}</p>
        <small>${capacity.halfDays} demi-journée(s) × ${capacity.hoursPerHalfDay} heures × ${capacity.ratePerHour.min} à ${capacity.ratePerHour.max} spectres par heure</small>
      `;
      attachTooltips(node);
      return node;
    }

    function formatInteger(value) {
      return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
    }

    function selectedSpectraInstruments() {
      return NIRSApp.collectSelectedSpectraInstruments(state, config);
    }

    function assignmentForPerson(person, instrumentId) {
      person.instrumentAssignments = person.instrumentAssignments || {};
      person.instrumentAssignments[instrumentId] = person.instrumentAssignments[instrumentId] || {
        assigned: false,
        trainingStatus: "",
        trainingDate: "",
        trainingRequested: false
      };
      return person.instrumentAssignments[instrumentId];
    }

    function ensureGlobalSpectraPeople() {
      const instruments = selectedSpectraInstruments();
      if (!instruments.length) return;
      state.people = Array.isArray(state.people) ? state.people : [];
      if (!state.people.length) state.people.push(defaultPerson());
      state.people.forEach((person) => {
        person.instrumentAssignments = person.instrumentAssignments || {};
      });
      if (instruments.length === 1 && !state.people.some((person) => assignmentForPerson(person, instruments[0].id).assigned)) {
        assignmentForPerson(state.people[0], instruments[0].id).assigned = true;
      }
    }

    function requesterPersonValues() {
      const requester = { ...defaultRequester(), ...(state.requester || {}) };
      return {
        firstName: requester.firstName || "",
        lastName: requester.lastName || "",
        email: requester.email || ""
      };
    }

    function firstGlobalPerson() {
      state.people = Array.isArray(state.people) ? state.people : [];
      if (!state.people.length) state.people.push(defaultPerson());
      return state.people[0];
    }

    function firstPersonMatchesRequester() {
      const person = state.people?.[0];
      if (!person) return false;
      const requester = requesterPersonValues();
      return ["firstName", "lastName", "email"].every((key) => String(person[key] || "") === String(requester[key] || ""));
    }

    function copyRequesterToFirstGlobalPerson() {
      const person = firstGlobalPerson();
      const requester = requesterPersonValues();
      person.firstName = requester.firstName;
      person.lastName = requester.lastName;
      person.email = requester.email;
      const instruments = selectedSpectraInstruments();
      if (instruments.length === 1) assignmentForPerson(person, instruments[0].id).assigned = true;
      saveDraft();
      fullRender();
    }

    function renderGlobalSpectraUsers() {
      const validation = NIRSApp.validateGlobalSpectraUsers(state, config);
      if (!validation.selectedInstruments.length) return null;
      const showErrors = attemptedSteps.has(3);
      const showInstrumentCoverageErrors = showErrors || validation.selectedInstruments.length > 1;
      const fieldset = NIRSApp.createElement("fieldset", "field-section people-section global-people-section");
      fieldset.innerHTML = `
        <legend>Utilisateurs et formations ${requiredMarker()}</legend>
        <p>Renseignez les personnes prévues pour les mesures, puis associez-les aux instruments concernés.</p>
        <label class="checkbox">
          <input type="checkbox" data-copy-requester-to-user ${firstPersonMatchesRequester() ? "checked" : ""}>
          <span>Le premier utilisateur est le demandeur</span>
        </label>
        ${showErrors && validation.errors.people ? `<p class="error">${validation.errors.people}</p>` : ""}
        ${showInstrumentCoverageErrors ? validation.selectedInstruments.map((instrument) => validation.errors[`instruments.${instrument.id}`] ? `<p class="error">${validation.errors[`instruments.${instrument.id}`]}</p>` : "").join("") : ""}
        <div class="people-list">
          ${state.people.map((person, index) => renderGlobalPersonRow(person, index, validation.selectedInstruments, validation.errors, showErrors)).join("")}
        </div>
        <button type="button" class="button-secondary" data-add-global-person>Ajouter une personne</button>
      `;
      return fieldset;
    }

    function renderGlobalPersonRow(person, index, instruments, errors, showErrors) {
      const prefix = `people.${person.id}`;
      return `
        <article class="person-row global-person-row">
          <div class="person-row__head">
            <strong>Personne ${index + 1}</strong>
            ${state.people.length > 1 ? `<button type="button" class="button-ghost" data-remove-global-person="${person.id}">Retirer</button>` : ""}
          </div>
          <label>
            <span>Prénom ${requiredMarker()}</span>
            <input type="text" value="${escapeHtml(person.firstName || "")}" data-global-person-field="firstName" data-person-id="${person.id}" required aria-required="true">
            ${showErrors && errors[`${prefix}.firstName`] ? `<small class="error">${errors[`${prefix}.firstName`]}</small>` : ""}
          </label>
          <label>
            <span>Nom ${requiredMarker()}</span>
            <input type="text" value="${escapeHtml(person.lastName || "")}" data-global-person-field="lastName" data-person-id="${person.id}" required aria-required="true">
            ${showErrors && errors[`${prefix}.lastName`] ? `<small class="error">${errors[`${prefix}.lastName`]}</small>` : ""}
          </label>
          <label>
            <span>Mail de contact ${requiredMarker()}</span>
            <input type="email" value="${escapeHtml(person.email || "")}" data-global-person-field="email" data-person-id="${person.id}" required aria-required="true">
            ${showErrors && errors[`${prefix}.email`] ? `<small class="error">${errors[`${prefix}.email`]}</small>` : ""}
          </label>
          <fieldset class="checkbox-list">
            <legend>Instrument(s) concerné(s)</legend>
            ${instruments.map((instrument) => renderInstrumentAssignment(person, instrument, errors, showErrors)).join("")}
          </fieldset>
          ${showErrors && errors[`${prefix}.instrumentAssignments`] ? `<p class="error">${errors[`${prefix}.instrumentAssignments`]}</p>` : ""}
        </article>
      `;
    }

    function renderInstrumentAssignment(person, instrument, errors, showErrors) {
      const assignment = assignmentForPerson(person, instrument.id);
      const prefix = `people.${person.id}.${instrument.id}`;
      const modeLabel = "utilisation autonome avec assistance technique du plateau";
      const refresherRequired = assignment.trainingStatus === "trained"
        && NIRSApp.isTrainingOlderThanOneYear?.(assignment.trainingDate, state.project?.plannedStartDate || "");
      if (refresherRequired && assignment.trainingRequested) assignment.trainingRequested = false;
      return `
        <div class="instrument-assignment">
          <label class="checkbox">
            <input type="checkbox" data-toggle-global-instrument="${instrument.id}" data-person-id="${person.id}" ${assignment.assigned ? "checked" : ""}>
            <span>${instrument.shortLabel} (${modeLabel})</span>
          </label>
          ${assignment.assigned ? `
            <label>
              <span>Formation effectuée ${requiredMarker()}</span>
              <select data-global-assignment-field="trainingStatus" data-instrument-id="${instrument.id}" data-person-id="${person.id}" required aria-required="true">
                <option value="">À compléter</option>
                <option value="trained" ${assignment.trainingStatus === "trained" ? "selected" : ""}>Oui, déjà effectuée</option>
                <option value="untrained" ${assignment.trainingStatus === "untrained" ? "selected" : ""}>Non</option>
              </select>
              ${showErrors && errors[`${prefix}.trainingStatus`] ? `<small class="error">${errors[`${prefix}.trainingStatus`]}</small>` : ""}
            </label>
            ${assignment.trainingStatus === "trained" ? `
              <label>
                <span>Date de formation ${requiredMarker()}</span>
                <input type="date" value="${escapeHtml(assignment.trainingDate || "")}" data-global-assignment-field="trainingDate" data-instrument-id="${instrument.id}" data-person-id="${person.id}" required aria-required="true">
                ${showErrors && errors[`${prefix}.trainingDate`] ? `<small class="error">${errors[`${prefix}.trainingDate`]}</small>` : ""}
              </label>
            ` : ""}
            ${refresherRequired ? `
              <p class="person-training-note">Formation de plus d'un an : une remise à niveau est automatiquement ajoutée au pré-devis.</p>
            ` : ""}
            <p class="person-training-note">La validité de la formation sera confirmée par le plateau avant l'utilisation autonome.</p>
          ` : ""}
        </div>
      `;
    }

    function renderOperators(item, errors) {
      const instrumentId = item.answers.instrument;
      const instrument = config.tarifs.instruments[instrumentId];
      const fieldset = NIRSApp.createElement("fieldset", "field-section people-section");
      fieldset.innerHTML = `
        <legend>Utilisateurs prévus de l'instrument ${requiredMarker()}</legend>
        <p>La formation est nominative et propre à ${instrument.label || "l'instrument sélectionné"}.</p>
        ${errors.operators ? `<p class="error">${errors.operators}</p>` : ""}
        ${errors.operatorIds ? `<p class="error">${errors.operatorIds}</p>` : ""}
        <div class="people-list">
          ${renderPeopleSelector(item, "operators", errors, true)}
        </div>
        <button type="button" class="button-secondary" data-add-person="operators" data-item-id="${item.id}">Ajouter une personne</button>
      `;
      return fieldset;
    }

    function renderParticipants(item, errors) {
      const fieldset = NIRSApp.createElement("fieldset", "field-section people-section");
      fieldset.innerHTML = `
        <legend>Participants à former ${requiredMarker()}</legend>
        <p>Le nombre de personnes est déduit de la liste nominative.</p>
        ${errors.participants ? `<p class="error">${errors.participants}</p>` : ""}
        ${errors.participantIds ? `<p class="error">${errors.participantIds}</p>` : ""}
        <div class="people-list">
          ${renderPeopleSelector(item, "participants", errors, true)}
        </div>
        <button type="button" class="button-secondary" data-add-person="participants" data-item-id="${item.id}">Ajouter une personne</button>
      `;
      return fieldset;
    }

    function renderPeopleSelector(item, collection, errors, withTrainingStatus) {
      if (!state.people.length) return `<p class="muted">Aucune personne renseignée.</p>`;
      return state.people.map((person, index) => renderPersonRow(item, collection, person, index, errors, withTrainingStatus)).join("");
    }

    function renderPersonRow(item, collection, person, index, errors, withTrainingStatus) {
      const instrumentId = item.answers.instrument;
      const idsKey = collection === "operators" ? "operatorIds" : "participantIds";
      const selected = (item.answers[idsKey] || []).includes(person.id);
      const status = trainingStatusForPerson(person, instrumentId);
      const trainingDate = trainingDateForPerson(person, instrumentId);
      const personId = person.id;
      const prefix = `people.${personId}`;
      const coverage = withTrainingStatus && selected ? trainingCoverageLabel(item, person.id, instrumentId) : "";
      const personLabel = collection === "operators" ? "Utilisateur" : "Participant";
      const trainingLabel = "Formation effectuée";
      return `
        <article class="person-row">
          <label class="checkbox person-select">
            <input type="checkbox" data-select-person data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}" ${selected ? "checked" : ""}>
            <span>${personLabel} ${index + 1}</span>
          </label>
          <label>
            <span>Prénom ${requiredMarker()}</span>
            <input type="text" value="${escapeHtml(person.firstName || "")}" data-person-field="firstName" data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}" required aria-required="true">
            ${errors[`${prefix}.firstName`] ? `<small class="error">${errors[`${prefix}.firstName`]}</small>` : ""}
          </label>
          <label>
            <span>Nom ${requiredMarker()}</span>
            <input type="text" value="${escapeHtml(person.lastName || "")}" data-person-field="lastName" data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}" required aria-required="true">
            ${errors[`${prefix}.lastName`] ? `<small class="error">${errors[`${prefix}.lastName`]}</small>` : ""}
          </label>
          <label>
            <span>Mail de contact ${requiredMarker()}</span>
            <input type="email" value="${escapeHtml(person.email || "")}" data-person-field="email" data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}" required aria-required="true">
            ${errors[`${prefix}.email`] ? `<small class="error">${errors[`${prefix}.email`]}</small>` : ""}
          </label>
          ${withTrainingStatus && selected ? `
            <label>
              <span>${trainingLabel} ${requiredMarker()}</span>
              <select data-person-field="trainingStatus" data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}" required aria-required="true">
                <option value="">À compléter</option>
                <option value="trained" ${status === "trained" ? "selected" : ""}>Oui, déjà effectuée</option>
                <option value="untrained" ${status === "untrained" ? "selected" : ""}>Non</option>
              </select>
              ${errors[`${prefix}.trainingStatus`] ? `<small class="error">${errors[`${prefix}.trainingStatus`]}</small>` : ""}
            </label>
            ${status === "trained" ? `
              <label>
                <span>Date de formation ${requiredMarker()}</span>
                <input type="date" value="${escapeHtml(trainingDate)}" data-person-field="trainingDate" data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}" required aria-required="true">
                ${errors[`${prefix}.trainingDate`] ? `<small class="error">${errors[`${prefix}.trainingDate`]}</small>` : ""}
              </label>` : ""}
          ` : ""}
          ${coverage ? `<p class="person-training-note">${coverage}</p>` : ""}
          ${selected ? `<button type="button" class="button-ghost" data-remove-person data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}">Retirer de cette prestation</button>` : ""}
        </article>
      `;
    }

    function renderSubtotal(result) {
      const node = NIRSApp.createElement("div", "item-subtotal");
      if (result.status === "quote_required") {
        node.innerHTML = `
          <span>Estimation indicative HT</span>
          <strong>Sur devis</strong>
        `;
        return node;
      }
      if (result.status === "partial") {
        node.innerHTML = `
          <span>Estimation indicative partielle HT</span>
          <strong>${result.billedEstimate ? NIRSApp.rangeMoney(result.billedEstimate, result.currency) : "À discuter avec le plateau"}</strong>
          <small>Un élément reste à discuter avec le plateau.</small>
        `;
        return node;
      }
      node.innerHTML = `
        <span>Estimation indicative HT</span>
        <strong>${escapeHtml(subtotalAmountText(result))}</strong>
      `;
      return node;
    }

    function subtotalAmountText(result) {
      if (!result) return "À discuter avec le plateau";
      if (result.status === "incomplete") return "À compléter";
      if (result.status === "quote_required" || result.billingRangeReview?.required) return "Sur devis";
      if (result.billedEstimate) return NIRSApp.rangeMoney(result.billedEstimate, result.currency);
      return "À discuter avec le plateau";
    }

    function renderLiveEstimate() {
      const result = NIRSApp.calculateQuote(config, state);
      const incomplete = result.itemResults.filter((item) => item.status === "incomplete").length;
      const quoteLines = result.items.filter((item) => item.pricingMode === "quote").length;
      const contextLabel = result.context?.label || "Contexte à choisir";
      const contextDetail = result.context?.display || contextLabel;
      const billedEstimate = result.context
        ? (result.billingRangeReview?.required ? "Sur devis" : NIRSApp.rangeMoney(result.billedEstimate, result.currency))
        : "À compléter";
      const isPartnership = result.context?.mode === "negotiated_partnership";
      const hasContribution = Number(result.inKindContribution?.min || 0) > 0 || Number(result.inKindContribution?.max || 0) > 0;
      const contribution = hasContribution
        ? NIRSApp.rangeMoney(result.inKindContribution, result.currency)
        : "aucune à ce stade";
      const administrativeFee = result.items.find((item) => item.configRule === "externalAdministrativeFee");
      const administrativeFeeNote = isPartnership && administrativeFee
        ? `${administrativeFee.label} inclus : ${NIRSApp.rangeMoney({ min: administrativeFee.totalMin, max: administrativeFee.totalMax }, result.currency)} HT`
        : "";
      const totalLabel = quoteLines ? "Total estimatif partiel HT" : "Total estimatif HT";
      const contextHelp = result.context?.id === "subcontracting"
        ? "Le prix présenté tient compte des conditions propres à une prestation en sous-traitance."
        : "Estimation à préciser après examen des données, des échantillons et du périmètre avec le plateau.";
      const node = NIRSApp.createElement("aside", "live-estimate");
      node.id = "live-estimate";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.innerHTML = `
        <div>
          <span>${isPartnership ? "Part facturée indicative HT à définir" : totalLabel}</span>
          <strong>${!result.context ? "À compléter" : billedEstimate}</strong>
          <small>${result.billingRangeReview?.required ? escapeHtml(result.billingRangeReview.message) : (isPartnership ? `À valider avec le plateau.${administrativeFeeNote ? ` ${administrativeFeeNote}.` : ""}` : `${contextDetail || contextHelp}`)}${incomplete ? ` - ${incomplete} prestation(s) à compléter` : ""}${quoteLines ? ` - ${quoteLines} élément(s) sur devis non inclus` : ""}</small>
        </div>
        ${isPartnership ? `
          <div>
            <span>Apports Bioch&amp;SPIR identifiés HT</span>
            <strong>${contribution}</strong>
            <small>Non ajoutés au montant à payer</small>
          </div>
        ` : ""}
      `;
      return node;
    }

    function updateLiveEstimate() {
      const current = document.querySelector("#live-estimate");
      if (current) current.replaceWith(renderLiveEstimateSafely());
    }

    function attachFieldEvents(scope) {
      scope.querySelectorAll("input, select, textarea").forEach((control) => {
        const itemId = control.dataset.itemId;
        const fieldId = control.dataset.fieldId;
        if (!itemId || !fieldId) return;
        control.addEventListener("blur", () => {
          touchedFields.add(`${itemId}.${fieldId}`);
          const item = state.items.find((entry) => entry.id === itemId);
          if (item) refreshFieldErrors(item);
        });
        if (control.dataset.checkboxList === "true") {
          control.addEventListener("change", () => {
            const values = [...scope.querySelectorAll(`[data-item-id="${itemId}"][data-field-id="${fieldId}"][data-checkbox-list="true"]`)]
              .filter((entry) => entry.checked)
              .map((entry) => entry.value);
            updateAnswer(itemId, fieldId, values, true);
          });
        } else if (control.type === "number" || control.tagName === "TEXTAREA") {
          let timer;
          control.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => updateAnswer(itemId, fieldId, control.value, false), 200);
          });
          control.addEventListener("change", () => {
            clearTimeout(timer);
            updateAnswer(itemId, fieldId, control.value, false);
          });
        } else {
          control.addEventListener("change", () => updateAnswer(itemId, fieldId, control.type === "checkbox" ? control.checked : control.value, true));
        }
      });
      scope.querySelectorAll("[data-maintenance-info-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
          const panel = document.getElementById(button.getAttribute("aria-controls"));
          const expanded = button.getAttribute("aria-expanded") === "true";
          button.setAttribute("aria-expanded", String(!expanded));
          if (panel) panel.hidden = expanded;
        });
      });
    }

    function attachPersonEvents(scope) {
      scope.querySelectorAll("[data-add-global-person]").forEach((button) => {
        button.addEventListener("click", () => {
          const person = defaultPerson();
          state.people.push(person);
          const instruments = selectedSpectraInstruments();
          if (instruments.length === 1) assignmentForPerson(person, instruments[0].id).assigned = true;
          saveDraft();
          fullRender();
        });
      });
      scope.querySelectorAll("[data-remove-global-person]").forEach((button) => {
        button.addEventListener("click", () => {
          state.people = state.people.filter((person) => person.id !== button.dataset.removeGlobalPerson);
          ensureGlobalSpectraPeople();
          saveDraft();
          fullRender();
        });
      });
      scope.querySelectorAll("[data-copy-requester-to-user]").forEach((control) => {
        control.addEventListener("change", () => {
          if (control.checked) copyRequesterToFirstGlobalPerson();
        });
      });
      scope.querySelectorAll("[data-global-person-field]").forEach((control) => {
        control.addEventListener("input", () => {
          const person = personById(control.dataset.personId);
          if (!person) return;
          person[control.dataset.globalPersonField] = control.value;
          saveDraft();
          updateNavigationState();
          updateLiveEstimate();
        });
      });
      scope.querySelectorAll("[data-toggle-global-instrument]").forEach((control) => {
        control.addEventListener("change", () => {
          const person = personById(control.dataset.personId);
          if (!person) return;
          assignmentForPerson(person, control.dataset.toggleGlobalInstrument).assigned = control.checked;
          saveDraft();
          fullRender();
        });
      });
      scope.querySelectorAll("[data-global-assignment-field]").forEach((control) => {
        control.addEventListener("change", () => {
          const person = personById(control.dataset.personId);
          if (!person) return;
          const assignment = assignmentForPerson(person, control.dataset.instrumentId);
          const field = control.dataset.globalAssignmentField;
          assignment[field] = control.type === "checkbox" ? control.checked : control.value;
          if (field === "trainingStatus" && control.value !== "trained") assignment.trainingDate = "";
          if ((field === "trainingStatus" || field === "trainingDate")
            && assignment.trainingStatus === "trained"
            && NIRSApp.isTrainingOlderThanOneYear?.(assignment.trainingDate, state.project?.plannedStartDate || "")) {
            assignment.trainingRequested = false;
          }
          saveDraft();
          fullRender();
        });
      });
      scope.querySelectorAll("[data-add-person]").forEach((button) => {
        button.addEventListener("click", () => addPerson(button.dataset.itemId, button.dataset.addPerson));
      });
      scope.querySelectorAll("[data-remove-person]").forEach((button) => {
        button.addEventListener("click", () => removePerson(button.dataset.itemId, button.dataset.collection, button.dataset.personId));
      });
      scope.querySelectorAll("[data-select-person]").forEach((control) => {
        control.addEventListener("change", () => togglePersonSelection(control.dataset.itemId, control.dataset.collection, control.dataset.personId, control.checked));
      });
      scope.querySelectorAll("[data-person-field]").forEach((control) => {
        const handler = () => updatePerson(
          control.dataset.itemId,
          control.dataset.collection,
          control.dataset.personId,
          control.dataset.personField,
          control.value
        );
        control.addEventListener(control.tagName === "SELECT" ? "change" : "input", handler);
      });
    }

    function renderSummary(form) {
      const section = NIRSApp.createElement("section", "step-panel result-shell app-step");
      section.innerHTML = `<div id="quote-result" aria-live="polite"></div>`;
      const result = NIRSApp.calculateQuote(config, state);
      NIRSApp.renderQuote(section.querySelector("#quote-result"), state, result, config, { goToStep: setStep, reset, announce });
      form.append(section);
      form.append(renderNavigation());
    }

    function renderNavigation() {
      const nav = NIRSApp.createElement("div", "wizard-nav");
      nav.innerHTML = `
        <button type="button" class="button-secondary" ${step === 1 ? "disabled" : ""} data-prev>Retour</button>
        <button type="button" class="button-ghost" data-clear-draft>Effacer le brouillon enregistré</button>
        ${step < 4 ? `<button type="button" class="button-primary" data-next ${canContinueFromStep(step, state, itemStatus, config) ? "" : "disabled"}>Continuer</button>` : ""}
      `;
      nav.querySelector("[data-prev]").addEventListener("click", () => setStep(step - 1));
      nav.querySelector("[data-next]")?.addEventListener("click", () => requestStepChange(step + 1));
      nav.querySelector("[data-clear-draft]").addEventListener("click", () => {
        storage.removeItem(STORAGE_KEY);
        announce("Brouillon local effacé.");
      });
      return nav;
    }

    function attachCartEvents(scope) {
      scope.querySelectorAll("[data-remove-item]").forEach((button) => button.addEventListener("click", () => removeItem(button.dataset.removeItem)));
      scope.querySelector("[data-go-config]").addEventListener("click", () => setStep(3));
    }

    function updateNavigationState() {
      const next = document.querySelector("[data-next]");
      if (next) next.disabled = !canContinueFromStep(step, state, itemStatus, config);
      updateProgressState();
    }

    function updateProgressState() {
      document.querySelectorAll("[data-step-target]").forEach((control) => {
        const number = Number(control.dataset.stepTarget);
        if (!number) return;
        const reachable = isStepReachable(number, step, state, itemStatus, config);
        const status = reachable ? getStepStatus(number, step) : "disabled";
        const clickable = reachable && number !== step;
        const label = STEPS[number - 1] || "";
        const title = reachable
          ? `Aller a l'etape ${number} : ${label}`
          : `Etape ${number} disponible apres validation des etapes precedentes`;
        control.className = `progress-step is-${status}${clickable ? " is-clickable" : ""}`;
        control.disabled = !reachable || number === step;
        control.setAttribute("aria-current", status === "current" ? "step" : "false");
        control.setAttribute("aria-label", title);
        control.setAttribute("title", title);
      });
    }

    function refreshFieldErrors(item) {
      const answers = answersForItem(item);
      const errors = NIRSApp.validateItem(config.prestations, item.requestType, answers);
      for (const field of NIRSApp.allVisibleFields(config.prestations, item.requestType, answers)) {
        const control = document.getElementById(`${item.id}-${field.id}`);
        const wrapper = control?.closest(".field");
        if (!wrapper) continue;
        const errorId = `${control.id}-error`;
        let error = document.getElementById(errorId);
        const message = attemptedSteps.has(3) || touchedFields.has(`${item.id}.${field.id}`) ? errors[field.id] : "";
        const describedBy = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter((id) => id && id !== errorId);
        if (message) {
          if (!error) {
            error = NIRSApp.createElement("p", "error");
            error.id = errorId;
            wrapper.append(error);
          }
          error.textContent = message;
          control.setAttribute("aria-invalid", "true");
          describedBy.push(errorId);
        } else {
          error?.remove();
          control.removeAttribute("aria-invalid");
        }
        if (describedBy.length) control.setAttribute("aria-describedby", describedBy.join(" "));
        else control.removeAttribute("aria-describedby");
      }
    }

    function refreshItemStatus(itemId) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const status = itemStatus(item);
      const statusNode = document.querySelector(`[data-item-status="${itemId}"]`);
      const summaryNode = document.querySelector(`[data-item-summary="${itemId}"]`);
      if (statusNode) statusNode.textContent = status;
      if (summaryNode) summaryNode.textContent = NIRSApp.describeAnswers(config, item.requestType, answersForItem(item)) || "À compléter";
      const body = document.querySelector(`[data-panel-body="${itemId}"]`);
      if (!body) return;
      const subtotal = body.querySelector(".item-subtotal");
      if (subtotal) subtotal.replaceWith(renderSubtotal(calculateItemSubtotal(item)));
      const capacitySlot = body.querySelector("[data-spectral-capacity]");
      if (capacitySlot) {
        const capacity = renderSpectralCapacityBlock(item);
        capacitySlot.replaceChildren(...(capacity ? [capacity] : []));
      }
    }

    function calculateItemSubtotal(item) {
      const result = NIRSApp.calculateQuote(config, state);
      return result.itemResults?.find((entry) => entry.itemId === item.id) || {
        status: "incomplete",
        currency: result.currency || config.tarifs.metadata.currency,
        technicalValue: { min: 0, max: 0 },
        billedEstimate: null
      };
    }

    function itemStatus(item) {
      const errors = NIRSApp.validateItem(config.prestations, item.requestType, answersForItem(item));
      if (Object.keys(errors).length) return "À compléter";
      const subtotal = calculateItemSubtotal(item);
      if (subtotal.status === "partial") return "Sur devis partiel";
      if (subtotal.status === "quote_required") return "Sur devis";
      return "Complète";
    }

    const draft = loadDraft(storage);
    if (draft) {
      root.innerHTML = "";
      root.append(renderInstitutionalBanner(config));
      root.append(renderHeader(config));
      const prompt = NIRSApp.createElement("section", "load-error");
      prompt.innerHTML = `
        <h1>Un pré-devis non terminé a été retrouvé.</h1>
        <p>Vous pouvez reprendre le brouillon local ou recommencer.</p>
        <div class="actions">
          <button type="button" class="button-primary" data-resume>Reprendre le brouillon</button>
          <button type="button" class="button-secondary" data-new>Recommencer</button>
        </div>
      `;
      root.append(prompt);
      prompt.querySelector("[data-resume]").addEventListener("click", () => replaceState(draft));
      prompt.querySelector("[data-new]").addEventListener("click", reset);
    } else {
      fullRender();
    }
  }

  function createEmptyState(config) {
    return {
      quoteId: NIRSApp.makeId("quote"),
      document: {
        type: "pre_quote",
        reference: "",
        fileName: "",
        sequenceNumber: null,
        generatedAt: "",
        validUntil: ""
      },
      requester: defaultRequester(),
      project: defaultProject(),
      schemaVersion: 8,
      context: "",
      urgent: false,
      urgentSource: "none",
      people: [],
      items: []
    };
  }

  function defaultRequester() {
    return {
      firstName: "",
      lastName: "",
      email: "",
      organization: "",
      unitCode: "",
      unitLabel: "",
      unitOther: "",
      unit: ""
    };
  }

  function normalizeRequesterUnit(requester, config = {}) {
    const next = { ...defaultRequester(), ...(requester || {}) };
    const labs = config.laboratories || [];
    const byCode = new Map(labs.map((lab) => [lab.code, lab]));
    if (next.unitCode && byCode.has(next.unitCode)) {
      const lab = byCode.get(next.unitCode);
      next.unitLabel = lab.label;
      if (lab.code === "Autre") {
        next.unitCode = "Autre";
        next.unitLabel = "Autre";
        next.unit = String(next.unitOther || "").trim();
      } else {
        next.unitOther = "";
        next.unit = lab.label;
      }
      return next;
    }
    if (next.unit) {
      const match = laboratoryMatch(next.unit, labs);
      if (match) {
        next.unitCode = match.code;
        next.unitLabel = match.label;
        next.unitOther = "";
        next.unit = match.label;
      } else {
        next.unitCode = "Autre";
        next.unitLabel = "Autre";
        next.unitOther = next.unitOther || next.unit;
        next.unit = next.unitOther;
      }
    }
    return next;
  }

  function laboratoryMatch(value, labs = []) {
    const text = String(value || "").trim();
    if (!text) return null;
    const normalized = normalizeText(text);
    return labs.find((lab) => lab.code === text)
      || labs.find((lab) => normalizeText(lab.label) === normalized)
      || labs.find((lab) => normalizeText(lab.code) === normalized)
      || null;
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toUpperCase();
  }

  function canonicalServiceMode(mode) {
    return {
      self_service: "autonomous_supported",
      assisted: "plateau_operated",
      full_service: "plateau_operated"
    }[mode] || mode || "autonomous_supported";
  }

  function defaultProject() {
    return {
      title: "",
      reference: "",
      plannedStartDate: "",
      plannedEndDate: "",
      phone: "",
      comment: "",
      partnershipProjectName: "",
      partnershipProjectReference: "",
      mainPartner: ""
    };
  }

  function defaultPerson() {
      return {
        id: NIRSApp.makeId("person"),
        firstName: "",
        lastName: "",
        email: "",
        instrumentAssignments: {}
      };
    }

  function ensureCustomAnswers(item) {
    item.answers = item.answers || {};
    if (item.requestType === "spectra_acquisition") {
      delete item.answers.operatorIds;
      delete item.answers.operators;
      delete item.answers.trained;
    }
    if (item.requestType === "initial_training") {
      item.answers.participantIds = Array.isArray(item.answers.participantIds) ? item.answers.participantIds : [];
      delete item.answers.participants;
      syncDerivedPeopleCount(item);
    }
  }

  function syncDerivedPeopleCount(item) {
    if (item.requestType === "initial_training" && Array.isArray(item.answers.participantIds)) {
      item.answers.people = item.answers.participantIds.length || 1;
    }
  }

  function draftState(state, currentStep = 1, config = {}) {
    return {
      quoteId: state.quoteId,
      document: { ...(state.document || {}) },
      requester: normalizeRequesterUnit({ ...defaultRequester(), ...(state.requester || {}) }, config),
      project: { ...defaultProject(), ...(state.project || {}) },
      context: state.context,
      urgent: state.urgent,
      urgentSource: state.urgentSource || "none",
      schemaVersion: 8,
      currentStep,
      tariffVersion: config.tarifs.metadata.version || state.tariffVersion || "",
      savedAt: new Date().toISOString(),
      people: (state.people || []).map((person) => ({
        id: person.id,
        firstName: person.firstName || "",
        lastName: person.lastName || "",
        email: person.email || "",
        instrumentAssignments: person.instrumentAssignments || {}
      })),
      items: (state.items || []).map((item) => ({
        ...item,
        answers: draftAnswers(item)
      }))
    };
  }

  function draftAnswers(item) {
    const answers = { ...(item.answers || {}) };
    delete answers.operators;
    delete answers.participants;
    delete answers.trained;
    return answers;
  }

  function normalizeState(parsed) {
    const requester = defaultRequester();
    const project = defaultProject();
    const normalized = {
      ...parsed,
      document: normalizeDocument(parsed.document),
      requester: normalizeRequesterUnit({ ...requester, ...(parsed.requester || {}) }, globalThis.NIRS_CONFIG || {}),
      project: { ...project, ...(parsed.project || {}) },
      context: migrateContext(parsed.context, parsed.schemaVersion),
      urgentSource: parsed.urgentSource || (parsed.urgent ? "manual" : "none"),
      schemaVersion: 8
    };
    delete normalized.externalAdmin;
    normalized.currentStep = Number.isInteger(parsed.currentStep) ? Math.min(4, Math.max(1, parsed.currentStep)) : 1;
    normalized.tariffVersion = parsed.tariffVersion || "";
    normalized.savedAt = parsed.savedAt || "";
    const people = new Map();
    (Array.isArray(parsed.people) ? parsed.people : []).forEach((person) => registerPerson(people, person));
    normalized.items = (normalized.items || []).map((item) => {
      const migratedRequestType = migrateRequestType(item.requestType, item.answers || {});
      const next = {
        ...item,
        requestType: migratedRequestType,
        answers: migrateItemAnswers(migratedRequestType, item.answers || {}),
        completed: item.completed ?? item["compl\u00e8ted"] ?? false
      };
      migrateEmbeddedPeople(next, people);
      ensureCustomAnswers(next);
      return next;
    });
    normalized.people = [...people.values()];
    return normalized;
  }

  function migrateContext(context, schemaVersion = 0) {
    if (Number(schemaVersion || 0) < 5 && context === "partnership") return "internal_agap";
    if (context === "collaborative_project") return "partnership";
    if (context === "occasional_help" || context === "point_support") return "internal_agap";
    return context || "";
  }

  function migrateRequestType(requestType, answers = {}) {
    if (requestType === "model_maintenance" && answers.maintenanceType === "other") return "other_chemometrics";
    return requestType;
  }

  function migrateItemAnswers(requestType, answers) {
    const next = requestType === "spectra_acquisition"
      ? NIRSApp.restoreAcquisitionDetails(answers || {}) : { ...(answers || {}) };
    if (requestType === "spectra_acquisition") {
      next.serviceMode = canonicalServiceMode(next.serviceMode);
      if (!next.halfDays) {
        if (Number(next.hours) > 0) next.halfDays = Math.ceil(Number(next.hours) / 4);
        else if (Number(next.reservedDays) > 0) next.halfDays = Number(next.reservedDays) * 2;
      }
      if (next.instrument === "viavi_micronir" && !next.measurementDevice) {
        next.measurementDevice = "direct_measurement";
      }
      if (next.measurementLocation === "platform" || next.measurementLocation === "field") {
        next.measurementLocation = next.measurementLocation === "field" ? "transport_required" : "bioch_spir_lab";
      }
      if (globalThis.NIRS_CONFIG?.tarifs.instruments[next.instrument]?.transportPolicy === "forbidden" && next.measurementLocation === "transport_required") {
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
      next.maintenanceType = migrateMaintenanceType(previousType);
      next.legacyMaintenanceAnswers = next.legacyMaintenanceAnswers || legacyMaintenanceAnswers(next);
      next.maintenanceComment = buildMaintenanceComment(next);
      delete next.comment;
    }
    if (requestType === "other_chemometrics" && next.maintenanceType === "other") {
      next.shortTitle = next.shortTitle || next.maintenanceTitle || "Ancienne demande ? reclasser";
      next.description = next.description || next.maintenanceDescription || next.comment || "Ancienne demande d'entretien ? reclasser avec le plateau.";
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
      calibration_transfer: "instrument_transfer"
    }[type] || type || "performance_audit";
  }

  function registerPerson(people, person) {
    if (!person) return null;
    const nameKey = normalizedPersonName(person);
    const existing = [...people.values()].find((entry) => normalizedPersonName(entry) === nameKey && nameKey);
    const target = existing || {
      id: person.id || NIRSApp.makeId("person"),
      firstName: "",
      lastName: "",
      email: "",
      instrumentAssignments: {}
    };
    target.firstName = target.firstName || person.firstName || "";
    target.lastName = target.lastName || person.lastName || "";
    target.email = target.email || person.email || "";
    target.instrumentAssignments = {
      ...(target.instrumentAssignments || {}),
      ...(person.instrumentAssignments || {})
    };
    Object.entries(person.trainingStatusByInstrument || {}).forEach(([instrumentId, status]) => {
      const scoped = typeof status === "string" ? { status } : status;
      target.instrumentAssignments[instrumentId] = {
        ...(target.instrumentAssignments[instrumentId] || {}),
        assigned: target.instrumentAssignments[instrumentId]?.assigned === true,
        trainingStatus: scoped.status === "unknown" ? "untrained" : (scoped.status || ""),
        trainingDate: scoped.date || scoped.trainingDate || "",
        trainingRequested: target.instrumentAssignments[instrumentId]?.trainingRequested === true
      };
    });
    if (person.trainedInstruments) {
      Object.entries(person.trainedInstruments).forEach(([instrumentId, status]) => {
        target.instrumentAssignments[instrumentId] = {
          ...(target.instrumentAssignments[instrumentId] || {}),
          assigned: target.instrumentAssignments[instrumentId]?.assigned === true,
          trainingStatus: status === "unknown" ? "untrained" : status,
          trainingDate: target.instrumentAssignments[instrumentId]?.trainingDate || "",
          trainingRequested: target.instrumentAssignments[instrumentId]?.trainingRequested === true
        };
      });
    }
    if (person.trainingStatus && person.instrumentId) {
      target.instrumentAssignments[person.instrumentId] = {
        ...(target.instrumentAssignments[person.instrumentId] || {}),
        assigned: target.instrumentAssignments[person.instrumentId]?.assigned === true,
        trainingStatus: person.trainingStatus === "unknown" ? "untrained" : person.trainingStatus,
        trainingDate: person.trainingDate || target.instrumentAssignments[person.instrumentId]?.trainingDate || "",
        trainingRequested: target.instrumentAssignments[person.instrumentId]?.trainingRequested === true
      };
    }
    people.set(target.id, target);
    return target.id;
  }

  function migrateEmbeddedPeople(item, people) {
    const assignPerson = (personId, instrumentId, values = {}) => {
      const person = people.get(personId);
      if (!person || !instrumentId) return;
      person.instrumentAssignments = person.instrumentAssignments || {};
      person.instrumentAssignments[instrumentId] = {
        ...(person.instrumentAssignments[instrumentId] || {}),
        assigned: true,
        trainingStatus: person.instrumentAssignments[instrumentId]?.trainingStatus || values.trainingStatus || "",
        trainingDate: person.instrumentAssignments[instrumentId]?.trainingDate || values.trainingDate || "",
        trainingRequested: values.trainingRequested === true || person.instrumentAssignments[instrumentId]?.trainingRequested === true
      };
    };
    if (item.requestType === "spectra_acquisition" && Array.isArray(item.answers.operators)) {
      item.answers.operatorIds = item.answers.operators
        .map((person) => registerPerson(people, { ...person, instrumentId: item.answers.instrument }))
        .filter(Boolean);
    }
    if (item.requestType === "spectra_acquisition" && Array.isArray(item.answers.operatorIds)) {
      item.answers.operatorIds.forEach((personId) => assignPerson(personId, item.answers.instrument));
    }
    if (item.requestType === "initial_training" && Array.isArray(item.answers.participants)) {
      item.answers.participantIds = item.answers.participants
        .map((person) => registerPerson(people, person))
        .filter(Boolean);
      item.answers.people = item.answers.participantIds.length || item.answers.people;
    }
    if (item.requestType === "initial_training" && Array.isArray(item.answers.participantIds)) {
      item.answers.participantIds.forEach((personId) => assignPerson(personId, item.answers.instrument, { trainingRequested: true }));
    }
  }

  function normalizedPersonName(person) {
    return [person.firstName, person.lastName]
      .map((part) => String(part || "").trim().toLocaleLowerCase("fr-FR"))
      .filter(Boolean)
      .join(" ");
  }

  function personName(person) {
    return [person.firstName, person.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || "Cette personne";
  }

  function personInstrumentKey(personId, instrumentId) {
    return `${String(personId || "").trim()}:${String(instrumentId || "").trim()}`;
  }

  function requestErrors(state) {
    const requester = { ...defaultRequester(), ...(state.requester || {}) };
    const project = { ...defaultProject(), ...(state.project || {}) };
    const errors = {};
    const required = [
      ["requester.firstName", requester.firstName],
      ["requester.lastName", requester.lastName],
      ["requester.email", requester.email],
      ["requester.organization", requester.organization],
      ["requester.unitCode", requester.unitCode],
      ["project.title", project.title],
      ["project.plannedStartDate", project.plannedStartDate],
      ["project.plannedEndDate", project.plannedEndDate],
      ["context", state.context]
    ];
    required.forEach(([key, value]) => {
      if (!String(value || "").trim()) errors[key] = requiredMessageFor(key);
    });
    if (requester.unitCode === "Autre" && !String(requester.unitOther || "").trim()) {
      errors["requester.unitOther"] = "Précisez l’unité, le laboratoire ou le service.";
    }
    if (requester.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requester.email)) {
      errors["requester.email"] = "Renseignez une adresse électronique valide.";
    }
    if (project.plannedStartDate && project.plannedEndDate && project.plannedEndDate < project.plannedStartDate) {
      errors["project.plannedEndDate"] = "La fin doit être postérieure ou égale au début.";
    }
    if (state.context === "partnership" && !String(project.partnershipProjectName || "").trim()) {
      errors["project.partnershipProjectName"] = "Renseignez le nom du projet de partenariat.";
    }
    return errors;
  }

  function canContinueFromStep(step, state, itemStatus, config) {
    if (step === 1) return Object.keys(requestErrors(state)).length === 0;
    if (step === 2) return state.items.length > 0;
    if (step === 3) {
      const allItemsComplete = state.items.length > 0 && state.items.every((item) => itemStatus(item) !== "À compléter");
      const peopleValid = NIRSApp.validateGlobalSpectraUsers(state, config).valid;
      return allItemsComplete && peopleValid;
    }
    return true;
  }

  function requiredMessageFor(key) {
    return {
      "requester.firstName": "Renseignez votre prénom.",
      "requester.lastName": "Renseignez votre nom.",
      "requester.email": "Renseignez une adresse électronique valide.",
      "requester.organization": "Renseignez votre organisme.",
      "requester.unitCode": "Sélectionnez une unité ou un laboratoire.",
      "requester.unitOther": "Précisez l’unité, le laboratoire ou le service.",
      "project.title": "Renseignez l'intitulé court de la demande.",
      "project.plannedStartDate": "Choisissez une date de début.",
      "project.plannedEndDate": "Choisissez une date de fin.",
      "project.partnershipProjectName": "Renseignez le nom du projet de partenariat.",
      "context": "Choisissez un contexte d'intervention."
    }[key] || "Complétez ce champ.";
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function focusStepStart(stepElement) {
    if (!stepElement) return;

    stepElement.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start"
    });

    const heading = stepElement.querySelector("h1, h2, [data-step-heading]");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  function loadDraft(storage) {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.items) ? normalizeState(parsed) : null;
    } catch (_error) {
      return null;
    }
  }

  function renderDraftNotice(storage, state, replaceState, reset) {
    const draft = loadDraft(storage);
    const node = NIRSApp.createElement("div", "draft-placeholder");
    if (!draft || draft.quoteId === state.quoteId) return node;
    node.innerHTML = `
      <section class="draft-notice">
        <p>Un pré-devis non terminé a été retrouvé.</p>
        <button type="button" class="button-secondary">Reprendre le brouillon</button>
        <button type="button" class="button-ghost">Recommencer</button>
      </section>
    `;
    const buttons = node.querySelectorAll("button");
    buttons[0].addEventListener("click", () => replaceState(draft));
    buttons[1].addEventListener("click", reset);
    return node;
  }

  function renderInstitutionalBanner(config) {
    const logos = config.assets.logos || [];
    const left = logos.filter((logo) => /cirad|inrae/i.test(`${logo.label || ""} ${logo.filename || ""}`));
    const center = logos.filter((logo) => /nirs4all/i.test(`${logo.id || ""} ${logo.label || ""} ${logo.filename || ""}`));
    const right = logos.filter((logo) => /agap|bioch/i.test(`${logo.label || ""} ${logo.filename || ""}`));
    const used = new Set([...left, ...center, ...right]);
    const fallback = logos.filter((logo) => !used.has(logo));
    const renderLogo = (logo) => `<img class="institutional-banner__logo institutional-banner__logo--${escapeHtml(logo.id || "logo")}" src="${logo.dataUrl}" alt="${logo.label}">`;
    const banner = NIRSApp.createElement("div", "institutional-banner");
    banner.innerHTML = `
      <div class="institutional-banner__group">${[...left, ...fallback].map(renderLogo).join("")}</div>
      <div class="institutional-banner__group institutional-banner__group--center">${center.map(renderLogo).join("")}</div>
      <div class="institutional-banner__group">${right.map(renderLogo).join("")}</div>
    `;
    return banner;
  }

  function renderHeader(config, currentStep) {
    const header = NIRSApp.createElement("header", "hero");
    header.innerHTML = `
      <div class="hero__content">
        <p class="eyebrow">Plateau scientifique Bioch&amp;Spir</p>
        <h1>${config.textes.app.title}</h1>
        <p class="subtitle">${config.textes.app.subtitle}</p>
        <p class="app-notice">${config.textes.app.notice}</p>
      </div>
      <div class="hero__signature" aria-hidden="true">
        <img src="./data/design_spectre.png" alt="">
      </div>
    `;
    return header;
  }

  function normalizeDocument(document) {
    return {
      type: document?.type || "pre_quote",
      reference: document?.reference || "",
      fileName: document?.fileName || (document?.reference && NIRSApp.filenameFromReference ? NIRSApp.filenameFromReference(document.reference, "pdf") : ""),
      sequenceNumber: Number.isInteger(document?.sequenceNumber) ? document.sequenceNumber : null,
      generatedAt: document?.generatedAt || "",
      validUntil: document?.validUntil || ""
    };
  }

  function renderProgress(currentStep, state, itemStatus, config) {
    const nav = NIRSApp.createElement("nav", "progress");
    nav.setAttribute("aria-label", "Progression du formulaire");
    nav.innerHTML = STEPS.map((label, index) => {
      const number = index + 1;
      const reachable = isStepReachable(number, currentStep, state, itemStatus, config);
      const status = reachable ? getStepStatus(number, currentStep) : "disabled";
      const disabled = !reachable || number === currentStep ? "disabled" : "";
      const clickable = reachable && number !== currentStep ? " is-clickable" : "";
      const title = reachable
        ? `Aller a l'etape ${number} : ${label}`
        : `Etape ${number} disponible apres validation des etapes precedentes`;
      return `
        <button type="button"
          class="progress-step is-${status}${clickable}"
          data-step-target="${number}"
          aria-current="${status === "current" ? "step" : "false"}"
          aria-label="${title}"
          title="${title}"
          ${disabled}>
          <b>${number}</b>${label}
        </button>
      `;
    }).join("");
    return nav;
  }

  function firstBlockingStepBefore(targetStep, state, itemStatus, config) {
    for (let candidate = 1; candidate < targetStep; candidate += 1) {
      if (!canContinueFromStep(candidate, state, itemStatus, config)) return candidate;
    }
    return 0;
  }

  function isStepReachable(stepNumber, currentStep, state, itemStatus, config) {
    if (stepNumber <= currentStep) return true;
    return firstBlockingStepBefore(stepNumber, state, itemStatus, config) === 0;
  }

  function getStepStatus(stepNumber, currentStep) {
    if (stepNumber === currentStep) return "current";
    if (stepNumber < currentStep) return "complete";
    return "upcoming";
  }

  function renderEducational(config) {
    const section = NIRSApp.createElement("section", "education");
    section.innerHTML = `<h2>Repères scientifiques</h2>`;
    const grid = NIRSApp.createElement("div", "education-grid");
    Object.values(config.textes.educational).forEach((item) => {
      const article = NIRSApp.createElement("article");
      article.innerHTML = `<h3>${item.title}</h3><p>${item.text}</p>`;
      grid.append(article);
    });
    section.append(grid);
    return section;
  }

  function sortedGroups(config) {
    return [...(config.prestations.requestGroups || [])].sort((a, b) => a.order - b.order);
  }

  function requestsForGroup(config, groupId) {
    return Object.entries(config.prestations.requestTypes)
      .filter(([, request]) => request.groupId === groupId)
      .sort((left, right) => (left[1].order || 0) - (right[1].order || 0));
  }

  function groupFieldsBySection(config, fields) {
    const order = Object.keys(config.prestations.fieldSections || {});
    const groups = {};
    fields.forEach((field) => {
      const section = field.section || "options";
      groups[section] = groups[section] || [];
      groups[section].push(field);
    });
    return Object.fromEntries(Object.entries(groups).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  NIRSApp.focusStepStart = focusStepStart;
  NIRSApp.initForm = initForm;
})();
