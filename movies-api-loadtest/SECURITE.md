# SECURITE.md — Durcissement de Movies (API, front, nginx, Docker)

Ce document est préparé pour le passage d'une red team. Il liste ce qui est protégé, comment le vérifier et ce qui reste à risque.

Le périmètre couvre :
- `movies-api-loadtest` : l'API Express et MongoDB ;
- `movies-web` : le front Vue et la configuration nginx ;
- `docker-compose.yml`.

## Configuration à faire avant le déploiement

| Variable (`.env`, jamais dans le dépôt) | Rôle | Si elle est absente |
| --- | --- | --- |
| `APP_SECRET` (32 caractères ou plus, `openssl rand -hex 32`) | Signe les jetons d'annulation des réservations faites sans compte | Un secret aléatoire est tiré au démarrage : les jetons déjà donnés ne valent plus après un redémarrage |
| `ADMIN_EMAILS` (liste d'e-mails, séparés par des virgules) | Comptes qui peuvent créer, modifier et supprimer des films, et lire `/ab/metrics` | Aucun administrateur : personne ne peut modifier le catalogue par l'API |
| `TP_TICKETS` | `1` réactive les défauts du TP OpenTelemetry et crée le compte de démonstration, dont le mot de passe est publié dans la doc | `0` : comportement corrigé, aucun compte de démonstration créé |

**À faire avant le passage de la red team**
- Le compte `spectateur@movies.test` existe encore dans le volume MongoDB local, avec son mot de passe publié dans `TRACES.md`. Supprimez-le, ou changez son mot de passe.
- Désignez un administrateur avec un mot de passe robuste, dans `ADMIN_EMAILS`.

## Mesures en place

### Authentification et sessions (`src/routes/auth.ts`)

- **Mots de passe :** hachés avec scrypt (sel de 16 octets par compte). Longueur de 8 à 200 caractères.
- **Jeton de session :** 256 bits aléatoires dans un cookie `HttpOnly`, `Secure` (en production) et `SameSite=Strict`.
  - La base ne garde que l'**empreinte SHA-256** du jeton : une fuite de la base ne donne aucune session.
  - Expiration après 7 jours, avec un index TTL.
  - La déconnexion supprime la session côté serveur.
- **Comptes qui existent ou non :**
  - le message d'échec de connexion est le même, que l'e-mail ou le mot de passe soit faux ;
  - un e-mail inconnu coûte le même calcul scrypt (hachage factice), donc le temps de réponse ne révèle rien.
- **Force brute :**

  | Action | Limite |
  | --- | --- |
  | Connexion, par IP | 20 par minute |
  | Connexion, par e-mail | 10 par 15 min |
  | Inscription, par IP | 5 par heure |
  | Connexion et inscription, devant nginx, par IP | 10 par minute |

  Au-delà, la réponse est `429` avec `Retry-After`.

### Autorisations

| Ressource | Règle | Refus |
| --- | --- | --- |
| `GET /movies…`, `/screenings…` (public) | Lecture libre | — |
| `POST/PUT/DELETE /movies` | Administrateur (`ADMIN_EMAILS`) | 401 sans session, 403 pour un compte ordinaire |
| `GET /ab/metrics` | Administrateur | 401 / 403 |
| `GET /screenings/mine`, historique, billet PDF | Propriétaire de la réservation | 401 ; **404** et non 403 pour celle d'un autre (aucun indice d'existence) |
| `DELETE …/reservations/:bookingId`, réservation d'un compte | Ce compte connecté | 404 |
| `DELETE …/reservations/:bookingId`, réservation sans compte | En-tête `X-Cancel-Token` | 404 |

- **Le jeton d'annulation** est un HMAC-SHA256 du `bookingId` avec `APP_SECRET`, sur 128 bits, vérifié en temps constant. Il est remis seulement à celui qui a réservé.
- **Le `bookingId` seul ne suffit pas :** c'est un ObjectId, prévisible (horodatage, valeur fixe par processus et compteur).
- **Le front** masque les actions d'administration aux comptes ordinaires (boutons, routes `/movies/new` et `/movies/:id/edit`). C'est du confort : la barrière est l'API.

### CSRF (`src/security.ts`)

- **Contrôle de provenance :** toute requête qui modifie (`POST`, `PUT`, `PATCH`, `DELETE`) doit venir de la même origine.
  - `Sec-Fetch-Site` doit valoir `same-origin`, sinon 403.
  - `Origin`, s'il est présent, doit avoir le même hôte que la page ; l'origine `null` est refusée.
- **Pourquoi SameSite ne suffit pas :** `http://localhost:<autre port>` est « même site ». Jaeger ou une autre application locale pourraient donc envoyer le cookie.
- **Type du corps :** il doit être `application/json`, sinon 415. Un formulaire HTML ne peut pas envoyer ce type sans CORS, et l'API n'ouvre pas CORS.
- **Clients hors navigateur :** curl et k6 n'envoient ni `Origin` ni `Sec-Fetch-Site`, ils passent. Ils n'ont de toute façon pas le cookie d'un autre.

### Entrées

- **Corps JSON :** 16 Ko au plus (413 au-delà) et strict. nginx limite aussi les corps à 32 Ko.
- **Films :**
  - **liste blanche** des champs (`title`, `year`, `genres`, `plot`, `poster`) ; tout autre champ donne 400. Pas d'opérateur `$…` ni de `__proto__`, et un nouvel objet est construit à partir des seuls champs autorisés ;
  - longueurs bornées ;
  - année entre 1870 et 2100 ;
  - `poster` est une URL `https://`, sans identifiants.
- **Recherche et filtres :**
  - les expressions régulières sont échappées ;
  - les paramètres font 100 caractères au plus ;
  - la page est limitée à 1000 (pas de `skip` géant).
- **Textes saisis** (nom de compte, nom de réservation, titres) : les caractères de contrôle, de direction (U+202E…) et les séparateurs de ligne sont retirés. Ils servent à maquiller un nom sur un billet, un SMS ou une liste.
- **Messages d'erreur :** ils ne renvoient plus l'identifiant saisi. Les chemins inconnus sont tronqués à 100 caractères.

### Abus et déni de service

| Cible | Limite |
| --- | --- |
| Réservations, par IP | 20 par 10 min |
| SMS de confirmation, par numéro | 3 par heure ; au-delà, la réservation passe sans SMS (évite d'envoyer des SMS en masse vers un tiers) |
| Annulations, par IP | 30 par 10 min |
| Flux SSE ouverts simultanément, par IP | 10 |
| Billets PDF, par compte | 30 par minute |
| Requêtes API, devant nginx, par IP | 20 par seconde (pointe de 40) |
| Connexions simultanées, devant nginx, par IP | 50 |

- **Lenteurs volontaires (Slowloris) :** les délais d'en-tête et de corps nginx sont de 10 s.
- **Adresse IP du client :**
  - Express fait confiance à `X-Forwarded-For` seulement quand la requête vient d'une adresse privée, c'est-à-dire du proxy ;
  - nginx **écrase** cet en-tête avec l'adresse réelle au lieu de le compléter, donc un client ne peut pas usurper son IP.

### En-têtes HTTP

- **API (toutes les réponses) :**
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'…` ;
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` ;
  - `Cross-Origin-Resource-Policy` et `Cross-Origin-Opener-Policy` à `same-origin` ;
  - `Permissions-Policy` restrictive ;
  - `Cache-Control: no-store` par défaut ;
  - pas de `X-Powered-By`.
- **Pages du front (nginx) :**
  - CSP sans script ni style inline :
    `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://data.geopf.fr; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` ;
  - `nosniff`, `DENY`, `no-referrer` ;
  - `Permissions-Policy` : géolocalisation pour la page elle-même seulement, caméra, micro et paiement interdits ;
  - `server_tokens off` (pas de version de nginx) ;
  - fichiers cachés (`/.git`, `/.env`) refusés ;
  - `/otlp/` n'accepte que `POST`.
- **Vérification :** toutes les pages ont été chargées dans Chromium avec cette CSP (accueil, film, réservation, Mes séances, billet, cinémas avec la carte) : aucune violation.

### Front (`movies-web`)

- Pas de `v-html` ni de `innerHTML` : Vue échappe tout le texte affiché.
- **Retour après connexion (`src/safeRedirect.ts`) :** un chemin interne seulement. Sont refusés `//site`, `/\site`, `https:`, `javascript:` et les caractères de contrôle. Ce point est testé.
- **Billet PDF :** récupéré par `fetch` avec vérification du statut et du type. Le nom de fichier ne contient que le numéro de réservation (voir `CONVOCATION.md`).

### Conteneurs (`docker-compose.yml`)

- **API :**
  - processus `node`, pas root ;
  - système de fichiers en **lecture seule** (`/tmp` en mémoire) ;
  - `cap_drop: ALL`, `no-new-privileges` ;
  - limites de processus et de mémoire.
- **Front :** nginx avec seulement les capacités nécessaires (`CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE`), `no-new-privileges` et des limites.
- **Ports :** tous sont publiés sur `127.0.0.1` seulement, jamais sur le réseau.

### Dépendances

- `npm audit` du front : 0 vulnérabilité.
- API : la vulnérabilité **haute** de `body-parser` (déni de service) est corrigée par `npm audit fix`.

## Tests

- **API :** `npm test`, dont `tests/security.test.ts` :
  - en-têtes ;
  - CSRF (autre site, autre port du même site, `Origin` tiers ou `null`, corps de formulaire) ;
  - taille du corps ;
  - limite de fréquence ;
  - jeton d'annulation (absent, faux, d'une autre réservation) ;
  - nettoyage des textes.
- **Front :** `npm test`, dont `src/safeRedirect.test.ts`.
- **Vérifications sur la pile, le 16/11/2026 :**

```
POST /movies sans session                → 401
POST /movies compte ordinaire            → 403 {"error":"Action réservée aux administrateurs"}
POST /auth/logout, Origin: https://evil.example        → 403
POST /auth/logout, Sec-Fetch-Site: same-site           → 403
POST /auth/login, Content-Type: text/plain             → 415
GET  /ab/metrics compte ordinaire        → 403
Set-Cookie: session=…; HttpOnly; Secure; SameSite=Strict
Réservation sans compte → cancelToken ; DELETE sans jeton 404, jeton faux 404, bon jeton 204
14 connexions ratées via nginx : 401 ×6 puis 429 ; 12 directes sur l'API (même e-mail) : 401 ×10 puis 429
```

## Risques restants (connus, assumés ou hors périmètre)

1. **Compteurs en mémoire :** les limites de fréquence et le compteur de flux SSE suffisent avec une instance. Avec plusieurs, il faut un stockage partagé (Redis), et un redémarrage les remet à zéro.
2. **Pas de HTTPS en local :** il faut le mettre en place au déploiement (terminaison TLS, HSTS). Le cookie est déjà `Secure` en production.
3. **MongoDB sans authentification :**
   - elle est publiée sur `127.0.0.1:27018` pour les scripts (seed, sauvegarde) ;
   - l'activer impose de recréer le volume (les variables d'initialisation ne s'appliquent qu'à un volume vide) ;
   - Jaeger (`127.0.0.1:16686`) n'a pas non plus d'authentification ;
   - l'API reste joignable en direct sur `127.0.0.1:8080`, sans les limites de nginx, mais avec les siennes.
4. **Inscription :** elle répond 409 si l'e-mail existe déjà, ce qui permet de savoir qu'un compte existe. Les limites de fréquence freinent cette énumération. La supprimer demanderait une validation par e-mail.
5. **Brouillon de réservation :** il garde nom, e-mail et téléphone dans le `localStorage` du navigateur pour le mode hors ligne. Ce n'est lisible que par du script de la même origine, que la CSP stricte rend très difficile à injecter.
6. **Dépendances :** 5 alertes **modérées** restent dans l'API (`glob` et `minimatch`, via `gcp-metadata`, une dépendance d'OpenTelemetry). Ce code ne reçoit aucune entrée utilisateur.
7. **Pas de journal d'audit des actions d'administration ni de détection d'anomalies :** il faudrait le prévoir avant la production.
