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
    if (item.billingRangeReview?.required) return "À confirmer avec le plateau";
    if (item.pricingMode === "quote") return "Sur devis";
    if (item.offeredByPlatform) return "Offert";
    if (displayTotalMin(item) === displayTotalMax(item)) return NIRSApp.money(displayTotalMin(item), currency);
    return `${NIRSApp.money(displayTotalMin(item), currency)} - ${NIRSApp.money(displayTotalMax(item), currency)}`;
  }

  function contributionText(result) {
    const contribution = result.inKindContribution || { min: 0, max: 0 };
    const hasContribution = Number(contribution.min || 0) > 0 || Number(contribution.max || 0) > 0;
    return hasContribution ? NIRSApp.rangeMoney(contribution, result.currency) : "Aucune à ce stade";
  }

  function isBusinessLine(item) {
    return item && item.configRule !== "externalAdministrativeFee" && item.configRule !== "billingMinimumAdjustment" && item.configRule !== "urgentMarkup" && !String(item.id || "").startsWith("global_urgent");
  }

  function quoteRequiredLines(result) {
    return (result.items || []).filter((item) => isBusinessLine(item) && item.pricingMode === "quote");
  }

  function totalTitle(result) {
    if (result.status === "quote_required") return "Montant à définir avec le plateau";
    return result.status === "partial" ? "Total estimatif partiel HT" : "Total estimatif HT";
  }

  function totalAmountText(result) {
    if (result.status === "quote_required") return "Sur devis";
    return NIRSApp.rangeMoney(result.billedEstimate || { min: 0, max: 0 }, result.currency);
  }

  function displayTotalMin(item) {
    return Number.isFinite(item.displayTotalMin) ? item.displayTotalMin : item.totalMin;
  }

  function displayTotalMax(item) {
    return Number.isFinite(item.displayTotalMax) ? item.displayTotalMax : item.totalMax;
  }

  function lineLabelHtml(item) {
    const help = item.configRule === "externalAdministrativeFee" && item.helpText && NIRSApp.tooltipHtml
      ? NIRSApp.tooltipHtml("administrative-fee-help", item.helpText, "Que couvre le forfait de gestion ?")
      : "";
    const referenceDetails = item.configRule === "predictionReferenceAnalyses" ? `<br><small>${NIRSApp.escapeHtml(item.reason)}</small>` : "";
    return `${escapeHtml(item.label)}${item.trainingDetails ? ` - ${escapeHtml(item.trainingDetails)}` : ""}${help}${referenceDetails}`;
  }

  function orderedResultItems(result) {
    return [...(result.items || [])].sort((a, b) => {
      const aAdmin = a.configRule === "externalAdministrativeFee";
      const bAdmin = b.configRule === "externalAdministrativeFee";
      if (aAdmin === bAdmin) return 0;
      return aAdmin ? -1 : 1;
    });
  }

  function groupedResultItems(result) {
    const ordered = orderedResultItems(result);
    const training = ordered.filter((item) => item.configRule === "instrumentTraining" && item.pricingMode !== "quote");
    if (!training.length) return ordered;
    const others = ordered.filter((item) => item.configRule !== "instrumentTraining");
    const firstTrainingIndex = ordered.findIndex((item) => item.configRule === "instrumentTraining");
    const groupTotalMin = training.reduce((sum, item) => sum + displayTotalMin(item), 0);
    const groupTotalMax = training.reduce((sum, item) => sum + displayTotalMax(item), 0);
    const group = {
      id: "grouped_instrument_training",
      parentLabel: "Utilisateurs et formations",
      label: "Formations aux instruments",
      trainingDetails: training.map((item) => item.trainingDescription || item.label).join(" ; "),
      totalMin: groupTotalMin,
      totalMax: groupTotalMax,
      pricingMode: "range",
      configRule: "instrumentTraining",
      offeredByPlatform: training.every((item) => item.offeredByPlatform),
      contextNote: training.find((item) => item.contextNote)?.contextNote || ""
    };
    others.splice(Math.max(0, firstTrainingIndex), 0, group);
    return others;
  }

  function ensureDocument(state, config, callbacks = {}) {
    try {
      return NIRSApp.ensureQuoteReference?.(state, config) || NIRSApp.ensureQuoteDocument?.(state, config);
    } catch (error) {
      console.error("Reference du pre-devis non generee", error);
      callbacks.announce?.(error.message);
      if (typeof window !== "undefined" && window.alert) window.alert(error.message);
      return null;
    }
  }

  function buildSummary(state, result, config) {
    const requester = state.requester || {};
    const project = state.project || {};
    const contextLabel = result.context?.label || state.context || "Contexte à choisir";
    const lines = [
      config.textes.app.title,
      state.document?.reference ? `Référence pré-devis : ${state.document.reference}` : `Identifiant local : ${state.quoteId}`,
      `Demandeur : ${[requester.firstName, requester.lastName].filter(Boolean).join(" ")}`,
      `Courriel : ${requester.email || "à compléter"}`,
      `Structure : ${[requester.organization, requester.unit].filter(Boolean).join(" - ")}`,
      `Demande : ${project.title || "à compléter"}`,
      `Période envisagée : ${project.plannedStartDate || "à compléter"} - ${project.plannedEndDate || "à compléter"}`,
      `Contexte : ${contextLabel}`,
      `Statut : ${statusLabel(result.status)}`,
      `${totalTitle(result)} : ${totalAmountText(result)}`
    ];
    if (result.context?.mode === "negotiated_partnership" && result.partnershipBreakdown) {
      lines.push(
        `Contribution Bioch&SPIR non facturée HT : ${contributionText(result)}`,
        "Montant partenariat : indicatif, à valider avec le plateau"
      );
    }
    if (project.reference) lines.push(`Référence projet : ${project.reference}`);
    if (project.phone) lines.push(`Téléphone : ${project.phone}`);
    if (project.comment) lines.push(`Commentaire : ${project.comment}`);
    lines.push("", "Prestations :");
    result.itemResults.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.label} - ${statusLabel(item.status)} - ${summaryAmountText(item, result.currency, result.taxMode)}`);
      if (item.summary) lines.push(`   ${item.summary}`);
      if (item.estimatedSpectralCapacity) lines.push(`   ${spectralCapacityText(item.estimatedSpectralCapacity)}`);
    });
    const quoteLines = quoteRequiredLines(result);
    if (quoteLines.length) {
      lines.push("", "Éléments restant à chiffrer par le plateau :");
      quoteLines.forEach((item) => lines.push(`- ${item.parentLabel ? `${item.parentLabel} : ` : ""}${item.label}`));
    }
    if (result.exclusions.length) {
      lines.push("", "Mentions et exclusions :");
      result.exclusions.forEach((item) => lines.push(`- ${item}`));
    }
    if (result.warnings.length) {
      lines.push("", "Avertissements :");
      result.warnings.forEach((warning) => lines.push(`- ${warning}`));
    }
    return lines.join("\n");
  }

  function buildQuoteExport(state, result) {
    const technicalValue = result.context?.mode === "negotiated_partnership" && result.partnershipBreakdown?.technicalValue
      ? result.partnershipBreakdown.technicalValue
      : result.technicalValue;
    const { biochSpirInvolvement: _biochSpirInvolvement, ...project } = state.project || {};
    return {
      schemaVersion: state.schemaVersion || 6,
      quoteId: state.quoteId || "",
      document: state.document || {},
      requester: state.requester || {},
      project,
      context: result.context ? {
        id: result.context.id,
        label: result.context.label,
        mode: result.context.mode,
        billedShare: result.context.billedShare || null,
        requiresDiscussion: result.context.requiresDiscussion === true
      } : {
        id: state.context || "",
        label: "Contexte à choisir",
        mode: "",
        billedShare: null,
        requiresDiscussion: false
      },
      totals: {
        technicalValue,
        billedEstimate: result.billingRangeReview?.required ? null : result.billedEstimate,
        inKindContribution: result.inKindContribution,
        currency: result.currency,
        taxMode: result.taxMode
      },
      clientPricing: {
        requiresPlateauReview: result.billingRangeReview?.required === true,
        reviewMessage: result.billingRangeReview?.required ? result.billingRangeReview.message : "",
        context: result.context ? {
          id: result.context.id,
          label: result.context.label,
          requiresDiscussion: result.context.requiresDiscussion === true
        } : null,
        billedEstimate: result.billingRangeReview?.required ? null : result.billedEstimate,
        administrativeFee: administrativeFeeRange(result),
        status: result.status,
        quoteRequiredItems: (result.items || []).filter((item) => item.pricingMode === "quote").map((item) => ({
          id: item.id,
          label: item.label,
          parentLabel: item.parentLabel || "",
          reason: item.reason || ""
        }))
      },
      platformPricingAudit: result.pricingAudit || null,
      billingRangeReview: result.billingRangeReview || null,
      partnershipBreakdown: result.partnershipBreakdown || null,
      configuredItems: (state.items || []).map((item) => exportConfiguredItem(item)),
      items: result.items || [],
      itemResults: result.itemResults || [],
      warnings: result.warnings || [],
      assumptions: result.assumptions || [],
      exclusions: result.exclusions || []
    };
  }

  function administrativeFeeRange(result) {
    const fee = (result.items || []).find((item) => item.configRule === "externalAdministrativeFee");
    return fee ? { min: fee.totalMin, max: fee.totalMax, label: fee.label || "Forfait de gestion" } : null;
  }

  function exportConfiguredItem(item) {
    const answers = NIRSApp.pruneHiddenAnswers
      ? NIRSApp.pruneHiddenAnswers(globalThis.NIRS_CONFIG?.prestations || {}, item.requestType, item.answers || {})
      : item.answers || {};
    const exported = {
      id: item.id || "",
      requestType: item.requestType || "",
      answers
    };
    if (item.requestType === "model_maintenance") {
      const type = migrateMaintenanceTypeForExport(answers.maintenanceType);
      const rule = globalThis.NIRS_CONFIG?.tarifs?.maintenancePricing?.[type] || {};
      exported.maintenance = {
        type,
        comment: answers.maintenanceComment || answers.comment || "",
        pricingConfidence: rule.pricingConfidence || "",
        requiresPlateauReview: rule.requiresPlateauReview === true
      };
      if (answers.legacyMaintenanceAnswers) exported.maintenance.legacyMaintenanceAnswers = answers.legacyMaintenanceAnswers;
    }
    return exported;
  }

  function migrateMaintenanceTypeForExport(type) {
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

  function renderQuote(container, state, result, config, callbacks = {}) {
    const requester = state.requester || {};
    const project = state.project || {};
    const contextLabel = result.context?.label || "Contexte à choisir";
    const contextDisplay = result.context?.display;
    const partnership = result.context?.mode === "negotiated_partnership";
    const quoteLines = quoteRequiredLines(result);
    const totalLabel = totalTitle(result);
    const pricedCount = result.itemResults.filter((item) => !isQuoteOnlyItem(item) && item.status !== "incomplete").length;
    container.innerHTML = `
      <section class="quote-card" aria-labelledby="quote-title">
        <div class="quote-head">
          <div>
            <p class="eyebrow">${statusLabel(result.status)}</p>
            <h2 id="quote-title">Résumé</h2>
            <p>${escapeHtml(project.title || "Demande à compléter")} - ${escapeHtml(contextLabel)}${contextDisplay ? ` - ${escapeHtml(contextDisplay)}` : ""}</p>
            <p class="notice-inline">Ce pré-devis est indicatif et doit être validé et discuté avec le plateau avant tout engagement.</p>
          </div>
          <div class="quote-total">
            <span>${partnership ? "Part facturée indicative HT à définir" : totalLabel}</span>
            <strong>${totalAmountText(result)}</strong>
            <small>${pricedCount} prestation(s) chiffrée(s)${quoteLines.length ? ` ; ${quoteLines.length} élément(s) à discuter avec le plateau non inclus` : ""}</small>
            ${partnership ? "<small>La répartition définitive sera arrêtée avec le plateau.</small>" : ""}
          </div>
        </div>

        <section class="request-recap" aria-labelledby="request-recap-title">
          <h3 id="request-recap-title">Demande et coordonnées</h3>
          <dl>
            <div><dt>Demandeur</dt><dd>${escapeHtml([requester.firstName, requester.lastName].filter(Boolean).join(" ") || "À compléter")}</dd></div>
            <div><dt>Courriel</dt><dd>${escapeHtml(requester.email || "À compléter")}</dd></div>
            <div><dt>Structure</dt><dd>${escapeHtml([requester.organization, requester.unit].filter(Boolean).join(" - ") || "À compléter")}</dd></div>
            <div><dt>Période</dt><dd>${escapeHtml(project.plannedStartDate || "À compléter")} - ${escapeHtml(project.plannedEndDate || "À compléter")}</dd></div>
            <div><dt>Urgence</dt><dd>${state.urgent ? `Oui (${state.urgentSource === "automatic" ? "automatique" : "manuelle"})` : "Non"}</dd></div>
            ${result.context?.id === "partnership" ? `<div><dt>Projet de partenariat</dt><dd>${escapeHtml(project.partnershipProjectName || "À compléter")}</dd></div>` : ""}
          </dl>
        </section>

        <section class="item-summary-list" aria-labelledby="items-summary-title">
          <h3 id="items-summary-title">Synthèse par prestation</h3>
          ${result.itemResults.map((item, index) => renderItemSummary(item, index, result.currency, result.taxMode)).join("")}
        </section>

        ${partnership ? `
          <div class="value-grid">
            <div><span>Apports Bioch&amp;SPIR identifiés HT</span><strong>${contributionText(result)}</strong></div>
          </div>
        ` : ""}

        ${partnership ? renderPartnershipBreakdown(result) : ""}

        <div class="table-wrap">
          <table>
            <caption>Détail des lignes chiffrables et sur devis</caption>
            <thead>
              <tr>
                <th scope="col">Prestation</th>
                <th scope="col">Ligne</th>
                <th scope="col">Total estimatif HT</th>
              </tr>
            </thead>
            <tbody>
              ${groupedResultItems(result).map((item) => `
                <tr>
                  <td>${escapeHtml(item.parentLabel || "Global")}</td>
                  <td>${lineLabelHtml(item)}${item.contextNote ? `<br><small>${escapeHtml(item.contextNote)}</small>` : ""}</td>
                  <td>${itemAmount(item, result.currency)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        ${quoteLines.length ? renderQuoteRequired(quoteLines) : ""}
        <p class="notice-inline">${NIRSApp.escapeHtml(config.textes.pdf.estimateRangeNote)}</p>
        ${renderList("Hypothèses", result.assumptions)}
        ${renderList("Avertissements", result.warnings, "warning-list")}
        ${renderList("Mentions et exclusions", result.exclusions)}

        <p class="next-step"><strong>Prochaine étape :</strong> ${escapeHtml(config.textes.result.nextStep)}</p>

        <div class="actions">
          <button type="button" class="button-danger" data-action="reset">Réinitialiser</button>
          <button type="button" class="button-primary" data-action="pdf">Générer le PDF A4</button>
          ${internalExportsVisible(config) ? '<button type="button" class="button-secondary" data-action="platform-xlsx">Export plateau XLSX</button><button type="button" class="button-secondary" data-action="platform-csv">Export lignes CSV</button>' : ""}
        </div>
      </section>
    `;

    container.querySelector('[data-action="reset"]').addEventListener("click", () => callbacks.reset?.());
    container.querySelector('[data-action="pdf"]').addEventListener("click", () => NIRSApp.downloadQuoteDocuments?.(state, result, config));
    container.querySelector('[data-action="platform-xlsx"]')?.addEventListener("click", () => NIRSApp.downloadPlatformWorkbook?.(state, result, config));
    container.querySelector('[data-action="platform-csv"]')?.addEventListener("click", () => NIRSApp.downloadPlatformCsv?.(state, result, config));
    NIRSApp.attachTooltips?.(container);
  }


  async function downloadQuoteDocuments(state, result, config) {
    const pdfDownload = NIRSApp.downloadPdfA4;
    if (typeof pdfDownload !== "function") throw new Error("Export PDF indisponible.");
    const settings = config?.tarifs?.internalExports || {};
    const jobs = [Promise.resolve(pdfDownload(state, result, config))];
    if (settings.enabled === true && settings.autoGenerateWithPdf === true) {
      if (typeof NIRSApp.downloadPlatformWorkbook !== "function") {
        throw new Error("Export XLSX plateau indisponible alors qu'il est configuré avec le PDF.");
      }
      jobs.push(Promise.resolve(NIRSApp.downloadPlatformWorkbook(state, result, config)));
    }
    const outcomes = await Promise.allSettled(jobs);
    const failure = outcomes.find((entry) => entry.status === "rejected");
    if (failure) {
      console.error("Generation des documents incomplete", failure.reason);
      if (typeof window !== "undefined" && window.alert) {
        window.alert("Un des documents n'a pas pu être généré. Vérifiez le PDF et le classeur XLSX téléchargés.");
      }
    }
    return outcomes;
  }

  NIRSApp.downloadQuoteDocuments = downloadQuoteDocuments;

  function internalExportsVisible(config) {
    const settings = config?.tarifs?.internalExports || {};
    return settings.enabled === true && settings.showInPublicInterface === true;
  }

  function renderPartnershipBreakdown(result) {
    const breakdown = result.partnershipBreakdown;
    if (!breakdown) return "";
    const offeredBase = breakdown.offeredBase || addDisplayRange(breakdown.offeredPersonnel, breakdown.offeredTraining);
    const rows = [
      ["Part facturée indicative", breakdown.billedEstimate],
      ["Dont forfait de gestion", breakdown.administrativeFee],
      ["Apports Bioch&SPIR déjà identifiés", offeredBase],
      ["Dont formations offertes", breakdown.offeredTraining],
      ["Contribution complémentaire possible", breakdown.negotiatedReduction]
    ].filter(([, range]) => Number(range?.min || 0) !== 0 || Number(range?.max || 0) !== 0);
    return `
      <section class="quote-list partnership-breakdown">
        <h3>Répartition partenariale indicative</h3>
        <p class="partnership-payable-note">La fourchette reflète les caractéristiques concrètes du travail. Les personnels et formations apportés par Bioch&amp;SPIR ne sont pas facturés. Le montant exact sera discuté avec le plateau avant établissement du devis définitif.</p>
        <dl>${rows.map(([label, range]) => `<div><dt>${label}</dt><dd>${label === "Part facturée indicative" && result.billingRangeReview?.required ? "Sur devis" : `${NIRSApp.rangeMoney(range, result.currency)} ${result.taxMode}`}</dd></div>`).join("")}</dl>
        <p class="notice-inline">Les apports Bioch&amp;SPIR ne sont pas ajoutés au montant à payer.</p>
      </section>
    `;
  }

  function addDisplayRange(a = {}, b = {}) {
    return {
      min: Number(a.min || 0) + Number(b.min || 0),
      max: Number(a.max || 0) + Number(b.max || 0)
    };
  }

  function renderItemSummary(item, index, currency, taxMode) {
    const capacity = item.estimatedSpectralCapacity ? `<p>${spectralCapacityText(item.estimatedSpectralCapacity)}</p>` : "";
    const amount = itemSummaryAmount(item, currency, taxMode);
    const maintenance = item.requestType === "model_maintenance" ? maintenanceSummaryHtml(item) : "";
    return `
      <article class="item-summary ${item.status === "incomplete" ? "is-incomplete" : ""}">
        <div>
          <h4>${index + 1}. ${escapeHtml(item.label)}</h4>
          <p>${escapeHtml(item.summary || statusLabel(item.status))}</p>
          ${maintenance}
          ${item.contextNote ? `<p>${escapeHtml(item.contextNote)}</p>` : ""}
          ${capacity}
        </div>
        <strong>${amount}</strong>
      </article>
    `;
  }

  function maintenanceSummaryHtml(item) {
    const answerItem = item.answers || {};
    const comment = String(answerItem.maintenanceComment || answerItem.comment || "").trim();
    return `
      <p>${comment ? escapeHtml(comment) : "Informations complémentaires à préciser avec le plateau."}</p>
          <p><small>Tarifs indicatifs à confirmer avec le plateau.</small></p>
    `;
  }

  function itemSummaryAmount(item, currency, taxMode) {
    if (item.billingRangeReview?.required) return "Sur devis";
    if (item.status === "incomplete") return "À discuter";
    if (isQuoteOnlyItem(item)) return "Sur devis";
    if (item.offeredByPlatform) {
      return `Contribution Bioch&SPIR HT<br><small>${NIRSApp.rangeMoney(item.technicalValue, currency)}</small>`;
    }
    if (!item.billedEstimate) return "À discuter";
    return `${NIRSApp.rangeMoney(item.billedEstimate, currency)} ${taxMode}`;
  }

  function summaryAmountText(item, currency, taxMode) {
    if (item.billingRangeReview?.required) return "Sur devis";
    if (item.status === "incomplete") return "À discuter";
    if (isQuoteOnlyItem(item)) return "Sur devis";
    if (!item.billedEstimate) return "À discuter";
    return `${NIRSApp.rangeMoney(item.billedEstimate, currency)} ${taxMode}`;
  }

  function isQuoteOnlyItem(item) {
    const amount = item.billedEstimate || item.technicalValue || {};
    const hasQuoteLine = item.pricingMode === "quote"
      || item.status === "quote_required"
      || (item.items || []).some((line) => line.pricingMode === "quote");
    const hasAmount = Number(amount.min || 0) !== 0 || Number(amount.max || 0) !== 0;
    return hasQuoteLine && !hasAmount;
  }

  function spectralCapacityText(capacity) {
    const format = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
    if (!Number.isFinite(Number(capacity.min)) || !Number.isFinite(Number(capacity.max)) || !capacity.ratePerHour) {
      return `${capacity.label || capacity.measurementDeviceId} - Quantité de spectres indicative : à valider avec le plateau.`;
    }
    const validation = capacity.requiresValidation ? " À valider avec le plateau." : "";
    return `${capacity.label || capacity.measurementDeviceId} - Quantité de spectres indicative : ${format.format(capacity.min)} à ${format.format(capacity.max)} spectres.${validation} Calcul : ${capacity.halfDays} × ${capacity.hoursPerHalfDay} h × ${capacity.ratePerHour.min} à ${capacity.ratePerHour.max} spectres/h.`;
  }

  function renderQuoteRequired(items) {
    return `
      <section class="quote-list warning-list">
        <h3>Éléments restant à chiffrer par le plateau</h3>
        <ul>${items.map((item) => `<li>${item.parentLabel ? `${escapeHtml(item.parentLabel)} : ` : ""}${escapeHtml(item.label)}</li>`).join("")}</ul>
      </section>
    `;
  }

  function renderList(title, items, className = "") {
    if (!items.length) return "";
    return `
      <section class="quote-list ${className}">
        <h3>${title}</h3>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    `;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  NIRSApp.statusLabel = statusLabel;
  NIRSApp.buildSummary = buildSummary;
  NIRSApp.buildQuoteExport = buildQuoteExport;
  NIRSApp.renderQuote = renderQuote;
})();


