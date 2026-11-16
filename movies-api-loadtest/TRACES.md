# TRACES.md — TP OpenTelemetry sur Movies

Ce TP a été adapté de MediSlot à Movies (`movies-api-loadtest` + `movies-web`) : cinéma au lieu du cabinet médical, séance au lieu du créneau, réservation au lieu du rendez-vous. Comme le kit du TP, cette version ajoute une passerelle SMS simulée, un historique des réservations et un compte de démonstration. Avec `TP_TICKETS=1`, ces ajouts contiennent les trois défauts des tickets ; avec `TP_TICKETS=0`, le comportement est corrigé. Depuis le durcissement de sécurité (voir [`SECURITE.md`](SECURITE.md)), la valeur par défaut est `0` : pour rejouer le TP, lancez `TP_TICKETS=1 docker compose up -d api`.

| | |
| --- | --- |
| Lancer | `cd movies-api-loadtest && GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build` |
| Front | http://localhost:8081 |
| Jaeger | http://localhost:16686 (stockage en mémoire : un redémarrage efface les traces) |
| Compte de démonstration | `spectateur@movies.test` / `Movies-demo-2026!` (Camille Dupont, données fictives, 24 réservations) |

Les identifiants de trace cités plus bas viennent de notre session du 16/11/2026 (version `f04ac96`). Dans l'interface de Jaeger 2.23, le champ « Operation » s'appelle **Span Name** et « Tags » s'appelle **Attributes**. Pour retrouver la preuve après un redémarrage, refaites le parcours : la méthode de recherche décrite pour chaque ticket donne une nouvelle trace équivalente.

## 1. Instrumentation en place

| Maillon | Fichier | Ce qui est fait |
| --- | --- | --- |
| Navigateur | `movies-web/src/tracing.ts`, appelé dans `main.ts` avant `createApp` | `TracerProvider` (service `movies-web`, `service.version` = commit), échantillonneur `ParentBased(TraceIdRatio(1))`, `BatchSpanProcessor` + `OTLPTraceExporter` vers `/otlp/v1/traces` (même origine), `StackContextManager`, `W3CTraceContextPropagator`, `FetchInstrumentation` (sans `/otlp/`). Garde-fou `StripQueryProcessor` : `onStart` retire `?…` de `url.full`. Le tampon est vidé quand la page passe en arrière-plan. |
| Navigateur, erreurs | `movies-web/src/api.ts` | Lit l'en-tête `X-Trace-Id`. Une réponse 500 affiche « Le service est momentanément indisponible. (réf. *trace*) ». |
| Nginx | `movies-web/nginx.conf` | `location /otlp/ { proxy_pass http://collector:4318/; }` : la barre finale retire le préfixe `/otlp`. `/api/` relaie déjà `traceparent` sans réglage. |
| API Node (équivalent de l'agent Java) | `movies-api-loadtest/src/instrumentation.ts`, `Dockerfile` (`node --import ./dist/instrumentation.js`) | `@opentelemetry/auto-instrumentations-node` 0.83.1 : http, undici (fetch sortant), express, mongodb. En ESM, le crochet `@opentelemetry/instrumentation/hook.mjs` doit être enregistré avant le SDK, sinon seul `http` est tracé. |
| API, configuration | `movies-api-loadtest/docker-compose.yml`, service `api` | `OTEL_SERVICE_NAME=movies-api`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318`, `OTEL_TRACES_SAMPLER=parentbased_always_on` (suit la décision du navigateur), `OTEL_METRICS_EXPORTER=none`, `OTEL_LOGS_EXPORTER=none`, `OTEL_RESOURCE_ATTRIBUTES=service.version=${GIT_SHA},deployment.environment.name=formation`, `OTEL_SEMCONV_STABILITY_OPT_IN=http` (sépare `url.path` et `url.query`). |
| API, code | `movies-api-loadtest/src/index.ts` | Renvoie `X-Trace-Id` sur chaque réponse. Pour une erreur 5xx inattendue : `recordException` et statut `ERROR` sur le span. |
| Collecteur | `movies-api-loadtest/observabilite/collector.yaml` (contrib 0.165.0) | Récepteur `otlp` (http 4318, grpc 4317). Processeurs `memory_limiter`, `filter/bruit` (sonde de santé `GET /`, middlewares Express), `attributes/sante` (supprime `url.query` et `enduser.id`), `batch`. Exportateurs `otlp_grpc/jaeger` (`tls.insecure`) et `debug`. |
| Jaeger | `jaegertracing/jaeger:2.23.0` | Interface publiée sur `127.0.0.1:16686` seulement (pas d'authentification). L'API HTTP est `/api/v3/…` (l'ancienne `/api/services` répond 404 en 2.23). |

Avant l'instrumentation (étape 0, anciennes images) : le script affichait 3 ÉCHEC, et Jaeger ne listait que `jaeger`.

**Relation exigée par `e2e/trace.spec.ts`.** Le `traceparent` envoyé par le navigateur donne la trace et le span parent. Dans Jaeger, la même trace doit contenir le span `GET` de `movies-web` portant **cet** identifiant de span, et un span de `movies-api` dont le `parentSpanId` est **égal** à cet identifiant : le span serveur est l'enfant direct du span du navigateur. Le test vérifie aussi que `url.full` du span navigateur se termine par `/api/movies/search`, sans la saisie.

## 2. T1 — « Confirmer une réservation prend plus d'une seconde » (accusé : le front)

- **Recherche dans Jaeger** : Service `movies-api`, Span Name `POST /screenings/:id/reservations`, Min Duration `1s`. On ouvre la trace la plus longue.
- **Trace** : `31ce39270f2ff9d2847d12819da0684a` (13 spans, 2 services)
- **Preuve** : le span navigateur `POST` dure 1 386 ms, le span serveur `POST /screenings/:id/reservations` 1 369 ms. Le front et le réseau n'ajoutent donc que 17 ms : le temps est passé côté serveur. Les requêtes MongoDB prennent 1 à 2 ms chacune (`insert reservations` : 2 ms). Sous `movies.reservation` (1 357 ms), un span client `POST` (statut 202) prend à lui seul **1 323 ms**, avec `url.full = http://sms-passerelle:4000/sms` et `server.address = sms-passerelle`. Le service appelé est le prestataire SMS.
- **Coupable** : maillon *service appelé*, attendu de façon synchrone par l'API. Méthode : le handler `POST /:id/reservations` (`src/routes/screenings.ts:373`) fait `await` sur `confirmBySms` → `sendSms` (`src/sms.ts`) avant de répondre 201.
- **Piste** (équipe back) : ne plus attendre le SMS dans la requête. Envoi après la réponse (file d'attente ou outbox), statut SMS mis à jour en arrière-plan. Vérifié avec `TP_TICKETS=0` : trace `3b0727e9e48fef9f1ca194dfe65e0e82`, le navigateur mesure **26 ms** ; le span SMS (1 209 ms) continue après la réponse.

## 3. T2 — « "Mes séances" sollicite la base bien plus que prévu » (accusé : la base)

- **Recherche dans Jaeger** : Service `movies-api`, Span Name `GET /screenings/mine`, connecté en Camille. On ouvre la trace et on compte les spans.
- **Trace** : `2a6cfe2054ba1e3973f8d3d912c93d07`
- **Preuve** : **35 spans** pour 80 ms côté navigateur (58 ms côté API). Le `request handler` a 31 enfants : `find sessions`, `find users`, `aggregate`, puis **28 spans `find movies` identiques**, un par réservation (Camille en a 28), avec le même `db.query.text` : `{"find":"?","filter":{"_id":"?"},…}`. Chacun dure environ 1 ms et ils s'exécutent l'un après l'autre : la cascade dessine un escalier.
- **Coupable** : maillon *API (Express)*, pas la base, qui répond en moins de 1 ms à chaque requête. Méthode : `titlesOneByOne` (`src/routes/screenings.ts:186`), qui fait un `findOne` dans une boucle `for` (N+1).
- **Pourquoi ça ne se voit presque pas à la durée** : chaque requête prend moins de 1 ms sur une base locale et peu chargée, donc 28 allers-retours ne coûtent qu'une trentaine de ms. Le nombre de requêtes grandit avec le nombre de réservations et la latence réseau se multiplie : c'est le **nombre de spans** qui alerte, pas la durée.
- **Piste** (équipe back) : une seule requête `find({ _id: { $in: [...] } })`, comme `titlesAtOnce`, ou un `$lookup` dans l'agrégation. Vérifié avec `TP_TICKETS=0` : trace `e6a761ce289385d6966040313bddcd1c`, **1 seul** `find movies` pour 27 réservations.

## 4. T3 — « L'historique de certaines réservations affiche "Le service est momentanément indisponible" » (accusé : le front)

- **Recherche dans Jaeger** : le message affiché sur la réservation « The Man Ghost 81 » donne la référence (`réf. 5e9612d0ceaf4b6892ea712c37ed30b6`). On la colle dans « Lookup by Trace ID ». Pour retrouver tous les cas : Service `movies-api`, Span Name `GET /screenings/mine/:bookingId/history`, Attributes `error=true`.
- **Trace** : `5e9612d0ceaf4b6892ea712c37ed30b6` (7 spans). Seules 3 réservations de Camille sur 28 sont touchées.
- **Preuve** : le span navigateur `GET` (10 ms) reçoit un 500. Le span serveur `GET /screenings/mine/:bookingId/history` est en `ERROR`, avec `http.response.status_code = 500`. Son événement `exception` contient `exception.type = TypeError` et `exception.message = Cannot read properties of undefined (reading 'replace')`, ainsi que la pile `at historyLabel (file:///app/dist/routes/screenings.js:200:25)`. Le span navigateur ne fait que recevoir le 500 : le front affiche correctement une erreur réelle.
- **Coupable** : maillon *API*, fonction `historyLabel` (`src/routes/screenings.ts:243`). `LABELS[type]` vaut `undefined` pour le type `SMS_ECHEC`, dont le libellé manque dans `LABELS` (ligne 239). Seules les réservations dont le SMS a été refusé par l'opérateur produisent ce type d'événement, d'où « pas toutes ».
- **Piste** (équipe back) : ajouter le libellé `SMS_ECHEC`, et prévoir un libellé par défaut pour un type inconnu au lieu de lever une exception. Un test unitaire pourrait parcourir tous les `HistoryType`. Vérifié avec `TP_TICKETS=0` : 0 erreur sur 27 historiques.

## 5. Span métier et données personnelles

`movies.reservation` (`src/routes/screenings.ts:339`) s'intercale sous le span serveur `POST /screenings/:id/reservations` et regroupe l'écriture, le SMS et la conversion A/B. Il porte deux identifiants techniques : `movies.screening.id`, pris dans le paramètre, et `movies.booking.id`, posé une fois l'insertion réussie. **Ces deux identifiants suffisent à retrouver la réservation en base pour qui y a accès, et ne disent rien de la personne à qui lit la trace.**

**Question : l'`email` serait-il utile dans la trace ?** Il permettrait de chercher « les réservations de Camille » directement dans Jaeger. On ne l'y met pas : un attribut est copié, stocké et partagé sans contrôle d'accès (Jaeger n'a pas d'authentification), et on ne peut pas le rappeler. Dans MediSlot, un rendez-vous rattaché à une personne est une donnée de santé ; ici, c'est une donnée personnelle au sens du RGPD. La recherche par personne passe par la base, puis par `movies.booking.id`.

Les trois garde-fous sont vérifiés :
1. **Dans le code** : aucun `setAttribute` avec un nom, un e-mail ou un téléphone. Le numéro part dans le corps de la requête SMS, qui n'est pas tracé. `db.query.text` remplace toutes les valeurs par `?`.
2. **Dans le navigateur** : `StripQueryProcessor` retire la saisie de recherche de `url.full` (test unitaire et test e2e).
3. **Dans le collecteur** : `attributes/sante` supprime `url.query` et `enduser.id`. Vérification sur 200 traces `movies-api` : 0 occurrence de l'e-mail, du nom ou du téléphone de démonstration, ni de la saisie « godfather ».

## 6. Sorties des tests

### `cd movies-web && npm test`

```text

> movies-web@0.0.0 test
> vitest run --reporter=verbose


 RUN  v5.1.0 /home/vincent/m2/coordination_front_back/movies-web

 ✓ src/api.test.ts > api : erreurs > 500 : message générique suivi de la référence de trace 3ms
 ✓ src/api.test.ts > api : erreurs > 4xx : message du back, sans référence 1ms
 ✓ src/api.test.ts > api : erreurs > réponse correcte : le corps JSON est renvoyé tel quel 1ms
 ✓ src/tracing.test.ts > traces du navigateur > ajoute un en-tête traceparent W3C échantillonné 5ms
 ✓ src/tracing.test.ts > traces du navigateur > le span du fetch porte la trace et l’identifiant envoyés dans traceparent 303ms
 ✓ src/tracing.test.ts > traces du navigateur > la saisie d’une recherche ne reste pas dans url.full 302ms

 Test Files  2 passed (2)
      Tests  6 passed (6)
   Start at  11:01:59
   Duration  1.09s (tests 48%, environment 42%, import 7%, transform 2%, worker 1%)
```

### `cd movies-api-loadtest && bash tests/verifier_traces.sh`

```text
OK     1. nginx relaie POST /otlp/v1/traces au collecteur
OK     2. Jaeger propose le service movies-api
OK     3. l'API reprend le traceparent (trace deb82a8434f2548c949bafa13c68b372)

Bilan : 3 OK, 0 ÉCHEC
```

### `cd movies-web && npx playwright test e2e/trace.spec.ts`

```text

Running 1 test using 1 worker

  ✓  1 [chromium] › e2e/trace.spec.ts:30:1 › une recherche produit une trace front puis back (5.8s)

  1 passed (6.4s)
```
