# Movies — front Vue

Front Vue 3 + TypeScript + Vite pour l'API [`movies-api-loadtest`](../movies-api-loadtest/).

- **Accueil** : une seule barre de recherche. Vide : liste paginée de tous les films. À partir de 2 caractères : **recherche réactive** par titre, genre ou année (debounce 300 ms, annulation de l'appel précédent par AbortController, numéro de génération pour ignorer les réponses dépassées ; états idle, waiting, loading, success, empty, error avec « Réessayer »). Le texte est gardé dans l'URL (`?q=`).
- **Détail** d'un film, avec modification et suppression.
- **Formulaire** de création et de modification.
- **Réservation de places** (`/seances/:id`) : plan de salle synchronisé en temps réel par SSE entre tous les onglets ouverts (voir le README de l'API pour le contrat du flux). Pour tester : ouvrir la même séance dans deux onglets, réserver dans l'un, l'autre se met à jour sans rechargement.
- **Brouillon de réservation** (`src/bookingDraft.ts`) : nom, e-mail, téléphone et sièges sélectionnés sont gardés dans le `localStorage` ; si l'API est hors ligne ou la page rechargée, rien n'est perdu. Effacé après une réservation confirmée.
- **Réservation hors ligne** : un clic sur Réserver pendant une panne de l'API met la demande en attente (`booking:pending:<séance>`) ; elle est renvoyée automatiquement au retour de l'API (événement `ready` du flux SSE ou retour du réseau), même après rechargement. Un `requestId` empêche toute double réservation ; sièges pris entre-temps → 409, le visiteur rechoisit.
- **Billet PDF** (« Mes séances ») : chaque réservation propose deux boutons, « Mon billet (PDF) » et « Enregistrer ».
  - Le front récupère le PDF par `fetch`, avec le cookie de session (`src/ticket.ts`).
  - Pour l'affichage, l'onglet s'ouvre avant l'attente. Une fois la réponse vérifiée, il affiche l'URL du serveur et non un `blob:` : le bouton « Télécharger » du lecteur PDF fonctionne alors, avec le bon nom de fichier.
  - Pour l'enregistrement, le fichier porte le nom proposé par le serveur.
  - Chaque erreur (401, 404, 409, 500, hors ligne, réponse qui n'est pas un PDF) devient une phrase, jamais un onglet vide.
  - Contrat et preuves : [`CONVOCATION.md`](../movies-api-loadtest/CONVOCATION.md).
- **Cinémas autour de moi** (`/cinemas`) : « Autour de moi (5 km) » ou une adresse géocodée par l'IGN (`src/geo.ts`, `components/NearbyBar.vue`), liste triée par l'API, carte Leaflet / OpenStreetMap (`components/NearbyMap.vue`). La position est demandée seulement au clic et arrondie à environ 100 m ; chaque refus devient une phrase. Contrat et preuves : [`GEOLOC.md`](../movies-api-loadtest/GEOLOC.md).
- **Test A/B du bouton de réservation** : « Réserver » (A) ou « Choisir cette place » (B), seul le texte change. La variante vient de l'API (`composables/useExperiment.ts`, squelette tant qu'elle est inconnue, A hors test en cas d'échec) ; l'exposition part quand le bouton est visible (`composables/trackExposure.ts`). Détails dans le README de l'API.

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

## Traces et tests

`src/tracing.ts` (appelé par `main.ts`) trace chaque `fetch` : il envoie l'en-tête `traceparent` et exporte les spans vers `/otlp/`, que nginx relaie au collecteur. La saisie d'une recherche est retirée de `url.full`.

```bash
npm test                                  # Vitest + happy-dom : propagation, garde-fou, messages d'erreur, billet PDF
npx playwright install chromium           # une fois
npx playwright test e2e/trace.spec.ts     # pile Docker lancée : trace navigateur → API dans Jaeger
```

## Build

```bash
npm run build      # vérification des types + build dans dist/
```

En production, le front appelle `VITE_API_URL` (par défaut `/api`) : il faut soit servir l'API derrière le même domaine sous `/api`, soit définir `VITE_API_URL` au build et activer CORS sur l'API.
