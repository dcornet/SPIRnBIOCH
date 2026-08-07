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
- La contribution Bioch&SPIR correspond aux composantes offertes et à la part non facturée des composantes négociables. Elle n'est jamais une charge ajoutée.
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

Aucune donnée nominative sensible ne doit être stockée : prénom, nom, courriel, téléphone, référence projet, commentaire libre et noms des utilisateurs ou participants sont exclus du brouillon automatique.

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
