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
      root.innerHTML = "";
      root.append(renderInstitutionalBanner(config));
      root.append(renderHeader(config));
      root.append(renderDraftNotice(storage, state, replaceState, reset));
      root.append(renderProgress(step, state));
      root.append(renderLiveEstimate());
      const form = NIRSApp.createElement("form", "wizard");
      form.noValidate = true;
      form.addEventListener("submit", (event) => event.preventDefault());
      if (step === 1) renderRequestDetails(form);
      if (step === 2) renderCatalog(form);
      if (step === 3) renderConfiguration(form);
      if (step === 4) renderSummary(form);
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
      if (!canContinueFromStep(step, state, itemStatus)) {
        fullRender();
        requestAnimationFrame(focusFirstError);
        return;
      }
      setStep(next);
    }

    function addItem(requestType) {
      const request = config.prestations.requestTypes[requestType];
      const item = {
        id: NIRSApp.makeId("item"),
        requestType,
        answers: NIRSApp.defaultAnswersForRequest(config.prestations, requestType),
        completed: false
      };
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
      state[key] = value;
      saveDraft();
      fullRender();
    }

    function updateRequester(key, value) {
      state.requester = {
        ...defaultRequester(),
        ...(state.requester || {}),
        [key]: value
      };
      saveDraft();
      updateNavigationState();
    }

    function updateProject(key, value) {
      state.project = {
        ...defaultProject(),
        ...(state.project || {}),
        [key]: value
      };
      saveDraft();
      updateNavigationState();
    }

    function markFieldTouched(fieldKey) {
      touchedFields.add(fieldKey);
      fullRender();
    }

    function updateAnswer(itemId, fieldId, value, shouldRenderDependents) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      item.answers[fieldId] = value;
      item.answers = NIRSApp.pruneHiddenAnswers(config.prestations, item.requestType, item.answers);
      ensureCustomAnswers(item);
      item.completed = Object.keys(NIRSApp.validateItem(config.prestations, item.requestType, answersForItem(item))).length === 0;
      saveDraft();
      refreshItemStatus(itemId);
      updateLiveEstimate();
      if (shouldRenderDependents) renderConfigurationPanelBody(itemId);
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
      updateLiveEstimate();
    }

    function updatePerson(itemId, collection, personId, key, value) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const person = state.people.find((entry) => entry.id === personId);
      if (!person) return;
      if (key === "trainingStatus") {
        const instrumentId = item.answers.instrument;
        person.trainingStatusByInstrument = {
          ...(person.trainingStatusByInstrument || {}),
          [instrumentId]: {
            status: value,
            source: value === "trained" ? "user_declaration" : "autonomous_use"
          }
        };
      } else {
        person[key] = value;
      }
      syncDerivedPeopleCount(item);
      item.completed = Object.keys(NIRSApp.validateItem(config.prestations, item.requestType, answersForItem(item))).length === 0;
      saveDraft();
      refreshItemStatus(itemId);
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
      return person?.trainingStatusByInstrument?.[instrumentId]?.status || "";
    }

    function explicitTrainingKeysForState(exceptItemId = "") {
      const keys = new Set();
      state.items.forEach((entry) => {
        if (entry.id === exceptItemId || entry.requestType !== "initial_training") return;
        const instrumentId = entry.answers?.instrument;
        if (!instrumentId) return;
        (entry.answers?.participantIds || []).forEach((personId) => keys.add(personInstrumentKey(personId, instrumentId)));
      });
      return keys;
    }

    function hasExplicitTraining(personId, instrumentId, exceptItemId = "") {
      return state.items.some((entry) => entry.id !== exceptItemId
        && entry.requestType === "initial_training"
        && entry.answers?.instrument === instrumentId
        && (entry.answers.participantIds || []).includes(personId));
    }

    function trainingCoverageLabel(item, personId, instrumentId) {
      const person = personById(personId);
      const name = personName(person);
      const instrument = config.tarifs.instruments[instrumentId]?.label || instrumentId;
      const status = trainingStatusForPerson(person, instrumentId);
      if (status === "trained") return `${name} — formation déjà suivie sur ${instrument}`;
      if (hasExplicitTraining(personId, instrumentId)) return `Formation prévue dans le pré-devis : ${name} — ${instrument}`;
      return `Formation initiale obligatoire — ${instrument}, ajoutée automatiquement pour l'utilisation autonome.`;
    }

    function renderRequestDetails(form) {
      const requester = { ...defaultRequester(), ...(state.requester || {}) };
      const project = { ...defaultProject(), ...(state.project || {}) };
      const errors = visibleRequestErrors(requestErrors(state));
      const section = NIRSApp.createElement("section", "step-panel app-step");
      section.innerHTML = `
        <h2>Votre demande et vos coordonnées</h2>
        ${renderRequiredNote()}
        <p>Ces informations servent à préparer le pré-devis et à contextualiser votre demande. Aucune transmission automatique n’est activée dans cette version.</p>
        <fieldset class="field-section">
          <legend>Demandeur</legend>
          ${renderTextInput("requester", "firstName", "Prénom du demandeur", requester.firstName, errors["requester.firstName"], "given-name", "text", true)}
          ${renderTextInput("requester", "lastName", "Nom du demandeur", requester.lastName, errors["requester.lastName"], "family-name", "text", true)}
          ${renderTextInput("requester", "email", "Courriel professionnel", requester.email, errors["requester.email"], "email", "email", true)}
          ${renderTextInput("requester", "organization", "Organisme ou structure", requester.organization, errors["requester.organization"], "organization", "text", true)}
          ${renderTextInput("requester", "unit", "Unité, laboratoire ou service", requester.unit, errors["requester.unit"], "", "text", true)}
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
          ${Object.entries(config.tarifs.contexts).map(([id, context]) => `
            <label class="context-card">
              <input type="radio" name="context" value="${id}" required aria-required="true" ${state.context === id ? "checked" : ""}>
              <span>${context.label}</span>
              <small>${context.description}</small>
              ${context.display ? `<em>${context.display}</em>` : ""}
            </label>
          `).join("")}
          ${errors.context ? `<p class="error">${errors.context}</p>` : ""}
        </fieldset>
        <fieldset class="field-section">
          <legend>Options globales</legend>
          <label class="checkbox"><input type="checkbox" name="urgent" ${state.urgent ? "checked" : ""}>Demande urgente</label>
        </fieldset>
      `;
      form.append(section);
      form.append(renderNavigation());
      section.querySelectorAll("[data-requester-field]").forEach((control) => {
        control.addEventListener("input", () => updateRequester(control.dataset.requesterField, control.value));
        control.addEventListener("blur", () => markFieldTouched(`requester.${control.dataset.requesterField}`));
      });
      section.querySelectorAll("[data-project-field]").forEach((control) => {
        control.addEventListener("input", () => updateProject(control.dataset.projectField, control.value));
        control.addEventListener("blur", () => markFieldTouched(`project.${control.dataset.projectField}`));
      });
      section.querySelectorAll('input[name="context"]').forEach((input) => input.addEventListener("change", () => updateContext("context", input.value)));
      section.querySelector('input[name="urgent"]').addEventListener("change", (event) => updateContext("urgent", event.target.checked));
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
          <p>Vous pouvez sélectionner plusieurs prestations. Aucune prestation n'est ajoutée automatiquement.</p>
        </section>
      `;
      main.append(renderChoiceHelp());
      sortedGroups(config).forEach((group) => {
        const groupNode = NIRSApp.createElement("section", `request-group ${highlightedGroup === group.id ? "is-highlighted" : ""}`);
        groupNode.id = `group-${group.id}`;
        groupNode.innerHTML = `<h3>${group.label}</h3><p>${group.description}</p>`;
        const grid = NIRSApp.createElement("div", "request-card-grid");
        requestsForGroup(config, group.id).forEach(([requestType, request]) => {
          const count = state.items.filter((item) => item.requestType === requestType).length;
          const card = NIRSApp.createElement("article", "request-card");
          card.innerHTML = `
            <h4>${request.label}</h4>
            <p>${request.shortDescription || request.definition}</p>
            ${request.example ? `<small>${request.example}</small>` : ""}
            <strong>${request.pricingHint}</strong>
            <button type="button" class="button-primary" data-add-request="${requestType}">
              ${count ? "Ajouté - ajouter une autre" : "Ajouter au pré-devis"}
            </button>
            ${count ? `<span class="selected-mark">${count} ligne(s) déjà ajoutée(s)</span>` : ""}
          `;
          grid.append(card);
        });
        groupNode.append(grid);
        main.append(groupNode);
      });
      const cart = renderCart();
      layout.append(main, cart);
      form.append(layout);
      form.append(renderNavigation());
      form.querySelectorAll("[data-add-request]").forEach((button) => button.addEventListener("click", () => addItem(button.dataset.addRequest)));
      form.querySelectorAll("[data-highlight-group]").forEach((button) => button.addEventListener("click", () => {
        highlightedGroup = button.dataset.highlightGroup;
        fullRender();
        document.querySelector(`#group-${highlightedGroup}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      }));
      attachCartEvents(form);
    }

    function renderChoiceHelp() {
      const help = NIRSApp.createElement("section", "choice-help");
      help.innerHTML = `
        <h3>Vous ne savez pas quelle prestation choisir ?</h3>
        <div class="help-buttons">
          <button type="button" class="button-secondary" data-highlight-group="measure">Je veux mesurer mes échantillons</button>
          <button type="button" class="button-secondary" data-highlight-group="training">Je veux apprendre à utiliser un instrument</button>
          <button type="button" class="button-secondary" data-highlight-group="develop_model">Je veux créer un modèle de prédiction</button>
          <button type="button" class="button-secondary" data-highlight-group="use_model">Je possède déjà un modèle</button>
        </div>
      `;
      return help;
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
      state.items.forEach((item, index) => section.append(renderItemPanel(item, index)));
      form.append(section);
      form.append(renderNavigation());
      form.querySelector("[data-go-catalog]")?.addEventListener("click", () => setStep(2));
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

    function renderItemPanel(item, index) {
      const request = config.prestations.requestTypes[item.requestType];
      const status = itemStatus(item);
      const panel = NIRSApp.createElement("article", "config-panel");
      const bodyId = `panel-body-${item.id}`;
      panel.dataset.itemPanel = item.id;
      panel.innerHTML = `
        <header class="config-panel__head">
          <button type="button" class="panel-toggle" data-toggle-panel aria-expanded="true" aria-controls="${bodyId}">
            <span>${index + 1}. ${request.label}</span>
            <small data-item-summary="${item.id}">${NIRSApp.describeAnswers(config, item.requestType, answersForItem(item)) || "À compléter"}</small>
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
      const hydratedAnswers = answersForItem(item);
      const errors = NIRSApp.validateItem(config.prestations, item.requestType, hydratedAnswers);
      const fields = NIRSApp.allVisibleFields(config.prestations, item.requestType, hydratedAnswers)
        .filter((field) => !(item.requestType === "initial_training" && field.id === "people"));
      const bySection = groupFieldsBySection(config, fields);
      container.innerHTML = "";
      Object.entries(bySection).forEach(([sectionId, fieldsInSection]) => {
        const sectionMeta = config.prestations.fieldSections[sectionId] || { label: "Paramètres" };
        const fieldset = NIRSApp.createElement("fieldset", "field-section");
        fieldset.innerHTML = `<legend>${sectionMeta.label}</legend>${sectionMeta.description ? `<p>${sectionMeta.description}</p>` : ""}`;
        fieldsInSection.forEach((field) => fieldset.append(renderField(item, field, errors[field.id])));
        container.append(fieldset);
      });
      if (item.requestType === "spectra_acquisition" && item.answers.serviceMode === "self_service") {
        container.append(renderOperators(item, errors));
      }
      if (item.requestType === "initial_training") {
        container.append(renderParticipants(item, errors));
      }
      const subtotal = calculateItemSubtotal(item);
      container.append(renderSubtotal(subtotal));
    }

    function renderField(item, field, error) {
      const wrapper = NIRSApp.createElement("div", "field");
      const id = `${item.id}-${field.id}`;
      const errorId = `${id}-error`;
      if (field.type === "select") {
        const label = NIRSApp.createElement("label", "", field.label);
        label.htmlFor = id;
        const select = NIRSApp.createElement("select");
        select.id = id;
        select.name = field.id;
        select.dataset.itemId = item.id;
        select.dataset.fieldId = field.id;
        NIRSApp.fieldOptions(config, field).forEach((option) => select.append(new Option(option.label, option.value, false, item.answers[field.id] === option.value)));
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
      } else if (field.type === "radio") {
        const fieldset = NIRSApp.createElement("fieldset", "segmented");
        fieldset.innerHTML = `<legend>${field.label}</legend>`;
        NIRSApp.fieldOptions(config, field).forEach((option) => {
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
      if (error) {
        const node = NIRSApp.createElement("p", "error", error);
        node.id = errorId;
        wrapper.append(node);
      }
      if (field.help) wrapper.append(NIRSApp.createElement("p", "muted", field.help));
      return wrapper;
    }

    function renderOperators(item, errors) {
      const instrumentId = item.answers.instrument;
      const instrument = config.tarifs.instruments[instrumentId];
      const fieldset = NIRSApp.createElement("fieldset", "field-section people-section");
      fieldset.innerHTML = `
        <legend>Utilisateurs prévus de l'instrument ${requiredMarker()}</legend>
        <p>La formation est nominative et propre à ${instrument?.label || "l'instrument sélectionné"}.</p>
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
          ${renderPeopleSelector(item, "participants", errors, false)}
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
      const personId = person.id;
      const prefix = `people.${personId}`;
      const coverage = withTrainingStatus && selected ? trainingCoverageLabel(item, person.id, instrumentId) : "";
      return `
        <article class="person-row">
          <label class="checkbox person-select">
            <input type="checkbox" data-select-person data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}" ${selected ? "checked" : ""}>
            <span>${withTrainingStatus ? "Utilisateur" : "Participant"} ${index + 1}</span>
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
          ${withTrainingStatus && selected ? `
            <label>
              <span>Habilitation sur cet instrument ${requiredMarker()}</span>
              <select data-person-field="trainingStatus" data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}" required aria-required="true">
                <option value="">À compléter</option>
                <option value="trained" ${status === "trained" ? "selected" : ""}>Déjà formé</option>
                <option value="untrained" ${status === "untrained" ? "selected" : ""}>Non formé</option>
                <option value="unknown" ${status === "unknown" ? "selected" : ""}>Statut inconnu</option>
              </select>
              ${errors[`${prefix}.trainingStatus`] ? `<small class="error">${errors[`${prefix}.trainingStatus`]}</small>` : ""}
            </label>
          ` : ""}
          ${coverage ? `<p class="person-training-note">${coverage}</p>` : ""}
          ${selected ? `<button type="button" class="button-ghost" data-remove-person data-collection="${collection}" data-person-id="${personId}" data-item-id="${item.id}">Retirer de cette prestation</button>` : ""}
        </article>
      `;
    }

    function renderSubtotal(result) {
      const node = NIRSApp.createElement("div", "item-subtotal");
      node.innerHTML = `
        <span>Sous-total indicatif</span>
        <strong>${result.status === "incomplete" ? "À compléter" : NIRSApp.rangeMoney(result.technicalValue, result.currency)}</strong>
        ${result.status === "partial" ? "<small>Sur devis partiel</small>" : ""}
      `;
      return node;
    }

    function renderLiveEstimate() {
      const result = NIRSApp.calculateQuote(config, state);
      const incomplete = result.itemResults.filter((item) => item.status === "incomplete").length;
      const quoteLines = result.items.filter((item) => item.pricingMode === "quote").length;
      const node = NIRSApp.createElement("aside", "live-estimate");
      node.id = "live-estimate";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.innerHTML = `
        <div>
          <span>Montant indicatif dynamique</span>
          <strong>${incomplete && !result.technicalValue.max ? "À compléter" : `${NIRSApp.rangeMoney(result.billedEstimate, result.currency)} ${result.taxMode}`}</strong>
          <small>${result.context?.label || ""}${incomplete ? ` - ${incomplete} prestation(s) à compléter` : ""}${quoteLines ? ` - ${quoteLines} élément(s) sur devis` : ""}</small>
        </div>
        <div>
          <span>Valeur technique</span>
          <strong>${NIRSApp.rangeMoney(result.technicalValue, result.currency)} ${result.taxMode}</strong>
        </div>
      `;
      return node;
    }

    function updateLiveEstimate() {
      const current = document.querySelector("#live-estimate");
      if (current) current.replaceWith(renderLiveEstimate());
    }

    function attachFieldEvents(scope) {
      scope.querySelectorAll("input, select").forEach((control) => {
        const itemId = control.dataset.itemId;
        const fieldId = control.dataset.fieldId;
        if (!itemId || !fieldId) return;
        if (control.type === "number") {
          let timer;
          control.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => updateAnswer(itemId, fieldId, control.value, false), 200);
          });
          control.addEventListener("change", () => updateAnswer(itemId, fieldId, control.value, true));
        } else {
          control.addEventListener("change", () => updateAnswer(itemId, fieldId, control.type === "checkbox" ? control.checked : control.value, true));
        }
      });
    }

    function attachPersonEvents(scope) {
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
        ${step < 4 ? `<button type="button" class="button-primary" data-next>Continuer</button>` : ""}
      `;
      nav.querySelector("[data-prev]")?.addEventListener("click", () => setStep(step - 1));
      nav.querySelector("[data-next]")?.addEventListener("click", () => requestStepChange(step + 1));
      nav.querySelector("[data-clear-draft]")?.addEventListener("click", () => {
        storage?.removeItem(STORAGE_KEY);
        announce("Brouillon local effacé.");
      });
      return nav;
    }

    function attachCartEvents(scope) {
      scope.querySelectorAll("[data-remove-item]").forEach((button) => button.addEventListener("click", () => removeItem(button.dataset.removeItem)));
      scope.querySelector("[data-go-config]")?.addEventListener("click", () => setStep(3));
    }

    function updateNavigationState() {
      const next = document.querySelector("[data-next]");
      if (next) next.disabled = false;
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
      const subtotal = body?.querySelector(".item-subtotal");
      if (subtotal) subtotal.replaceWith(renderSubtotal(calculateItemSubtotal(item)));
    }

    function calculateItemSubtotal(item) {
      const answers = answersForItem(item);
      const errors = NIRSApp.validateItem(config.prestations, item.requestType, answers);
      if (Object.keys(errors).length) return { status: "incomplete", currency: config.tarifs.metadata.currency, technicalValue: { min: 0, max: 0 } };
      return NIRSApp.calculateSingleQuote(config.tarifs, answers, {
        applyCommonOptions: false,
        applyUrgency: false,
        applyBillingMinimum: false,
        applyContext: false,
        addDisclaimers: false
      });
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
      requester: defaultRequester(),
      project: defaultProject(),
      context: config.tarifs.contexts.occasional_help ? "occasional_help" : (Object.keys(config.tarifs.contexts)[0] || "occasional_help"),
      urgent: false,
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
      unit: ""
    };
  }

  function defaultProject() {
    return {
      title: "",
      reference: "",
      plannedStartDate: "",
      plannedEndDate: "",
      phone: "",
      comment: ""
    };
  }

  function defaultPerson() {
    return {
      id: NIRSApp.makeId("person"),
      firstName: "",
      lastName: "",
      trainingStatusByInstrument: {}
    };
  }

  function ensureCustomAnswers(item) {
    item.answers = item.answers || {};
    if (item.requestType === "spectra_acquisition" && item.answers.serviceMode === "self_service") {
      item.answers.operatorIds = Array.isArray(item.answers.operatorIds) ? item.answers.operatorIds : [];
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
      requester: { ...defaultRequester(), ...(state.requester || {}) },
      project: { ...defaultProject(), ...(state.project || {}) },
      context: state.context,
      urgent: state.urgent,
      currentStep,
      tariffVersion: config.tarifs?.metadata?.version || state.tariffVersion || "",
      savedAt: new Date().toISOString(),
      people: (state.people || []).map((person) => ({
        id: person.id,
        firstName: person.firstName || "",
        lastName: person.lastName || "",
        trainingStatusByInstrument: person.trainingStatusByInstrument || {}
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
      requester: { ...requester, ...(parsed.requester || {}) },
      project: { ...project, ...(parsed.project || {}) },
      context: parsed.context === "point_support" ? "occasional_help" : (parsed.context || "occasional_help")
    };
    delete normalized.externalAdmin;
    normalized.currentStep = Number.isInteger(parsed.currentStep) ? Math.min(4, Math.max(1, parsed.currentStep)) : 1;
    normalized.tariffVersion = parsed.tariffVersion || "";
    normalized.savedAt = parsed.savedAt || "";
    const people = new Map();
    (Array.isArray(parsed.people) ? parsed.people : []).forEach((person) => registerPerson(people, person));
    normalized.items = (normalized.items || []).map((item) => {
      const next = {
        ...item,
        answers: { ...(item.answers || {}) },
        completed: item.completed ?? item["compl\u00e8ted"] ?? false
      };
      migrateEmbeddedPeople(next, people);
      ensureCustomAnswers(next);
      return next;
    });
    normalized.people = [...people.values()];
    return normalized;
  }

  function registerPerson(people, person) {
    if (!person) return null;
    const nameKey = normalizedPersonName(person);
    const existing = [...people.values()].find((entry) => normalizedPersonName(entry) === nameKey && nameKey);
    const target = existing || {
      id: person.id || NIRSApp.makeId("person"),
      firstName: "",
      lastName: "",
      trainingStatusByInstrument: {}
    };
    target.firstName = target.firstName || person.firstName || "";
    target.lastName = target.lastName || person.lastName || "";
    target.trainingStatusByInstrument = {
      ...(target.trainingStatusByInstrument || {}),
      ...(person.trainingStatusByInstrument || {})
    };
    if (person.trainedInstruments) {
      Object.entries(person.trainedInstruments).forEach(([instrumentId, status]) => {
        target.trainingStatusByInstrument[instrumentId] = {
          status,
          source: status === "trained" ? "user_declaration" : "migrated"
        };
      });
    }
    if (person.trainingStatus && person.instrumentId) {
      target.trainingStatusByInstrument[person.instrumentId] = {
        status: person.trainingStatus,
        source: "migrated"
      };
    }
    people.set(target.id, target);
    return target.id;
  }

  function migrateEmbeddedPeople(item, people) {
    if (item.requestType === "spectra_acquisition" && Array.isArray(item.answers.operators)) {
      item.answers.operatorIds = item.answers.operators
        .map((person) => registerPerson(people, { ...person, instrumentId: item.answers.instrument }))
        .filter(Boolean);
    }
    if (item.requestType === "initial_training" && Array.isArray(item.answers.participants)) {
      item.answers.participantIds = item.answers.participants
        .map((person) => registerPerson(people, person))
        .filter(Boolean);
      item.answers.people = item.answers.participantIds.length || item.answers.people;
    }
  }

  function normalizedPersonName(person) {
    return [person?.firstName, person?.lastName]
      .map((part) => String(part || "").trim().toLocaleLowerCase("fr-FR"))
      .filter(Boolean)
      .join(" ");
  }

  function personName(person) {
    return [person?.firstName, person?.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || "Cette personne";
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
      ["requester.unit", requester.unit],
      ["project.title", project.title],
      ["project.plannedStartDate", project.plannedStartDate],
      ["project.plannedEndDate", project.plannedEndDate],
      ["context", state.context]
    ];
    required.forEach(([key, value]) => {
      if (!String(value || "").trim()) errors[key] = requiredMessageFor(key);
    });
    if (requester.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requester.email)) {
      errors["requester.email"] = "Renseignez une adresse électronique valide.";
    }
    if (project.plannedStartDate && project.plannedEndDate && project.plannedEndDate < project.plannedStartDate) {
      errors["project.plannedEndDate"] = "La fin doit être postérieure ou égale au début.";
    }
    return errors;
  }

  function canContinueFromStep(step, state, itemStatus) {
    if (step === 1) return Object.keys(requestErrors(state)).length === 0;
    if (step === 2) return state.items.length > 0;
    if (step === 3) return state.items.some((item) => itemStatus(item) !== "À compléter");
    return true;
  }

  function requiredMessageFor(key) {
    return {
      "requester.firstName": "Renseignez votre prénom.",
      "requester.lastName": "Renseignez votre nom.",
      "requester.email": "Renseignez une adresse électronique valide.",
      "requester.organization": "Renseignez votre organisme.",
      "requester.unit": "Renseignez votre unité ou laboratoire.",
      "project.title": "Renseignez l'intitulé court de la demande.",
      "project.plannedStartDate": "Choisissez une date de début.",
      "project.plannedEndDate": "Choisissez une date de fin.",
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
    const logos = config.assets?.logos || [];
    const left = logos.filter((logo) => /cirad|inrae/i.test(`${logo.label || ""} ${logo.filename || ""}`));
    const right = logos.filter((logo) => /agap|bioch/i.test(`${logo.label || ""} ${logo.filename || ""}`));
    const fallback = logos.filter((logo) => !left.includes(logo) && !right.includes(logo));
    const renderLogo = (logo) => `<img src="${logo.dataUrl}" alt="${logo.label}">`;
    const banner = NIRSApp.createElement("div", "institutional-banner");
    banner.innerHTML = `
      <div class="institutional-banner__group">${[...left, ...fallback].map(renderLogo).join("")}</div>
      <div class="institutional-banner__group">${right.map(renderLogo).join("")}</div>
    `;
    return banner;
  }

  function renderHeader(config) {
    const header = NIRSApp.createElement("header", "hero");
    header.innerHTML = `
      <div>
        <p class="eyebrow">Plateau scientifique</p>
        <h1>${config.textes.app.title}</h1>
        <p class="subtitle">${config.textes.app.subtitle}</p>
        <p class="app-notice">${config.textes.app.notice}</p>
      </div>
      <img src="./assets/images/parcours-predevis.svg" alt="Parcours du pré-devis en quatre étapes">
    `;
    return header;
  }

  function renderProgress(currentStep, state) {
    const nav = NIRSApp.createElement("nav", "progress");
    nav.setAttribute("aria-label", "Progression du formulaire");
    const incomplete = state.items.some((item) => item.completed === false);
    nav.innerHTML = STEPS.map((label, index) => {
      const number = index + 1;
      const done = number < currentStep && !(number === 2 && incomplete);
      return `<span class="${number === currentStep ? "done" : done ? "done is-complete" : ""}" aria-current="${number === currentStep ? "step" : "false"}"><b>${number}</b>${label}</span>`;
    }).join("");
    return nav;
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


