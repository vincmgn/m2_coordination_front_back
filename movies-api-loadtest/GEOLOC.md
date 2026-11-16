# GEOLOC.md — TP Géolocalisation sur Movies

Ce TP est adapté de MediSlot à Movies (`movies-api-loadtest` + `movies-web`). « Un praticien à moins de 5 km » devient **un cinéma à moins de 5 km**. La page « Cinémas autour de moi » propose « Autour de moi (5 km) » et « ou une adresse, un code postal ». L'API mesure, trie et pagine. MongoDB filtre vite. La position n'est gardée nulle part : ni journal, ni base, ni trace.

| | |
| --- | --- |
| Lancer | `cd movies-api-loadtest && docker compose up -d --build api web` |
| Front | http://localhost:8081/cinemas (lien « Cinémas autour de moi ») |
| Tests | API : `npm test` (50, dont 33 pour ce TP). Front : `cd ../movies-web && npm test` (39, dont 13 dans `geo.test.ts`) |

Le kit de départ (`Kit_TP_Geolocalisation_praticiens_depart.zip`) n'était pas disponible : tout est écrit à partir du cours.

**Adaptations à Movies**
- MediSlot a un fichier par élément de la recherche : `DirectoryController`, `NearbyQuery`, `GeoDistance` / `BoundingBox`, `BoxNearbyFinder`, `NearbyService`.
- Movies a l'équivalent dans `src/routes/cinemas.ts`, `src/geo/query.ts`, `src/geo/distance.ts`, `src/geo/finders.ts` et `src/geo/service.ts`.
- La migration V2 et les praticiens de démo deviennent la collection `cinemas`, remplie par `src/geo/cinemas-seed.ts`.
- La spécialité devient l'**équipement** (`feature` : `vo`, `imax`, `pmr`).
- Le défi PostGIS devient son équivalent MongoDB : index `2dsphere` + `$geoNear` (`GEO_FINDER=geonear`).

| Côté | Fichier | Rôle |
| --- | --- | --- |
| API | `src/geo/query.ts` | Contrat, bornes, refus en 400 |
| API | `src/geo/distance.ts` | `haversineKm`, `roundKm`, `boundingBox` |
| API | `src/geo/finders.ts` | `boxFinder` (défaut) et `geoNearFinder` (défi) |
| API | `src/geo/service.ts` | Tri `ORDER`, découpe de la page |
| API | `src/geo/cinemas-seed.ts` | Les 11 cinémas fictifs et leurs index |
| API | `src/routes/cinemas.ts` | `GET /cinemas` |
| Front | `src/geo.ts` | `getPosition`, `roundCoord`, `nearbyParams`, `formatDistance`, `geocode` |
| Front | `src/components/NearbyBar.vue` | Bouton, adresse, messages de refus |
| Front | `src/components/NearbyMap.vue` | Défi carte (Leaflet) |
| Front | `src/views/CinemasNearby.vue` | Page `/cinemas` |
| Front | `nginx.conf` | Journal sans chaîne de requête |

## §1 — Le contrat

```
GET /cinemas?lat=45.758&lon=4.832&radiusKm=5&page=1&limit=6&feature=vo
```

Avec `lat` et `lon`, c'est une recherche « autour de ». Sans eux, c'est l'annuaire complet trié par nom. La forme de page est la même que `GET /movies` : `{ page, limit, total, data }`.

| Paramètre | Unité | Bornes | Si absent | Refus (400, `{ "error": … }`, affiché tel quel) |
| --- | --- | --- | --- | --- |
| `lat` | degrés décimaux WGS 84 | -90 à 90, fini (`NaN`, `Infinity` refusés) | annuaire | « Indiquez lat et lon ensemble. » · « Latitude invalide : entre -90 et 90 degrés. » |
| `lon` | degrés décimaux WGS 84 | -180 à 180, fini | annuaire | « Indiquez lat et lon ensemble. » · « Longitude invalide : entre -180 et 180 degrés. » |
| `radiusKm` | kilomètres | plus de 0, au plus 20 | 5 | « Rayon invalide : plus de 0 et au plus 20 km. » |
| `feature` | code | `vo`, `imax`, `pmr` | tous | « Équipement invalide : vo, imax ou pmr. » |
| `page`, `limit` | entiers | page ≥ 1, limit de 1 à 50 | 1 et 6 | « Pagination invalide : page à partir de 1, limit de 1 à 50. » |
| valeur non numérique (`lat=abc`) | | | | « Paramètre invalide : lat. » (la valeur n'est pas recopiée) |

- **Ordre des refus.** Ils sont vérifiés dans cet ordre, avant toute requête MongoDB (test : aucun `find` n'est lancé). `radiusKm` sans `lat` ni `lon` est refusé.
- **Champs ajoutés à chaque cinéma.** `latitude` et `longitude` donnent la position du **cinéma** (adresse publique). `distanceKm` est à vol d'oiseau, en km, **arrondie au dixième**, et vaut `null` dans l'annuaire.
- **Tri.** Distance **exacte** croissante, puis nom, puis slug. Le tri porte sur tout le cercle, avant la découpe de la page : un cinéma n'apparaît que sur une page. Le front ne trie rien.
- **Total.** `total` compte les cinémas dans le rayon. La réponse ne contient jamais la position reçue.
- **Ordre des nombres.** Le contrat, l'API Geolocation et Leaflet écrivent latitude puis longitude. GeoJSON (géocodeur, champ `location`, `$geoNear`) écrit longitude puis latitude. Chaque passage porte un commentaire.

## §2 — Côté front

**Position du navigateur** (`getPosition`)
- Demandée **seulement après un clic**, jamais au montage de la page.
- Hors contexte sécurisé, elle est refusée tout de suite, sans interroger le navigateur.
- Options : `enableHighAccuracy: false`, `timeout: 10 000` ms, `maximumAge: 300 000` ms.
- Arrondie à 3 décimales (environ 111 m) dès réception.
- Au-delà de 1 km d'incertitude, la page affiche « Position approximative (± x km) ».
- Le centre reste en mémoire : il ne va pas dans l'URL de la page, contrairement à `?q=` de la recherche de films.

**Un message par refus.** Côté front, chacun mène à la saisie d'adresse, qui reçoit le focus.

| Cas | Message |
| --- | --- |
| code 1 (permission refusée) | Localisation refusée. Saisissez une adresse ou un code postal. |
| code 2 (position introuvable) | Position introuvable pour le moment. Saisissez une adresse. |
| code 3 (délai dépassé) | La localisation prend trop de temps. Réessayez ou saisissez une adresse. |
| page non sécurisée | La localisation exige une page sécurisée (HTTPS). Saisissez une adresse ou un code postal. |
| pas d'API Geolocation | Votre navigateur ne sait pas donner votre position. Saisissez une adresse ou un code postal. |
| adresse introuvable, ou score < 0,5 | Adresse introuvable ou trop imprécise. Précisez la ville ou le code postal. |
| géocodeur en 429 | Le service d'adresses est très sollicité. Réessayez dans une seconde. |
| géocodeur en panne | Le service d'adresses ne répond pas. Vérifiez le réseau puis réessayez. |

Les refus de l'API (§1) sont affichés tels quels.

**Géocodage** (`geocode`)
- Appel : `https://data.geopf.fr/geocodage/search?q=…&limit=1` (Géoplateforme de l'IGN, données BAN).
- `coordinates` est lu en **`[lon, lat]`**. Seuil de `score` : 0,5. `label` est affiché.
- **Limite d'usage** : gratuit, sans clé, 50 requêtes par seconde et par adresse IP (`RateLimit-Limit: 50`).
- **Parade** :
  - un cache en mémoire par adresse normalisée (espaces, majuscules) ;
  - un appel seulement à la soumission du champ ;
  - un 429 donne un message, sans mise en cache de l'échec ;
  - aucune boucle d'appels.

## §3 — Côté API et MongoDB

- **Distance.** `haversineKm` : R = 6 371 km, radians dès l'entrée, garde `min(1, √h)`. `roundKm` sert seulement à l'affichage.
- **Collection `cinemas`.** 11 cinémas fictifs sur des lieux publics, géocodés le 16/11/2026 : 7 autour de Lyon, dont 6 à moins de 5 km de Bellecour (Vénissieux est à environ 8 km).
  - La position est stockée deux fois, écrite au même endroit : `latitude` / `longitude` pour la boîte, `location` en GeoJSON `[lon, lat]` pour le défi.
  - Index : `{ latitude: 1, longitude: 1 }`, `{ location: "2dsphere" }`, et `slug` unique.
- **Boîte englobante** (`boxFinder`, défaut).
  - Demi-hauteur `d/R` (0,0450°), demi-largeur `asin(sin(d/R) / cos φ)` (0,0644° à Lyon).
  - Un pôle dans le cercle, ou le passage de l'antiméridien, ouvre toutes les longitudes.
  - MongoDB filtre `latitude`/`longitude` entre `$gte` et `$lte` (plan : `IXSCAN latitude_1_longitude_1`). Le code mesure ensuite et **écarte les coins**, jusqu'à 7,1 km.
- **Défi PostGIS, version MongoDB** (`geoNearFinder`, `GEO_FINDER=geonear`).
  - `$geoNear` sur `location`, avec `maxDistance` en mètres (plan : `GEO_NEAR_2DSPHERE`).
  - Il trouve les mêmes six cinémas que la boîte, à moins de 0,5 % de haversine (la sphère MongoDB fait 6 378,1 km).
- **Défi carte** (`NearbyMap.vue`, Leaflet 1.9.4, chargé à la première carte).
  - Tuiles OpenStreetMap, « © OpenStreetMap contributors » visible, pas de préchargement.
  - Cercle de 5 km, centre, un marqueur par cinéma de la page. Les noms passent en texte, jamais en HTML.
  - La liste reste complète sans la carte.

## §4 — Vie privée : où la position n'est pas gardée, et la preuve

| Endroit | Ce qui est fait | Preuve |
| --- | --- | --- |
| Appareil → réseau | arrondi à 3 décimales avant l'envoi | `geo.test.ts` « Paramètres » ; requête observée `lat=45.758&lon=4.832` pour une position simulée en 45.7576, 4.8317 |
| Front | en mémoire seulement : ni `localStorage`, ni URL de page, ni `console` | relecture de `geo.ts`, `NearbyBar.vue`, `CinemasNearby.vue` |
| Journal nginx | `log_format sans_position` (`$request_method $uri`, sans `$request`, `$request_uri` ni `$args`) sur le serveur et dans `location /api/` | `geoloc-privacy.test.ts` ; ligne relevée : `172.21.0.1 [16/Nov/2026:11:22:40 +0000] "GET /api/cinemas" 400 38`. Effet de bord utile : `?q=` de la recherche de films ne va plus dans le journal non plus. |
| Journal de l'API | aucun `console.*` dans `src/geo/` ni dans `routes/cinemas.ts` ; `lat=abc` nomme le paramètre sans recopier la valeur | `geoloc-privacy.test.ts` ; `docker logs movies-api` : 0 ligne avec une coordonnée |
| Traces (Jaeger) | navigateur : `StripQueryProcessor` coupe `url.full` ; collecteur : `url.query` supprimé ; instrumentation MongoDB : valeurs remplacées par `?` | 24 spans de `GET /cinemas` relevés dans Jaeger (`/api/v3/traces`) : 0 occurrence de `45.758`, `4.832` ou `lat=`. `db.query.text` = `{"filter":{"latitude":{"$gte":"?","$lte":"?"},…}}` |
| Base | aucune collection pour la position du spectateur ; seuls les cinémas ont une position | `geoloc-privacy.test.ts` « seuls les cinémas ont une position » |
| Réponse | distance arrondie à 0,1 km, jamais la position reçue | `cinemas-route.test.ts` « ne renvoie jamais la position reçue » |

Ce qui reste visible par des tiers, et c'est assumé :
- **l'adresse tapée** part du navigateur vers l'IGN ;
- **les tuiles** révèlent la zone affichée à tile.openstreetmap.org.

Le journal d'**erreurs** de nginx peut recopier la ligne de requête en cas de panne de l'API.

## §5 — Preuves

**Tests, relancés le 16/11/2026**

- `npm test` (API) : 50 tests, 50 verts, 0 ignoré.
  - `geo-distance.test.ts` (8) : références Rosetta Code (2 886,444 km pour Nashville → Los Angeles) et PostGIS 3.6.4 (Bellecour → Part-Dieu 2,1305 km, Bellecour → Paris 392,552 km), tolérance 0,5 % ; piège lat/lon ; boîte ; pôle et antiméridien.
  - `cinemas-route.test.ts` (17) : coin exclu, ex aequo, pagination après tri, rayon par défaut, filtre transmis, réponse sans la position, 12 refus en 400 sans requête MongoDB.
  - `cinemas-mongo.test.ts` (4, sur le MongoDB 8 de `movies-db`, base jetable `geo_test_<pid>`, ignoré si MongoDB est arrêté) : six cinémas autour de Bellecour, filtre VO, (0, 0) vide, `$geoNear` identique à la boîte, plans `IXSCAN` et `GEO_NEAR_2DSPHERE`.
  - `geoloc-privacy.test.ts` (4).
- `npm test` (front) : 39 tests, 39 verts. `geo.test.ts` (13) : Position 4, Paramètres 3, Affichage 2, Géocodage 4, dont l'ordre `[lon, lat]` et le cache.
- `npm run build` (front, vue-tsc compris) et `npm run typecheck` (API) : passent.

**Essais dans l'application** (http://localhost:8081, Chromium piloté par Playwright avec une position simulée)

| Essai | Résultat observé |
| --- | --- |
| Autour de moi, Bellecour (45.7576, 4.8317) | « 6 cinémas à moins de 5 km », requête `lat=45.758&lon=4.832&radiusKm=5&page=1&limit=6`. Ordre : Ciné Charité 300 m, Les Terreaux 1,1 km, Le Lafayette 1,2 km, Écran Part-Dieu 2,1 km, Ciné Jean-Jaurès 2,1 km, Ciné Gratte-Ciel 3,8 km. Carte : cercle, centre, 6 marqueurs, « © OpenStreetMap contributors ». |
| Avec l'équipement VO | « 3 cinémas à moins de 5 km » : Ciné Charité, Les Terreaux, Ciné Gratte-Ciel (`…&feature=vo`). |
| Permission bloquée | « Localisation refusée. Saisissez une adresse ou un code postal. », focus sur le champ d'adresse. « 21 cours Lafayette 69006 Lyon » donne ensuite 6 cinémas. |
| `lat=95`, puis le journal de nginx | `400 {"error":"Latitude invalide : entre -90 et 90 degrés."}`. Journal : `"GET /api/cinemas" 400 38`, sans `?lat=95&lon=4.8`. |

## §6 — Ce que « à vol d'oiseau » ne promet pas

- **Ni un trajet, ni une durée.** « À 2,1 km » peut vouloir dire traverser le Rhône et 30 minutes de bus. La page affiche seulement « À 2,1 km », sans mention « à vol d'oiseau » : la limite est documentée ici, pas à l'écran.
- **Ni le mètre près.** Sphère contre ellipsoïde : moins de 0,5 %. Il faut ajouter l'arrondi à 0,1 km et le centre arrondi à environ 111 m. Deux cinémas affichés « 2,1 km » peuvent permuter selon le centre exact.
- **Ni la position du spectateur.** Une position du navigateur peut être fausse de plusieurs kilomètres (Wi-Fi, IP). L'incertitude est affichée au-delà de 1 km.
- **Ni les séances.** L'annuaire ne dit pas ce qui passe dans chaque salle. Dans ce TP, les séances réservables restent celles du « Cinéma Movies » existant.
