# Pré-devis NIRS / SPIR

Application statique locale pour composer un pré-devis indicatif NIRS/SPIR avec plusieurs prestations dans une même demande.

Les montants sont indicatifs, hors taxes et non contractuels. Le devis final reste établi après revue scientifique et technique par le plateau.

## Lancement utilisateur

Double-cliquer sur `index.html`.

L'application fonctionne sans serveur HTTP, sans backend et sans envoi de données. Les JSON restent les sources de vérité, mais ils sont regroupés dans `assets/js/generated-config.js` pour permettre l'ouverture directe en `file://`.

## Lancement développement

Un serveur local reste utile pour tester le comportement HTTP et GitHub Pages :

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Puis ouvrir :

```text
http://127.0.0.1:8000/
```

## Génération de la configuration

Après toute modification dans `data/`, relancer :

```powershell
python tools/generate-runtime-config.py
```

Vérifier la synchronisation sans modifier les fichiers :

```powershell
python tools/generate-runtime-config.py --check
```

Le fichier `assets/js/generated-config.js` est généré automatiquement. Ne pas le modifier à la main.

Le générateur lit :

- `data/tarifs.json`
- `data/prestations.json`
- `data/textes.json`
- les logos placés dans `data/`
- `data/bandeau.png` pour le pied de page du PDF

Les logos et le bandeau PDF sont intégrés sous forme de data URL pour fonctionner en double-clic et dans le PDF A4.

## Publication GitHub Pages légère

Ne pas publier tout le dossier de travail comme racine de GitHub Pages. Générer d'abord le dossier public minimal :

```powershell
npm run build:public
```

Puis configurer GitHub Pages pour servir le dossier `docs/`. Ce dossier contient uniquement les fichiers nécessaires à l'application statique : HTML, CSS, JS, icônes, images servies, favicon, image d'accueil et bibliothèques d'export chargées à la demande.

Pour tester le dossier généré avec les mêmes scénarios navigateur :

```powershell
$env:PLAYWRIGHT_ENTRY = "docs/index.html"
npx playwright test
Remove-Item Env:PLAYWRIGHT_ENTRY
```

## Fonctionnement multiprestations

L'état d'une demande est structuré autour d'un tableau `items` :

```json
{
  "quoteId": "identifiant-local",
  "document": {
    "type": "pre_quote",
    "reference": "",
    "fileName": "",
    "sequenceNumber": null,
    "generatedAt": "",
    "validUntil": ""
  },
  "requester": {
    "firstName": "",
    "lastName": "",
    "email": "",
    "organization": "",
    "unit": ""
  },
  "project": {
    "title": "",
    "reference": "",
    "plannedStartDate": "",
    "plannedEndDate": "",
    "phone": "",
    "comment": ""
  },
  "context": "occasional_help",
  "urgent": false,
  "items": [
    {
      "id": "item-unique",
      "requestType": "spectra_acquisition",
      "answers": {},
      "completed": false
    }
  ]
}
```

L'utilisateur peut ajouter plusieurs prestations, ajouter deux fois le même type, configurer chaque ligne, dupliquer, supprimer et obtenir un total global.

## Règles de calcul

- Chaque prestation est calculée séparément.
- Les résultats chiffrables sont additionnés.
- Les lignes `sur devis` restent visibles sans annuler les autres lignes.
- Le modèle suit l'ordre : coût technique de référence, fourchette de discussion, contexte, forfait de gestion, total estimatif.
- La vue client n'affiche pas les coefficients internes ni la ventilation économique détaillée.
- `internal_agap` affiche uniquement le total estimatif après contexte et forfait.
- `subcontracting` affiche uniquement le total estimatif ; l'ajustement de sous-traitance reste interne.
- `partnership` affiche une part facturée indicative à définir, les apports Bioch&SPIR identifiés et la contribution complémentaire possible.
- La contribution Bioch&SPIR correspond aux composantes offertes, notamment le personnel instrumental et les formations. Les autres composantes restent facturées avec leur fourchette technique, sans seconde plage de 50 à 100 %. La contribution n’est jamais une charge ajoutée.
- La contribution en nature est une différence, jamais une charge ajoutée.
- L'urgence est appliquée une seule fois au total calculable.
- Le minimum de facturation administratif global est appliqué une seule fois au pré-devis agrégé. Un minimum propre à un lot doit être modélisé explicitement dans la prestation concernée.
- Les réservations instrumentales en autonomie et accompagnement utilisent le modèle de coût `costModel` défini par instrument dans `data/tarifs.json`. Les anciens taux horaires instrumentaux ne sont plus conservés comme fallback.
- La formation autonome est nominative : elle est ajoutée uniquement pour les utilisateurs non formés ou au statut inconnu, puis dédupliquée par utilisateur et par instrument.

## Séparation client / plateau

L'interface et le PDF client masquent les coefficients, coûts techniques de référence et ventilations internes. Ces informations restent disponibles dans l'export JSON interne `platformPricingAudit` et dans les fonctions prévues pour une fiche de travail plateau.

`data/tarifs.json` est l'unique source de vérité des montants, coefficients, taux et fourchettes modifiables. `pricingGovernance.mutableParameters` documente les principaux chemins à modifier. Après toute modification, exécuter `python tools/generate-runtime-config.py` puis `python tools/generate-runtime-config.py --check`. Le calculateur ne doit pas introduire de valeur économique de repli silencieuse.

Le masquage d'un bouton ou d'une section dans une application statique ne constitue pas une protection d'accès : les données présentes dans les fichiers JavaScript ou JSON peuvent être inspectées par un utilisateur avancé. Une séparation réelle nécessite deux déploiements distincts ou un service authentifié.

## Sauvegarde locale

Un brouillon est sauvegardé automatiquement dans `localStorage`. Au redémarrage, l'utilisateur peut reprendre le brouillon ou recommencer.

Le brouillon conserve les coordonnées du demandeur, le projet, le contexte, les utilisateurs, les prestations et l’étape courante sur cet ordinateur uniquement. Aucune transmission réseau n’est effectuée. Sur un poste partagé, effacer le brouillon après utilisation.

## Ajustements du document NIRS_MS 1

- Les trois dispositifs ASD sont la sonde de contact de 2 cm, la pince à feuille et la microsonde de 0,3 cm. Une ancienne « fibre optique » impose une nouvelle sélection, sans substitution silencieuse.
- Les cadences du tableau fourni sont conservées dans `spectralThroughputProfiles`. Le nom historique `samplesPerHour` désigne ici une cadence de **spectres par heure**, pas un nombre d’échantillons indépendants.
- Le volume d’acquisition exige les demi-journées et le nombre estimé d’échantillons. Les répétitions sont facultatives, proposées à 2. Échantillons et répétitions sont conservés dans le brouillon, le résumé et les exports, sans effet sur le prix instrumental.
- « Vérifier et adapter un modèle » remplace le libellé « Entretenir », sans modifier les identifiants ou les cinq interventions publiques.
- Les prédictions affichent un diagnostic de conformité, les limites d’une absence de validation par référence et la possibilité d’une suspension de restitution après revue scientifique.
- Le catalogue distingue les prédictions sans analyses de référence et avec vérification par chimie humide. Les anciens brouillons sont repris sans analyses de référence, sans ajout automatique de dépenses.

## Prédiction et Chimie Humide 0.3.24

`predictionReferenceAnalyses` dans `data/tarifs.json` pilote les quantités et les tarifs des analyses de référence. Le calcul porte sur 10 % des échantillons indépendants à prédire (`samplingRate.min=max=0.1`), arrondis à l’entier supérieur et plafonnés à 100 échantillons vérifiés par prestation, pour chaque propriété. Il ne porte pas sur les répétitions spectrales. Le programme sera discuté en amont avec le plateau, puis pourra être revu à l’issue du diagnostic des nouveaux spectres (X) et des valeurs de référence disponibles (Y), par comparaison aux données de calibration. Toute modification du nombre d’analyses et de son coût devra être validée avec le demandeur avant les analyses complémentaires. Cette mention est commune au formulaire, au résumé, au PDF et aux exports.

- Amidon : 10 EUR par analyse en interne AGAP, 40 EUR pour les laboratoires publics hors AGAP, 20 EUR en partenariat et 50 EUR en sous-traitance privée.
- Protéines : 50 EUR par analyse, sous-traitée à SELMET, dans tous les contextes.
- Les analyses ne reçoivent ni coefficient de contexte, ni majoration d’urgence, ni seconde marge d’incertitude. Elles restent facturées intégralement en partenariat et ne constituent pas une contribution offerte.
- Les autres propriétés restent sur devis. Une propriété n’est comptée qu’une fois par prestation, même si elle est sélectionnée plusieurs fois dans un ancien export.
- `quantity` / `quantityMax` et `referenceAnalysis` conservent les quantités, taux, prix unitaire et contexte dans le JSON. Le PDF indique le nombre d’analyses et le tarif unitaire ; le XLSX inclut les mêmes informations.

`billedEstimateRangeLimit` impose un plafond global de ±15 % autour du centre de la fourchette, après contexte, urgence, forfait de gestion, minimum et arrondi. Si la variabilité des quantités dépasse ce plafond, le total client passe sur devis, sans tronquer les prix ni inventer un pourcentage intermédiaire de facturation. Le JSON client porte alors `billedEstimate: null` (montant non arrêté, jamais une prestation gratuite) ; le calcul intégral reste dans `platformPricingAudit` et `billingRangeReview.computedEstimate` pour la discussion avec le plateau. Les exports plateau conservent les coûts et les quantités de travail.

En partenariat, personnel et formations offerts restent distincts du montant facturé. Le paramètre historique `billedShare` reste présent pour compatibilité, avec `min=max=1` : aucune seconde plage ne s’ajoute à la fourchette technique. Le devis exact est discuté avec le plateau.

## Audit 0.3.25

Les totaux facturés sont la somme des lignes arrondies affichées, y compris pour les demandes multiprestations. Les prix unitaires facturés et le traitement partenarial des exports sont recalculés après application du contexte. Les champs de volume nécessaires à la prédiction sont obligatoires. La saisie numérique conserve les champs et le focus, tout en actualisant les erreurs et la capacité indicative. Les textes saisis sont affichés comme du texte dans le résumé ; les exports CSV neutralisent les formules présentes dans des commentaires.

## PDF A4

Le bouton `Générer le PDF A4` utilise la bibliothèque locale `vendor/jspdf.umd.min.js`, reprise comme dépendance vendue localement. Aucune ressource distante n'est appelée.

En phase interne actuelle, ce bouton déclenche aussi automatiquement la génération du classeur plateau XLSX lorsque `tarifs.internalExports.autoGenerateWithPdf` vaut `true`. Les deux fichiers utilisent la même référence de pré-devis. Cette règle est transitoire : avant un déploiement public distinguant demandeur et plateau, l'export XLSX interne devra être déplacé côté serveur ou désactivé pour l'utilisateur public.

L'impression navigateur reste disponible avec `Imprimer / enregistrer en PDF`.

## Structure

```text
index.html
404.html
assets/css/
assets/js/
assets/images/parcours-predevis.svg
data/
tests/calculator.test.mjs
tools/generate-runtime-config.py
vendor/jspdf.umd.min.js
```

## Modele de cout instrument 2026.1

Hypotheses de travail a valider avant usage operationnel.

Le modele est parametre dans `data/tarifs.json` avec :

- `instrumentCostModelSettings` pour les hypotheses communes : 7 ans d amortissement, 240 demi-journees centrales, 65 EUR/h pour le personnel plateau, 4 h par demi-journee et repartition egale des couts partages ;
- `autonomousTechnicalSupportRate = 0.1` pour l assistance technique du mode autonome ;
- `instruments.*.costModel` pour le prix de remplacement, les accessoires inclus, les couts annuels, la capacite et les couts directs de chaque spectrometre ;
- `pricing.mode` pour basculer entre `cost_model` et `manual` sans supprimer les hypotheses.

Les modes publics sont `autonomous_supported` et `plateau_operated`. Les anciens `self_service` et `assisted` ne sont conserves que comme alias de migration. Le taux historique `assistedDirectStaffHourlyRate = 32.5` reste dans les donnees comme trace de compatibilite, mais les nouveaux calculs plateau utilisent 4 h x 65 EUR.

## Référentiel tarifaire 0.3.19

- `data/tarifs.json` porte la version `0.3.19` et conserve les hypotheses instrumentales dans `costModel`.
- Les contextes publics sont `internal_agap`, `public_research_lab`, `partnership` et `subcontracting`.
- `public_research_lab` correspond aux laboratoires publics hors UMR AGAP Institut, avec coefficient configure dans le JSON et forfait de gestion de 150 EUR.
- Les modes publics de prise de spectres sont `autonomous_supported` et `plateau_operated`.
- Le transport hors laboratoire pour TANGO et LabSpec est une ligne fixe de 150 EUR non soumise au coefficient de contexte ni a l'urgence.
- Les laboratoires proposes dans le formulaire viennent de `data/labos.csv`, compile dans `assets/js/generated-config.js` par `tools/generate-runtime-config.py`.
- Les formations instrumentales explicites et la formation theorique NIRS sont des prestations actives du catalogue.
