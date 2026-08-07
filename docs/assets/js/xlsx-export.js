(function () {
  "use strict";

  const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};

  const SHEETS = [
    "MODE_EMPLOI",
    "SYNTHESE_DOSSIER",
    "PARAMETRES_DOSSIER",
    "LIGNES_PRESTATIONS",
    "CHIMIOMETRIE",
    "PARTENARIAT",
    "SUR_DEVIS_ET_QUESTIONS"
  ];

  function fileSafeStem(value) {
    return String(value || "PREDEVIS")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "PREDEVIS";
  }

  function referenceFor(state, config) {
    const document = NIRSApp.ensureQuoteReference?.(state, config, { documentCode: "PRD" })
      || NIRSApp.ensureQuoteDocument?.(state, config, { documentCode: "PRD" })
      || state.document
      || {};
    return document.reference || state.quoteId || "PREDEVIS";
  }

  function rangeValue(range, side) {
    const value = Number(range?.[side]);
    return Number.isFinite(value) ? value : null;
  }

  function moneyRangeText(range, currency = "EUR") {
    if (!range || !Number.isFinite(Number(range.min)) || !Number.isFinite(Number(range.max))) return "";
    if (NIRSApp.rangeMoney) return NIRSApp.rangeMoney(range, currency).replace(/\s*HT$/, "");
    return `${range.min} - ${range.max} ${currency}`;
  }

  function configuredItemById(quoteExport) {
    return new Map((quoteExport.configuredItems || []).map((item) => [item.id, item]));
  }

  function itemResultById(quoteExport) {
    return new Map((quoteExport.itemResults || []).map((item) => [item.itemId, item]));
  }

  function maintenanceAuditByItem(quoteExport) {
    const map = new Map();
    (quoteExport.platformPricingAudit?.maintenance || []).forEach((entry) => {
      const key = entry.parentItemId || entry.itemId || "";
      if (key) map.set(key, entry);
    });
    return map;
  }

  function lineStatus(line) {
    return line.pricingMode === "quote" ? "Sur devis" : "Estimatif";
  }

  function normalizeLine(line, index, quoteExport) {
    const configured = configuredItemById(quoteExport).get(line.parentItemId) || {};
    const itemResult = itemResultById(quoteExport).get(line.parentItemId) || {};
    const answers = configured.answers || {};
    const quantity = Number(line.quantity || 0);
    return {
      index: index + 1,
      id: line.id || "",
      parentItemId: line.parentItemId || "",
      parentLabel: line.parentLabel || "Global",
      label: line.label || "",
      description: [line.reason, itemResult.summary].filter(Boolean).join(" | "),
      quantity,
      unit: line.unit || "",
      technicalReferenceUnitPrice: rangeValue({ min: line.technicalReferenceUnitPrice }, "min"),
      technicalReferenceTotal: rangeValue({ min: line.technicalReferenceTotal }, "min"),
      discussionRangeRate: Number.isFinite(Number(line.discussionRangeRate)) ? Number(line.discussionRangeRate) : 0,
      technicalDiscussionUnitPriceMin: rangeValue({ min: line.technicalDiscussionUnitPriceMin }, "min"),
      technicalDiscussionUnitPriceMax: rangeValue({ max: line.technicalDiscussionUnitPriceMax }, "max"),
      technicalDiscussionTotalMin: rangeValue({ min: line.technicalDiscussionTotalMin }, "min"),
      technicalDiscussionTotalMax: rangeValue({ max: line.technicalDiscussionTotalMax }, "max"),
      costCategory: line.costCategory || "",
      partnershipTreatment: line.partnershipTreatment || "",
      contextCoefficientMin: rangeValue(line.contextCoefficient, "min"),
      contextCoefficientMax: rangeValue(line.contextCoefficient, "max"),
      billedUnitPriceMin: rangeValue({ min: line.billedUnitPriceMin }, "min"),
      billedUnitPriceMax: rangeValue({ max: line.billedUnitPriceMax }, "max"),
      billedTotalMin: rangeValue({ min: line.billedTotalMin }, "min"),
      billedTotalMax: rangeValue({ max: line.billedTotalMax }, "max"),
      pricingMode: line.pricingMode || "",
      status: lineStatus(line),
      reason: line.reason || "",
      assumptions: (line.assumptions || []).join(" | "),
      warnings: (line.warnings || []).join(" | "),
      comment: answers.maintenanceComment || answers.comment || answers.description || "",
      serviceMode: answers.serviceMode || line.costBasis?.serviceMode || "",
      machineHalfDayCost: rangeValue({ min: line.costBasis?.machineHalfDayCost ?? line.costDetail?.machineHalfDayCost }, "min"),
      routineConsumablesPerHalfDay: rangeValue({ min: line.costBasis?.routineConsumablesPerHalfDay ?? line.costDetail?.routineConsumablesPerHalfDay }, "min"),
      autonomousTechnicalSupportRate: rangeValue({ min: line.costBasis?.autonomousTechnicalSupportRate ?? line.costDetail?.autonomousTechnicalSupportRate }, "min"),
      autonomousTechnicalSupportAmount: rangeValue({ min: line.costBasis?.autonomousTechnicalSupportAmount ?? line.costDetail?.autonomousTechnicalSupportAmount }, "min"),
      staffHours: rangeValue({ min: line.costBasis?.staffHours ?? line.costDetail?.staffHours }, "min"),
      staffHourlyRate: rangeValue({ min: line.costBasis?.staffHourlyRate ?? line.costDetail?.staffHourlyRate }, "min"),
      staffCost: rangeValue({ min: line.costBasis?.staffCost ?? line.costDetail?.staffCost }, "min"),
      transportOccurrences: line.transportOccurrences || "",
      transportUnitPrice: line.transportUnitPrice || ""
    };
  }

  function dossierRows(state, quoteResult, quoteExport) {
    const requester = quoteExport.requester || {};
    const project = quoteExport.project || {};
    const context = quoteExport.context || {};
    const audit = quoteExport.platformPricingAudit || {};
    return [
      ["Reference pre-devis", quoteExport.document?.reference || ""],
      ["Type document", "Pre-devis client avec fiche plateau interne"],
      ["Demandeur", [requester.firstName, requester.lastName].filter(Boolean).join(" ")],
      ["Courriel", requester.email || ""],
      ["Structure", [requester.organization, requester.unit].filter(Boolean).join(" - ")],
      ["Unite laboratoire", requester.unit || ""],
      ["Code unite laboratoire", requester.unitCode || ""],
      ["Intitule demande", project.title || ""],
      ["Reference interne", project.reference || ""],
      ["Periode debut", project.plannedStartDate || ""],
      ["Periode fin", project.plannedEndDate || ""],
      ["Contexte", context.label || "Contexte a choisir"],
      ["Coefficient interne min", audit.contextCoefficient?.min ?? ""],
      ["Coefficient interne max", audit.contextCoefficient?.max ?? ""],
      ["Urgence", state.urgent ? "Oui" : "Non"],
      ["Statut estimation", quoteResult.status || ""],
      ["Valeur technique de reference", rangeValue(audit.technicalReferenceAmount, "min")],
      ["Fourchette technique apres discussion", moneyRangeText(audit.technicalDiscussionRange, quoteResult.currency)],
      ["Forfait de gestion", moneyRangeText(audit.administrativeFee, quoteResult.currency)],
      ["Minimum de facturation", moneyRangeText(audit.billingMinimumAdjustment, quoteResult.currency)],
      ["Montant facturable indicatif", moneyRangeText(audit.billedEstimate || quoteResult.billedEstimate, quoteResult.currency)]
    ];
  }

  function parameterRows(config, quoteExport) {
    const tarifs = config.tarifs || {};
    const rows = [
      ["metadata.version", tarifs.metadata?.version || ""],
      ["metadata.currency", tarifs.metadata?.currency || ""],
      ["metadata.taxMode", tarifs.metadata?.taxMode || ""],
      ["preQuoteUncertainty.rate", tarifs.preQuoteUncertainty?.rate ?? ""],
      ["preQuoteUncertainty.excludedConfigRules", (tarifs.preQuoteUncertainty?.excludedConfigRules || []).join(", ")]
    ];
    Object.entries(tarifs.contexts || {}).forEach(([id, context]) => {
      rows.push([`context.${id}.label`, context.label || ""]);
      rows.push([`context.${id}.mode`, context.mode || ""]);
      if (context.costCoefficient) rows.push([`context.${id}.costCoefficient`, `${context.costCoefficient.min} - ${context.costCoefficient.max}`]);
      if (context.billedShare) rows.push([`context.${id}.billedShare`, `${context.billedShare.min} - ${context.billedShare.max}`]);
    });
    const audit = quoteExport.platformPricingAudit || {};
    rows.push(["audit.contextId", audit.contextId || ""]);
    rows.push(["audit.contextMode", audit.contextMode || ""]);
    return rows;
  }

  function chemometricsRows(quoteExport) {
    const maintenanceAudit = maintenanceAuditByItem(quoteExport);
    return (quoteExport.configuredItems || [])
      .filter((item) => ["validated_calibration", "existing_model_predictions", "model_maintenance", "other_chemometrics"].includes(item.requestType))
      .map((item) => {
        const answers = item.answers || {};
        const result = itemResultById(quoteExport).get(item.id) || {};
        const audit = maintenanceAudit.get(item.id) || {};
        const discussionRange = audit.technicalDiscussionRange
          ? moneyRangeText(audit.technicalDiscussionRange, quoteExport.currency)
          : "";
        const billedRange = audit.billedRange
          ? moneyRangeText(audit.billedRange, quoteExport.currency)
          : "";
        return [
          item.id || "",
          item.requestType || "",
          result.label || "",
          result.summary || "",
          answers.samples || answers.spectra || answers.newSpectra || answers.referenceSampleCount || "",
          answers.replicates || answers.models || answers.properties || answers.propertiesCount || "",
          answers.maintenanceType || "",
          answers.comment || answers.description || "",
          Array.isArray(audit.discussionChecklist) ? audit.discussionChecklist.join(" | ") : "",
          discussionRange,
          billedRange,
          audit.partnershipTreatment || "",
          audit.pricingConfidence || "",
          audit.requiresPlateauReview ? "Oui" : ""
        ];
      });
  }

  function partnershipRows(quoteExport, currency) {
    const breakdown = quoteExport.platformPricingAudit?.partnershipBreakdown || quoteExport.partnershipBreakdown || null;
    if (!breakdown) return [["Information", "Aucun contexte partenariat selectionne"]];
    return [
      ["Valeur technique", moneyRangeText(breakdown.technicalValue, currency)],
      ["Apports Bioch&SPIR identifies", moneyRangeText(breakdown.offeredBase, currency)],
      ["Base technique restante a repartir", moneyRangeText(breakdown.negotiableBase, currency)],
      ["Contribution complementaire possible", moneyRangeText(breakdown.negotiatedReduction, currency)],
      ["Part facturee indicative", moneyRangeText(breakdown.billedEstimate, currency)],
      ["Forfait de gestion", moneyRangeText(breakdown.administrativeFee, currency)],
      ["Part facturee totale", moneyRangeText(quoteExport.platformPricingAudit?.billedEstimate, currency)]
    ];
  }

  function quoteRows(quoteExport) {
    const questions = (quoteExport.platformPricingAudit?.quoteRequiredItems || [])
      .map((item) => [item.parentLabel || "", item.label || "", item.reason || ""]);
    const warnings = (quoteExport.warnings || []).map((warning) => ["Avertissement", "", warning]);
    return [...questions, ...warnings];
  }

  function buildPlatformWorkbookModel(config, state, quoteResult, quoteExport = null) {
    const exportData = quoteExport || NIRSApp.buildQuoteExport?.(state, quoteResult) || {};
    const reference = referenceFor(state, config);
    exportData.document = exportData.document || {};
    exportData.document.reference = exportData.document.reference || reference;
    const lines = (quoteResult.items || []).map((line, index) => normalizeLine(line, index, exportData));
    return {
      schemaVersion: "platform_workbook.1",
      reference,
      filenames: {
        xlsx: `FT_${fileSafeStem(reference)}_PLATEAU.xlsx`,
        csv: `FT_${fileSafeStem(reference)}_LIGNES.csv`
      },
      sheets: SHEETS,
      summaryRows: dossierRows(state, quoteResult, exportData),
      parameterRows: parameterRows(config, exportData),
      lines,
      chemometricsRows: chemometricsRows(exportData),
      partnershipRows: partnershipRows(exportData, quoteResult.currency),
      quoteRows: quoteRows(exportData),
      quoteExport: exportData
    };
  }

  function addRowsSheet(workbook, name, rows, headers = null) {
    const sheet = workbook.addWorksheet(name);
    if (headers) sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    sheet.views = [{ state: "frozen", ySplit: headers ? 1 : 0 }];
    if (headers) {
      sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + headers.length)}1` };
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF006D77" } };
    }
    sheet.columns.forEach((column) => {
      column.width = Math.min(60, Math.max(12, ...column.values.map((value) => String(value || "").length + 2)));
      column.alignment = { vertical: "top", wrapText: true };
    });
    return sheet;
  }

  function addLinesSheet(workbook, model) {
    const headers = [
      "N", "Parent", "Ligne", "Description", "Categorie cout", "Traitement partenariat",
      "Quantite", "Unite", "Prix ref unitaire", "Total ref", "Prix unitaire modifie",
      "Taux discussion", "Taux discussion modifie", "Total technique retenu min",
      "Total technique retenu max", "Coef contexte", "Coef contexte modifie",
      "Part partenariat modifiee", "Total facture min", "Total facture max",
      "Mode tarif", "Statut", "Mode utilisation", "Base machine demi-journee",
      "Consommables demi-journee", "Taux assistance autonome", "Assistance autonome demi-journee",
      "Heures personnel", "Taux horaire", "Cout personnel demi-journee",
      "Nombre transports", "Cout transport unitaire", "Commentaires plateau"
    ];
    const rows = model.lines.map((line) => [
      line.index,
      line.parentLabel,
      line.label,
      line.description,
      line.costCategory,
      line.partnershipTreatment,
      line.quantity,
      line.unit,
      line.technicalReferenceUnitPrice,
      line.technicalReferenceTotal,
      "",
      line.discussionRangeRate,
      "",
      line.technicalDiscussionTotalMin,
      line.technicalDiscussionTotalMax,
      line.contextCoefficientMin,
      "",
      "",
      line.billedTotalMin,
      line.billedTotalMax,
      line.pricingMode,
      line.status,
      line.serviceMode,
      line.machineHalfDayCost,
      line.routineConsumablesPerHalfDay,
      line.autonomousTechnicalSupportRate,
      line.autonomousTechnicalSupportAmount,
      line.staffHours,
      line.staffHourlyRate,
      line.staffCost,
      line.transportOccurrences,
      line.transportUnitPrice,
      line.comment
    ]);
    const sheet = addRowsSheet(workbook, "LIGNES_PRESTATIONS", rows, headers);
    ["I", "J", "K", "N", "O", "S", "T"].forEach((col) => sheet.getColumn(col).numFmt = '#,##0 "€"');
    ["L", "M", "P", "Q", "R"].forEach((col) => sheet.getColumn(col).numFmt = "0.00%");
    ["K", "M", "Q", "R", "W"].forEach((col) => {
      sheet.getColumn(col).eachCell({ includeEmpty: true }, (cell, rowNumber) => {
        if (rowNumber > 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      });
    });
    sheet.getColumn("V").eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber > 1) {
        cell.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: ['"Estimatif,Sur devis,A discuter,Valide plateau"']
        };
      }
    });
    return sheet;
  }

  async function buildPlatformWorkbook(workbookModel) {
    if (!globalThis.ExcelJS && typeof document !== "undefined") {
      await NIRSApp.loadScriptOnce?.("./vendor/exceljs.min.js", "ExcelJS");
    }
    if (!globalThis.ExcelJS) throw new Error("ExcelJS local n'est pas charge.");
    const workbook = new globalThis.ExcelJS.Workbook();
    workbook.creator = "Bioch&SPIR pre-devis";
    workbook.created = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;
    addRowsSheet(workbook, "MODE_EMPLOI", [
      ["Objectif", "Fiche interne plateau pour revue technique et administrative."],
      ["Important", "Le PDF client reste le document de pre-devis. Ce classeur n'engage pas le plateau sans validation."],
      ["Cellules jaunes", "Cellules modifiables pour ajustement plateau."],
      ["Sur devis", "Les lignes sur devis sont descriptives et ne valent pas zero euro."]
    ]);
    addRowsSheet(workbook, "SYNTHESE_DOSSIER", workbookModel.summaryRows, ["Champ", "Valeur"]);
    addRowsSheet(workbook, "PARAMETRES_DOSSIER", workbookModel.parameterRows, ["Parametre", "Valeur"]);
    addLinesSheet(workbook, workbookModel);
    addRowsSheet(workbook, "CHIMIOMETRIE", workbookModel.chemometricsRows, [
      "Item", "Type", "Libelle", "Resume", "Volume", "Traits/modeles", "Scenario", "Commentaire",
      "Checklist entretien", "Fourchette technique initiale", "Fourchette apres contexte",
      "Traitement partenariat", "Confiance", "Revue plateau"
    ]);
    addRowsSheet(workbook, "PARTENARIAT", workbookModel.partnershipRows, ["Champ", "Valeur"]);
    addRowsSheet(workbook, "SUR_DEVIS_ET_QUESTIONS", workbookModel.quoteRows, ["Prestation", "Ligne", "Question ou avertissement"]);
    return workbook;
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return "";
    const text = String(value).replace(/\r?\n/g, " ");
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function buildPlatformCsv(workbookModel) {
    const headers = Object.keys(workbookModel.lines[0] || {
      index: "", parentLabel: "", label: "", quantity: "", unit: "", status: ""
    });
    const lines = [
      headers.join(";"),
      ...workbookModel.lines.map((line) => headers.map((key) => csvEscape(line[key])).join(";"))
    ];
    return `\uFEFF${lines.join("\r\n")}`;
  }

  function downloadBlob(filename, blob) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  async function downloadPlatformWorkbook(state, quoteResult, config) {
    const quoteExport = NIRSApp.buildQuoteExport?.(state, quoteResult);
    const model = buildPlatformWorkbookModel(config, state, quoteResult, quoteExport);
    const workbook = await buildPlatformWorkbook(model, config);
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(model.filenames.xlsx, new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }));
  }

  function downloadPlatformCsv(state, quoteResult, config) {
    const quoteExport = NIRSApp.buildQuoteExport?.(state, quoteResult);
    const model = buildPlatformWorkbookModel(config, state, quoteResult, quoteExport);
    downloadBlob(model.filenames.csv, new Blob([buildPlatformCsv(model)], {
      type: "text/csv;charset=utf-8"
    }));
  }

  NIRSApp.buildPlatformWorkbookModel = buildPlatformWorkbookModel;
  NIRSApp.buildPlatformWorkbook = buildPlatformWorkbook;
  NIRSApp.downloadPlatformWorkbook = downloadPlatformWorkbook;
  NIRSApp.buildPlatformCsv = buildPlatformCsv;
  NIRSApp.downloadPlatformCsv = downloadPlatformCsv;
})();
