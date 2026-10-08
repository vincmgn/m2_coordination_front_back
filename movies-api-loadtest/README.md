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
```
