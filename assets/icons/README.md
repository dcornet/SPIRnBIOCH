# Icônes des prestations NIRS / SPIR

Lot d’icônes SVG originales destiné à l’application interne expérimentale de pré-devis de l’UMR AGAP / Bioch&Spir.

## Fichiers

- `viavi-micronir.svg` — spectromètre NIR portable
- `bruker-tango.svg` — spectromètre FT-NIR de paillasse
- `asd-labspec.svg` — spectromètre NIR avec sonde ou fibre optique
- `mir-perkinelmer.svg` — spectromètre FTIR avec accessoire ATR
- `me-former.svg` — formation à l’utilisation d’un instrument
- `calibrer.svg` — construction et validation d’un modèle
- `predire.svg` — application d’un modèle existant
- `entretenir.svg` — contrôle, correction, mise à jour ou transfert
- `autre-demande.svg` — demande chimiométrique sur mesure

## Caractéristiques

- format vectoriel SVG ;
- fond transparent ;
- dimensions logiques : 64 × 64 ;
- tracé homogène ;
- couleur héritée via `currentColor` ;
- titres et descriptions accessibles intégrés.

## Exemple HTML

```html
<img
  src="./assets/icons/calibrer.svg"
  class="service-card__icon"
  alt=""
  aria-hidden="true"
>
```

## Exemple CSS

```css
.service-card__icon {
  width: 3rem;
  height: 3rem;
  color: var(--category-accent);
}
```

Les icônes sont prévues pour être décoratives lorsque le titre de la carte fournit déjà l’information.
