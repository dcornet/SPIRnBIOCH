(function () {
  "use strict";

  const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};
  const A4 = { width: 210, height: 297, margin: 11, header: 44, footer: 286 };
  const BLUE = "#0b5d8b";
  const TEXT = "#17324d";
  const MUTED = "#536576";
  const BORDER = "#c9d7e2";
  const PALE = "#edf7fc";
  const WARN = "#c95d16";

  function getPdfClass() {
    return globalThis.jspdf?.jsPDF || globalThis.jsPDF;
  }

  function pdfText(value) {
    return String(value || "").replace(/[\u00a0\u202f]/g, " ");
  }

  function pdfMoney(value, currency = "EUR") {
    if (!Number.isFinite(value)) return "Sur devis";
    const formatted = new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(value);
    return pdfText(formatted);
  }

  function pdfRangeMoney(range, currency = "EUR") {
    if (Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.min === range.max) {
      return pdfMoney(range.min, currency);
    }
    return `${pdfMoney(range?.min, currency)} - ${pdfMoney(range?.max, currency)}`;
  }

  function drawText(pdf, text, x, y, width, options = {}) {
    const size = options.size || 9;
    const lineHeight = options.lineHeight || 1.2;
    pdf.setFont("helvetica", options.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(options.color || TEXT);
    const lines = pdf.splitTextToSize(pdfText(text), width);
    pdf.text(lines, x, y, { lineHeightFactor: lineHeight, align: options.align || "left" });
    return lines.length * size * 0.3528 * lineHeight;
  }

  function splitLines(pdf, text, width) {
    return pdf.splitTextToSize(pdfText(text), width);
  }

  function textHeight(lines, size, lineHeight = 1.2) {
    return Math.max(1, lines.length) * size * 0.3528 * lineHeight;
  }

  function drawLabelValue(pdf, label, value, x, y, width, options = {}) {
    drawText(pdf, label, x, y, width, { size: options.labelSize || 7.5, color: MUTED, bold: true });
    return drawText(pdf, value, x, y + 4.6, width, { size: options.valueSize || 9, color: options.color || TEXT, bold: options.bold }) + 4.6;
  }

  function drawPanel(pdf, x, y, width, height, fill = "#ffffff", stroke = BORDER) {
    pdf.setFillColor(fill);
    pdf.setDrawColor(stroke);
    pdf.roundedRect(x, y, width, height, 2, 2, "FD");
  }

  function drawImageContained(pdf, source, box, alias) {
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
      pdf.addImage(source, type, x, y, width, height, alias, "FAST");
    } catch (error) {
      console.warn("Logo non inséré dans le PDF.", error);
    }
  }

  function splitLogos(config) {
    const logos = config.assets?.logos || [];
    const left = logos.filter((logo) => /cirad|inrae/i.test(`${logo.label || ""} ${logo.filename || ""}`));
    const right = logos.filter((logo) => /agap|bioch/i.test(`${logo.label || ""} ${logo.filename || ""}`));
    const fallback = logos.filter((logo) => !left.includes(logo) && !right.includes(logo));
    return { left: [...left, ...fallback].slice(0, 2), right: right.slice(0, 2) };
  }

  function addHeader(pdf, config, state, page) {
    const logos = splitLogos(config);
    pdf.setFillColor("#f7fbfd");
    pdf.rect(0, 0, A4.width, A4.header, "F");
    logos.left.forEach((logo, index) => {
      const box = { x: A4.margin + index * 31, y: 7, width: 27, height: 18 };
      drawPanel(pdf, box.x - 1, box.y - 1, box.width + 2, box.height + 2, "#ffffff", "#d7e2eb");
      drawImageContained(pdf, logo.pdfDataUrl || logo.dataUrl, box, `logo-left-${page}-${index}`);
    });
    logos.right.forEach((logo, index) => {
      const box = { x: A4.width - A4.margin - 58 + index * 31, y: 7, width: 27, height: 18 };
      drawPanel(pdf, box.x - 1, box.y - 1, box.width + 2, box.height + 2, "#ffffff", "#d7e2eb");
      drawImageContained(pdf, logo.pdfDataUrl || logo.dataUrl, box, `logo-right-${page}-${index}`);
    });
    drawText(pdf, "Pré-devis NIRS / SPIR", A4.margin, 35, 86, { size: 13, bold: true, color: BLUE });
    drawText(pdf, `Référence : ${state.quoteId || "à compléter"}`, A4.width - A4.margin - 72, 14, 72, { size: 8, color: MUTED, align: "right" });
    drawText(pdf, `Grille tarifaire : ${config.tarifs.metadata.version || "à compléter"}`, A4.width - A4.margin - 72, 20, 72, { size: 8, color: MUTED, align: "right" });
    drawText(pdf, `Généré le : ${new Date().toLocaleString("fr-FR")}`, A4.width - A4.margin - 72, 26, 72, { size: 8, color: MUTED, align: "right" });
  }

  function addFooter(pdf, page, pageCount = page) {
    pdf.setDrawColor(BORDER);
    pdf.line(A4.margin, A4.footer, A4.width - A4.margin, A4.footer);
    drawText(pdf, "Pré-devis indicatif HT, non contractuel. Devis définitif établi après revue scientifique et technique.", A4.margin, 291, 150, { size: 7.5, color: MUTED });
    drawText(pdf, `Page ${page} / ${pageCount}`, A4.width - A4.margin - 30, 291, 30, { size: 7.5, color: MUTED, align: "right" });
  }

  function finalizeFooters(pdf) {
    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      pdf.setPage(page);
      addFooter(pdf, page, pageCount);
    }
  }

  function ensurePage(pdf, y, needed, config, state, pageRef) {
    if (y + needed <= A4.footer - 5) return y;
    pdf.addPage([A4.width, A4.height], "portrait");
    pageRef.value += 1;
    addHeader(pdf, config, state, pageRef.value);
    addFooter(pdf, pageRef.value);
    return A4.header + 8;
  }

  function compactRequestInfo(state) {
    const requester = state.requester || {};
    const project = state.project || {};
    return [
      ["Demandeur", [requester.firstName, requester.lastName].filter(Boolean).join(" ")],
      ["Courriel", requester.email],
      ["Structure", [requester.organization, requester.unit].filter(Boolean).join(" - ")],
      ["Demande", project.title],
      ["Période", `${project.plannedStartDate || "à compléter"} - ${project.plannedEndDate || "à compléter"}`],
      ["Référence projet", project.reference],
      ["Téléphone", project.phone]
    ].filter(([, value]) => String(value || "").trim());
  }

  function drawOverview(pdf, state, result, config, y) {
    drawText(pdf, "Demande et coordonnées", A4.margin, y, 120, { size: 16, bold: true, color: BLUE });
    y += 9;
    const requestLines = compactRequestInfo(state);
    const contextLines = [
      `Statut : ${NIRSApp.statusLabel ? NIRSApp.statusLabel(result.status) : result.status}`,
      `Contexte : ${result.context?.label || state.context || "à compléter"}`,
      result.context?.display ? `Mode : ${result.context.display}` : "",
      ...requestLines.map(([label, value]) => `${label} : ${value}`)
    ].filter(Boolean);
    const rows = [];
    for (let index = 0; index < contextLines.length; index += 2) rows.push(contextLines.slice(index, index + 2));
    const rowHeights = rows.map((row) => Math.max(...row.map((line) => textHeight(splitLines(pdf, line, 88), 8.2, 1.2)), 4.5) + 4);
    const height = Math.max(24, 8 + rowHeights.reduce((sum, value) => sum + value, 0));
    drawPanel(pdf, A4.margin, y, 188, height, "#ffffff");
    let rowY = y + 7;
    rows.forEach((row, rowIndex) => {
      row.forEach((line, col) => {
        drawText(pdf, line, A4.margin + 4 + col * 92, rowY, 88, { size: 8.2, color: col === 0 && rowIndex === 0 ? TEXT : MUTED });
      });
      rowY += rowHeights[rowIndex];
    });
    return y + height + 7;
  }

  function drawPrestations(pdf, state, result, config, y, pageRef) {
    y = ensurePage(pdf, y, 18, config, state, pageRef);
    y += drawText(pdf, "Prestations", A4.margin, y, 180, { size: 13, bold: true, color: BLUE }) + 2;
    result.itemResults.forEach((item, index) => {
      const titleLines = splitLines(pdf, `${index + 1}. ${item.label}`, 104);
      const summaryLines = splitLines(pdf, item.summary || NIRSApp.statusLabel(item.status), 106);
      const amount = item.status === "incomplete" ? "Non inclus" : `${pdfRangeMoney(item.technicalValue, result.currency)} ${result.taxMode}`;
      const amountLines = splitLines(pdf, amount, 66);
      const leftHeight = textHeight(titleLines, 9.2, 1.16) + 2 + textHeight(summaryLines, 7.8, 1.22);
      const rightHeight = textHeight(amountLines, 10, 1.15);
      const height = Math.max(20, 10 + Math.max(leftHeight, rightHeight));
      y = ensurePage(pdf, y, height + 4, config, state, pageRef);
      drawPanel(pdf, A4.margin, y, 188, height, item.status === "incomplete" ? "#fff8ed" : "#ffffff", item.status === "incomplete" ? "#e4a35b" : BORDER);
      drawText(pdf, titleLines.join("\n"), A4.margin + 4, y + 5.5, 104, { size: 9.2, bold: true, lineHeight: 1.16 });
      drawText(pdf, summaryLines.join("\n"), A4.margin + 4, y + 7.5 + textHeight(titleLines, 9.2, 1.16), 106, { size: 7.8, color: MUTED, lineHeight: 1.22 });
      drawText(pdf, amountLines.join("\n"), A4.margin + 116, y + 8, 66, { size: 10, bold: true, align: "right", lineHeight: 1.15 });
      y += height + 4;
    });
    return y;
  }

  function drawLineDetails(pdf, state, result, config, y, pageRef) {
    if (!result.items?.length) return y;
    y = ensurePage(pdf, y, 20, config, state, pageRef);
    y += drawText(pdf, "Détail chiffrable", A4.margin, y, 180, { size: 12, bold: true, color: BLUE }) + 2;
    result.items.forEach((item) => {
      const amount = item.pricingMode === "quote" ? "Sur devis" : `${pdfRangeMoney({ min: item.totalMin, max: item.totalMax }, result.currency)} ${result.taxMode}`;
      const parentLines = splitLines(pdf, item.parentLabel || "Global", 34);
      const labelLines = splitLines(pdf, item.label, 64);
      const quantityLines = splitLines(pdf, `${item.quantity} ${item.unit}`, 22);
      const amountLines = splitLines(pdf, amount, 58);
      const reasonLines = splitLines(pdf, item.reason || "", 112);
      const labelBlockHeight = textHeight(labelLines, 7.8, 1.16) + (reasonLines.length ? 2 + textHeight(reasonLines, 6.8, 1.22) : 0);
      const height = Math.max(
        14,
        7 + Math.max(
          textHeight(parentLines, 7.3, 1.15),
          labelBlockHeight,
          textHeight(quantityLines, 7.4, 1.15),
          textHeight(amountLines, 7.8, 1.15)
        )
      );
      y = ensurePage(pdf, y, height + 2, config, state, pageRef);
      drawText(pdf, parentLines.join("\n"), A4.margin + 2, y + 4.8, 34, { size: 7.3, color: MUTED, lineHeight: 1.15 });
      drawText(pdf, labelLines.join("\n"), A4.margin + 39, y + 4.8, 64, { size: 7.8, bold: true, lineHeight: 1.16 });
      drawText(pdf, quantityLines.join("\n"), A4.margin + 107, y + 4.8, 22, { size: 7.4, color: MUTED, lineHeight: 1.15 });
      drawText(pdf, amountLines.join("\n"), A4.margin + 130, y + 4.8, 58, { size: 7.8, bold: true, align: "right", lineHeight: 1.15 });
      if (reasonLines.length) drawText(pdf, reasonLines.join("\n"), A4.margin + 39, y + 6.8 + textHeight(labelLines, 7.8, 1.16), 112, { size: 6.8, color: MUTED, lineHeight: 1.22 });
      pdf.setDrawColor("#e3ebf1");
      pdf.line(A4.margin, y + height, A4.width - A4.margin, y + height);
      y += height + 2;
    });
    return y + 3;
  }

  function drawTotals(pdf, state, result, config, y, pageRef) {
    y = ensurePage(pdf, y, 45, config, state, pageRef);
    y += drawText(pdf, "Totaux", A4.margin, y, 180, { size: 13, bold: true, color: BLUE }) + 2;
    const cards = [
      ["Valeur technique complète", `${pdfRangeMoney(result.technicalValue, result.currency)} ${result.taxMode}`],
      ["Montant estimatif facturé", `${pdfRangeMoney(result.billedEstimate, result.currency)} ${result.taxMode}`]
    ];
    if (result.context?.id === "collaborative_project") cards.push(["Contribution scientifique en nature", `${pdfRangeMoney(result.inKindContribution, result.currency)} ${result.taxMode}`]);
    if (result.context?.id === "subcontracting") cards.push(["Majoration de sous-traitance", `${pdfRangeMoney(result.contextMarkup, result.currency)} ${result.taxMode}`]);

    const width = cards.length > 2 ? 60 : 91;
    cards.forEach(([label, value], index) => {
      const x = A4.margin + index * (width + 4);
      drawPanel(pdf, x, y, width, 23, index === 1 ? PALE : "#ffffff");
      drawLabelValue(pdf, label, value, x + 4, y + 6, width - 8, { valueSize: index === 1 ? 10.5 : 9.5, bold: true });
    });
    return y + 31;
  }

  function drawQuoteRequired(pdf, state, result, config, y, pageRef) {
    const quoteLines = result.items.filter((item) => item.pricingMode === "quote");
    if (!quoteLines.length) return y;
    y = ensurePage(pdf, y, 28, config, state, pageRef);
    y += drawText(pdf, "Éléments restant à chiffrer par le plateau", A4.margin, y, 180, { size: 11, bold: true, color: WARN }) + 2;
    const lines = quoteLines.map((item) => `- ${item.parentLabel ? `${item.parentLabel} : ` : ""}${item.label}`);
    return y + drawText(pdf, lines.join("\n"), A4.margin + 2, y, 184, { size: 8.5, color: TEXT, lineHeight: 1.28 }) + 5;
  }

  function drawMentions(pdf, state, result, config, y, pageRef) {
    const mentions = [...new Set([...(result.exclusions || []), ...(result.warnings || [])])];
    if (!mentions.length) return y;
    y = ensurePage(pdf, y, 45, config, state, pageRef);
    y += drawText(pdf, "Mentions, limites et hypothèses", A4.margin, y, 180, { size: 11.5, bold: true, color: BLUE }) + 2;
    mentions.forEach((item) => {
      const lines = splitLines(pdf, `- ${item}`, 180);
      const height = textHeight(lines, 8, 1.28) + 3;
      y = ensurePage(pdf, y, height, config, state, pageRef);
      drawText(pdf, lines.join("\n"), A4.margin + 2, y + 3.5, 180, { size: 8, color: MUTED, lineHeight: 1.28 });
      y += height;
    });
    return y + 4;
  }

  function createPdfA4(state, result, config) {
    const JsPDF = getPdfClass();
    if (!JsPDF) return null;
    const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: [A4.width, A4.height], compress: true });
    pdf.setProperties({
      title: `Pré-devis NIRS SPIR - ${state.quoteId || ""}`,
      subject: "Pré-devis indicatif A4",
      author: "Plateau NIRS/SPIR"
    });

    const pageRef = { value: 1 };
    addHeader(pdf, config, state, pageRef.value);
    addFooter(pdf, pageRef.value);

    let y = A4.header + 8;
    y = drawOverview(pdf, state, result, config, y) + 5;
    y = drawTotals(pdf, state, result, config, y, pageRef);
    y = drawPrestations(pdf, state, result, config, y, pageRef);
    y = drawLineDetails(pdf, state, result, config, y, pageRef);
    y = drawQuoteRequired(pdf, state, result, config, y, pageRef);
    drawMentions(pdf, state, result, config, y, pageRef);
    finalizeFooters(pdf);
    return pdf;
  }

  function downloadPdfA4(state, result, config) {
    const pdf = createPdfA4(state, result, config);
    if (!pdf) {
      window.print();
      return;
    }
    pdf.save(`predevis-nirs-spir-${NIRSApp.slugDate()}.pdf`);
  }

  NIRSApp.createPdfA4 = createPdfA4;
  NIRSApp.downloadPdfA4 = downloadPdfA4;
  NIRSApp.pdfRangeMoney = pdfRangeMoney;
})();
