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

À chaque push touchant ce dossier, `.github/workflows/movies-load-test.yml` lance les quatre tests sur une base MongoDB jetable (`npm run seed`, 21 349 films factices) et publie les tableaux des paliers et de rupture et les résumés dans la page du run, avec les rapports en artifacts. Le bouton **Run workflow** permet de lancer la même chose sur Atlas (secret `MONGODB_URI`).

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
