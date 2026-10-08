# API Movies (sample_mflix)

API REST CRUD en TypeScript (Node.js + Express) sur la collection `movies` de la base d'exemple `sample_mflix` de MongoDB Atlas (driver officiel `mongodb`).

## Installation

Prérequis : Node.js 20+ et un cluster Atlas avec le dataset d'exemple chargé.

```bash
npm install
cp .env.example .env   # puis renseigner MONGODB_URI
```

| Variable      | Obligatoire | Défaut         |
| ------------- | ----------- | -------------- |
| `MONGODB_URI` | oui         | —              |
| `MONGODB_DB`  | non         | `sample_mflix` |
| `PORT`        | non         | `3000`         |

## Lancement

```bash
npm run dev        # nodemon + tsx : exécute src/*.ts directement, recharge à chaque modification

npm run build      # compile src/ vers dist/ avec tsc
npm start          # lance la version compilée (dist/index.js)

npm run typecheck  # vérification des types sans compiler
```

## Endpoints

| Méthode | Route         | Description                                                         |
| ------- | ------------- | ------------------------------------------------------------------- |
| GET     | `/`           | Liste des endpoints (JSON)                                          |
| GET     | `/movies`     | Liste paginée : `page`, `limit` (max 100), filtres `title`, `year`, `genre` |
| GET     | `/movies/genres` | Liste des genres (triée)                                       |
| GET     | `/movies/:id` | Un film complet                                                     |
| POST    | `/movies`     | Crée un film (`title` obligatoire) → 201                            |
| PUT     | `/movies/:id` | Modifie les champs envoyés (les autres sont conservés)              |
| DELETE  | `/movies/:id` | Supprime un film → 204                                              |

- `title` : recherche partielle, insensible à la casse. `genre` : genre exact, insensible à la casse.
- La liste ne renvoie que `_id`, `title`, `year`, `genres`, `imdb.rating` et `poster`.
- Erreurs au format `{ "error": "message" }` : 400 (id ou données invalides), 404 (film ou route absents), 500.

## Exemples

```bash
# Liste paginée
curl "http://localhost:3000/movies?page=2&limit=5"

# Filtres combinés
curl "http://localhost:3000/movies?title=star%20wars&genre=action"
curl "http://localhost:3000/movies?year=1999&limit=10"

# Un film
curl http://localhost:3000/movies/573a1390f29313caabcd42e8

# Création
curl -X POST http://localhost:3000/movies \
  -H "Content-Type: application/json" \
  -d '{"title": "Mon film", "year": 2024, "genres": ["Drama"]}'

# Modification (remplacer <id> par l'_id renvoyé à la création)
curl -X PUT http://localhost:3000/movies/<id> \
  -H "Content-Type: application/json" \
  -d '{"year": 2025, "imdb": {"rating": 7.5}}'

# Suppression
curl -i -X DELETE http://localhost:3000/movies/<id>
```

Réponse de `GET /movies?limit=1` :

```json
{
  "page": 1,
  "limit": 1,
  "total": 21349,
  "totalPages": 21349,
  "data": [
    {
      "_id": "573a1390f29313caabcd42e8",
      "title": "The Great Train Robbery",
      "year": 1903,
      "genres": ["Short", "Western"],
      "poster": "https://m.media-amazon.com/images/M/...jpg",
      "imdb": { "rating": 7.4 }
    }
  ]
}
```

## Test de charge (k6)

k6 est téléchargé dans `.tools/` au premier lancement (rien n'est installé sur la machine). Le scénario `load-tests/movies.ts` ne fait que des GET : il monte jusqu'à 50 utilisateurs virtuels en 1 min 40.

```bash
npm run dev            # l'API doit tourner
npm run load           # dans un autre terminal
npm run load -- -e BASE_URL=http://autre-hote:3000

npm run load:report   # graphes en direct sur http://localhost:5665 + rapport HTML
                      # enregistré dans load-tests/reports/rapport.html

npm run load:max      # débit maximal, sans pause : GET /, puis /movies, puis /movies/:id
                      # rapport dans load-tests/reports/rapport-max.html

npm run load:breakpoint   # test de rupture : débit à partir duquel chaque route ne tient plus
                          # tableau dans load-tests/reports/breakpoint.md

npm run load:paliers      # GET /movies à 5, 10, 20, 50… utilisateurs virtuels, arrêt au 1er palier en échec
                          # tableau dans load-tests/reports/paliers.md
PALIERS="5 10 20" DURATION=15s npm run load:paliers   # paliers et durée personnalisés
```

### Seuils

| Test | Seuils | Si un seuil casse |
| --- | --- | --- |
| `load` / `load:report` | p95 < 800 ms, erreurs < 1 % | la CI échoue |
| `load:max` | par route : débit minimal et p95 maximal (calibrés sur la CI, voir `load-tests/max-throughput.ts`) | la CI échoue : régression |
| `load:paliers` | p95 < 500 ms, erreurs < 1 %, checks 100 % (seuils du TP) | arrêt de la montée en charge : premier palier en échec |
| `load:breakpoint` | p95 < 500 ms, erreurs < 1 %, moins de 50 requêtes abandonnées | k6 s'arrête : c'est le point de rupture (résultat attendu) |

Les seuils de `load:max` sont calibrés pour la base jetable de la CI : en local sur Atlas (bridé), `detail` et `liste` ne les tiennent pas.

### CI (GitHub Actions)

Tous les tests tournent sur une base MongoDB jetable (`npm run seed`, 21 349 films factices). Chaque run affiche un **baromètre W/L** (runs réussis / ratés sur les 20 derniers, météo ☀️ ⛅ 🌧️, série en cours) dans son résumé.

| Workflow | Déclenchement | Contenu | Durée |
| --- | --- | --- | --- |
| `movies-load-test.yml` | chaque push touchant ce dossier | build, types, seuils anti-régression (`load:max`, 10 s par route) | ~1 min 30 |
| `movies-bilan-charge.yml` | manuel (base jetable ou Atlas) et chaque lundi 6 h 43 | progressif, débit maximal, rupture, paliers | ~8 min |
| `perf-suivi.yml` | manuel (charge au choix) et en semaine à 7 h 17 | TP : mesure de `GET /movies` + tickets GitHub Issues | ~3 min |

### Suivi des performances (TP k6 + GitHub Issues)

`.github/workflows/perf-suivi.yml` mesure la lecture `GET /movies` (scénario `load-tests/paliers.ts`, seuils : p95 < 500 ms, erreurs < 1 %, checks 100 %) :

- **manuel** : onglet *Actions* → *Suivi des performances* → *Run workflow*, en choisissant le nombre d'utilisateurs virtuels (5 par défaut) ;
- **programmé** : du lundi au vendredi à 7 h 17 (heure de Paris), avec une charge fixe de 5 utilisateurs virtuels.

`scripts/perf-result.mjs` interprète le run : `ok`, `seuil` (seuil dépassé, le job échoue) ou `technique` (API indisponible, k6 en erreur, résumé absent ou vide : le job échoue aussi, avec un autre message). Le résultat (`result.json`), le résumé k6, le rapport HTML et les journaux sont dans les artifacts, même en cas d'échec.

#### Tickets GitHub Issues (`scripts/perf-issue.mjs`, job `publish`)

| Résultat | Ticket ouvert du même problème | Aucun ticket ouvert |
| --- | --- | --- |
| Seuil dépassé | commentaire « nouvelle occurrence » | création d'un ticket (label `performance`) |
| Seuils respectés | commentaire « retour sous les seuils » (le ticket reste ouvert) | rien |
| Problème technique | rien : les mesures ne permettent pas de conclure | rien |

- **Même problème** : empreinte stable `<!-- perf-fingerprint: <route> | <scénario> -->` dans la description du ticket, cherchée parmi les tickets ouverts du label `performance` (API de liste, pas la recherche, qui indexe avec retard).
- **Jamais de fermeture automatique** : une personne ferme le ticket après analyse ; un dépassement ultérieur ouvre alors un nouveau ticket.
- **Pas de double publication** : `concurrency` exécute les runs l'un après l'autre, et chaque publication porte l'identifiant du run (relancer un run ne publie pas deux fois).
- **Appel GitHub refusé** : 2 nouvelles tentatives pour 429/5xx, sinon erreur explicite et run en échec.
- **Droits** : jeton automatique `GITHUB_TOKEN` (aucune clé dans le dépôt) ; `issues: write` uniquement dans le job `publish`, qui ne lance ni l'API ni k6 ni les dépendances npm.

## Déploiement et rollback (Docker Compose)

`docker-compose.yml` simule un serveur de production : l'API tourne dans une **image versionnée** (`movies-api:v1`, `v2`…) sur http://localhost:8080, MongoDB garde ses données dans le **volume persistant** `mongo-data` (port 27018). Changer de version ne recrée que le conteneur `api` : les données ne sont jamais touchées.

```bash
npm run demo:rollback          # démonstration complète (voir ci-dessous)

npm run deploy -- v2           # déploie une version
npm run rollback               # revient à la version précédente (ou : npm run rollback -- v1)
npm run restore -- backups/<fichier>.archive.gz   # dernier recours : restaure la base

docker compose down            # arrête tout ; SURTOUT PAS « down -v », qui supprime les données
```

**`scripts/deploy.sh <version>`**

1. démarre MongoDB (volume persistant) ;
2. **sauvegarde la base** (`mongodump`, dans `backups/`, les 10 dernières sont gardées) ;
3. construit l'image `movies-api:<version>` ;
4. remplace **uniquement** le conteneur `api` et vérifie que la bonne version répond ;
5. **contrôle k6** (5 VUs, p95 < 500 ms, erreurs < 1 %, checks 100 %) ;
6. si l'étape 4 ou 5 échoue : **rollback automatique** vers la version précédente.

**Deux sortes de retour en arrière :**

| Problème | Solution | Données |
| --- | --- | --- |
| La nouvelle version est lente ou plante, les données sont saines | `rollback` (automatique ou manuel) : on remet l'ancienne image | **aucune perte** : la base n'est pas touchée |
| La nouvelle version a **abîmé les données** | `rollback` puis `restore` de la sauvegarde faite avant le déploiement | les écritures postérieures à la sauvegarde sont perdues (une sauvegarde de l'état abîmé est faite juste avant) |

**Démonstration (`npm run demo:rollback`)** : déploie une v1, crée un film, tente de déployer une `v2-lente` (+800 ms par requête, `ARTIFICIAL_DELAY_MS`), que le contrôle k6 refuse (p95 ≈ 820 ms), revient automatiquement à la v1, puis vérifie : version v1 en service, film créé avant la v2 toujours présent, nombre de films inchangé. L'historique est dans `.deploy/history.log`.
