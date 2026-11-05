import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const CAPACITY_HELP = "Les cadences sont indicatives. Elles varient selon l’expérience de l’opérateur, la présentation et la nature de la matrice, ainsi que les manipulations, le repositionnement et le nettoyage nécessaires. Par exemple, des arachides entières et une pâte d’arachide ne se mesurent pas à la même cadence.";

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
  const samples = page.locator('input[name="samples"]');
  if (cardId.startsWith("spectra_") && await samples.count()) {
    await samples.fill("100");
    await samples.dispatchEvent("change");
  }
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
  await expect(trainingCategory).toContainText("Formations théoriques");
  await expect(trainingCategory.locator("[data-add-card]")).toHaveCount(0);

  await addCardAndGoToConfig(page, "spectra_asd_labspec");
  await expectSingleCurrentStep(page, "Configurer les prestations");
  await expect(page.locator(".progress [data-step-target]").nth(1)).toHaveClass(/is-complete/);
  await expect(page.getByLabel("Sonde ou dispositif de mesure")).toHaveText(/Sonde de contact 2 cm.*Pince à feuille.*Microsonde 0,3 cm/s);

  await configureCapacity(page, "clamp", 10);
  await expect(page.getByText(/Quantité de spectres indicative : 2\s?400 à 3\s?200 spectres\./)).toBeVisible();
  await expect(page.getByText("Pince adaptée à la mesure des feuilles.")).toBeVisible();
  await expect(page.getByText("10 demi-journée(s) × 4 heures × 60 à 80 spectres par heure")).toBeVisible();

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
  await expect(page.getByText(/Quantité de spectres indicative : 600 à 1\s?000 spectres\./)).toBeVisible();
  await expect(page.getByText("Petite zone couverte par une goutte déposée sur la fenêtre de mesure.")).toBeVisible();

  await expectNoBrowserErrors(errors);
});

test("capacité MicroNIR mesure directe n'affiche pas zero spectre par heure", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_viavi_micronir");

  await configureCapacity(page, "direct_measurement", 1);
  await expect(page.getByText(/Quantité de spectres indicative : 320 à 400 spectres\./)).toBeVisible();
  await expect(page.locator(".spectral-capacity")).not.toContainText("0 à 0");
  await expect(page.locator(".spectral-capacity")).toContainText("1 demi-journée(s) × 4 heures × 80 à 100 spectres par heure");

  await expectNoBrowserErrors(errors);
});

test("capacité TANGO coupelle", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_bruker_tango");

  await expect(page.getByLabel("Sonde ou dispositif de mesure")).toHaveText(/Mesure directe.*Coupelle 5 cm.*Coupelle 9 cm.*Pilulier/s);
  await configureCapacity(page, "cup_9cm", 10);
  await expect(page.getByText(/Quantité de spectres indicative : 1\s?200 à 2\s?400 spectres\./)).toBeVisible();
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
  await expect(page.getByText(/Quantité de spectres indicative : 600 à 1\s?000 spectres\./)).toBeVisible();
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
  await expect(page.getByText(/Quantité de spectres indicative : 600 à 1\s?000 spectres\./)).toBeVisible();
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
      items: [{ id: "item-1", requestType: "spectra_acquisition", answers: { requestType: "spectra_acquisition", samples: 100, ...answers }, completed: true }]
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
  await expect(page.locator('.global-person-row').getByText("Formation effectuée")).toBeVisible();
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

  await expect(page.locator('[data-navigation-requirements]').getByText(/Ajoutez au moins un utilisateur pour PerkinElmer/)).toBeVisible();
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
  await expect(panel.getByLabel("Spectres déjà acquis")).toHaveCount(0);
  await expect(panel.getByLabel("Préparation et nettoyage des données")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Fiabilité et domaine d’application des prédictions" })).toBeVisible();
  await expect(panel).toContainText("la justesse des valeurs prédites n’est pas vérifiée expérimentalement");
  await expect(panel).not.toContainText("suspendre la restitution");
  await expect(panel).toContainText("Pour connaître les modèles prédictifs et les traits disponibles");

  await expectNoBrowserErrors(errors);
});

test("volumes d’acquisition, tarif inchangé et reprise complète du brouillon", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.goto(testInfo.project.use.baseURL, { waitUntil: "domcontentloaded" });
  await continueToCatalog(page, "public_research_lab");
  await page.locator('[data-add-card="spectra_asd_labspec"]').click();
  await page.locator('[data-go-config]').click();
  await page.locator('input[data-field-id="serviceMode"][value="plateau_operated"]').check();
  const halfDays = page.getByLabel("Nombre de demi-journées réservées");
  const samples = page.getByLabel("Nombre estimé d’échantillons indépendants");
  const replicates = page.getByLabel("Répétitions spectrales par échantillon", { exact: true });
  await expect(halfDays).toHaveAttribute("required", "");
  await expect(samples).toHaveAttribute("aria-required", "true");
  await expect(samples).toHaveValue("");
  await expect(replicates).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Continuer" })).toBeDisabled();
  await samples.fill("48");
  await samples.dispatchEvent("change");
  const amount = await page.locator("#live-estimate strong").first().textContent();
  await samples.fill("120");
  await samples.dispatchEvent("change");
  await replicates.fill("3");
  await replicates.dispatchEvent("change");
  await expect(page.locator("#live-estimate strong").first()).toHaveText(amount);
  await expect(page.locator('.field-section').filter({ has: samples })).toContainText("vaisselle ou d’aspiration");
  await page.screenshot({ path: testInfo.outputPath("volume-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("volume-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Reprendre le brouillon" }).click();
  await expect(samples).toHaveValue("120");
  await expect(replicates).toHaveValue("3");
  await progressStep(page, "Votre demande").click();
  await expect(page.locator('[data-requester-field="email"]')).toHaveValue("alice.martin@example.test");
  await expect(page.locator('input[name="context"][value="public_research_lab"]')).toBeChecked();
  await expectNoBrowserErrors(errors);
});

test("une fibre ASD historique exige de choisir une sonde sans perdre les volumes", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.addInitScript(() => localStorage.setItem("nirs_spir_quote_draft_v2", JSON.stringify({
    schemaVersion: 8, currentStep: 3, context: "internal_agap", people: [],
    items: [{ id: "legacy-asd", requestType: "spectra_acquisition", answers: {
      instrument: "asd_labspec", serviceMode: "plateau_operated", halfDays: 1,
      measurementDevice: "optical_fiber", legacySpectraDetails: { samples: 42, replicates: 3 }
    } }]
  })));
  await page.goto(testInfo.project.use.baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Reprendre le brouillon" }).click();
  await expect(page.getByLabel("Sonde ou dispositif de mesure")).toHaveValue("");
  await expect(page.getByText(/L’ancien dispositif « fibre optique »/)).toBeVisible();
  await expect(page.getByLabel("Nombre estimé d’échantillons indépendants")).toHaveValue("42");
  await page.getByLabel("Sonde ou dispositif de mesure").selectOption("microprobe_03cm");
  await expect(page.getByText(/L’ancien dispositif « fibre optique »/)).toHaveCount(0);
  await expect(page.locator(".spectral-capacity")).toContainText("240 à 320 spectres");
  await expectNoBrowserErrors(errors);
});

for (const extraPredictions of [0, 18]) {
test(`PDF conserve les volumes et les réserves scientifiques de prédiction${extraPredictions ? " sur vingt prestations" : ""}`, async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await openApp(page, testInfo);
  await page.evaluate(() => globalThis.NIRSApp.loadScriptOnce("./vendor/jspdf.umd.min.js", "jspdf"));
  const generated = await page.evaluate((extraPredictions) => {
    const app = globalThis.NIRSApp;
    const config = globalThis.NIRS_CONFIG;
    const state = {
      quoteId: "document-nirs-ms", context: "internal_agap", urgent: false, people: [],
      requester: { firstName: "Alice", lastName: "Martin", unit: "AGAP", email: "alice@example.test", organization: "CIRAD" },
      project: { title: "Contrôle d’un lot d’arachides", plannedStartDate: "2027-01-11", plannedEndDate: "2027-01-12" },
      items: [
        { id: "spectra", requestType: "spectra_acquisition", answers: { ...app.defaultAnswersForRequest(config.prestations, "spectra_acquisition"), instrument: "asd_labspec", measurementDevice: "contact_probe_2cm", serviceMode: "plateau_operated", halfDays: 2, samples: 120, replicates: 2 } },
        { id: "predict", requestType: "existing_model_predictions", answers: { ...app.defaultAnswersForRequest(config.prestations, "existing_model_predictions"), predictionMode: "with_reference", samples: 120, referenceProperties: ["starch", "protein"], models: 2, spectra: 240, comment: "Modèles amidon et protéines à vérifier sur une nouvelle campagne d’arachides." } }
      ]
    };
    for (let index = 0; index < extraPredictions; index += 1) {
      state.items.push({ ...structuredClone(state.items[1]), id: `prediction-${index}` });
    }
    const result = app.calculateQuote(config, state);
    const vm = app.buildPdfViewModel(config, state, result);
    const originalPdf = globalThis.jspdf.jsPDF;
    const records = [];
    globalThis.jspdf.jsPDF = function (...args) {
      const doc = new originalPdf(...args);
      const drawText = doc.text.bind(doc);
      doc.text = function (text, x, y, options = {}) {
        const size = doc.getFontSize();
        const lines = Array.isArray(text) ? text : String(text).split("\n");
        lines.forEach((line, index) => {
          if (!String(line).trim()) return;
          const width = doc.getTextWidth(line);
          const left = options.align === "right" ? x - width : x;
          records.push({ text: line, left, right: left + width, baseline: y + index * size * 0.3528 * (options.lineHeightFactor || doc.getLineHeightFactor()), size, page: doc.internal.getCurrentPageInfo().pageNumber });
        });
        return drawText(text, x, y, options);
      };
      return doc;
    };
    try {
      const pdf = app.createPdfA4(state, result, config);
      const overlaps = [];
      records.forEach((a, index) => records.slice(index + 1).forEach((b) => {
        if (a.page === b.page && Math.abs(a.baseline - b.baseline) < Math.min(a.size, b.size) * 0.3528 * 0.75 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.2) overlaps.push([a.text, b.text]);
      }));
      return { data: pdf.output("datauristring").split(",")[1], pages: pdf.getNumberOfPages(), summaries: vm.serviceSummaries, clauses: vm.predictionClauses, overlaps, outOfBounds: records.filter((record) => record.left < 10 || record.right > 200 || record.baseline > 274) };
    } finally {
      globalThis.jspdf.jsPDF = originalPdf;
    }
  }, extraPredictions);
  expect(generated.pages).toBeGreaterThan(0);
  if (extraPredictions) expect(generated.pages).toBeGreaterThan(2);
  expect(generated.summaries[0]).toContain("120 échantillon(s) estimé(s)");
  expect(generated.clauses).toHaveLength(3);
  expect(generated.overlaps).toEqual([]);
  expect(generated.outOfBounds).toEqual([]);
  const pdfPath = testInfo.outputPath("predevis-nirs-ms.pdf");
  await writeFile(pdfPath, Buffer.from(generated.data, "base64"));
  await testInfo.attach("predevis-nirs-ms.pdf", { path: pdfPath, contentType: "application/pdf" });
  await expectNoBrowserErrors(errors);
});
}

test("une offre Prédire, répétitions, limite des traits et reprise du brouillon", async ({ page }, testInfo) => {
  const errors = collectBrowserErrors(page);
  await page.goto(testInfo.project.use.baseURL, { waitUntil: "domcontentloaded" });
  await continueToCatalog(page, "partnership");
  await expect(page.getByRole('heading', { name: "Prédire", exact: true })).toHaveCount(1);
  await expect(page.locator('[data-add-card="predict_with_reference"]')).toHaveCount(0);
  await addCardAndGoToConfig(page, "predict");
  const samples = page.getByLabel("Nombre estimé d’échantillons indépendants à prédire");
  await expect(samples).toHaveAttribute("readonly", "");
  await page.getByLabel("Prédictions avec vérification biochimique", { exact: true }).check();
  await expect(page.locator('input[data-field-id="predictionMode"][value="with_reference"]')).toBeChecked();
  await page.locator('input[name="spectra"]').fill("300");
  await page.locator('input[name="spectra"]').dispatchEvent("change");
  await page.locator('input[name="replicates"]').fill("3");
  await page.locator('input[name="replicates"]').dispatchEvent("change");
  await expect(samples).toHaveValue("100");
  await page.getByLabel("Amidon", { exact: true }).check();
  await expect(page.getByLabel("Protéines", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Autre propriété, sur devis", { exact: true })).toBeDisabled();
  await page.locator('input[name="models"]').fill("2");
  await page.locator('input[name="models"]').dispatchEvent("change");
  await page.getByLabel("Protéines", { exact: true }).check();
  await expect(page.getByLabel("Autre propriété, sur devis", { exact: true })).toBeDisabled();
  const comment = page.getByLabel("Informations utiles pour préparer la discussion");
  await comment.fill("X");
  await comment.dispatchEvent("change");
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await expect(page.locator('[data-navigation-requirements]')).toBeHidden();
  await page.locator('input[name="models"]').fill("1");
  await page.locator('input[name="models"]').dispatchEvent("change");
  await expect(page.getByRole("button", { name: "Continuer" })).toBeDisabled();
  await expect(page.locator('[data-navigation-requirements]')).toContainText("Retirez les sélections en trop");
  await expect(page.getByLabel("Protéines", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Protéines", { exact: true })).toBeEnabled();
  await page.locator('input[name="models"]').fill("2");
  await page.locator('input[name="models"]').dispatchEvent("change");
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await expect(page.locator('[data-panel-body]')).toContainText(/sur 10\s*%/);
  await expect(page.locator('[data-panel-body]')).toContainText("plafonnés à 100 échantillons");
  await expect(page.locator('[data-panel-body]')).toContainText("discuté en amont");
  await expect(page.locator('[data-panel-body]')).not.toContainText("nouveaux spectres (X)");
  await expect(page.locator('[data-panel-body]')).not.toContainText("nouvelles valeurs de référence (Y)");
  await expect(page.locator('[data-panel-body]')).toContainText("validée avec le demandeur");
  await expect(page.locator('[data-panel-body]')).not.toContainText("la justesse des valeurs prédites n’est pas vérifiée expérimentalement");
  await page.screenshot({ path: testInfo.outputPath("prediction-references-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("prediction-references-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Reprendre le brouillon" }).click();
  await expect(samples).toHaveValue("100");
  await expect(page.locator('input[name="replicates"]')).toHaveValue("3");
  await expect(page.getByLabel("Amidon", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Protéines", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator('.table-wrap')).toContainText(/Chimie humide.*amidon/);
  await expect(page.locator('.table-wrap')).toContainText("10 analyses pour 100 échantillons indépendants");
  await expect(page.locator('#live-estimate strong').first()).not.toHaveText("Sur devis");
  await expect(page.locator('.warning-list')).toContainText("à l’issue du diagnostic");
  await expect(page.locator('.warning-list')).not.toContainText("nouveaux spectres (X)");
  await expect(page.locator('#live-estimate [data-range-explanation]')).toContainText(/plafond\s*: ±15/);
  await expect(page.locator('.quote-total [data-range-explanation]')).toContainText(/plafond\s*: ±15/);
  await expect(page.locator('.table-wrap')).toContainText(/20\s*€ par analyse/);
  await expect(page.locator('.table-wrap')).toContainText(/50\s*€ par analyse/);
  await page.getByRole("button", { name: "Retour", exact: true }).click();
  await page.locator('input[data-field-id="predictionMode"][value="without_reference"]').check();
  await expect(samples).toHaveValue("100");
  await expect(page.getByLabel("Amidon", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-panel-body]')).toContainText("la justesse des valeurs prédites n’est pas vérifiée expérimentalement");
  await expect(page.locator('#live-estimate strong').first()).not.toHaveText("Sur devis");
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await expectNoBrowserErrors(errors);
});

const MAINTENANCE_CASES = [
  ["performance_audit", "Auditer les performances", /1\s*148\s*€.*1\s*553\s*€/],
  ["contextual_validation", "Valider dans un nouveau contexte", /1\s*893\s*€.*2\s*562\s*€/],
  ["bias_correction", "Corriger un biais", /1\s*148\s*€.*1\s*553\s*€/],
  ["model_update", "Mettre à jour ou étendre le modèle", /2\s*869\s*€.*3\s*881\s*€/],
  ["instrument_transfer", "Transférer vers un autre spectromètre", /2\s*295\s*€.*3\s*105\s*€/]
];

test("audit : la saisie lente des demi-journées conserve le focus et actualise la capacité", async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "spectra_bruker_tango");
  await page.locator('input[data-field-id="serviceMode"][value="plateau_operated"]').check();
  const field = page.locator('input[name="halfDays"]');
  const original = await field.elementHandle();
  await field.fill("");
  await field.pressSequentially("12", { delay: 350 });
  await expect(field).toHaveValue("12");
  await expect(field).toBeFocused();
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.locator('.spectral-capacity')).toContainText("12 demi-journée(s)");
  const capacityAfterDevice = await page.locator('select[name="measurementDevice"]').evaluate((control) => {
    const capacity = control.closest('.field').querySelector('[data-spectral-capacity]');
    return Boolean(capacity && control.compareDocumentPosition(capacity) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(capacityAfterDevice).toBe(true);
  await field.fill("");
  await field.dispatchEvent("change");
  await page.locator('input[name="samples"]').click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.fill("2");
  await field.dispatchEvent("change");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  expect(await original.evaluate((node) => node.isConnected)).toBe(true);
});

test("audit : les textes saisis restent du texte dans la configuration et le résumé", async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await fillRequestStep(page);
  const payload = '<svg data-audit-markup onload="globalThis.__auditMarkup=true">Texte de projet</svg>';
  await page.locator('[data-project-field="title"]').fill(payload);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await addCardAndGoToConfig(page, "predict");
  await page.getByLabel("Informations utiles pour préparer la discussion").fill(payload);
  await page.getByLabel("Informations utiles pour préparer la discussion").dispatchEvent("change");
  await progressStep(page, "Composer").click();
  await progressStep(page, "Configurer").click();
  await expect(page.locator('[data-item-summary]')).toContainText(payload);
  await expect(page.locator('[data-audit-markup]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.locator('#quote-title')).toBeVisible();
  await expect(page.locator('.quote-head')).toContainText(payload);
  await expect(page.locator('.item-summary-list')).toContainText(payload);
  await expect(page.locator('[data-audit-markup]')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__auditMarkup)).toBeUndefined();
});

test("audit : une prédiction ne peut pas continuer avec un volume obligatoire vide", async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await continueToCatalog(page);
  await addCardAndGoToConfig(page, "predict");
  await page.getByLabel("Informations utiles pour préparer la discussion").fill("Description suffisante pour préparer le pré-devis de prédiction.");
  await page.getByLabel("Informations utiles pour préparer la discussion").dispatchEvent("change");
  for (const name of ["spectra", "models", "replicates"]) {
    const field = page.locator(`input[name="${name}"]`);
    await field.fill("");
    await field.dispatchEvent("change");
    await expect(page.getByRole('button', { name: 'Continuer' })).toBeDisabled();
    await expect(page.locator('[data-navigation-requirements]')).toContainText("Complétez le champ");
    await field.fill("100");
    await field.dispatchEvent("change");
  }
});

test("un brouillon de prédiction ancien conserve ses échantillons sans acquisition implicite", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("nirs_spir_quote_draft_v2", JSON.stringify({
    schemaVersion: 8, currentStep: 3, context: "internal_agap", people: [],
    items: [{ id: "legacy-predict", requestType: "existing_model_predictions", answers: {
      instrument: "viavi_micronir", predictionMode: "with_reference", spectra: 300, samples: 100,
      models: 1, referenceProperties: ["starch"], spectraAlreadyAcquired: false, comment: "X"
    } }]
  })));
  await page.goto(testInfo.project.use.baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Reprendre le brouillon" }).click();
  await expect(page.locator('input[name="replicates"]')).toHaveValue("3");
  await expect(page.locator('input[name="samples"]')).toHaveValue("100");
  await expect(page.getByLabel("Spectres déjà acquis")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator('.table-wrap')).toContainText("10 analyses pour 100 échantillons indépendants");
  await expect(page.locator('.table-wrap')).not.toContainText("Acquisition des spectres");
});

test("Continuer grisé indique les informations manquantes à chaque étape", async ({ page }, testInfo) => {
  await openApp(page, testInfo);
  await expect(page.locator('[data-navigation-requirements]')).toContainText("Renseignez votre prénom");
  await fillRequestStep(page);
  await expect(page.locator('[data-navigation-requirements]')).toBeHidden();
  await page.getByRole("button", { name: "Continuer" }).click();
  await expect(page.locator('[data-navigation-requirements]')).toContainText("Ajoutez au moins une prestation");
  await addCardAndGoToConfig(page, "predict");
  await expect(page.locator('[data-navigation-requirements]')).toContainText("Informations utiles pour préparer la discussion");
  await page.getByLabel("Informations utiles pour préparer la discussion").fill("X");
  await expect(page.locator('[data-navigation-requirements]')).toBeHidden();
  await expect(page.getByRole("button", { name: "Continuer" })).toBeEnabled();
});

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
