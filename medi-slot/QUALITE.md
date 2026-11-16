# Qualité · MediSlot sous SonarQube

## 1 · Les mesures (étapes 2 et 3)

| Projet | Lignes | Sécu. | Fiab. | Maint. | Couverture | Dupl. | Porte |
|---|---|---|---|---|---|---|---|
| back | 943 | E | E | A | 20,1 % | 9,9 % | Passed (1re analyse : pas de nouveau code) |
| front | 584 | D | D | A | 5,6 % | 16,6 % | Passed (1re analyse : pas de nouveau code) |

Back : 118 problèmes ; 3 tests, 1 ignoré (`BookingIntegrationTest`), aucun échec.
Front : 54 problèmes ; 3 tests, 1 ignoré ; Vitest « Failed to parse » sur les `.vue` (exclus de la couverture), d'où la couverture basse.

## 2 · Les problèmes (étapes 4 et 5)

| # | Problème (fichier:ligne) | Règle | Décision et raison | Preuve |
|---|---|---|---|---|
| 1 | back · `api/DebugController.java:38-39` | `secrets:S6290` + `java:S6418` · Sécurité · Blocker | **Corriger** : clé AWS et secret écrits en dur, donc lisibles par toute personne ayant accès au dépôt et à l'historique Git. Les révoquer, puis les lire depuis une variable d'environnement. | **Corrigé** (clé lue depuis `EXPORT_AWS_ACCESS_KEY_ID`, secret supprimé) · analyse 1.1 du 16/11 à 09:39 · back 118 → 115 problèmes ; `secrets:S6290` et `java:S6418` au statut Closed |
| 2 | back · `api/DebugController.java:113-121` | `java:S2095` · Fiabilité · Blocker (+ `java:S1143`) | **Corriger** : `Connection` et `Statement` jamais fermés, donc fuite de connexions JDBC jusqu'à épuisement du pool ; le `return` dans le `finally` masque en plus les exceptions. try-with-resources. | |
| 3 | front · `components/AdminDebug.vue:27` | `typescript:S1523` · Sécurité · High | **Corriger** : `eval()` exécute n'importe quel code tapé dans le champ (XSS, vol du jeton de session). Remplacer par un calcul sans `eval`. | **Corrigé** (`services/calcul.ts`, testé dans `calcul.test.ts`) · analyse 1.1 du 16/11 à 09:39 · front 54 → 53 problèmes ; `typescript:S1523` au statut Closed |
| 4 | front · `components/ConnexionAvancee.vue:12` (idem `RecherchePraticien.vue:12`) | `typescript:S5852` · Sécurité · High | **Corriger** : le groupe `([a-zA-Z0-9_.-]+)+` provoque un retour arrière exponentiel ; une adresse piégée bloque l'onglet (ReDoS). Supprimer le quantificateur imbriqué. | |
| 5 | front · `App.vue:49-53` | `Web:S7930` · Fiabilité · High | **Faux positif** : les cinq `id="modal-title"` sont dans des branches `v-if` / `v-else-if` exclusives d'un même bloc ; un seul existe dans le DOM à un instant donné. La règle analyse le gabarit comme du HTML statique. | |
| + | non vu par SonarQube | aucune | | |

## 3 · La porte (étape 6)

Porte utilisée : « Sonar way » (par défaut), et non une copie `MediSlot-TP`.

- Défaut ajouté exprès : `DebugController.java:60`, `if (motdepasse == "demo")` (comparaison de chaînes avec `==`, règle `java:S4973`).
- Condition qui a échoué et sa valeur : New issues = 1 (seuil : > 0).
- Verdict 1.2 avant / après : **Failed** (16/11, 09:40) → défaut retiré → **Passed** (16/11, 09:41).
- (bonus) Liens des deux exécutions : non fait.
