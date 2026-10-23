//! # Lumen Requiem — noyau de jeu
//!
//! Architecture (indépendante de tout moteur graphique) :
//!
//! | Module      | Rôle (nomenclature du cahier des charges)                         |
//! |-------------|-------------------------------------------------------------------|
//! | `battle`    | CombatEngine (état), PartyManager, ResourceSystem, inventaire      |
//! | `ai`        | ReflexEngine (GambitEngine), TargetResolver, ConditionEvaluator, ActionValidator |
//! | `sim`       | ActionScheduler, ActionExecutor, NavigationSystem, contrôle direct |
//! | `status`    | StatusEffectSystem                                                 |
//! | `reflex`    | Modèle de données des Réflexes, catalogue, Postures (ProfileManager), sérialisation |
//! | `analyzer`  | Analyseur de grimoire (mode étendu, conseils)                      |
//! | `game`      | Boucle roguelike, salles, récompenses, méta-progression            |
//! | `ui`        | GambitUI (éditeur), HUD, menus — rendu en liste de commandes       |
//! | `wasm`      | Interface WebAssembly (aucune dépendance externe)                  |

pub mod ai;
pub mod analyzer;
pub mod battle;
pub mod data;
pub mod fx;
pub mod game;
pub mod presets;
pub mod reflex;
pub mod render;
pub mod rng;
pub mod sim;
pub mod status;
pub mod story;
pub mod types;
pub mod ui;
pub mod wasm;
