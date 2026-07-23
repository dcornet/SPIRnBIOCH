(function () {
  "use strict";

  const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};

  function statusLabel(status) {
    return {
      estimated: "Estimation chiffrée",
      partial: "Estimation partielle",
      quote_required: "Sur devis",
      incomplete: "À compléter"
    }[status] || status;
  }

  function itemAmount(item, currency) {
    if (item.pricingMode === "quote") return "Sur devis";
    return `${NIRSApp.money(item.totalMin, currency)} - ${NIRSApp.money(item.totalMax, currency)}`;
  }

  function buildSummary(state, result, config) {
    const requester = state.requester || {};
    const project = state.project || {};
    const lines = [
      config.textes.app.title,
      `Identifiant local : ${state.quoteId}`,
      `Demandeur : ${[requester.firstName, requester.lastName].filter(Boolean).join(" ")}`,
      `Courriel : ${requester.email || "à compléter"}`,
      `Structure : ${[requester.organization, requester.unit].filter(Boolean).join(" - ")}`,
      `Demande : ${project.title || "à compléter"}`,
      `Période envisagée : ${project.plannedStartDate || "à compléter"} - ${project.plannedEndDate || "à compléter"}`,
      `Contexte : ${result.context?.label || state.context}`,
      `Statut : ${statusLabel(result.status)}`,
      `Valeur technique complète : ${NIRSApp.rangeMoney(result.technicalValue, result.currency)} ${result.taxMode}`,
      `Montant estimatif facturé : ${NIRSApp.rangeMoney(result.billedEstimate, result.currency)} ${result.taxMode}`
    ];
    if (result.context?.id === "collaborative_project") {
      lines.push(`Contribution scientifique en nature : ${NIRSApp.rangeMoney(result.inKindContribution, result.currency)} ${result.taxMode}`);
    }
    if (project.reference) lines.push(`Référence projet : ${project.reference}`);
    if (project.phone) lines.push(`Téléphone : ${project.phone}`);
    if (project.comment) lines.push(`Commentaire : ${project.comment}`);
    lines.push("", "Prestations :");
    result.itemResults.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.label} - ${statusLabel(item.status)} - ${NIRSApp.rangeMoney(item.technicalValue, result.currency)} ${result.taxMode}`);
      if (item.summary) lines.push(`   ${item.summary}`);
    });
    const quoteLines = result.items.filter((item) => item.pricingMode === "quote");
    if (quoteLines.length) {
      lines.push("", "Éléments restant à chiffrer par le plateau :");
      quoteLines.forEach((item) => lines.push(`- ${item.parentLabel ? `${item.parentLabel} : ` : ""}${item.label}`));
    }
    if (result.exclusions.length) {
      lines.push("", "Mentions et exclusions :");
      result.exclusions.forEach((item) => lines.push(`- ${item}`));
    }
    return lines.join("\n");
  }

  function renderQuote(container, state, result, config, callbacks = {}) {
    const collaborative = result.context?.id === "collaborative_project";
    const subcontracting = result.context?.id === "subcontracting";
    const quoteLines = result.items.filter((item) => item.pricingMode === "quote");
    const summary = buildSummary(state, result, config);
    container.innerHTML = `
      <section class="quote-card" aria-labelledby="quote-title">
        <div class="quote-head">
          <div>
            <p class="eyebrow">${statusLabel(result.status)}</p>
            <h2 id="quote-title">Résumé</h2>
            <p>${state.project?.title || "Demande à compléter"} - ${result.context?.label || ""}${result.context?.display ? ` - ${result.context.display}` : ""}</p>
          </div>
          <div class="quote-total">
            <span>Montant estimatif facturé</span>
            <strong>${NIRSApp.rangeMoney(result.billedEstimate, result.currency)}</strong>
            <small>${result.taxMode}</small>
          </div>
        </div>

        <section class="request-recap" aria-labelledby="request-recap-title">
          <h3 id="request-recap-title">Demande et coordonnées</h3>
          <dl>
            <div><dt>Demandeur</dt><dd>${[state.requester?.firstName, state.requester?.lastName].filter(Boolean).join(" ") || "À compléter"}</dd></div>
            <div><dt>Courriel</dt><dd>${state.requester?.email || "À compléter"}</dd></div>
            <div><dt>Structure</dt><dd>${[state.requester?.organization, state.requester?.unit].filter(Boolean).join(" - ") || "À compléter"}</dd></div>
            <div><dt>Période</dt><dd>${state.project?.plannedStartDate || "À compléter"} - ${state.project?.plannedEndDate || "À compléter"}</dd></div>
          </dl>
        </section>

        <section class="item-summary-list" aria-labelledby="items-summary-title">
          <h3 id="items-summary-title">Synthèse par prestation</h3>
          ${result.itemResults.map((item, index) => renderItemSummary(item, index, result.currency, result.taxMode)).join("")}
        </section>

        <div class="value-grid">
          <div>
            <span>${subcontracting ? "Valeur technique avant contexte" : "Valeur technique complète"}</span>
            <strong>${NIRSApp.rangeMoney(result.technicalValue, result.currency)}</strong>
          </div>
          ${subcontracting ? `<div><span>Majoration de sous-traitance</span><strong>${NIRSApp.rangeMoney(result.contextMarkup, result.currency)}</strong></div>` : ""}
          ${collaborative ? `<div><span>Contribution scientifique en nature potentielle</span><strong>${NIRSApp.rangeMoney(result.inKindContribution, result.currency)}</strong></div>` : ""}
        </div>

        ${collaborative ? `<p class="notice-inline">La contribution en nature n'est jamais additionnée au montant facturé. Montant facturé = valeur technique complète - contribution scientifique en nature convenue.</p>` : ""}

        <div class="table-wrap">
          <table>
            <caption>Détail des lignes chiffrables et sur devis</caption>
            <thead>
              <tr>
                <th scope="col">Prestation</th>
                <th scope="col">Ligne</th>
                <th scope="col">Quantité</th>
                <th scope="col">Tarif unitaire</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              ${result.items.map((item) => `
                <tr>
                  <td>${item.parentLabel || "Global"}</td>
                  <td>${item.label}${item.mandatory ? " <span class=\"tag\">obligatoire</span>" : ""}<br><small>${item.reason || ""}</small></td>
                  <td>${item.quantity} ${item.unit}</td>
                  <td>${item.pricingMode === "quote" ? "Sur devis" : `${NIRSApp.money(item.unitPriceMin, result.currency)} - ${NIRSApp.money(item.unitPriceMax, result.currency)}`}</td>
                  <td>${itemAmount(item, result.currency)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        ${quoteLines.length ? renderQuoteRequired(quoteLines) : ""}
        ${renderList("Hypothèses", result.assumptions)}
        ${renderList("Avertissements", result.warnings, "warning-list")}
        ${renderList("Mentions et exclusions", result.exclusions)}

        <p class="next-step"><strong>Prochaine étape :</strong> ${config.textes.result.nextStep}</p>

        <div class="actions">
          <button type="button" class="button-secondary" data-action="edit">Modifier mes choix</button>
          <button type="button" class="button-secondary" data-action="add">Ajouter une prestation</button>
          <button type="button" class="button-danger" data-action="reset">Réinitialiser</button>
          <button type="button" class="button-primary" data-action="pdf">Générer le PDF A4</button>
          <button type="button" class="button-secondary" data-action="print">Imprimer / enregistrér en PDF</button>
          <button type="button" class="button-secondary" data-action="copy">Copier le résumé</button>
          <button type="button" class="button-secondary" data-action="export">Exporter les données JSON</button>
        </div>
      </section>
    `;

    container.querySelector('[data-action="edit"]')?.addEventListener("click", () => callbacks.goToStep?.(3));
    container.querySelector('[data-action="add"]')?.addEventListener("click", () => callbacks.goToStep?.(2));
    container.querySelector('[data-action="reset"]')?.addEventListener("click", () => callbacks.reset?.());
    container.querySelector('[data-action="print"]')?.addEventListener("click", () => window.print());
    container.querySelector('[data-action="pdf"]')?.addEventListener("click", () => NIRSApp.downloadPdfA4?.(state, result, config));
    container.querySelector('[data-action="copy"]')?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(summary);
        callbacks.announce?.("Résumé copié dans le presse-papiers.");
      } catch (_error) {
        callbacks.announce?.("Copie impossible dans ce navigateur.");
      }
    });
    container.querySelector('[data-action="export"]')?.addEventListener("click", () => {
      NIRSApp.downloadJson(`predevis-nirs-spir-${NIRSApp.slugDate()}.json`, {
        quoteState: state,
        requester: state.requester || null,
        project: state.project || null,
        items: state.items,
        result,
        tariffVersion: config.tarifs.metadata.version,
        generatedAt: new Date().toISOString()
      });
    });
  }

  function renderItemSummary(item, index, currency, taxMode) {
    return `
      <article class="item-summary ${item.status === "incomplete" ? "is-incomplete" : ""}">
        <div>
          <h4>${index + 1}. ${item.label}</h4>
          <p>${item.summary || statusLabel(item.status)}</p>
        </div>
        <strong>${item.status === "incomplete" ? "Non inclus" : `${NIRSApp.rangeMoney(item.technicalValue, currency)} ${taxMode}`}</strong>
      </article>
    `;
  }

  function renderQuoteRequired(items) {
    return `
      <section class="quote-list warning-list">
        <h3>Éléments restant à chiffrer par le plateau</h3>
        <ul>${items.map((item) => `<li>${item.parentLabel ? `${item.parentLabel} : ` : ""}${item.label}</li>`).join("")}</ul>
      </section>
    `;
  }

  function renderList(title, items, className = "") {
    if (!items.length) return "";
    return `
      <section class="quote-list ${className}">
        <h3>${title}</h3>
        <ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>
      </section>
    `;
  }

  NIRSApp.statusLabel = statusLabel;
  NIRSApp.buildSummary = buildSummary;
  NIRSApp.renderQuote = renderQuote;
})();


