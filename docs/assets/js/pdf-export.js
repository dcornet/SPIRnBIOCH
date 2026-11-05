(function () {
  "use strict";

  const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};
  const A4 = {
    width: 210,
    height: 297,
    margin: 12,
    headerFirst: 42,
    headerCompact: 22,
    contentBottom: 264,
    footerLine: 268,
    footerText: 272,
    bannerY: 278,
    bannerHeight: 13
  };
  const BLUE = "#0b5d8b";
  const TEXT = "#17324d";
  const MUTED = "#536576";
  const BORDER = "#c9d7e2";
  const PALE = "#edf7fc";
  const LIGHT = "#f7fbfd";
  const SERVICE_TABLE = {
    width: 186,
    descriptionX: A4.margin + 2,
    descriptionWidth: 142,
    totalX: A4.margin + 148,
    totalWidth: 38
  };

  function getPdfClass() {
    return globalThis.jspdf?.jsPDF || globalThis.jsPDF;
  }

  function pdfText(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/œ/g, "oe")
      .replace(/Œ/g, "OE");
  }

  function pdfMoney(value, currency = "EUR") {
    if (!Number.isFinite(value)) return "Sur devis";
    return pdfText(new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(value));
  }

  function pdfRangeMoney(range, currency = "EUR") {
    if (Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.min === range.max) {
      return pdfMoney(range.min, currency);
    }
    return `${pdfMoney(range?.min, currency)} à ${pdfMoney(range?.max, currency)}`;
  }

  function addPdfRange(a = {}, b = {}) {
    return {
      min: Number(a.min || 0) + Number(b.min || 0),
      max: Number(a.max || 0) + Number(b.max || 0)
    };
  }

  function dateFromLocalValue(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const local = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (local) {
      const date = new Date(Number(local[1]), Number(local[2]) - 1, Number(local[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateLong(value) {
    const date = dateFromLocalValue(value || Date.now());
    if (!date) return "Date à compléter";
    return pdfText(new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(date));
  }

  function formatPeriod(start, end) {
    const startText = start ? formatDateLong(start) : "";
    const endText = end ? formatDateLong(end) : "";
    if (startText && endText) return `du ${startText} au ${endText}`;
    if (startText) return `à partir du ${startText}`;
    if (endText) return `jusqu'au ${endText}`;
    return "";
  }

  function numberRangeText(min, max, unit) {
    const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
    if (Number.isFinite(min) && Number.isFinite(max) && min === max) return `${formatter.format(min)} ${unit}`;
    if (Number.isFinite(min) && Number.isFinite(max)) return `${formatter.format(min)} à ${formatter.format(max)} ${unit}`;
    return "";
  }

  function drawText(pdf, text, x, y, width, options = {}) {
    const size = options.size || 9;
    const lineHeight = options.lineHeight || 1.2;
    pdf.setFont("helvetica", options.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(options.color || TEXT);
    const lines = pdf.splitTextToSize(pdfText(text), width);
    const anchorX = options.align === "right" ? x + width : x;
    pdf.text(lines, anchorX, y, { lineHeightFactor: lineHeight, align: options.align || "left" });
    return lines.length * size * 0.3528 * lineHeight;
  }

  function splitLines(pdf, text, width, { size = 9, bold = false } = {}) {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    return pdf.splitTextToSize(pdfText(text), width);
  }

  function textHeight(lines, size, lineHeight = 1.2) {
    return Math.max(1, lines.length) * size * 0.3528 * lineHeight;
  }

  function extractLinkParts(word) {
    const match = String(word || "").match(/^(.*?)(https?:\/\/[^\s),;]+)([),;.]*)$/);
    if (!match) return [{ text: word, url: "" }];
    return [
      match[1] ? { text: match[1], url: "" } : null,
      { text: match[2], url: match[2] },
      match[3] ? { text: match[3], url: "" } : null
    ].filter(Boolean);
  }

  function drawLinkedToken(pdf, token, x, y, options) {
    let cursor = x;
    extractLinkParts(token).forEach((part) => {
      const text = pdfText(part.text);
      if (!text) return;
      const width = pdf.getTextWidth(text);
      if (part.url) {
        pdf.setTextColor(BLUE);
        if (typeof pdf.textWithLink === "function") pdf.textWithLink(text, cursor, y, { url: part.url });
        else pdf.text(text, cursor, y);
        pdf.setDrawColor(BLUE);
        pdf.line(cursor, y + 0.7, cursor + width, y + 0.7);
        pdf.setTextColor(options.color || TEXT);
      } else {
        pdf.text(text, cursor, y);
      }
      cursor += width;
    });
    return cursor;
  }

  function drawLinkedParagraph(pdf, text, x, y, width, options, vm, pageRef) {
    const size = options.size || 8;
    const lineHeight = options.lineHeight || 1.22;
    const lineStep = size * 0.3528 * lineHeight;
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    let cursor = x;
    pdf.setFont("helvetica", options.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(options.color || TEXT);
    words.forEach((word, index) => {
      const token = word;
      const tokenWidth = pdf.getTextWidth(pdfText(token));
      const spaceWidth = index < words.length - 1 ? pdf.getTextWidth(" ") : 0;
      if (cursor > x && cursor + tokenWidth + spaceWidth > x + width) {
        y += lineStep;
        y = ensurePage(pdf, y, lineStep, vm, pageRef);
        cursor = x;
        pdf.setFont("helvetica", options.bold ? "bold" : "normal");
        pdf.setFontSize(size);
        pdf.setTextColor(options.color || TEXT);
      }
      cursor = drawLinkedToken(pdf, token, cursor, y, options);
      if (index < words.length - 1) cursor = drawLinkedToken(pdf, " ", cursor, y, options);
    });
    return y + lineStep;
  }

  function drawPanel(pdf, x, y, width, height, fill = "#ffffff", stroke = BORDER) {
    pdf.setFillColor(fill);
    pdf.setDrawColor(stroke);
    pdf.roundedRect(x, y, width, height, 1.5, 1.5, "FD");
  }

  function drawImageContained(pdf, source, box, alias, opacity = 1) {
    if (!source || !source.startsWith("data:image/")) return;
    try {
      const props = pdf.getImageProperties(source);
      const ratio = props.width / props.height || 1;
      let width = box.width;
      let height = width / ratio;
      if (height > box.height) {
        height = box.height;
        width = height * ratio;
      }
      const x = box.x + (box.width - width) / 2;
      const y = box.y + (box.height - height) / 2;
      const type = source.includes("image/png") ? "PNG" : source.includes("image/webp") ? "WEBP" : "JPEG";
      if (opacity < 1 && pdf.setGState && globalThis.jspdf?.GState) {
        pdf.setGState(new globalThis.jspdf.GState({ opacity }));
      }
      pdf.addImage(source, type, x, y, width, height, alias, "FAST");
      if (opacity < 1 && pdf.setGState && globalThis.jspdf?.GState) {
        pdf.setGState(new globalThis.jspdf.GState({ opacity: 1 }));
      }
    } catch (error) {
      console.warn("Image non inseree dans le PDF.", error);
    }
  }

  function logoBioch(config) {
    return (config.assets?.logos || []).find((logo) => /bioch/i.test(`${logo.label || ""} ${logo.filename || ""}`));
  }

  function valueRows(rows) {
    return rows.filter(([, value]) => String(value || "").trim());
  }

  function providerRows(provider) {
    const contact = provider?.administrativeContact || {};
    const referent = provider?.platformReferent || {};
    return valueRows([
      ["Nom", provider?.name],
      ["Organisme", provider?.organization],
      ["Adresse", [provider?.addressLine1, provider?.addressLine2, [provider?.postalCode, provider?.city].filter(Boolean).join(" "), provider?.country].filter(Boolean).join(" - ")],
      ["SIRET", provider?.siret],
      ["TVA", provider?.vatNumber],
      ["Contact administratif", [contact.name, contact.email, contact.phone].filter(Boolean).join(" - ")],
      ["Référent plateau", referent.name]
    ]);
  }

  function requesterRows(state, result) {
    const requester = state.requester || {};
    const project = state.project || {};
    return valueRows([
      ["Nom", [requester.firstName, requester.lastName].filter(Boolean).join(" ")],
      ["E-mail", requester.email],
      ["Téléphone", project.phone],
      ["Organisme", requester.organization],
      ["Unité", requester.unit],
      ["Demande", project.title],
      ["Période", formatPeriod(project.plannedStartDate, project.plannedEndDate)]
    ]);
  }

  function contextDescription(state, result) {
    const project = state.project || {};
    const context = result.context?.label || state.context || "Contexte à choisir";
    return context;
  }

  function contextRows(state, result) {
    const project = state.project || {};
    const rows = [["Contexte", result.context?.label || "Contexte à choisir"]];
    if (result.context?.mode === "negotiated_partnership") {
      if (project.partnershipProjectName) rows.push(["Projet", project.partnershipProjectName]);
      if (project.partnershipProjectReference) rows.push(["Référence projet", project.partnershipProjectReference]);
      if (project.mainPartner) rows.push(["Partenaire principal", project.mainPartner]);
    }
    return valueRows(rows);
  }

  function isBusinessLine(line) {
    return line && line.configRule !== "externalAdministrativeFee" && line.configRule !== "billingMinimumAdjustment" && line.configRule !== "urgentMarkup" && !String(line.id || "").startsWith("global_urgent");
  }

  function quoteRequiredBusinessLines(quoteResult) {
    return (quoteResult.items || []).filter((line) => isBusinessLine(line) && line.pricingMode === "quote");
  }

  function estimatedBusinessItemCount(quoteResult) {
    return (quoteResult.itemResults || []).filter((item) => item.requestType !== "initial_training" && item.status !== "incomplete" && item.status !== "quote_required").length;
  }

  function totalTitlePdf(vm) {
    if (vm.totals.contextId === "partnership" && vm.status !== "quote_required") return "PART FACTURÉE INDICATIVE HT";
    if (vm.status === "quote_required") return "MONTANT À DÉFINIR AVEC LE PLATEAU";
    return vm.status === "partial" ? "TOTAL ESTIMATIF PARTIEL HT" : "TOTAL ESTIMATIF HT";
  }

  function totalAmountTextPdf(vm) {
    if (vm.status === "quote_required") return "Sur devis";
    return pdfRangeMoney(vm.totals.billedEstimate, vm.totals.currency);
  }

  function totalText(line, currency) {
    if (line.billingRangeReview?.required) return "À confirmer";
    if (line.pricingMode === "quote") return "Sur devis";
    if (line.offeredByPlatform) return "Offert";
    return pdfRangeMoney({
      min: Number.isFinite(line.displayTotalMin) ? line.displayTotalMin : line.totalMin,
      max: Number.isFinite(line.displayTotalMax) ? line.displayTotalMax : line.totalMax
    }, currency);
  }

  function serviceDescription(line) {
    if (line.configRule === "externalAdministrativeFee") return "Forfait de gestion du dossier";
    const label = line.parentLabel && line.parentLabel !== "Global" ? `${line.parentLabel} - ${line.label}` : line.label;
    return [label, line.trainingDetails, line.configRule === "predictionReferenceAnalyses" ? line.reason : ""].filter(Boolean).join(" - ");
  }

  function lineTotalRange(line) {
    return {
      min: Number.isFinite(line.displayTotalMin) ? line.displayTotalMin : line.totalMin,
      max: Number.isFinite(line.displayTotalMax) ? line.displayTotalMax : line.totalMax
    };
  }

  function groupedServiceItems(quoteResult) {
    const ordered = orderedResultItems(quoteResult);
    const training = ordered.filter((line) => line.configRule === "instrumentTraining" && line.pricingMode !== "quote");
    if (!training.length) return ordered;
    const others = ordered.filter((line) => line.configRule !== "instrumentTraining");
    const firstTrainingIndex = ordered.findIndex((line) => line.configRule === "instrumentTraining");
    const totalMin = training.reduce((sum, line) => sum + lineTotalRange(line).min, 0);
    const totalMax = training.reduce((sum, line) => sum + lineTotalRange(line).max, 0);
    const group = {
      id: "grouped_instrument_training",
      label: "Formations aux instruments",
      parentLabel: "Utilisateurs et formations",
      trainingDetails: training.map((line) => line.trainingDescription || line.label).join(" ; "),
      totalMin,
      totalMax,
      pricingMode: "range",
      configRule: "instrumentTraining",
      offeredByPlatform: training.every((line) => line.offeredByPlatform),
      contextNote: training.find((line) => line.contextNote)?.contextNote || ""
    };
    others.splice(Math.max(0, firstTrainingIndex), 0, group);
    return others;
  }

  function instrumentLabel(config, id) {
    return config.tarifs?.instruments?.[id]?.label || id || "";
  }

  function serviceModeLabel(item) {
    const text = item.summary || "";
    if (/Réalisation des mesures par le plateau/i.test(text)) return "réalisation par le plateau";
    if (/Utilisation autonome avec assistance technique/i.test(text)) return "utilisation autonome avec assistance technique du plateau";
    if (/Utilisation accompagnée/i.test(text)) return "réalisation par le plateau";
    if (/autonome/i.test(text)) return "utilisation autonome avec assistance technique du plateau";
    return "";
  }

  function pdfServiceSummary(config, item) {
    if (item.requestType === "spectra_acquisition") {
      const capacity = item.estimatedSpectralCapacity || {};
      const instrument = instrumentLabel(config, capacity.instrumentId);
      const device = capacity.label || "";
      const hasCapacity = Number.isFinite(Number(capacity.min)) && Number.isFinite(Number(capacity.max));
      const spectra = hasCapacity
        ? `${numberRangeText(capacity.min, capacity.max, "spectres indicatifs")}${capacity.requiresValidation ? " - à valider avec le plateau" : ""}`
        : capacity.requiresValidation
        ? "quantité de spectres indicative à valider avec le plateau"
        : numberRangeText(capacity.min, capacity.max, "spectres indicatifs");
      const mode = serviceModeLabel(item);
      const answers = item.answers || {};
      return [
        "Prendre des spectres",
        instrument ? `spectromètre ${instrument}` : "",
        device ? `sonde/dispositif ${device}` : "",
        answers.samples ? `${answers.samples} échantillon(s) estimé(s)` : "",
        answers.replicates ? `${answers.replicates} répétition(s) spectrale(s) par échantillon` : "",
        spectra,
        mode
      ].filter(Boolean).join(" - ");
    }
    if (item.requestType === "validated_calibration") {
      const answers = item.answers || {};
      const properties = Number(answers.properties || 1);
      const samples = Number(answers.samples);
      const replicates = Number(answers.replicates || 1);
      const spectra = Number.isFinite(samples) && Number.isFinite(replicates) ? samples * replicates : Number.NaN;
      const sampleText = Number.isFinite(samples)
        ? `${new Intl.NumberFormat("fr-FR").format(samples)} échantillons indépendants`
        : "";
      const spectraText = Number.isFinite(spectra) && replicates > 1
        ? `${sampleText} × ${new Intl.NumberFormat("fr-FR").format(replicates)} répétitions = ${new Intl.NumberFormat("fr-FR").format(spectra)} spectres`
        : sampleText;
      return [
        "Calibrer",
        `${properties} ${properties > 1 ? "propriétés" : "propriété"}`,
        spectraText
      ].filter(Boolean).join(" - ");
    }
    if (item.requestType === "model_maintenance") {
      return pdfMaintenanceSummary(config, item);
    }
    return [item.label, item.summary].filter(Boolean).join(" - ");
  }

  function pdfMaintenanceSummary(config, item) {
    const answers = item.answers || {};
    const maintenanceType = migrateMaintenanceTypeForPdf(answers.maintenanceType);
    const label = config.prestations.requestTypes.model_maintenance.label;
    const intervention = optionLabel(config, "model_maintenance", "maintenanceType", maintenanceType) || label;
    const comment = String(answers.maintenanceComment || answers.comment || "").trim();
    return [
      `${label} - ${intervention}`,
      comment || "Informations complémentaires à préciser avec le plateau",
      "Tarifs indicatifs à confirmer avec le plateau."
    ].filter(Boolean).join(" - ");
  }

  function optionLabel(config, requestType, fieldId, value) {
    const field = config.prestations?.requestTypes?.[requestType]?.fields?.find((entry) => entry.id === fieldId);
    return field?.options?.find((entry) => entry.value === value)?.label || value || "";
  }

  function migrateMaintenanceTypeForPdf(type) {
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

  function orderedResultItems(quoteResult) {
    return [...(quoteResult.items || [])].sort((a, b) => {
      const aAdmin = a.configRule === "externalAdministrativeFee";
      const bAdmin = b.configRule === "externalAdministrativeFee";
      if (aAdmin === bAdmin) return 0;
      return aAdmin ? -1 : 1;
    });
  }

  function pdfUserSummaries(config, state, quoteResult) {
    const instruments = NIRSApp.collectSelectedSpectraInstruments
      ? NIRSApp.collectSelectedSpectraInstruments(state, config)
      : [];
    const requirements = quoteResult.trainingRequirements || [];
    const people = Array.isArray(state.people) ? state.people.filter((person) => !person.deleted) : [];
    const rows = [];
    people.forEach((person) => {
      const name = [person.firstName, person.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || "Personne à compléter";
      instruments.forEach((instrument) => {
        const assignment = person.instrumentAssignments?.[instrument.id];
        if (!assignment?.assigned) return;
        const requirement = requirements.find((entry) => entry.personId === person.id && entry.instrumentId === instrument.id);
        const status = assignment.trainingStatus === "trained" ? "formation déjà effectuée" : "formation non effectuée";
        const date = assignment.trainingDate ? ` (${formatDateLong(assignment.trainingDate)})` : "";
        const requirementText = requirement
          ? `${requirement.requirementType === "refresher" ? "remise à niveau" : "formation initiale"} ${requirement.mandatory ? "obligatoire" : "demandée"}`
          : "aucune formation ajoutée au pré-devis";
        rows.push(`${name} - ${instrument.shortLabel || instrument.label} : ${status}${date} ; ${requirementText}.`);
      });
    });
    return rows;
  }

  function buildPdfViewModel(config, state, quoteResult, options = {}) {
    const document = NIRSApp.ensureQuoteDocument(state, config, options.documentOptions || {});
    const provider = config.textes?.provider || {};
    const terms = config.textes?.pdf || {};
    const generatedAt = document.generatedAt || new Date().toISOString();
    const displayedTechnicalValue = quoteResult.context?.mode === "negotiated_partnership" && quoteResult.partnershipBreakdown?.technicalValue
      ? quoteResult.partnershipBreakdown.technicalValue
      : quoteResult.technicalValue;
    const quoteRequiredItems = quoteRequiredBusinessLines(quoteResult);
    const serviceLines = groupedServiceItems(quoteResult).map((line) => ({
      description: [serviceDescription(line), line.contextNote].filter(Boolean).join(" - "),
      total: totalText(line, quoteResult.currency),
      configRule: line.configRule || "",
      pricingMode: line.pricingMode
    }));
    const incompleteLines = (quoteResult.itemResults || [])
      .filter((item) => item.status === "incomplete")
      .map((item) => ({
        description: `${item.label}\nÀ discuter avec le plateau avant chiffrage.${item.warnings?.length ? `\n${item.warnings.join(" ")}` : ""}`,
        total: "À discuter",
        configRule: "",
        pricingMode: "quote"
      }));
    return {
      reference: document.reference,
      fileName: document.fileName,
      generatedAt,
      generatedAtLabel: formatDateLong(generatedAt),
      validUntil: document.validUntil,
      validUntilLabel: formatDateLong(document.validUntil),
      requesterRows: requesterRows(state, quoteResult),
      contextRows: contextRows(state, quoteResult),
      providerRows: providerRows(provider),
      provider,
      project: state.project || {},
      contextLabel: contextDescription(state, quoteResult),
      status: quoteResult.status,
      quoteRequiredItemCount: quoteRequiredItems.length,
      estimatedBusinessItemCount: estimatedBusinessItemCount(quoteResult),
      serviceSummaries: (quoteResult.itemResults || []).map((item) => pdfServiceSummary(config, {
        ...item,
        answers: item.answers || (state.items || []).find((entry) => entry.id === item.itemId)?.answers || {}
      })),
      userSummaries: pdfUserSummaries(config, state, quoteResult),
      services: [...serviceLines, ...incompleteLines],
      hasCalibration: (quoteResult.itemResults || []).some((item) => item.requestType === "validated_calibration"),
      calibrationNote: terms.calibrationNote || null,
      totals: {
        technicalValue: displayedTechnicalValue,
        billedEstimate: quoteResult.billedEstimate,
        inKindContribution: quoteResult.inKindContribution,
        contextMarkup: quoteResult.contextMarkup,
        currency: quoteResult.currency,
        taxMode: quoteResult.taxMode,
        contextId: quoteResult.context?.id || ""
      },
      partnershipBreakdown: quoteResult.partnershipBreakdown || null,
      billingRangeReview: quoteResult.billingRangeReview || null,
      administrativeFee: (quoteResult.items || []).find((line) => line.configRule === "externalAdministrativeFee") || null,
      terms,
      predictionClauses: [...new Set((quoteResult.itemResults || [])
        .filter((item) => item.requestType === "existing_model_predictions" && item.status !== "incomplete")
        .flatMap((item) => NIRSApp.predictionNotes(config, item.answers)))],
      acquisitionClauses: (quoteResult.itemResults || []).some((item) => item.requestType === "spectra_acquisition")
        ? [config.textes.acquisition.capacityHelp, config.textes.acquisition.reservationReview] : [],
      footerBanner: options.footerBanner || config.assets?.images?.footerBanner || "",
      logo: logoBioch(config)
    };
  }

  function addHeader(pdf, vm, page) {
    const compact = page > 1;
    pdf.setFillColor(LIGHT);
    pdf.rect(0, 0, A4.width, compact ? A4.headerCompact : A4.headerFirst, "F");
    if (compact) {
      drawText(pdf, `PRÉ-DEVIS - ${vm.reference}`, A4.margin, 14, 130, { size: 11, bold: true, color: BLUE });
      drawImageContained(pdf, vm.logo?.pdfDataUrl || vm.logo?.dataUrl, { x: A4.width - A4.margin - 30, y: 5, width: 30, height: 12 }, `bioch-logo-${page}`);
    } else {
      drawText(pdf, "PRÉ-DEVIS", A4.margin, 15, 90, { size: 19, bold: true, color: BLUE });
      drawText(pdf, vm.reference, A4.margin, 26, 112, { size: 9, color: TEXT });
      drawText(pdf, `Date : ${vm.generatedAtLabel}`, A4.margin, 32, 100, { size: 8.5, color: MUTED });
      drawImageContained(pdf, vm.logo?.pdfDataUrl || vm.logo?.dataUrl, { x: A4.width - A4.margin - 45, y: 8, width: 45, height: 22 }, `bioch-logo-${page}`);
    }
  }

  function addFooter(pdf, vm, page, pageCount) {
    pdf.setDrawColor(BORDER);
    pdf.line(A4.margin, A4.footerLine, A4.width - A4.margin, A4.footerLine);
    drawText(pdf, vm.reference, A4.margin, A4.footerText, 112, { size: 7.5, color: MUTED });
    drawText(pdf, `Page ${page} / ${pageCount}`, A4.width - A4.margin - 42, A4.footerText, 42, { size: 7.5, color: MUTED, align: "right" });
    drawImageContained(pdf, vm.footerBanner, { x: A4.margin, y: A4.bannerY, width: A4.width - A4.margin * 2, height: A4.bannerHeight }, `footer-banner-${page}`, 0.55);
  }

  function finalizeFooters(pdf, vm) {
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      addFooter(pdf, vm, page, pageCount);
    }
  }

  function ensurePage(pdf, y, needed, vm, pageRef) {
    if (y + needed <= A4.contentBottom) return y;
    pdf.addPage([A4.width, A4.height], "portrait");
    pageRef.value += 1;
    addHeader(pdf, vm, pageRef.value);
    return A4.headerCompact + 8;
  }

  function drawRowsBox(pdf, title, rows, x, y, width) {
    const textWidth = width - 8;
    const heights = rows.map(([label, value]) => textHeight(splitLines(pdf, `${label} : ${value}`, textWidth, { size: 7.8 }), 7.8, 1.2) + 2);
    const height = Math.max(34, 10 + heights.reduce((sum, value) => sum + value, 0));
    drawPanel(pdf, x, y, width, height, "#ffffff");
    drawText(pdf, title, x + 4, y + 6, textWidth, { size: 8.5, bold: true, color: BLUE });
    let rowY = y + 13;
    rows.forEach(([label, value], index) => {
      drawText(pdf, `${label} : ${value}`, x + 4, rowY, textWidth, { size: 7.8, color: index === 0 ? TEXT : MUTED, lineHeight: 1.2 });
      rowY += heights[index];
    });
    return height;
  }

  function drawClientProvider(pdf, vm, y) {
    const gap = 6;
    const width = (A4.width - A4.margin * 2 - gap) / 2;
    const leftHeight = drawRowsBox(pdf, "CLIENT / DEMANDEUR", vm.requesterRows, A4.margin, y, width);
    const rightHeight = drawRowsBox(pdf, "PLATEAU BIOCH&SPIR", vm.providerRows, A4.margin + width + gap, y, width);
    return y + Math.max(leftHeight, rightHeight) + 8;
  }

  function drawContextPanel(pdf, vm, y) {
    if (!vm.contextRows?.length) return y;
    const height = drawRowsBox(pdf, "CONTEXTE", vm.contextRows, A4.margin, y, A4.width - A4.margin * 2);
    return y + height + 8;
  }

  function descriptionEntryHeight(pdf, entry, width, labelWidth = 0) {
    const size = 8.5;
    const lineHeight = 1.28;
    if (entry.label && entry.text) {
      return textHeight(splitLines(pdf, entry.text, Math.max(20, width - labelWidth), { size }), size, lineHeight) + 1;
    }
    return textHeight(splitLines(pdf, entry.text || entry.label || "", width, { size }), size, lineHeight) + 1;
  }

  function drawDescriptionEntry(pdf, entry, y, vm, pageRef) {
    const size = 8.5;
    const lineHeight = 1.28;
    const lineStep = size * 0.3528 * lineHeight;
    const level = entry.level || 0;
    const bullet = level > 0 ? "•" : "-";
    const bulletX = A4.margin + level * 12;
    const textX = bulletX + 5;
    const width = 184 - level * 12 - 5;
    pdf.setFontSize(size);
    pdf.setFont("helvetica", "bold");
    const labelText = entry.label ? `${entry.label} :` : "";
    const labelWidth = entry.label ? pdf.getTextWidth(pdfText(`${labelText} `)) : 0;
    y = ensurePage(pdf, y, descriptionEntryHeight(pdf, entry, width, labelWidth), vm, pageRef);
    pdf.setTextColor(TEXT);
    pdf.setFont("helvetica", "normal");
    pdf.text(bullet, bulletX, y);
    if (entry.label) {
      pdf.setFont("helvetica", "bold");
      pdf.text(pdfText(labelText), textX, y);
      if (entry.text) {
        pdf.setFont("helvetica", "normal");
        const lines = splitLines(pdf, entry.text, Math.max(20, width - labelWidth), { size });
        pdf.text(lines, textX + labelWidth, y, { lineHeightFactor: lineHeight });
        return y + Math.max(1, lines.length) * lineStep + 1;
      }
      return y + lineStep + 1;
    }
    const lines = splitLines(pdf, entry.text, width, { size });
    pdf.text(lines, textX, y, { lineHeightFactor: lineHeight });
    return y + Math.max(1, lines.length) * lineStep + 1;
  }

  function drawDescription(pdf, vm, y, pageRef) {
    y = ensurePage(pdf, y, 26, vm, pageRef);
    y += drawText(pdf, "Description générale", A4.margin, y, 180, { size: 12, bold: true, color: BLUE }) + 2;
    const period = formatPeriod(vm.project.plannedStartDate, vm.project.plannedEndDate);
    const entries = [
      { label: "Demande", text: `${vm.project.title || "à compléter"}.` },
      { label: "Prestations sélectionnées" },
      ...vm.serviceSummaries.map((summary) => ({ level: 1, text: `${summary}.` })),
      { label: "Contexte", text: `${vm.contextLabel}.` },
      period ? { label: "Période envisagée", text: `${period}.` } : null,
      { label: "Statut", text: "pré-devis indicatif, à valider et discuter avec le plateau avant tout engagement." }
    ].filter(Boolean);
    entries.forEach((entry) => {
      y = drawDescriptionEntry(pdf, entry, y, vm, pageRef);
    });
    return y + 5;
  }

  function drawUsersAndTraining(pdf, vm, y, pageRef) {
    if (!vm.userSummaries.length) return y;
    y = ensurePage(pdf, y, 22, vm, pageRef);
    y += drawText(pdf, "Utilisateurs et formations", A4.margin, y, 180, { size: 12, bold: true, color: BLUE }) + 2;
    const text = vm.userSummaries.map((summary) => `- ${summary}`).join("\n");
    return y + drawText(pdf, text, A4.margin, y, 184, { size: 8.2, color: TEXT, lineHeight: 1.25 }) + 6;
  }

  function drawTableHeader(pdf, y) {
    pdf.setFillColor(PALE);
    pdf.setDrawColor(BORDER);
    pdf.rect(A4.margin, y, SERVICE_TABLE.width, 8, "FD");
    drawText(pdf, "Prestation et détail", SERVICE_TABLE.descriptionX, y + 5.3, SERVICE_TABLE.descriptionWidth, { size: 7.5, bold: true, color: BLUE });
    drawText(pdf, "Total HT", SERVICE_TABLE.totalX, y + 5.3, SERVICE_TABLE.totalWidth, { size: 7.5, bold: true, color: BLUE, align: "right" });
    return y + 8;
  }

  function drawServicesTable(pdf, vm, y, pageRef) {
    y = ensurePage(pdf, y, 20, vm, pageRef);
    y += drawText(pdf, "Tableau des prestations", A4.margin, y, 180, { size: 12, bold: true, color: BLUE }) + 2;
    y = drawTableHeader(pdf, y);
    vm.services.forEach((row) => {
      const descLines = splitLines(pdf, row.description, SERVICE_TABLE.descriptionWidth, { size: 7.5, bold: row.configRule === "externalAdministrativeFee" });
      const totalLines = splitLines(pdf, row.total, SERVICE_TABLE.totalWidth, { size: 8, bold: true });
      const height = Math.max(9, 5 + Math.max(
        textHeight(descLines, 7.5, 1.18),
        textHeight(totalLines, 8, 1.18)
      ));
      y = ensurePage(pdf, y, height + 1, vm, pageRef);
      if (y < A4.headerCompact + 10 && pageRef.value > 1) y = drawTableHeader(pdf, y);
      pdf.setDrawColor("#e3ebf1");
      pdf.line(A4.margin, y + height, A4.width - A4.margin, y + height);
      drawText(pdf, descLines.join("\n"), SERVICE_TABLE.descriptionX, y + 4.8, SERVICE_TABLE.descriptionWidth, { size: 7.5, lineHeight: 1.18, bold: row.configRule === "externalAdministrativeFee" });
      drawText(pdf, totalLines.join("\n"), SERVICE_TABLE.totalX, y + 4.8, SERVICE_TABLE.totalWidth, { size: 8, lineHeight: 1.18, align: "right", bold: true });
      y += height;
    });
    if (vm.administrativeFee) {
      y = ensurePage(pdf, y + 4, 12, vm, pageRef);
      y += drawText(pdf, "Forfait de gestion : il couvre la préparation administrative, la coordination, la facturation et le suivi du dossier.", A4.margin, y, 184, { size: 7.5, color: MUTED, lineHeight: 1.22 }) + 5;
    }
    return y + 2;
  }

  function drawCalibrationNote(pdf, vm, y, pageRef) {
    if (!vm.hasCalibration || !vm.calibrationNote?.paragraphs?.length) return y;
    pdf.addPage([A4.width, A4.height], "portrait");
    pageRef.value += 1;
    addHeader(pdf, vm, pageRef.value);
    y = A4.headerCompact + 10;
    y += drawText(pdf, "Annexe", A4.margin, y, 180, { size: 8.5, bold: true, color: MUTED }) + 1;
    y += drawText(pdf, vm.calibrationNote.title || "Calibration chimiométrique", A4.margin, y, 180, { size: 14, bold: true, color: BLUE }) + 2;
    pdf.setDrawColor(BORDER);
    pdf.line(A4.margin, y, A4.width - A4.margin, y);
    y += 7;
    const labels = ["Périmètre de la prestation", "Méthodes, traçabilité et reproductibilité", "Restitution et points de vigilance"];
    vm.calibrationNote.paragraphs.forEach((paragraph, index) => {
      y = ensurePage(pdf, y, 17, vm, pageRef);
      drawText(pdf, labels[index] || "Complément", A4.margin, y, 184, { size: 9.2, bold: true, color: BLUE });
      y += 5.5;
      y = drawLinkedParagraph(pdf, paragraph, A4.margin, y, 184, { size: 7.8, color: TEXT, lineHeight: 1.24 }, vm, pageRef) + 4;
    });
    return y + 4;
  }

  function drawPartnershipBreakdown(pdf, vm, y, pageRef) {
    const breakdown = vm.partnershipBreakdown;
    if (!breakdown) return y;
    y = ensurePage(pdf, y, 38, vm, pageRef);
    y += drawText(pdf, "Répartition partenariale indicative", A4.margin, y, 180, { size: 12, bold: true, color: BLUE }) + 2;
    const rows = [
      ["Part facturée indicative", breakdown.billedEstimate, "À définir avec le plateau"],
      ["Apports Bioch&SPIR identifiés", breakdown.offeredBase || addPdfRange(breakdown.offeredPersonnel, breakdown.offeredTraining), "Personnel et formations"],
      ["Contribution complémentaire possible", breakdown.negotiatedReduction, "Selon l'implication du plateau"]
    ].filter(([, range]) => Number(range?.max || 0) > 0);
    const x = A4.margin;
    const width = A4.width - A4.margin * 2;
    const cols = [72, 52, 58];
    pdf.setFillColor(PALE);
    pdf.setDrawColor(BORDER);
    pdf.rect(x, y, width, 8, "FD");
    drawText(pdf, "Élément", x + 2, y + 5.3, cols[0], { size: 7.5, bold: true, color: BLUE });
    drawText(pdf, "Montant", x + cols[0], y + 5.3, cols[1], { size: 7.5, bold: true, color: BLUE, align: "right" });
    drawText(pdf, "Lecture", x + cols[0] + cols[1] + 2, y + 5.3, cols[2], { size: 7.5, bold: true, color: BLUE });
    y += 8;
    rows.forEach(([label, range, note]) => {
      const amount = label === "Part facturée indicative" && vm.billingRangeReview?.required ? "Sur devis" : pdfRangeMoney(range, vm.totals.currency);
      y = ensurePage(pdf, y, 9, vm, pageRef);
      pdf.setDrawColor("#e3ebf1");
      pdf.line(x, y + 8, x + width, y + 8);
      const isPayable = label === "Part facturée indicative";
      drawText(pdf, label, x + 2, y + 5.2, cols[0], { size: 7.4, color: TEXT, bold: isPayable });
      drawText(pdf, amount, x + cols[0], y + 5.2, cols[1], { size: 7.4, color: TEXT, align: "right", bold: isPayable });
      drawText(pdf, note, x + cols[0] + cols[1] + 2, y + 5.2, cols[2], { size: 7.2, color: isPayable ? TEXT : MUTED, bold: isPayable });
      y += 8;
    });
    y += 3;
    y += drawText(pdf, "La part facturée indicative sera discutée et validée avec le plateau avant tout engagement.", A4.margin, y, 184, { size: 7.8, color: MUTED, lineHeight: 1.22 }) + 5;
    return y;
  }

  function drawTotals(pdf, vm, y, pageRef) {
    y = ensurePage(pdf, y, 52, vm, pageRef);
    y += drawText(pdf, "Totaux", A4.margin, y, 180, { size: 12, bold: true, color: BLUE }) + 2;
    const amountLines = splitLines(pdf, totalAmountTextPdf(vm), 176, { size: 13, bold: true });
    const panelHeight = Math.max(23, 14 + textHeight(amountLines, 13, 1.12));
    drawPanel(pdf, A4.margin, y, 186, panelHeight, PALE, "#a8cbdc");
    drawText(pdf, totalTitlePdf(vm), A4.margin + 5, y + 7, 176, { size: 8.5, bold: true, color: BLUE });
    drawText(pdf, amountLines.join("\n"), A4.margin + 5, y + 17, 176, { size: 13, bold: true, color: BLUE, lineHeight: 1.12 });
    y += panelHeight + 5;
    if (vm.status === "partial" && vm.quoteRequiredItemCount > 0) {
      const pending = vm.quoteRequiredItemCount > 1
        ? `${vm.quoteRequiredItemCount} éléments restent à discuter avec le plateau et ne sont pas compris`
        : "1 élément reste à discuter avec le plateau et n'est pas compris";
      y += drawText(pdf, `Ce montant comprend uniquement les prestations chiffrées. ${pending} dans le total présenté.`, A4.margin, y, 184, { size: 7.8, color: MUTED, lineHeight: 1.22 }) + 4;
    }
    if (vm.terms.vatNote) y += drawText(pdf, vm.terms.vatNote, A4.margin, y, 184, { size: 7.8, color: MUTED }) + 4;
    if (vm.terms.estimateRangeNote) {
      y = ensurePage(pdf, y, 5, vm, pageRef);
      y = drawLinkedParagraph(pdf, vm.terms.estimateRangeNote, A4.margin, y, 184, { size: 7.8, color: MUTED, lineHeight: 1.22 }, vm, pageRef) + 4;
    }
    return y;
  }

  function drawTerms(pdf, vm, y, pageRef) {
    y = ensurePage(pdf, y, 22, vm, pageRef);
    y += drawText(pdf, "Validité et conditions", A4.margin, y, 180, { size: 11, bold: true, color: BLUE }) + 2;
    y += drawText(pdf, `Validité du pré-devis : ${vm.validUntilLabel}`, A4.margin, y, 184, { size: 8.5, color: TEXT }) + 2;
    if (vm.terms.conditions) y += drawText(pdf, vm.terms.conditions, A4.margin, y, 184, { size: 8, color: MUTED, lineHeight: 1.24 }) + 4;
    const clauses = conditionalClauses(vm);
    if (clauses.length) {
      y = ensurePage(pdf, y, 14, vm, pageRef);
      y += drawText(pdf, "Clauses", A4.margin, y, 180, { size: 10, bold: true, color: BLUE }) + 2;
      clauses.forEach((clause) => {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.6);
        const lines = splitLines(pdf, `- ${clause}`, 182, { size: 7.6 });
        const height = textHeight(lines, 7.6, 1.22) + 2;
        y = ensurePage(pdf, y, height, vm, pageRef);
        drawText(pdf, lines.join("\n"), A4.margin + 2, y, 182, { size: 7.6, color: MUTED, lineHeight: 1.22 });
        y += height;
      });
    }
    return y;
  }

  function conditionalClauses(vm) {
    const terms = vm.terms || {};
    if (Array.isArray(terms.commonClauses)) {
      const contextClauses = vm.totals.contextId === "partnership"
        ? terms.partnershipClauses
        : vm.totals.contextId === "subcontracting"
          ? terms.subcontractingClauses
          : vm.totals.contextId === "public_research_lab"
            ? terms.publicResearchLabClauses
            : terms.internalClauses;
      return [...terms.commonClauses, ...vm.acquisitionClauses, ...vm.predictionClauses, ...(vm.billingRangeReview?.required ? [vm.billingRangeReview.message] : []), ...(Array.isArray(contextClauses) ? contextClauses : [])];
    }
    const legacy = Array.isArray(terms.clauses) ? terms.clauses : [];
    if (vm.totals.contextId === "partnership") return legacy;
    return legacy.filter((clause) => !/^Dans un partenariat/i.test(String(clause || "")));
  }

  function createPdfA4(state, result, config, options = {}) {
    const JsPDF = getPdfClass();
    if (!JsPDF) return null;
    const vm = options.viewModel || buildPdfViewModel(config, state, result, options);
    const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: [A4.width, A4.height], compress: true });
    pdf.setProperties({
      title: `Pré-devis ${vm.reference}`,
      subject: "Pré-devis indicatif A4",
      author: vm.provider?.name || "Plateau Bioch&Spir"
    });

    const pageRef = { value: 1 };
    addHeader(pdf, vm, pageRef.value);
    let y = A4.headerFirst + 8;
    y = drawClientProvider(pdf, vm, y);
    y = drawContextPanel(pdf, vm, y);
    y = drawDescription(pdf, vm, y, pageRef);
    y = drawUsersAndTraining(pdf, vm, y, pageRef);
    y = drawServicesTable(pdf, vm, y, pageRef);
    y = drawPartnershipBreakdown(pdf, vm, y, pageRef);
    if (vm.totals.contextId !== "partnership") y = drawTotals(pdf, vm, y, pageRef);
    drawTerms(pdf, vm, y, pageRef);
    drawCalibrationNote(pdf, vm, y, pageRef);
    finalizeFooters(pdf, vm);
    return pdf;
  }

  function createMutedBannerDataUrl(sourceDataUrl) {
    if (!sourceDataUrl || typeof document === "undefined" || typeof Image === "undefined") {
      return Promise.resolve(sourceDataUrl || "");
    }
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const context = canvas.getContext("2d");
          context.filter = "grayscale(35%) opacity(65%)";
          context.drawImage(image, 0, 0);
          context.filter = "none";
          context.fillStyle = "rgba(255, 255, 255, 0.35)";
          context.fillRect(0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          console.warn("Bandeau PDF non attenue.", error);
          resolve(sourceDataUrl);
        }
      };
      image.onerror = () => resolve(sourceDataUrl);
      image.src = sourceDataUrl;
    });
  }

  async function downloadPdfA4(state, result, config) {
    try {
      if (!getPdfClass() && typeof document !== "undefined") {
        await NIRSApp.loadScriptOnce?.("./vendor/jspdf.umd.min.js", "jspdf");
      }
      NIRSApp.ensureQuoteDocument(state, config);
      const footerBanner = await createMutedBannerDataUrl(config.assets?.images?.footerBanner || "");
      const pdf = createPdfA4(state, result, config, { footerBanner });
      if (!pdf) {
        window.print();
        return;
      }
      pdf.save(state.document.fileName);
    } catch (error) {
      console.error("PDF non genere", error);
      if (typeof window !== "undefined" && window.alert) window.alert(error.message);
    }
  }

  NIRSApp.buildPdfViewModel = buildPdfViewModel;
  NIRSApp.createPdfA4 = createPdfA4;
  NIRSApp.downloadPdfA4 = downloadPdfA4;
  NIRSApp.createMutedBannerDataUrl = createMutedBannerDataUrl;
  NIRSApp.pdfRangeMoney = pdfRangeMoney;
})();
