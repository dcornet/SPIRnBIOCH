# biochNspir_spir_devis

## Présentation

`biochNspir_spir_devis` est une application web statique développée à titre expérimental pour les besoins internes de l’UMR AGAP et de son plateau d’analyse NIRS/SPIR.

L’application permet aux utilisateurs de décrire une demande, de sélectionner plusieurs prestations et d’obtenir une estimation indicative de leur coût. Elle couvre notamment :

* l’acquisition de spectres ;
* l’utilisation autonome ou accompagnée des instruments ;
* la formation initiale nominative ;
* les études de faisabilité chimiométrique ;
* le développement et la validation de calibrations ;
* les prédictions avec un modèle existant ;
* les transferts de calibration ;
* les corrections de biais ;
* la maintenance des modèles ;
* la qualification instrumentale.

Les instruments actuellement pris en compte sont :

* VIAVI MicroNIR ;
* Bruker TANGO FT-NIR ;
* ASD LabSpec ;
* MIR PerkinElmer FTIR.

## Statut du projet

Cette application est un **prototype interne expérimental**.

Elle est destinée :

* aux personnels de l’UMR AGAP et du CIRAD ;
* aux membres du plateau ;
* aux partenaires expressément autorisés dans le cadre d’un projet ou d’une collaboration.

Elle n’est pas destinée à constituer un service commercial public.

Les montants produits par l’application :

* sont indicatifs ;
* sont exprimés hors taxes sauf mention contraire ;
* ne constituent pas un devis contractuel ;
* doivent être confirmés après analyse scientifique, technique, administrative et contractuelle de la demande ;
* peuvent évoluer avec la grille tarifaire, les moyens disponibles, la nature des échantillons, les données de référence et les délais demandés.

Seuls les devis, conventions ou documents contractuels validés par les personnes habilitées engagent les institutions concernées.

## Fonctionnement

L’application est développée en HTML, CSS, JavaScript et JSON.

Elle fonctionne :

* directement depuis `index.html` ;
* avec un serveur HTTP local ;
* sous la forme d’un site statique compatible avec GitHub Pages.

Elle ne nécessite actuellement :

* aucun serveur applicatif ;
* aucune base de données ;
* aucun compte utilisateur ;
* aucune clé API ;
* aucune transmission automatique des demandes.

Les brouillons sont enregistrés localement dans le navigateur de l’utilisateur. Les exports JSON et PDF sont générés sur son appareil.

## Limites scientifiques

Le plateau met en œuvre les instruments, compétences, logiciels et méthodes jugés adaptés à la demande, dans les limites définies par le devis ou la convention applicable.

Les prestations scientifiques et chimiométriques relèvent d’une **obligation de moyens et non d’une obligation générale de résultat**.

En particulier, l’application ne peut garantir :

* qu’une étude de faisabilité conclura favorablement ;
* qu’une calibration pourra être développée ;
* qu’un modèle atteindra un niveau de performance déterminé ;
* qu’un transfert entre instruments sera possible sans recalibration ;
* qu’un modèle existant restera applicable à de nouvelles matrices, saisons ou conditions de mesure.

La performance d’une calibration dépend notamment :

* de la qualité et de la représentativité des échantillons ;
* de la qualité des analyses de référence ;
* de la variabilité de la matrice ;
* du nombre d’échantillons ;
* du domaine couvert par la calibration ;
* des conditions instrumentales et expérimentales.

## Confidentialité

Aucune donnée confidentielle, sensible ou réglementée ne doit être saisie dans l’application sans dispositif institutionnel approprié.

Toute future fonctionnalité de transmission ou de stockage centralisé devra faire l’objet d’une validation préalable portant notamment sur :

* la sécurité ;
* la protection des données ;
* la confidentialité ;
* les responsabilités institutionnelles ;
* les durées de conservation.

## Licence

Le projet est diffusé sous une licence d’usage interne et expérimental.

Il ne s’agit pas d’une licence open source. La publication, la redistribution, l’exploitation commerciale ou la mise à disposition publique nécessitent une autorisation écrite préalable du titulaire des droits.
