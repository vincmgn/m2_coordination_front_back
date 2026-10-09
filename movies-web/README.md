# Movies — front Vue

Front Vue 3 + TypeScript + Vite pour l'API [`movies-api-loadtest`](../movies-api-loadtest/).

- **Accueil** : une seule barre de recherche. Vide : liste paginée de tous les films. À partir de 2 caractères : **recherche réactive** par titre, genre ou année (debounce 300 ms, annulation de l'appel précédent par AbortController, numéro de génération pour ignorer les réponses dépassées ; états idle, waiting, loading, success, empty, error avec « Réessayer »). Le texte est gardé dans l'URL (`?q=`).
- **Détail** d'un film, avec modification et suppression.
- **Formulaire** de création et de modification.
- **Réservation de places** (`/seances/:id`) : plan de salle synchronisé en temps réel par SSE entre tous les onglets ouverts (voir le README de l'API pour le contrat du flux). Pour tester : ouvrir la même séance dans deux onglets, réserver dans l'un, l'autre se met à jour sans rechargement.

## Lancement

L'API doit tourner (par défaut sur `http://localhost:3000`).

```bash
# Terminal 1 : l'API
cd movies-api-loadtest && npm run dev

# Terminal 2 : le front
cd movies-web
npm install
npm run dev        # http://localhost:5173
```

En dev, Vite relaie `/api/*` vers l'API : le front appelle `/api/movies` et Vite transmet à `http://localhost:3000/movies`. Pas de CORS à configurer.
Si l'API tourne ailleurs : `API_URL=http://localhost:4000 npm run dev`.

## Build

```bash
npm run build      # vérification des types + build dans dist/
```

En production, le front appelle `VITE_API_URL` (par défaut `/api`) : il faut soit servir l'API derrière le même domaine sous `/api`, soit définir `VITE_API_URL` au build et activer CORS sur l'API.
