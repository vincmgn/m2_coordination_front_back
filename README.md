# M2 — Coordination front / back

| Dossier | Contenu |
| --- | --- |
| [`movies-api-loadtest/`](movies-api-loadtest/) | API REST CRUD (Node.js + Express + TypeScript) sur `sample_mflix.movies` (MongoDB Atlas), tests de charge k6 |
| [`movies-web/`](movies-web/) | Front Vue 3 + TypeScript pour l'API movies : liste, filtres, détail, création, modification |
| [`doctolib-like/`](doctolib-like/) | Application de prise de rendez-vous style Doctolib (front Vue + back) — à venir |

Chaque projet a son propre README, son `package.json` et son `.env`.
Les workflows GitHub Actions sont dans [`.github/workflows/`](.github/workflows/) et ne se déclenchent que sur les changements de leur dossier.
