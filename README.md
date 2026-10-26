# Algo-Programmation-IHME
# Suivi Test Produit 

Application web de suivi des demandes et des résultats de tests sur les produits.

## Contexte et objectif

Aujourd'hui, les test du labo sont réalisés dans l'urgence, au dernier moment, et les équipes de test ont du 
mal à s'intégrer au projet développement produit. Les résultats des tests sont mal exploités par les ingénieurs
produits et retardent les délais de développement.
Cette application centralise le processus entre les ingénieurs produits et l'équipe test.

## Utilisateurs

- **Ingénieurs produits** : créent des demandes de tests.
- **Équipe test** : met à jour les demandes avec les résultats.

## Informations d'une demande de test

| Champ | Description |
|---|---|
| Référence produit | Identifiant du produit à tester |
| Quantité à tester | Nombre d'échantillons / de tests |
| Type de test | Type de test demandé |
| Date limite | Date avant laquelle le test doit être réalisé |
| Priorité | Degré d'urgence de la demande |
| Testeur préconisé | Personne recommandée pour réaliser le test |
| Résultat | Approved ou Fail (renseigné par l'équipe test) |

### Ingénieurs produits
- Créer une demande de test (produit concerné, type de test, quantité, date limite)
- Suivre l'avancement de leurs demandes

### Équipe test
- Consulter les demandes en attente
- Saisir le résultat de chaque test : **Approved** ou **Fail**
- Rajouter des commentaires, photos, autre...

## Statuts d'une demande

`Demandée` → `En cours` → `Terminée (Approved / Fail)`

## Technologies

- **Backend** : Node.js
- **Framework** : Express

## Installation et lancement

[À compléter quand le projet sera démarré]

## État du projet

🚧 En cours de conception

## Auteur

Lilou AZEMA
