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

Les logos sont intégrés sous forme de data URL pour fonctionner en double-clic et dans le PDF A4.

## Fonctionnement multiprestations

L'état d'une demande est structuré autour d'un tableau `items` :

```json
{
  "quoteId": "identifiant-local",
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
- Le contexte s'applique une seule fois au total global.
- La collaboration affiche valeur technique complète, montant facturé estimatif et contribution scientifique en nature.
- La contribution en nature est une différence, jamais une charge ajoutée.
- La sous-traitance applique son coefficient une seule fois au total.
- L'urgence est appliquée une seule fois au total calculable.
- Le minimum de facturation administratif global est appliqué une seule fois au pré-devis agrégé. Un minimum propre à un lot doit être modélisé explicitement dans la prestation concernée.
- Les instruments portables en utilisation autonome sont réservés à la journée, avec un tarif dérivé du tarif horaire et de `hoursPerDay`.
- La formation autonome est nominative : elle est ajoutée uniquement pour les utilisateurs non formés ou au statut inconnu, puis dédupliquée par utilisateur et par instrument.

## Sauvegarde locale

Un brouillon est sauvegardé automatiquement dans `localStorage`. Au redémarrage, l'utilisateur peut reprendre le brouillon ou recommencer.

Aucune donnée nominative sensible ne doit être stockée : prénom, nom, courriel, téléphone, référence projet, commentaire libre et noms des utilisateurs ou participants sont exclus du brouillon automatique.

## PDF A4

Le bouton `Générer le PDF A4` utilise la bibliothèque locale `vendor/jspdf.umd.min.js`, reprise comme dépendance vendue localement. Aucune ressource distante n'est appelée.

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

## Modifier les tarifs

Modifier uniquement `data/tarifs.json`, puis relancer :

```powershell
python tools/generate-runtime-config.py
```

Mettre à jour `metadata.version` lors d'un changement de grille.

## Ajouter une catégorie

Ajouter une entrée dans `data/prestations.json`, clé `requestGroups`, avec `id`, `label`, `description` et `order`. Associer ensuite les prestations avec `groupId`.

## Ajouter une prestation

1. Ajouter la prestation dans `data/prestations.json`.
2. Déclarer `groupId`, `order`, `allowMultiple`, `shortDescription` et ses champs.
3. Ajouter les tarifs nécessaires dans `data/tarifs.json`.
4. Ajouter la règle dans `assets/js/calculator.js`.
5. Ajouter des tests.
6. Régénérer `generated-config.js`.

## Tests

Avec Node.js installé :

```powershell
node --test
```

ou :

```powershell
npm test
```

Sans Node, vérifier au minimum :

```powershell
python tools/generate-runtime-config.py --check
python -m http.server 8000 --bind 127.0.0.1
```

Puis tester `index.html` en double-clic et `http://127.0.0.1:8000/`.

## GitHub Pages

Le projet reste compatible avec GitHub Pages :

- chemins relatifs ;
- pas de backend ;
- pas de routeur historique ;
- `.nojekyll` présent ;
- publication future depuis la branche principale et la racine du dépôt.

