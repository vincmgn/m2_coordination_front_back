# M2 — Coordination front / back

[![Tests de charge k6](https://github.com/vincmgn/m2_coordination_front_back/actions/workflows/movies-load-test.yml/badge.svg)](https://github.com/vincmgn/m2_coordination_front_back/actions/workflows/movies-load-test.yml) [![Bilan de charge](https://github.com/vincmgn/m2_coordination_front_back/actions/workflows/movies-bilan-charge.yml/badge.svg)](https://github.com/vincmgn/m2_coordination_front_back/actions/workflows/movies-bilan-charge.yml) [![Suivi des performances](https://github.com/vincmgn/m2_coordination_front_back/actions/workflows/perf-suivi.yml/badge.svg)](https://github.com/vincmgn/m2_coordination_front_back/actions/workflows/perf-suivi.yml)

Le **baromètre W/L** (runs réussis / ratés, météo, série en cours) est affiché dans le résumé de chaque run de ces workflows.

| Dossier | Contenu |
| --- | --- |
| [`movies-api-loadtest/`](movies-api-loadtest/) | API REST CRUD (Node.js + Express + TypeScript) sur `sample_mflix.movies` (MongoDB Atlas), tests de charge k6 |
| [`movies-web/`](movies-web/) | Front Vue 3 + TypeScript pour l'API movies : liste, filtres, détail, création, modification, réservation de places en temps réel (SSE), recherche réactive |
| [`doctolib-like/`](doctolib-like/) | Application de prise de rendez-vous style Doctolib (front Vue + back) — à venir |

Chaque projet a son propre README, son `package.json` et son `.env`.
Les workflows GitHub Actions sont dans [`.github/workflows/`](.github/workflows/) et ne se déclenchent que sur les changements de leur dossier.
