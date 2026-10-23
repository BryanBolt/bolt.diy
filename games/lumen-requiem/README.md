# Lumen Requiem

RPG d'action roguelike jouable dans le navigateur, écrit en **Rust** (compilé en WebAssembly).
Combats en temps réel façon jeu de combat sur une ligne (inspiration *Tales of*), alliés pilotés par un
système d'IA programmable — les **Réflexes** — inspiré des Gambits de FFXII mais renommé et adapté,
coop locale jusqu'à 3 manettes et coop en ligne (lockstep).

## Lancer

```bash
./build.sh                      # compile le WASM -> web/lumen.wasm + dist/lumen-requiem.html (fichier unique)
cargo run -p lumen_server       # http://localhost:8080 (jeu) + ws://localhost:9001 (relais en ligne)
cargo test -p lumen_core        # 28 tests (dont les 20 du cahier des charges)
```

`dist/lumen-requiem.html` s'ouvre aussi directement (double-clic), sans serveur, pour jouer en solo ou en local.

## Contrôles

| Action | Manette | Clavier | Tactile |
|---|---|---|---|
| Déplacement | stick / croix | flèches, ZQSD/WASD | joystick gauche |
| Saut (double saut) | A | Espace, Entrée | ⤒ |
| Attaque (combo ×3) | X | J | ⚔ |
| Arte neutre / ↑ / ↓ | B (+ direction) | K | ✦ |
| Garde | LB | L | ⛨ |
| Changer de cible | RB | I | ◎ |
| Arcane ultime (Surcharge pleine) | RT | O | ✸ |
| Changer de personnage | LT | U | « Perso » |
| Ordre manuel à un allié | Y | H, Tab | « Ordre » |
| Pilote automatique (vos Réflexes jouent) | Select | P | « Auto » |
| Pause / Réflexes | Start | Échap | ❚❚ |

Coop locale : chaque manette est un joueur (manette 1 = J1, avec clavier et tactile). Les héros non pris
par un humain sont joués par leurs Réflexes.
Coop en ligne : bouton « En ligne », même code de salon, l'hôte lance. Le serveur ne fait que relayer
les entrées ; chaque client exécute la même simulation déterministe (contrôle d'empreinte toutes les 2 s).

## Vocabulaire (réinventé)

| Notion | Ici |
|---|---|
| Gambit / liste de Gambits | Réflexe / Grimoire de Réflexes |
| Configurations A/B/C | Postures I / II / III |
| PM | Éther (ÉT) |
| Magie / Technique / Limite | Arcane / Technique & Arte / Arcane ultime (jauge de Surcharge) |
| Leader | Meneur |
| Modes Actif / Attente | Rythme FLUX / SUSPENS |
| Mode fidèle / étendu | Règles FIDÈLE / ÉTENDU |
| Statuts | Égide, Prisme, Élan, Venin, Mutisme, Torpeur, Cristallisation, Sentence, Revers… (30) |

## Architecture (`core/src`)

| Module | Rôle (nomenclature du cahier des charges) |
|---|---|
| `battle.rs` | CombatEngine (état), PartyManager (meneur, invité), ResourceSystem, inventaire partagé avec **réservations atomiques** |
| `ai.rs` | ReflexEngine (GambitEngine), TargetResolver, ConditionEvaluator (étendu), ActionValidator, trace de décision |
| `sim.rs` | ActionScheduler (jauge → approche → charge → exécution → récupération), ActionExecutor, NavigationSystem, contrôle direct |
| `status.rs` | StatusEffectSystem générique (durées, dégâts périodiques, restrictions, interactions, immunités) |
| `reflex.rs` | Modèle de données, **catalogue explicite** des sélecteurs (origine : référence / adaptation / étendu), postures, sérialisation versionnée |
| `analyzer.rs` | Analyseur de grimoire (règle masquante, action non apprise, incompatibilité, doublon, gaspillage) |
| `presets.rs` | Grimoires de démonstration (Soigneur, Guerrier, Mage, Chapardeur) et grimoires ennemis (même moteur) |
| `game.rs` | Boucle roguelike : carte à embranchements, salles, Échos, marchand, repos, méta-progression, sauvegarde |
| `ui.rs`, `render.rs`, `fx.rs` | GambitUI (éditeur), HUD, menus, décors, personnages vectoriels, effets — sous forme de liste de commandes |
| `story.rs` | Scénario original |
| `wasm.rs` | Interface WebAssembly (aucune dépendance externe) |

Le moteur ne dépend d'aucun graphisme : les tests l'exécutent en natif. Le JS (`web/main.js`) ne fait
qu'exécuter les commandes de dessin, lire les entrées, synthétiser le son et relayer le réseau.

### Cycle de décision (`ai::decide`)
Pour chaque unité dont la jauge est pleine et sans action en cours, au plus toutes les `decision_interval` s :
lignes 1 → 12 de la posture active ; on ignore les lignes vides, verrouillées, désactivées ; on résout les
cibles du sélecteur ; on vérifie l'exécutabilité (apprise, statuts, Éther, objet disponible, recharge) ; on
filtre les cibles utiles et atteignables ; en mode étendu, la condition composée ; **la première ligne
valide gagne**. Aucune ligne valide → l'unité attend (pas de décision cachée). Chaque cycle repart de la ligne 1.

### Politique d'interruption (choix documentés)
- Un Réflexe n'interrompt jamais une action engagée.
- Un ordre manuel remplace une action automatique encore en approche/charge ; en cours d'animation, il attend.
- Coûts payés à l'impact ; objet **réservé** à la décision, **consommé** à l'impact, libéré si annulé.
- Cible disparue avant l'impact → action annulée, unité immédiatement disponible.
- Perte de la capacité d'agir (Torpeur, Figé…) → action non résolue abandonnée.
- Égalités : distance croissante puis identifiant (déterministe).
- Appât : les ennemis visent en priorité l'unité appâtée.
- Miroir : renvoie vers l'unité la plus proche du camp opposé à l'unité réfléchissante.

### Ajouter une condition
1. Variante dans `reflex::Selector` + `group`, `label`, `describe`, `code`, `from_code`.
2. Résolution dans `ai::resolve_targets`.
3. Entrée dans `reflex::catalog()` (origine, prix). Le test `catalog_codes_roundtrip` vérifie la sérialisation.

### Ajouter une action
1. Constante `A_…` + entrée dans `data::ACTIONS` (à l'index de la constante).
2. Si nouvel effet : `data::Effect`, `ai::useful` (utilité), `sim::apply` (application).
3. L'ajouter aux `actions` d'un gabarit de héros/ennemi (ou au tirage de l'Écho « Savoir oublié »).

## Tests
`core/tests/reflex_tests.rs` : les 20 tests obligatoires (priorités, résurrection, Éther insuffisant → objet,
objet absent, ligne/grimoire désactivés, faiblesse vs absorption vs vulnérabilité, cible du meneur, cible
morte en préparation, Mutisme, ordre manuel, changement de posture, soin inutile, nouvelle urgence,
inventaire partagé sans duplication, aucune règle valide, déplacement vers la portée, combat de 3 min),
plus : mêlée contre volant, sérialisation, catalogue, mode étendu, déterminisme, morts-vivants,
Miroir/Revers, combo manuel. `core/examples/smoke.rs` joue une partie complète sans interface.

## Limites connues
- **Droits d'auteur** : aucune musique, aucun texte ni aucun personnage de FF7, FF12 ou Tales of n'est repris.
  Scénario, personnages et musiques sont originaux ; ils reprennent seulement les *codes* du genre.
- Terrain 2D sur une seule ligne : pas d'obstacles ni de ligne de vue (la « vue » = rayon + invisibilité).
- Seuils fixes de PV ennemis : catalogue d'adaptation (les combinaisons exactes du jeu de référence ne sont pas garanties).
- Le multijoueur en ligne exige le serveur relais auto-hébergé (`wss://` derrière un proxy pour un site HTTPS) ;
  la version publiée sur claude.ai ne peut pas ouvrir de WebSocket : elle sert au solo et à la coop locale.
- Lockstep sans rollback : la latence s'ajoute au délai d'entrée (4 images).
- Équilibrage à affiner ; graphismes vectoriels procéduraux (pas de sprites).
