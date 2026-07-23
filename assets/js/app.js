(function () {
  "use strict";

  const root = document.querySelector("#app");
  const NIRSApp = globalThis.NIRSApp = globalThis.NIRSApp || {};
  const config = globalThis.NIRS_CONFIG;

  if (!config?.tarifs?.metadata || !config?.prestations || !config?.textes) {
    root.innerHTML = `
      <section class="load-error">
        <h1>Chargement impossible</h1>
        <p>La configuration locale générée est absente ou invalide.</p>
        <p>Relancez <code>python tools/generate-runtime-config.py</code>.</p>
      </section>
    `;
    return;
  }

  const expectedVersion = config.tarifs.metadata.version;
  if (!expectedVersion) {
    root.innerHTML = `
      <section class="load-error">
        <h1>Configuration incomplète</h1>
        <p>La version de grille tarifaire est absente.</p>
      </section>
    `;
    return;
  }

  NIRSApp.initForm(config);
})();
