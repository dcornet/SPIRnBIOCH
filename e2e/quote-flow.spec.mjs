import { expect, test } from "@playwright/test";

const CAPACITY_HELP = "Les cadences sont indicatives et incluent le nommage des spectres, la traçabilité manuelle, la manipulation des échantillons, le nettoyage courant et l’amortissement du temps de mise en route sur une demi-journée. En cas de préparation spécifique ou de nettoyage approfondi, la cadence doit être réduite.";

function collectBrowserErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openApp(page, testInfo) {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_error) {
      // file:// storage can be unavailable in some browser policies.
    }
  });
  await page.goto(testInfo.project.use.baseURL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("form.wizard")).toBeVisible();
}

async function expectNoBrowserErrors(errors) {
  expect(errors).toEqual([]);
}

async function typeInto(page, selector, value) {
  const field = page.locator(selector);
  await field.click();
  await field.fill("");
  await field.pressSequentially(value);
  await expect(field).toHaveValue(value);
}

async function fillRequestStep(page, context = "subcontracting") {
  await typeInto(page, '[data-requester-field="firstName"]', "Alice");
  await typeInto(page, '[data-requester-field="lastName"]', "Martin");
  await typeInto(page, '[data-requester-field="email"]', "alice.martin@example.test");
  await typeInto(page, '[data-requester-field="organization"]', "Bioch");
  await page.locator('[data-requester-field="unitCode"]').selectOption("A10802-AGAP - AFEF");
  await typeInto(page, '[data-project-field="title"]', "Essai NIRS");
  await page.locator('[data-project-field="plannedStartDate"]').fill("2026-09-15");
  await page.locator('[data-project-field="plannedEndDate"]').fill("2026-09-16");
  await page.locator(`input[name="context"][value="${context}"]`).check();
  if (context === "partnership") {
    await typeInto(page, '[data-project-field="partnershipProjectName"]', "NIRS4Agro");
  }
}

async function continueToCatalog(page, context = "subcontracting") {
  await fillRequestStep(page, context);
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Composer le pré-devis" })).toBeVisible();
}

async function addCardAndGoToConfig(page, cardId) {
  await page.locator(`[data-add-card="${cardId}"]`).click();
  await page.locator("[data-go-config]").click();
  await expect(page.getByRole("heading", { name: "Configurer les prestations" })).toBeVisible();
  await expect(page.locator("[data-panel-body]").first()).toBeVisible();
}

async function configureCapacity(page, deviceId, halfDays) {
  await page.locator('input[data-field-id="serviceMode"][value="plateau_operated"]').check();
  await page.locator('select[name="measurementDevice"]').selectOption(deviceId);
  const halfDayInput = page.locator('input[name="halfDays"]');
  await halfDayInput.fill(String(halfDays));
  await halfDayInput.dispatchEvent("change");
  await expect(halfDayInput).toHaveValue(String(halfDays));
}

async function fillGlobalSpectraUser(page, status = "untrained", date = "") {
  await typeInto(page, '[data-global-person-field="firstName"]', "Alice");
  await typeInto(page, '[data-global-person-field="lastName"]', "Martin");
  await typeInto(page, '[data-global-person-field="email"]', "alice.martin@example.test");
  await page.locator('[data-global-assignment-field="trainingStatus"]').first().selectOption(status);
  if (status === "trained") {
    await page.locator('[data-global-assignment-field="trainingDate"]').first().fill(date || "2026-07-01");
  }
}

async function expectSingleCurrentStep(page, label) {
  await expect(page.locator(".progress .is-current")).toHaveCount(1);
  await expect(page.locator(".progress .is-current")).toContainText(label);
  await expect(page.locator(".hero-steps")).toHaveCount(0);
}

function progressStep(page, label) {
  return page.locator(".progress [data-step-target]", { hasText: label });
}

test("première page sans contexte sélectionné", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);

  await expect(page).toHaveTitle("Bioch&SPIR - pré-devis");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "./data/favicon_bs_32x32.png");
  await expect(page.locator('input[name="context"]:checked')).toHaveCount(0);
  await expect(page.locator("form.wizard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Votre demande et vos coordonnées" })).toBeVisible();
  await expect(page.getByText("Contexte à choisir")).toBeVisible();
  await expect(page.locator("#live-estimate strong").first()).toHaveText("À compléter");
  await expect(page.getByText("Total estimatif HT")).toBeVisible();
  await expect(page.getByText("Valeur technique")).toHaveCount(0);
  await expect(page.getByText("Montant facturable indicatif après contexte")).toHaveCount(0);
  await expect(page.locator('input[name="context"]')).toHaveCount(4);
  await expect(page.locator(".context-card__icon")).toHaveCount(4);
  const contextLayout = await page.locator(".context-card").evaluateAll((cards) => cards.map((card) => {
    const box = card.getBoundingClientRect();
    return { left: Math.round(box.left), top: Math.round(box.top) };
  }));
  expect(new Set(contextLayout.map((box) => box.left)).size).toBe(2);
  expect(new Set(contextLayout.map((box) => box.top)).size).toBe(2);
  await expect(page.locator(".context-card span")).toHaveText([
    "UMR AGAP Institut — demande interne",
    "Laboratoire public de recherche — hors UMR AGAP Institut",
    "Partenariat scientifique avec Bioch&SPIR",
    "Sous-traitance / prestation de service"
  ]);
  await expectSingleCurrentStep(page, "Votre demande");

  await expectNoBrowserErrors(errors);
});

test("bandeau institutionnel blanc avec NIRS4ALL centre et CIRAD agrandi", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);

  await expect(page.locator(".institutional-banner")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".institutional-banner__group--center img")).toHaveAttribute("alt", /nirs4all/i);
  const sizes = await page.evaluate(() => {
    const cirad = document.querySelector(".institutional-banner__logo--cirad")?.getBoundingClientRect();
    const inrae = document.querySelector(".institutional-banner__logo--inrae")?.getBoundingClientRect();
    return {
      ciradWidth: cirad?.width || 0,
      ciradHeight: cirad?.height || 0,
      inraeWidth: inrae?.width || 0,
      inraeHeight: inrae?.height || 0
    };
  });
  expect(sizes.ciradHeight).toBeGreaterThanOrEqual(sizes.inraeHeight - 2);
  expect(sizes.ciradWidth).toBeLessThan(sizes.inraeWidth);

  await expectNoBrowserErrors(errors);
});

test("unite autre affiche un champ de precision requis puis permet de continuer", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);

  await typeInto(page, '[data-requester-field="firstName"]', "Alice");
  await typeInto(page, '[data-requester-field="lastName"]', "Martin");
  await typeInto(page, '[data-requester-field="email"]', "alice.martin@example.test");
  await typeInto(page, '[data-requester-field="organization"]', "Bioch");
  await page.locator('[data-requester-field="unitCode"]').selectOption("Autre");
  await expect(page.locator('[data-requester-field="unitOther"]')).toBeVisible();
  await typeInto(page, '[data-requester-field="unitOther"]', "Plateau SPIR externe");
  await typeInto(page, '[data-project-field="title"]', "Essai NIRS");
  await page.locator('[data-project-field="plannedStartDate"]').fill("2026-09-15");
  await page.locator('[data-project-field="plannedEndDate"]').fill("2026-09-16");
  await page.locator('input[name="context"][value="subcontracting"]').check();

  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.getByRole("heading", { name: "Composer le pré-devis" })).toBeVisible();

  await expectNoBrowserErrors(errors);
});

test("charte visuelle sans double stepper et icones de vignettes homogenes", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);

  await expect(page.locator(".hero-steps")).toHaveCount(0);
  await expect(page.locator(".progress")).toHaveCount(1);
  await expect(page.locator(".progress .is-current")).toHaveCount(1);
  await expect(page.locator(".progress [data-step-target]")).toHaveCount(4);

  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      green: styles.getPropertyValue("--brand-green").trim(),
      teal: styles.getPropertyValue("--brand-teal").trim(),
      gold: styles.getPropertyValue("--brand-gold").trim(),
      red: styles.getPropertyValue("--brand-red").trim()
    };
  });
  expect(tokens).toEqual({
    green: "#4f7f35",
    teal: "#007b80",
    gold: "#f3b600",
    red: "#b4202d"
  });

  const iconBoxes = await page.locator(".service-card__icon").evaluateAll((icons) =>
    icons.map((icon) => {
      const box = icon.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    })
  );
  expect(iconBoxes.length).toBeGreaterThan(4);
  expect(new Set(iconBoxes.map((box) => box.width))).toEqual(new Set([72]));
  expect(new Set(iconBoxes.map((box) => box.height))).toEqual(new Set([72]));

  await expectNoBrowserErrors(errors);
});

test("mise en page mobile sans debordement horizontal", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, testInfo);
  await continueToCatalog(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator(".institutional-banner")).toBeVisible();
  await expect(page.locator(".service-card").first()).toBeVisible();

  await expectNoBrowserErrors(errors);
});

test("navigation clavier et clic direct entre champs de la première page", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);

  const firstName = page.locator('[data-requester-field="firstName"]');
  const lastName = page.locator('[data-requester-field="lastName"]');
  const email = page.locator('[data-requester-field="email"]');

  await firstName.focus();
  await expect(firstName).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(lastName).toBeFocused();

  await firstName.click();
  await expect(firstName).toBeFocused();
  await email.click();
  await expect(email).toBeFocused();
  await page.keyboard.type("alice.martin@example.test");
  await expect(email).toHaveValue("alice.martin@example.test");

  await expectNoBrowserErrors(errors);
});

test("resume affiche le forfait de gestion et son aide accessible", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_bruker_tango");
  await configureCapacity(page, "direct_measurement", 1);

  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("#quote-title")).toBeVisible();
  await expect(page.getByText("Forfait de gestion")).toBeVisible();
  await expect(page.locator(".table-wrap tbody tr").first()).toContainText("Forfait de gestion");
  const tooltipButton = page.getByRole("button", { name: "Que couvre le forfait de gestion ?" });
  await tooltipButton.click();
  await expect(page.getByRole("tooltip")).toContainText("Ces frais couvrent");
  await expect(page.getByRole("tooltip")).toContainText(/gestion administrative et financi/);

  await expectNoBrowserErrors(errors);
});

test("partenariat affiche contribution BiochSPIR et formations offertes", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page, "partnership");
  await addCardAndGoToConfig(page, "spectra_viavi_micronir");

  await page.locator('input[data-field-id="serviceMode"][value="autonomous_supported"]').check();
  await page.locator('select[name="measurementDevice"]').selectOption("tablet_probe");
  await typeInto(page, 'input[name="halfDays"]', "1");
  await fillGlobalSpectraUser(page, "untrained");

  await expect(page.locator("#live-estimate span", { hasText: "Part facturée indicative HT à définir" })).toBeVisible();
  await expect(page.getByText(/Apports Bioch&SPIR/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await page.getByRole("button", { name: "Continuer" }).click();

  await expect(page.locator("#quote-title")).toBeVisible();
  await expect(page.getByText("Répartition partenariale indicative")).toBeVisible();
  await expect(page.locator(".partnership-breakdown dt", { hasText: "Apports Bioch&SPIR déjà identifiés" })).toBeVisible();
  await expect(page.getByText("Formations offertes")).toBeVisible();
  await expect(page.locator(".partnership-breakdown dt", { hasText: "Part facturée indicative" })).toBeVisible();
  await expect(page.locator(".table-wrap")).toContainText("Offert");
  await expect(page.locator(".table-wrap")).toContainText("Formation offerte dans le cadre du partenariat");
  await expect(page.locator(".table-wrap")).toContainText("Forfait de gestion");

  await expectNoBrowserErrors(errors);
});

test("ancien brouillon partnership migre vers demande interne", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem("nirs_spir_quote_draft_v2", JSON.stringify({
      quoteId: "old-partnership-draft",
      schemaVersion: 4,
      currentStep: 1,
      context: "partnership",
      requester: {
        firstName: "Alice",
        lastName: "Martin",
        email: "alice.martin@example.test",
        organization: "Bioch",
        unit: "Plateau SPIR"
      },
      project: {
        title: "Ancien projet",
        plannedStartDate: "2026-09-15",
        plannedEndDate: "2026-09-16"
      },
      people: [],
      items: []
    }));
  });
  await page.goto(testInfo.project.use.baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Reprendre le brouillon" }).click();

  await expect(page.locator('input[name="context"][value="internal_agap"]')).toBeChecked();
  await expect(page.locator('input[name="context"][value="partnership"]')).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();

  await expectNoBrowserErrors(errors);
});

test("navigation, ordre du catalogue et capacité LabSpec", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);

  await expectSingleCurrentStep(page, "Composer le pré-devis");
  await expect(page.locator(".progress [data-step-target]").first()).toHaveClass(/is-complete/);
  const categories = await page.locator(".service-category h3").allTextContents();
  expect(categories).toEqual(["Prendre des spectres", "Chimiométrie", "Me former"]);
  const trainingCategory = page.locator(".service-category--training");
  await expect(trainingCategory.getByText("Module en préparation")).toBeVisible();
  await expect(trainingCategory.locator("[data-add-card]")).toHaveCount(0);

  await addCardAndGoToConfig(page, "spectra_asd_labspec");
  await expectSingleCurrentStep(page, "Configurer les prestations");
  await expect(page.locator(".progress [data-step-target]").nth(1)).toHaveClass(/is-complete/);
  await expect(page.getByLabel("Sonde ou dispositif de mesure")).toHaveText(/Pince.*Fibre optique/s);

  await configureCapacity(page, "clamp", 10);
  await expect(page.getByText(/Quantité de spectres indicative : 480 à 1\s?000 spectres\./)).toBeVisible();
  await expect(page.getByText("Zone circulaire d’environ 10 mm de diamètre.")).toBeVisible();
  await expect(page.getByText("10 demi-journée(s) × 4 heures × 12 à 25 spectres par heure")).toBeVisible();

  const tooltipButton = page.locator(".spectral-capacity .help-tooltip-trigger");
  await tooltipButton.click();
  await expect(page.getByRole("tooltip")).toHaveText(CAPACITY_HELP);

  await expectNoBrowserErrors(errors);
});

test("capacité MicroNIR goutte", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_viavi_micronir");

  await expect(page.getByLabel("Sonde ou dispositif de mesure")).toHaveText(/Mesure directe sans adaptateur.*Sonde à comprimé.*Support pour vial.*Adaptateur pour liquide — goutte/s);
  await configureCapacity(page, "liquid_drop_adapter", 10);
  await expect(page.getByText(/Quantité de spectres indicative : 240 à 480 spectres\./)).toBeVisible();
  await expect(page.getByText("Petite zone couverte par une goutte déposée sur la fenêtre de mesure.")).toBeVisible();

  await expectNoBrowserErrors(errors);
});

test("capacité MicroNIR mesure directe n'affiche pas zero spectre par heure", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_viavi_micronir");

  await configureCapacity(page, "direct_measurement", 1);
  await expect(page.getByText(/Quantité de spectres indicative : 80 à 160 spectres\./)).toBeVisible();
  await expect(page.locator(".spectral-capacity")).not.toContainText("0 à 0");
  await expect(page.locator(".spectral-capacity")).toContainText("1 demi-journée(s) × 4 heures × 20 à 40 spectres par heure");

  await expectNoBrowserErrors(errors);
});

test("capacité TANGO coupelle", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_bruker_tango");

  await expect(page.getByLabel("Sonde ou dispositif de mesure")).toHaveText(/Mesure directe.*Coupelle 5 cm.*Coupelle 9 cm.*Pilulier ou flacon/s);
  await configureCapacity(page, "cup_9cm", 10);
  await expect(page.getByText(/Quantité de spectres indicative : 320 à 720 spectres\./)).toBeVisible();
  await expect(page.getByText("Zone instrumentale d’environ 10 mm ; la surface effective est plus grande lorsque la coupelle tourne.")).toBeVisible();

  await expectNoBrowserErrors(errors);
});

test("capacité MIR ATR", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_mir_perkin_elmer");

  await expect(page.getByLabel("Sonde ou dispositif de mesure")).toHaveText(/ATR diamant/);
  await configureCapacity(page, "diamond_atr", 10);
  await expect(page.getByText(/Quantité de spectres indicative : 240 à 600 spectres\./)).toBeVisible();
  await expect(page.getByText("Zone de contact de quelques millimètres, selon le cristal ATR.")).toBeVisible();

  await expectNoBrowserErrors(errors);
});

test("PerkinElmer initialise automatiquement l'ATR et affiche sous-total et capacité", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_mir_perkin_elmer");

  await page.locator('input[data-field-id="serviceMode"][value="plateau_operated"]').check();
  await typeInto(page, 'input[name="halfDays"]', "10");

  await expect(page.locator('[data-item-status]').first()).toHaveText("Complète");
  await expect(page.locator('[data-item-summary]').first()).toContainText("ATR diamant");
  await expect(page.getByText(/Quantité de spectres indicative : 240 à 600 spectres\./)).toBeVisible();
  await expect(page.locator(".item-subtotal strong").first()).toHaveText("3 408 € - 4 611 €");

  await expectNoBrowserErrors(errors);
});

test("scénarios navigateur du modèle de coût instrument", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);

  const scenarios = await page.evaluate(() => {
    const trained = (instrument) => ({
      id: `trained-${instrument}`,
      firstName: "Alice",
      lastName: "Martin",
      email: "alice.martin@example.test",
      trainingStatusByInstrument: { [instrument]: { status: "trained", date: "2026-07-01" } }
    });
    const calculate = (answers) => globalThis.NIRSApp.calculateQuote(globalThis.NIRS_CONFIG, {
      quoteId: `scenario-${answers.instrument}`,
      context: "",
      urgent: false,
      urgentSource: "none",
      people: [],
      items: [{ id: "item-1", requestType: "spectra_acquisition", answers: { requestType: "spectra_acquisition", ...answers }, completed: true }]
    });
    const micronir = calculate({
      serviceMode: "autonomous_supported",
      instrument: "viavi_micronir",
      measurementDevice: "tablet_probe",
      measurementLocation: "bioch_spir_lab",
      halfDays: 2,
      operators: [trained("viavi_micronir")]
    });
    const tango = calculate({
      serviceMode: "plateau_operated",
      instrument: "bruker_tango",
      measurementDevice: "direct_measurement",
      measurementLocation: "bioch_spir_lab",
      halfDays: 3
    });
    const labspec = calculate({
      serviceMode: "autonomous_supported",
      instrument: "asd_labspec",
      measurementDevice: "clamp",
      measurementLocation: "transport_required",
      halfDays: 2,
      operators: [trained("asd_labspec")]
    });
    const spectrum = calculate({
      serviceMode: "plateau_operated",
      instrument: "mir_perkin_elmer",
      measurementDevice: "diamond_atr",
      measurementLocation: "bioch_spir_lab",
      halfDays: 1
    });
    return {
      micronirTechnical: micronir.itemResults[0].technicalValue.min,
      tangoTechnical: tango.itemResults[0].technicalValue.min,
      labspecReservation: labspec.items.find((line) => line.id === "autonomous_supported_half_day")?.totalMin,
      labspecTransport: labspec.items.find((line) => line.id === "instrument_transport")?.totalMin,
      spectrumTechnical: spectrum.itemResults[0].technicalValue.min
    };
  });

  expect(scenarios).toEqual({
    micronirTechnical: 60,
    tangoTechnical: 803,
    labspecReservation: 97,
    labspecTransport: 150,
    spectrumTechnical: 252
  });
  await expectNoBrowserErrors(errors);
});

test("ajout d'une personne affiche les champs de contact et formation", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_viavi_micronir");

  const layout = await page.evaluate(() => {
    const panelToggle = document.querySelector(".panel-toggle");
    const peopleList = document.querySelector(".people-list");
    const personRow = document.querySelector(".global-person-row");
    const panelStyles = panelToggle ? getComputedStyle(panelToggle) : null;
    const listBox = peopleList?.getBoundingClientRect();
    const rowBox = personRow?.getBoundingClientRect();
    return {
      panelBackground: panelStyles?.backgroundColor || "",
      panelColor: panelStyles?.color || "",
      peopleWidthRatio: listBox && rowBox ? rowBox.width / listBox.width : 0
    };
  });
  expect(layout.panelBackground).not.toBe("rgb(79, 127, 53)");
  expect(layout.panelColor).not.toBe("rgb(255, 255, 255)");
  expect(layout.peopleWidthRatio).toBeGreaterThan(0.95);

  await expect(page.locator('[data-global-person-field="firstName"]')).toBeVisible();
  await expect(page.locator('[data-global-person-field="lastName"]')).toBeVisible();
  await expect(page.locator('[data-global-person-field="email"]')).toBeVisible();
  await expect(page.getByText("Formation effectuée")).toBeVisible();
  await page.getByRole("button", { name: "Ajouter une personne" }).click();
  await expect(page.locator(".global-person-row")).toHaveCount(2);
  await page.locator("[data-remove-global-person]").last().click();
  await expect(page.locator(".global-person-row")).toHaveCount(1);

  await fillGlobalSpectraUser(page);
  await page.locator('select[name="measurementDevice"]').selectOption("tablet_probe");
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();

  await expectNoBrowserErrors(errors);
});

test("bloque la suite si un spectrometre n'a pas d'utilisateur associe", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await page.locator('[data-add-card="spectra_bruker_tango"]').click();
  await page.locator('[data-add-card="spectra_mir_perkin_elmer"]').click();
  await page.locator("[data-go-config]").click();
  await expect(page.getByRole("heading", { name: "Configurer les prestations" })).toBeVisible();

  await page.locator('[data-toggle-global-instrument="bruker_tango"]').first().check();
  await typeInto(page, '[data-global-person-field="firstName"]', "Alice");
  await typeInto(page, '[data-global-person-field="lastName"]', "Martin");
  await typeInto(page, '[data-global-person-field="email"]', "alice.martin@example.test");
  await page.locator('[data-global-assignment-field="trainingStatus"]').first().selectOption("trained");
  const trainingDate = page.locator('[data-global-assignment-field="trainingDate"]').first();
  await trainingDate.fill("2026-07-01");
  await trainingDate.dispatchEvent("change");

  await expect(page.getByText(/Ajoutez au moins un utilisateur pour PerkinElmer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuer" })).toBeDisabled();
  await expectSingleCurrentStep(page, "Configurer les prestations");

  await expectNoBrowserErrors(errors);
});

test("formation ancienne accompagnee masque la case optionnelle et ajoute la remise a niveau", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_bruker_tango");
  await page.locator('input[data-field-id="serviceMode"][value="autonomous_supported"]').check();
  await page.locator('select[name="measurementDevice"]').selectOption("direct_measurement");
  await typeInto(page, 'input[name="halfDays"]', "1");
  await fillGlobalSpectraUser(page, "trained", "2024-01-01");
  const trainingDate = page.locator('[data-global-assignment-field="trainingDate"]').first();
  await trainingDate.dispatchEvent("change");

  await expect(page.getByText(/remise à niveau est automatiquement ajoutée/)).toBeVisible();
  await expect(page.locator('[data-global-assignment-field="trainingRequested"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("#quote-title")).toBeVisible();
  await expect(page.getByText(/Formations aux instruments - Bruker TANGO II - remise à niveau - Alice Martin/)).toBeVisible();

  await expectNoBrowserErrors(errors);
});

test("recopie les coordonnees du demandeur vers le premier utilisateur", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_viavi_micronir");

  await page.getByLabel("Le premier utilisateur est le demandeur").check();
  await expect(page.locator('[data-global-person-field="firstName"]').first()).toHaveValue("Alice");
  await expect(page.locator('[data-global-person-field="lastName"]').first()).toHaveValue("Martin");
  await expect(page.locator('[data-global-person-field="email"]').first()).toHaveValue("alice.martin@example.test");
  await expect(page.locator('[data-toggle-global-instrument="viavi_micronir"]').first()).toBeChecked();

  await expectNoBrowserErrors(errors);
});

test("navigation directe par la progression", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);

  await expect(progressStep(page, "Composer")).toBeDisabled();
  await fillRequestStep(page);
  await expect(progressStep(page, "Composer")).toBeEnabled();
  await progressStep(page, "Composer").click();
  await expectSingleCurrentStep(page, "Composer");

  await expect(progressStep(page, "Configurer")).toBeDisabled();
  await page.locator('[data-add-card="spectra_asd_labspec"]').click();
  await expect(progressStep(page, "Configurer")).toBeEnabled();
  await progressStep(page, "Configurer").click();
  await expectSingleCurrentStep(page, "Configurer les prestations");

  await progressStep(page, "Votre demande").click();
  await expectSingleCurrentStep(page, "Votre demande");

  await progressStep(page, "Configurer").click();
  await expectSingleCurrentStep(page, "Configurer les prestations");

  await expectNoBrowserErrors(errors);
});

test("prediction affiche le nettoyage sans bloc donnees disponibles", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "predict");

  const panel = page.locator("[data-panel-body]").first();
  await expect(panel.getByText("Données disponibles")).toHaveCount(0);
  await expect(panel.getByText("Contrôle des valeurs aberrantes")).toHaveCount(0);
  await expect(panel.getByLabel("Spectres déjà acquis")).toBeVisible();
  await expect(panel.getByLabel("Préparation et nettoyage des données")).toBeVisible();

  await expectNoBrowserErrors(errors);
});

const MAINTENANCE_CASES = [
  ["performance_audit", "Auditer les performances", /1\s*148\s*€.*1\s*553\s*€/],
  ["contextual_validation", "Valider dans un nouveau contexte", /1\s*893\s*€.*2\s*562\s*€/],
  ["bias_correction", "Corriger un biais", /1\s*148\s*€.*1\s*553\s*€/],
  ["model_update", "Mettre à jour ou étendre le modèle", /2\s*869\s*€.*3\s*881\s*€/],
  ["instrument_transfer", "Transférer vers un autre spectromètre", /2\s*295\s*€.*3\s*105\s*€/]
];

for (const [maintenanceType, label, range] of MAINTENANCE_CASES) {
  test(`entretien simplifie - ${maintenanceType}`, async ({ page }, testInfo) => {
    const errors = collectBrowserErrors(page);
    await openApp(page, testInfo);
    await continueToCatalog(page);
    await addCardAndGoToConfig(page, "maintain");

    const panel = page.locator("[data-panel-body]").first();
    await panel.locator('select[name="maintenanceType"]').selectOption(maintenanceType);
    await expect(panel.getByRole("heading", { name: label })).toBeVisible();
    await expect(panel.locator("textarea")).toHaveCount(1);
    await expect(panel.getByText("Informations utiles, si vous les connaissez")).toBeVisible();
    await expect(panel.locator(".maintenance-card__checklist input")).toHaveCount(0);
    await expect(panel.locator(".maintenance-card__checklist select")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Afficher l'information" })).toHaveCount(0);
    await expect(panel.locator(".maintenance-card__info")).toBeVisible();
    await expect(panel.getByText("Tarifs indicatifs à confirmer avec le plateau.")).toBeVisible();
    await expect(panel.getByText(range)).toBeVisible();

    await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.locator("#quote-title")).toBeVisible();
    await expect(page.locator(".item-summary-list").getByText(label).first()).toBeVisible();
    await expect(page.getByText("Informations complémentaires à préciser avec le plateau.")).toBeVisible();

    await progressStep(page, "Configurer").click();
    await expectSingleCurrentStep(page, "Configurer les prestations");
    await panel.locator("textarea").fill("Commentaire conservé pour préparer la discussion avec le plateau.");
    await panel.locator("textarea").dispatchEvent("change");
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.locator(".item-summary-list").getByText("Commentaire conservé pour préparer la discussion avec le plateau.", { exact: true })).toBeVisible();

    await expectNoBrowserErrors(errors);
  });
}

test("transfert entretien ne montre plus le questionnaire complexe", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page, "subcontracting");
  await addCardAndGoToConfig(page, "maintain");

  const panel = page.locator("[data-panel-body]").first();
  await panel.locator('select[name="maintenanceType"]').selectOption("instrument_transfer");
  await expect(panel.getByRole("heading", { name: "Transférer vers un autre spectromètre" })).toBeVisible();
  await expect(panel.getByLabel("Modèle concerné")).toHaveCount(0);
  await expect(panel.getByLabel("Propriété ou trait concerné")).toHaveCount(0);
  await expect(panel.getByLabel("Spectromètre source")).toHaveCount(0);
  await expect(panel.getByLabel("Spectromètre cible")).toHaveCount(0);
  await expect(panel.locator("textarea")).toHaveCount(1);

  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator("#quote-title")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("1,35");
  await expect(page.locator(".item-summary").first().locator("strong")).toContainText(/2\s*295\s*€.*3\s*105\s*€/);

  await expectNoBrowserErrors(errors);
});
