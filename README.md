# Suivi des tests produit

Application web destinée à organiser les demandes de tests réalisées en laboratoire sur des produits et à centraliser leur suivi, leurs résultats et leur validation.

> **État du projet :** première version du MVP en cours de développement. Le déploiement sur le serveur du cours se lance manuellement depuis GitHub Actions.

## Contexte

Les demandes de tests sont souvent traitées dans l'urgence et les équipes de laboratoire sont difficiles à intégrer au cycle de développement produit. Le suivi dispersé des demandes et des résultats complique leur exploitation par les ingénieurs produits et peut retarder les décisions de développement.

L'application doit fournir un espace partagé entre les ingénieurs produits et les opérateurs de laboratoire, depuis la création d'une demande jusqu'à la validation de son résultat.

## Objectifs du MVP

- Centraliser les demandes de tests sur les produits.
- Rendre visibles leur planification et leur avancement.
- Permettre aux opérateurs de consigner un verdict et un commentaire.
- Faire valider et clôturer les résultats par l'ingénieur à l'origine de la demande.
- Conserver les informations de demande et de résultat dans une base de données relationnelle.

## Utilisateurs et responsabilités

| Profil | Responsabilités |
|---|---|
| **Ingénieur produit (demandeur)** | Créer une demande, suivre son avancement, consulter le résultat, puis le valider et clôturer la demande. |
| **Opérateur de laboratoire (testeur)** | Consulter les demandes, les planifier, réaliser les tests et saisir le verdict ainsi qu'un commentaire. |

L'application comporte une authentification avec des rôles distincts. Les autorisations doivent être vérifiées côté serveur, et pas uniquement masquées dans l'interface.

## Parcours d'une demande

1. L'ingénieur produit crée une demande avec les informations nécessaires au laboratoire.
2. L'opérateur planifie le test et fait avancer la demande.
3. Après la réalisation du test, l'opérateur saisit un verdict **Conforme** ou **Non conforme** et un commentaire.
4. La demande passe en attente de validation.
5. L'ingénieur demandeur valide le résultat et clôture la demande.

### Statuts

`Demandée` → `Planifiée` → `En cours` → `À valider` → `Terminée`

Le verdict (Conforme ou Non conforme) est enregistré avec le résultat et reste consultable après la clôture.

## Informations suivies

### Demande de test

| Information | Description |
|---|---|
| Référence produit | Identifiant du produit à tester. |
| Quantité | Nombre d'échantillons ou d'unités concernés. |
| Catégorie produit | Body protection, maintien articulaire ou casque. |
| Famille de test | Type d'essai demandé, par exemple Impact, Thermique ou Mécanique. |
| Date limite | Date à laquelle le test doit être réalisé au plus tard. |
| Priorité | Niveau d'urgence de la demande. |
| Opérateur assigné | Opérateur responsable, choisi à la création ; facultatif si la demande reste ouverte à l'équipe. |
| Planification | Date planifiée et opérateur en charge du test. |
| Demandeur et dates de suivi | Informations de création et de mise à jour conservées par l'application. |

### Résultat

- Verdict : **Conforme** ou **Non conforme**.
- Commentaire de l'opérateur.
- Informations de saisie et de validation nécessaires au suivi.

Le MVP ne demande pas de formulaire de mesures numériques, de seuils de conformité ou de pièces jointes. Ces éléments pourront être étudiés ultérieurement.

## Familles de tests

Le MVP démarre avec les familles suivantes :

- Impact
- Thermique
- Mécanique

Les demandes sont également classées par catégorie produit : **Body protection**, **maintien articulaire** ou **casque**.

La conception devra permettre de faire évoluer cette liste sans remettre en cause le parcours général d'une demande.

## Règles métier principales

- Une demande est créée par un ingénieur produit authentifié.
- Une demande identifie son produit, sa quantité, sa famille de test, sa priorité et sa date limite.
- Le demandeur peut assigner un opérateur existant à la création ; sinon, tout opérateur disponible peut planifier la demande.
- Une demande déjà assignée ne peut être planifiée que par l'opérateur désigné.
- L'opérateur renseigne le verdict et son commentaire avant l'envoi en validation.
- Seul l'ingénieur demandeur valide et clôture sa demande.
- Une demande non clôturée conserve son statut d'avancement ; une demande clôturée conserve son verdict final.

## Architecture et technologies

| Composant | Technologie |
|---|---|
| Frontend | React |
| Backend | Node.js |
| Framework backend | Express |
| Base de données | PostgreSQL |

Le frontend communique avec l'API Express, qui porte la logique métier, l'authentification, les autorisations et l'accès à PostgreSQL.

## Installation et lancement

### Prérequis

- Node.js 24 et npm.
- Docker avec Docker Compose, pour lancer PostgreSQL localement.

### Développement local

```bash
npm ci
cp .env.example .env
```

Remplacez `POSTGRES_PASSWORD` et `DATABASE_URL` dans `.env` par des valeurs locales cohérentes. Ne publiez jamais ce fichier.

```bash
docker compose up -d db
npm run db:migrate
npm run dev:api
```

Dans un second terminal :

```bash
npm run dev
```

Ouvrez ensuite [http://localhost:5173](http://localhost:5173). L’API est disponible sur le port `3000` et le frontend Vite relaie les appels `/api`.

Pour lancer l’application compilée avec sa base locale :

```bash
docker compose up --build
```

L’application est alors disponible sur [http://localhost:3000](http://localhost:3000). La migration SQL idempotente est exécutée au démarrage.

### Comptes

- À l’inscription, choisissez **ingénieur produit** ou **ingénieur essais**. Le compte est actif immédiatement ; l’ingénieur essais peut alors accéder au tableau du laboratoire.
- À la connexion, choisissez **Ingénieur produit** ou **Ingénieur essais**. Le serveur vérifie que le profil choisi correspond au rôle réel du compte. Les comptes historiquement nommés « opérateur » restent les comptes d’ingénieur essais et conservent leurs identifiants.
- L’espace ingénieur essais affiche un tableau filtrable par statut, les dates de création, de planification et d’échéance, ainsi que des alertes pour les tests non terminés en retard ou dus dans les 7 jours. Le filtre **Passées** regroupe les tests réalisés en attente de validation et ceux déjà validés ; **Validées** ne contient que les demandes clôturées.
- La migration ajoute les comptes opérateurs préconfigurés suivants, sans mot de passe :

  | Opérateur | Adresse de connexion |
  |---|---|
  | Thibaut | `test+thibaut@decathlon.com` |
  | Nathan | `test+nathan@decathlon.com` |
  | Estelle | `test+estelle@decathlon.com` |
  | Louise | `test+louise@decathlon.com` |
  | Nicolas | `test+nicolas@decathlon.com` |

- Dans **Équipe opératrice**, un ingénieur peut activer un compte. Le mot de passe temporaire est affiché une seule fois : transmettez-le à l’opérateur par un canal privé. À sa première connexion, l’opérateur doit le remplacer par un mot de passe d’au moins 12 caractères avant d’accéder aux demandes.
- Vérifiez que les alias `test+nom@decathlon.com` sont bien distribués à la boîte de réception prévue. Aucun courriel d’activation n’est envoyé automatiquement.
- Les comptes ingénieurs essais créés depuis le formulaire sont actifs immédiatement et apparaissent dans l’équipe opératrice. Les comptes prédéfinis ci-dessus restent inactifs jusqu’à leur activation par un ingénieur produit. Pour créer un compte opérateur supplémentaire en local sans passer par le formulaire, ajoutez temporairement `OPERATOR_NAME`, `OPERATOR_EMAIL` et `OPERATOR_PASSWORD` à votre environnement, puis lancez `npm run users:create-operator`. Le mot de passe doit comporter au moins 12 caractères. Retirez les variables une fois la commande terminée.
- Les mots de passe sont stockés sous forme de hash bcrypt ; les sessions sont conservées en base et le cookie de session est `HttpOnly`.

### Vérifications

```bash
npm test
npm run build
```

La route `GET /api/health` vérifie la disponibilité de PostgreSQL et renvoie uniquement un état de santé.

## Déploiement sur le serveur du cours

Le dépôt contient le Dockerfile, le client de déploiement et les workflows GitHub Actions correspondant au contrat du cours :

- Node.js et Express servent le frontend React compilé et l’API sur le port `3000`.
- L’API est sous `/api`; la route `/api/health` est contrôlée par le serveur.
- PostgreSQL est fourni par l’environnement via `DATABASE_URL`; le pool est limité à quatre connexions.
- Vite compile les ressources avec `IHME_BASE_PATH`, nécessaire pour le chemin d’application `/algo-programmation-ihme/`.

Dans les paramètres **Settings → Secrets and variables → Actions** de ce dépôt, configurez les valeurs personnelles reçues de l’enseignant :

| Type | Nom | Valeur |
|---|---|---|
| Secret | `IHME_DEPLOY_TOKEN` | Jeton de déploiement du fichier d’accès personnel |
| Variable | `IHME_DEPLOY_URL` | URL privée de déploiement du fichier d’accès personnel (chemin `/__deploy/pNN`) |
| Variable | `IHME_BASE_PATH` | `/algo-programmation-ihme/` |

La variable `IHME_DEPLOY_URL` est différente de l’adresse publique de l’application : son chemin se termine par `/__deploy/pNN`, selon la valeur remise dans votre fichier d’accès. Ne copiez jamais le jeton dans le dépôt, dans `.env`, dans une issue ou dans une capture publique. Un push sur `main` exécute les vérifications et publie l’image `ghcr.io/azmlilou-stack/algo-programmation-ihme` dans GHCR sans changer la version en ligne. Pour déployer, ouvrez **Actions → Construire et publier l’image → Run workflow**, sélectionnez `main`, cochez **Déployer cette version après construction** et lancez le workflow.

Le jeton et l’URL complète de déploiement ne sont pas nécessaires au développement local et ne sont pas inclus dans le dépôt.

## Périmètre ultérieur

Les besoins suivants ne font pas partie du MVP défini ici et pourront être priorisés séparément :

- Saisie de mesures détaillées et comparaison à des seuils.
- Ajout de photos ou d'autres pièces jointes.
- Gestion de protocoles de test détaillés.
- Création et administration des familles de tests depuis l'application.

## Auteur

Lilou AZEMA
