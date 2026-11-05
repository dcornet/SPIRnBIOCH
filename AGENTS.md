# Consignes pour agents de maintenance

- Ne jamais coder un tarif, coefficient, libellé tarifaire ou paramêtre modifiable directement dans JavaScript ou HTML.
- Préserver le schéma de `data/tarifs.json`, notamment `metadata`, `instruments`, `chemometrics`, `options`, `contexts`, `rounding` et `disclaimers`.
- Utiliser des identifiants techniques stables, sans accents ni espaces.
- Ajouter des tests pour chaque nouvelle règle tarifaire ou changement de comportement.
- Maintenir la séparation entre données, calculs, interface, styles et tests.
- Conserver `assets/js/calculator.js` comme moteur pur sans accès au DOM, sans `fetch()` et sans effet de bord.
- Maintenir l'accèssibilite : labels associés, fieldsets, navigation clavier, focus visible, titres hiérarchisés et messages d'erreur proches des champs.
- Ne jamais envoyer de données utilisateur à un serveur.
- Ne pas introduire de backend, de base de données, de service distant, de clé API ou de dépendance externe sans décision explicite.
- Distinguer dans le rendu la valeur technique complète, le montant estimatif facturé et la contribution scientifique en nature.
- Ne jamais additionner la contribution en nature au montant facturé.
- Mettre à jour `metadata.version` dans `data/tarifs.json` lors d'un changement tarifaire.
- Vérifier `node --test` avant de livrer une modification du moteur.
- Conserver les chemins relatifs pour rester compatible GitHub Pages.
- Ne jamais réintroduire de dépendance obligatoire a `fetch()` pour charger la configuration indispensable.
- Ne jamais réintroduire d'import ES dans les scripts directement utilisés par `index.html`, sauf si un vrai processus de génération autonome est mis en place.
- `assets/js/generated-config.js` est généré automatiquement depuis les JSON et les logos de `data/`.
- Toute modification d'un JSON ou d'un logo doit être suivie de `python tools/generate-runtime-config.py`.
- Une demande utilisateur est représentee par un tableau de prestations `items`.
- Les règles de contexte s'appliquent au total global, sauf règle explicitement documentée.
- Toute nouvelle règle multiprestation doit avoir un test.
- Préserver le focus et éviter les rendus complets pendant la saisie, surtout sur les champs numériques.
- Pour `model_maintenance`, conserver les cinq interventions publiques `performance_audit`, `contextual_validation`, `bias_correction`, `model_update` et `instrument_transfer`. Les autres demandes d'entretien doivent passer par `other_chemometrics` ou par les migrations de brouillons.
- Pour `model_maintenance`, le formulaire public ne doit contenir que `maintenanceType` et `maintenanceComment`. Aucun champ masqué ou supprimé ne doit bloquer la validation, le calcul, le résumé, le PDF ou l'export.
- Les cinq interventions d'entretien utilisent `maintenancePricing` : chaque intervention possède un montant technique de référence et reçoit la fourchette standard de ±15 %.
- `classifyInstrumentTransfer()` peut rester un utilitaire de compatibilité historique, mais ne doit plus déterminer la validation, la progression ou le prix du flux public.

## Notes refonte 0.2.0

- Les contextes publics sont `internal_agap`, `partnership` et `subcontracting`; les anciens brouillons `partnership` avant schéma 5 migrent vers `internal_agap`.
- En partenariat, conserver la valeur technique complète et afficher la contribution Bioch&SPIR sans l’ajouter au montant facturé.
- Les frais de gestion administrative sont obligatoires, ajoutés une seule fois après contexte et avant minimum, sans urgence, transport ni coefficient.
- L’urgence est un taux fixe configurable de 15 %, appliqué une seule fois aux lignes techniques chiffrables ; en partenariat elle ne doit pas réintroduire le personnel ou les formations offerts.
- Les réservations autonomes et accompagnées sont en demi-journées de 4 heures.
- `spectralThroughputProfiles` définit les cadences indicatives par spectromètre et dispositif ; elles servent au calcul de capacité en spectres sans modifier le tarif.

## Notes refonte 0.3.14

- Le schéma de brouillon courant est `schemaVersion: 9`.
- Les contextes publics sont `internal_agap`, `public_research_lab`, `partnership` et `subcontracting`.
- `public_research_lab` applique le coefficient academique configure dans `data/tarifs.json` et le forfait de gestion de 150 EUR.
- Les modes publics de prise de spectres sont `autonomous_supported` et `plateau_operated`; les anciens `self_service` et `assisted` restent uniquement des alias de migration.
- Le transport instrument est une ligne fixe `instrument_transport` de 150 EUR pour TANGO et LabSpec hors laboratoire, sans coefficient de contexte ni urgence.
- `data/labos.csv` est compile dans `assets/js/generated-config.js`; modifier ce CSV impose de relancer `python tools/generate-runtime-config.py`.
- La formation instrumentale explicite utilise `initial_training`; la formation theorique NIRS utilise `theoretical_nirs_training`.

## Traçabilité tarifaire

- `data/tarifs.json` est l'unique source de vérité pour les montants, coefficients, taux et fourchettes modifiables.
- Ne pas ajouter de valeur économique de repli dans `calculator.js`; une valeur requise absente doit produire une erreur explicite.
- Les chemins de paramètres critiques sont documentés dans `tarifs.pricingGovernance.mutableParameters`.
- Les prestations `model_maintenance` utilisent `maintenancePricing` et la même fourchette standard de ±15 % que les autres prestations éligibles.
- La prédiction avec modèle existant utilise la fourchette standard de +/-15 %.
- En phase interne, `internalExports.autoGenerateWithPdf=true` impose la génération du XLSX plateau avec le PDF. Prévoir sa désactivation/séparation avant ouverture publique.

## Prédiction Avec Vérification Biochimique

- Conserver `existing_model_predictions` et le champ `predictionMode` (`without_reference` / `with_reference`). Les anciens brouillons restent en mode sans référence par défaut.
- Le catalogue expose une seule carte « Prédire ». Le mode avec ou sans vérification biochimique est choisi dans la configuration.
- Dans les deux modes, `samples` est calculé en lecture seule : `ceil(spectra / replicates)`. Les répétitions sont obligatoires. Les anciennes quantités explicites permettent d'inférer les répétitions si le rapport est entier ; sinon utiliser la valeur par défaut configurée et conserver l'ancienne saisie dans `legacyPredictionAnswers`.
- Le nombre de traits biochimiques sélectionnés ne peut pas dépasser `models`. Si ce dernier diminue, conserver les choix mais bloquer la progression jusqu'à correction explicite.
- `spectraAlreadyAcquired` reste uniquement une donnée historique et ne doit plus ajouter d'acquisition implicite sur devis.
- Les quantités et prix de chimie humide viennent uniquement de `predictionReferenceAnalyses` dans `data/tarifs.json`.
- Calculer les quantités sur les échantillons indépendants à prédire et les arrondir au supérieur, jamais sur le nombre de spectres ou de répétitions. Le taux actif est fixé à 10 % (`samplingRate.min=max=0.1`), plafonné à 100 échantillons vérifiés par prestation, pour chaque propriété.
- Présenter simplement la discussion du programme en amont et sa réévaluation après diagnostic, sans détailler les comparaisons X/Y ni mentionner une suspension de restitution. Toute adaptation du nombre d’analyses et de son coût doit être validée avant les analyses complémentaires.
- Les lignes `predictionReferenceAnalyses` ne reçoivent ni urgence, ni coefficient de contexte, ni marge d’incertitude supplémentaire. Elles restent facturées en partenariat.
- Préserver `quantityMax` et `referenceAnalysis` dans les exports. Ne pas remplacer une fourchette de quantités par une hausse fictive du prix unitaire.
- `billedEstimateRangeLimit` plafonne la fourchette globale à ±15 % après arrondi. Au-delà, le total client reste sur devis et le montant facturable exporté est `null`, jamais zéro. Les coûts calculés restent dans l’audit plateau, sans écrêtage.
- Le partenariat ne doit pas ajouter une seconde plage de 50 à 100 % : `contexts.partnership.billedShare` reste `min=max=1`, après personnel et formations offerts. Le devis exact sera discuté avec le plateau.

## Vérifications Avant Publication

- Le total facturé doit correspondre à la somme des lignes arrondies affichées ; les prix unitaires d’audit doivent refléter le contexte final, jamais une étape intermédiaire.
- Afficher les textes saisis avec `textContent` ou un échappement HTML. Les cellules textuelles CSV ne doivent pas être interprétées comme des formules.
- Avant un push destiné à GitHub Pages, régénérer `docs/` avec `npm run build:public` et vérifier l’application produite, pas uniquement les sources.
