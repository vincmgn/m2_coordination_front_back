# CONVOCATION.md — TP Génération de documents sur Movies

Ce TP est adapté de MediSlot à Movies (`movies-api-loadtest` + `movies-web`). La convocation devient le **billet** d'une réservation, et « Mes rendez-vous » devient « Mes séances ». Chaque réservation propose « Mon billet (PDF) » et « Enregistrer ». Le billet indique le film, le jour et l'heure de Paris, la salle, l'adresse, les sièges et le nom du spectateur. Une réservation annulée n'a plus de billet.

| | |
| --- | --- |
| Lancer | `cd movies-api-loadtest && docker compose up -d --build api web` |
| Front | http://localhost:8081, puis « Mes séances » |
| Compte de démonstration | `spectateur@movies.test` / `Movies-demo-2026!` (Camille Dupont, données fictives) |
| Second compte (preuve 404) | `second@movies.test` / `Second-demo-2026!` (Hélène Durand, fictif), créé par `POST /auth/register` |
| Tests | API : `cd movies-api-loadtest && npm test` (15). Front : `cd movies-web && npm test` (19, dont 13 pour le billet) |

| Côté | Fichier | Rôle (équivalent MediSlot) |
| --- | --- | --- |
| API | `src/routes/tickets.ts` | Route et en-têtes (`ConvocationController`) |
| API | `src/ticket/service.ts` | Droits, 404 et 409, nom de fichier (`ConvocationService`) |
| API | `src/ticket/view.ts` | Vue déjà mise en forme (`ConvocationView`) |
| API | `src/ticket/formats.ts` | Jour et heure de Paris (`ConvocationFormats`) |
| API | `src/ticket/renderer.ts` | Rendu pdfkit, PDF/UA et polices embarquées (`PdfRenderer` + `convocation.html`) |
| API | `src/routes/screenings.ts` | `DELETE` d'une réservation : enregistre l'annulation dans la collection `cancellations` |
| Front | `src/ticket.ts` | `filenameFrom`, `fetchTicket`, `openTicket`, `saveTicket`, `realBrowser` (`convocation.ts`) |
| Front | `src/components/TicketButton.vue` | Les deux boutons et leurs trois états (`ConvocationButton.vue`) |
| Front | `src/views/MyScreenings.vue` | Intégration des boutons dans chaque réservation, à venir ou passée |

## §1 — Le contrat du téléchargement

**Requête**

```
GET /screenings/mine/{bookingId}/ticket.pdf                 → affiche (inline)
GET /screenings/mine/{bookingId}/ticket.pdf?download=true   → enregistre (attachment)
Cookie: session=…   (httpOnly, SameSite=Lax, même origine via /api)
Accept: application/pdf, application/json
```

- Le chemin ne contient qu'un identifiant de réservation : ni nom, ni film, ni date, ni jeton.
- C'est un `GET` qui ne modifie rien : le cookie SameSite=Lax suffit, sans jeton CSRF.
- Sur cette pile, les erreurs sont au format `{ "error": "…" }` en `application/json` (pas de ProblemDetail en Express).

**En-têtes de succès (200)**

```
Content-Type: application/pdf
Content-Length: <taille>
Content-Disposition: inline; filename="billet-<bookingId>.pdf"       (attachment avec download=true)
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

- **Nom de fichier :** il ne contient que le numéro de réservation. Il est en ASCII, donc `filename*` n'est pas nécessaire.
- **`no-store` :** ni le navigateur ni un proxy ne gardent de copie. Il est aussi posé sur les réponses d'erreur.

**Erreurs et message affiché au spectateur**

| Code | Cas | Corps renvoyé par l'API | Phrase affichée par le front |
| --- | --- | --- | --- |
| 401 | Pas de session, ou session expirée | `{"error":"Connexion requise"}` | « Votre session a expiré. Reconnectez-vous. » |
| 404 | Réservation inexistante, d'un autre compte, ou identifiant mal formé | `{"error":"Réservation introuvable"}` | « Cette réservation est introuvable. » |
| 409 | Réservation annulée par ce compte | `{"error":"Cette réservation a été annulée : elle n'a plus de billet."}` | « Cette réservation a été annulée : elle n'a plus de billet. » |
| 500 | Le rendu a échoué | `{"error":"Erreur interne du serveur"}` + `X-Trace-Id` | « Le billet n'a pas pu être préparé. Réessayez dans un instant. (réf. *trace*) » |
| — | Pas de réponse (hors ligne) | — | « Connexion impossible : vérifiez votre réseau, puis réessayez. » |
| 200 non PDF | Page HTML d'un proxy ou d'un portail Wi-Fi | — | Phrase générique du cas 500, sans onglet vide |

- **Pourquoi 404 et pas 403 :** un 403 avouerait que la réservation existe. Le service vérifie le propriétaire avant toute fabrication, donc aucun PDF n'est produit pour un autre compte.
- **Comment le 409 est possible :** sur Movies, une annulation supprimait les sièges sans laisser de trace, ce qui aurait donné un 404. Le `DELETE` enregistre désormais `{ bookingId, userId, screeningId, seats, cancelledAt }` dans la collection `cancellations`, et le service la consulte quand la réservation n'est plus trouvée.

## §2 — Où le PDF est fabriqué, et pourquoi

Le billet est fabriqué **côté serveur**, par l'API Node avec pdfkit 0.20.2 :

1. **Il fait foi.** Le spectateur, la caisse et une réclamation voient le même document : un seul rendu, versionné avec l'API.
2. **Il protège les données.** Le navigateur ne reçoit que le PDF du compte connecté, pas de quoi le fabriquer. Les droits sont vérifiés là où sont les données.
3. **Il a un coût maîtrisé.** Un billet d'une page pèse environ 35 Ko et se rend en quelques dizaines de millisecondes. Il n'y a ni navigateur sans tête ni service de plus à héberger (Gotenberg, Chrome), seulement une bibliothèque MIT maintenue (dernière version en août 2026).

**Équivalences avec le cours** (Open HTML to PDF + Thymeleaf, côté Java) :

| Cours (Java) | Movies (Node) |
| --- | --- |
| Gabarit HTML Thymeleaf, uniquement des `th:text` | Fonction de rendu `renderTicket(view)` qui ne fait qu'afficher les champs d'une `TicketView` déjà mise en forme |
| `usePdfUaAccessibility(true)` | `subset: "PDF/UA"`, `tagged: true`, `lang: "fr-FR"`, `displayTitle: true` |
| Polices DejaVu Sans dans `resources/fonts` | Polices DejaVu Sans (400 et 700) du paquet npm `dejavu-fonts-ttf`, embarquées en sous-ensemble ; jamais les polices standard non embarquées |

## §3 — Ce qui est imprimé : modèle, police, fuseau

- **Mise en page.** Le billet est détachable, aux couleurs du front : un bandeau sombre avec le logo, l'affiche de remplacement de la même couleur que dans « Mes séances », puis le film, le spectateur, la date, l'heure et la salle. Le talon de contrôle contient les places, les sièges et un code QR du numéro de réservation (`MOVIES:<id>`, paquet `qrcode`, dessiné en vectoriel). Viennent ensuite « Bon à savoir » et le pied de page. Le fond reste blanc pour l'impression.
- **Modèle sans calcul.** `toTicketView` prépare toutes les chaînes : « lundi 16 novembre 2026 », « 21 h 00 », « E5, E6 », « 2 » / « places », la couleur de l'affiche de remplacement. Le rendu ne fait aucune mise en forme de date. Il ne garde que des choix de présentation, comme réduire la taille d'un titre long plutôt que de le couper.
- **Police embarquée.** Le test vérifie deux points :
  - chaque police du PDF est un sous-ensemble `XXXXXX+DejaVuSans…` ;
  - il y a autant de `/FontFile2` que de polices.

  Le PDF d'exemple (`tests/out/billet-exemple.pdf`) affiche « Hélène Durand » et « Amélie » sans « H?l?ne ».
- **Balisage.** Le PDF a un arbre de structure (H1, H2, P, et une `Figure` avec un texte de remplacement pour le code QR ; les fonds, la perforation et l'affiche de remplacement sont des `Artifact`), `/Lang (fr-FR)`, `DisplayDocTitle` et l'identifiant `pdfuaid:part 1` dans les métadonnées. Comme dans le cours, cela ne prétend pas à une conformité PDF/UA complète, qui n'a pas été validée avec un outil comme PAC ou veraPDF.

**Bug du fuseau, en une phrase.** Le conteneur de l'API tourne en UTC : formater l'heure de réservation (`createdAt`, un instant UTC) avec `getHours()` ou sans `timeZone` imprime 8 h 30 au lieu de 9 h 30 en hiver et 7 h 30 en été. On écrit donc `timeZone: "Europe/Paris"` dans le code (`src/ticket/formats.ts`), jamais le fuseau du serveur.

Preuve dans le conteneur :

```
$ docker exec movies-api node -e "…"
2026-11-24T08:30:00Z → getHours() : 8 h 30 | timeZone Europe/Paris : 9:30
2026-07-07T07:30:00Z → getHours() : 7 h 30 | timeZone Europe/Paris : 9:30
```

L'heure de la séance n'a pas ce problème : elle est déjà en heure de Paris dans l'identifiant de séance (`…-20261116-2100`). Le test `ticket-service.test.ts` force `TZ=America/New_York` et vérifie trois cas :
- l'hiver ;
- l'été ;
- le matin du changement d'heure (29 mars 2026 : 00:30Z donne 1 h 30, 01:30Z donne 3 h 30).

## §4 — Intégration et preuves (application qui tourne, 16/11/2026)

Les commandes passent par nginx (`http://localhost:8081/api`), comme le navigateur. `a.txt` contient la session de Camille Dupont, `b.txt` celle du second compte. La réservation de preuve `6afad7e79c8c6e1689d3bec0` (siège H11, séance du 16/11 à 21 h 00) a été créée pour l'occasion, puis annulée.

**200 : propriétaire de la réservation**

```
$ curl -s -D - -o billet.pdf -b a.txt http://localhost:8081/api/screenings/mine/6afad7e79c8c6e1689d3bec0/ticket.pdf
HTTP/1.1 200 OK
Server: nginx/1.27.5
Content-Type: application/pdf
Content-Length: 23831
X-Trace-Id: 9bbd312467798fda086c15e9f6f61733
Cache-Control: no-store
Content-Disposition: inline; filename="billet-6afad7e79c8c6e1689d3bec0.pdf"
X-Content-Type-Options: nosniff

$ head -c 8 billet.pdf
%PDF-1.7

$ curl -s -D - -o /dev/null -b a.txt ".../ticket.pdf?download=true" | grep -i disposition
Content-Disposition: attachment; filename="billet-6afad7e79c8c6e1689d3bec0.pdf"
```

Le PDF reçu porte « lundi 16 novembre 2026 à 21 h 00 (heure de Paris) », « H11 (1 place) » et « Réservé le 16 novembre 2026 à 11 h 16 ». À cet instant, `docker exec movies-api date` donnait `Mon Nov 16 10:16:13 UTC 2026` : le serveur est en UTC et le billet est bien en heure de Paris.

**401 : sans cookie**

```
$ curl -s -D - http://localhost:8081/api/screenings/mine/6afad7e79c8c6e1689d3bec0/ticket.pdf
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Cache-Control: no-store

{"error":"Connexion requise"}
```

**404 : même numéro, second compte connecté**

```
$ curl -s -D - -b b.txt http://localhost:8081/api/screenings/mine/6afad7e79c8c6e1689d3bec0/ticket.pdf
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8
Cache-Control: no-store

{"error":"Réservation introuvable"}
```

**409 : après annulation de la réservation**

```
$ curl -s -o /dev/null -w "DELETE %{http_code}\n" -b a.txt -X DELETE http://localhost:8081/api/screenings/6ac78aa3d39891c1cd77556b-20261116-2100/reservations/6afad7e79c8c6e1689d3bec0
DELETE 204
$ curl -s -D - -b a.txt http://localhost:8081/api/screenings/mine/6afad7e79c8c6e1689d3bec0/ticket.pdf
HTTP/1.1 409 Conflict
Content-Type: application/json; charset=utf-8
Cache-Control: no-store

{"error":"Cette réservation a été annulée : elle n'a plus de billet."}
```

**Clic réel dans « Mes séances »** (Chromium piloté par Playwright, compte de démonstration)

```
liste : The Summer Last 1 | Lundi 16 Novembre · 14:00
onglet ouvert, URL : http://localhost:8081/api/screenings/mine/6afad103c2b3d406f519298c/ticket.pdf | nom proposé : billet-6afad103c2b3d406f519298c.pdf
fichier enregistré : billet-6afad103c2b3d406f519298c.pdf
```

- « Mon billet (PDF) » ouvre un onglet pendant le clic, vérifie la réponse par `fetch`, puis affiche l'URL du serveur dans l'onglet. Chromium sans tête ne sait pas afficher un PDF : il le reçoit comme un téléchargement, ce qui donne le nom proposé.
- « Enregistrer » produit un fichier qui porte le nom proposé par le serveur.
- Dans l'onglet Réseau, `ticket.pdf` répond 200 en `application/pdf`. L'aperçu (« Preview ») est vide, ce qui est normal pour un binaire PDF : les preuves sont dans l'onglet « Headers ».

**Écart avec le cours : pas de `blob:` dans l'onglet.** La première version suivait le cours : l'onglet affichait une URL `blob:`, révoquée après 60 s. En test manuel dans Chrome, le bouton « Télécharger » du lecteur PDF échouait (« Vérifiez votre connexion Internet »). Ce bouton relit l'URL affichée : une fois le blob révoqué, il n'y a plus rien à relire. Et même avant, le fichier aurait porté l'UUID du blob comme nom.

Désormais :
- le `fetch` garde son rôle : il vérifie la réponse, chaque erreur devient une phrase et l'onglet est refermé ;
- une fois le billet confirmé, l'onglet affiche `/api/screenings/mine/{id}/ticket.pdf` ;
- le lecteur PDF télécharge alors depuis le serveur, avec le cookie de session et le nom `billet-<id>.pdf` donné par `Content-Disposition`, à tout moment.

Le prix : le PDF est fabriqué deux fois par affichage (≈ 35 Ko, quelques dizaines de ms). Le bouton « Enregistrer » garde le blob et `<a download>`, qui ne posent pas ce problème.

## §5 — Défi : le contrat d'un document long (récapitulatif annuel)

Ce besoin est imaginé pour le défi : il n'existe pas dans Movies. Exemple : un « récapitulatif annuel » de cent séances, avec affiches et sièges, trop long pour une requête synchrone.

**1. Commander**

```
POST /me/summaries            { "year": 2026 }
Cookie: session=… ; X-CSRF-Token: …
→ 202 Accepted
  Location: /me/summaries/7f3c…        (identifiant aléatoire, jamais un compteur)
  Cache-Control: no-store
  { "id": "7f3c…", "status": "PENDING" }
```

- Si une tâche identique est déjà en cours pour ce compte et cette année, l'API répond `202` avec la même `Location` : un double clic ne lance pas deux rendus.
- Erreurs :
  - 400 : année invalide ;
  - 401 : pas de session ;
  - 403 : jeton CSRF absent ou faux ;
  - 429 : trop de tâches en cours pour ce compte.

**2. Suivre**

```
GET /me/summaries/7f3c…
→ 200 { "status": "PENDING" | "RUNNING" | "DONE" | "FAILED", "progress": 40 }
  Cache-Control: no-store ; Retry-After: 2 (tant que PENDING ou RUNNING)
```

- Quand la tâche est terminée (`DONE`), la réponse contient aussi `"file": "/me/summaries/7f3c…/file"` et `"expiresAt": "…"`.
- Erreurs :
  - 401 : pas de session ;
  - 404 : tâche inconnue, ou appartenant à un autre compte (même règle que le billet) ;
  - 410 : fichier expiré et purgé.

**3. Télécharger**

```
GET /me/summaries/7f3c…/file[?download=true]
→ 200 application/pdf
  Content-Disposition: inline|attachment; filename="recapitulatif-2026.pdf"
  Cache-Control: no-store ; X-Content-Type-Options: nosniff
```

- Ce sont les mêmes en-têtes et les mêmes droits que pour le billet.
- Erreurs :
  - 401 : pas de session ;
  - 404 : tâche d'un autre compte ;
  - 409 : pas encore prête, ou en échec ;
  - 410 : expirée.

**Qui protège quoi**

- **CSRF :** seul le `POST` crée quelque chose, il exige donc le jeton CSRF en plus du cookie SameSite. Les deux `GET` ne modifient rien et n'en demandent pas.
- **Propriétaire :** la tâche stocke le `userId` du compte qui l'a commandée. Chaque appel (suivre, télécharger) le compare à la session et répond 404, jamais 403, sinon. L'identifiant est aléatoire pour ne pas être devinable.
- **Durée de vie :**
  - le fichier est gardé 7 jours (`expiresAt`), puis purgé par un index TTL MongoDB ou une tâche planifiée ; il répond alors 410 ;
  - les tâches sont en base pour survivre à un redémarrage de l'API ;
  - un rendu bloqué depuis plus de 10 minutes passe en `FAILED`.

**Côté front**

- Le bouton est désactivé dès le `POST`.
- Le front interroge `Location` toutes les 2 s, ou au rythme de `Retry-After` s'il est plus long, avec un seul appel à la fois.
- Il arrête de suivre :
  - sur `DONE` : il propose « Ouvrir » et « Enregistrer » ;
  - sur `FAILED`, ou sur un 404 ou un 410 : il affiche un message en une phrase ;
  - après 60 essais (2 minutes) : il affiche « Le document prend du retard : il restera disponible dans Mes séances. ».
- Le suivi s'arrête aussi quand la page est quittée (`AbortController`). Le serveur, lui, continue le rendu.

## §6 — Vérifier et rendre

```
$ cd movies-api-loadtest && npm test
# tests 15
# pass 15
# fail 0

$ cd movies-web && npm test
 Test Files  3 passed (3)
      Tests  19 passed (19)
$ npx vue-tsc --build      → aucune erreur
```

**Auto-vérification**

- [x] Le nom de fichier ne contient ni nom, ni film, ni date : `billet-<bookingId>.pdf`. Testé et vu avec `curl`.
- [x] Un autre compte reçoit 404, pas 403, et aucun PDF n'est fabriqué pour lui : `render` n'est jamais appelé dans `ticket-service.test.ts`.
- [x] L'heure imprimée est juste en hiver comme en été, et le jour du changement d'heure, avec un processus volontairement réglé sur un autre fuseau.
- [x] Le PDF contient « Hélène Durand » au test, avec ses polices DejaVu Sans embarquées.
- [x] Une erreur affiche une phrase (`role="alert"`), jamais du JSON ni un onglet vide : l'onglet est refermé en cas d'erreur (test « referme l'onglet vide »).
- [x] Chaque affirmation du §4 a sa commande et sa sortie collées.

**Relevé en passant et corrigé.** `DELETE /screenings/:id/reservations/:bookingId` ne vérifiait pas le propriétaire : connaître le `bookingId` suffisait pour annuler la réservation d'un autre. Désormais, une réservation rattachée à un compte ne peut être annulée que par ce compte ; un autre compte, ou une requête sans session, reçoit 404. Une réservation faite sans compte reste annulable avec son seul `bookingId`, que seul celui qui a réservé a reçu.

Vérifié sur la pile :

```
autre compte : {"error":"Réservation introuvable"} 404
sans session : {"error":"Réservation introuvable"} 404
propriétaire : 204
sans compte, sans session : 204
```
