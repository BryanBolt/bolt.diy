# AI Fighter 2

Beat'em up « stickman » en 2.5D, pensé dès le départ pour le **multijoueur** : de 1 à 4 joueurs,
**en local** (plusieurs claviers, manettes, écran tactile sur le même appareil) ou **en ligne**
(chacun sur son téléphone ou son PC, avec un simple code de salon).

C'est la suite d'*AI Fighter Heroes* (Rust / macroquad, Android uniquement, solo). Cette version
repart de zéro en web (TypeScript + Canvas), sans aucune dépendance de jeu, et tourne partout :
Android, iOS, PC, Mac, installable en application (PWA) et jouable hors-ligne en local.

## Ce qui change par rapport au premier

| Problème du 1 | AI Fighter 2 |
| --- | --- |
| Android seulement (APK) | Tout navigateur, installable (PWA), aucun store |
| Solo (duel local limité) | 1 à 4 joueurs, coop campagne, duel chacun pour soi ou par équipes, survie, entraînement |
| Pas de jeu en ligne | Salons avec code, **lockstep déterministe** : tout le monde voit exactement la même partie, l'hôte ne peut pas tricher |
| Clavier + manette | Clavier (AZERTY **et** QWERTY, 2 joueurs sur un clavier), manettes (API Gamepad, vibration), **tactile** multi-touch avec joystick flottant |
| Combat « mash » | Tampon d'entrées, hit-stop, enchaînements, lanceurs + jongles, coups bas / plongeons, garde haute/basse, **parade parfaite**, roulade, garde brisée, charge du coup lourd, super imparable |
| IA qui s'empile | Limite d'attaquants simultanés, flanc, réactions (garde / esquive) qui dépendent de la difficulté, projectiles évités |
| Pas de réanimation | Un allié KO se réanime en maintenant Attaque à côté de lui ; système de vies ; Phénix |
| Textes dynamiques via API Claude | Tout est embarqué : aucune clé, aucun réseau requis hors multijoueur |
| Partie perdue si ça bug | **Reprise de partie** : coupure ou fermeture, tu reviens dans la même partie avec ta place ; une IA joue à ta place pendant ton absence (en ligne et en local) |
| Peu de coups | 15 **commandes de combat** communes (quarts de cercle, dragon montant, tourbillon, saisies, 360°, poing éclair…) en plus des coups propres à chaque héros |
| Pas d'armes à feu | **Kalachnikov** (rafale), **pistolet**, **batte**, **nunchaku** au sol, dans les caisses et à la boutique |
| Boss peu lisibles | Boss agrandis, couronne dorée, anneau au sol, nom au-dessus de la tête, bannière « BOSS » à l'arrivée |

## Lancer

```bash
cd ai-fighter-2
npm install
npm run dev          # client Vite sur http://localhost:5173 (proxy /ws vers le serveur)
npm run dev:server   # serveur de salons sur le port 8787 (dans un second terminal)
```

Pour jouer **chacun sur son téléphone** sur le même Wi-Fi : lance les deux commandes ci-dessus, puis
ouvre l'adresse « Network » affichée par Vite (ex. `http://192.168.1.20:5173`) sur chaque téléphone.
Un joueur crée un salon, les autres entrent le code (ou ouvrent le lien partagé `?salon=CODE`).

### Production (un seul processus)

```bash
npm run build   # typecheck + build dans dist/
npm start       # sert dist/ et le WebSocket /ws sur $PORT (8787 par défaut)
```

Héberge ce processus Node n'importe où (VPS, Fly.io, Render, Railway…) derrière HTTPS et le jeu
en ligne fonctionne via Internet. Un `Dockerfile` est fourni.

### Tests

```bash
npm test        # déterminisme de la simulation, stabilité des 4 modes, lockstep avec latence et déconnexion
```

## Commandes

| Action | Clavier J1 | Clavier J2 (pavé num.) | Manette | Tactile |
| --- | --- | --- | --- | --- |
| Bouger | `Z Q S D` / `W A S D` / flèches | `8 4 5 6` | Stick / croix | Joystick (gauche de l'écran) |
| Courir | `Maj gauche` ou double appui | `.` | Stick à fond / `LB` / `LT` | Joystick à fond |
| Attaque | `J` | `1` | `X` | `A` |
| Lourd (maintenir : charger) | `K` | `3` | `Y` | `B` |
| Saut | `Espace` / `L` | `0` | `A` | `X` |
| Garde (+ direction : roulade) | `U` / `Maj droite` | `7` | `B` | `Y` |
| Spécial (25 Ki) | `I` | `9` | `RB` | `Ki` |
| Super (jauge pleine) | `O` | `+` | `RT` | `★` |
| Pause | `Échap` / `P` | `*` | `Start` | `❚❚` |

Toutes les touches sont remappables dans **Options**.

### Système de combat

- **Enchaînements** : Attaque ×3 puis Lourd = finisseur. Avant + Lourd = **lanceur**, puis saut et attaques aériennes pour jongler.
- **Coups bas** (Arrière/Bas + Lourd) passent sous la garde haute ; les **plongeons** (Lourd en l'air) passent au-dessus de la garde basse (Bas + Garde).
- **Parade parfaite** : appuyer sur Garde dans les 7 frames avant l'impact déséquilibre l'attaquant, rend 20 Ki et **renvoie les projectiles**.
- **Garde brisée** quand la jauge de garde tombe à zéro (les coups lourds chargés cassent la garde d'un coup).
- Après un coup qui touche, Garde + direction **annule la récupération** par une roulade.
- **Ki** : se remplit en frappant ; **Super** : jauge pleine = coup imparable, invincible au départ.
- **Coop** : réanimation des alliés, soins / Ki / pièces dans les caisses, **bonus roguelite** à choisir entre chaque vague (18 bonus avec effets réels : brûlure, gel, ondes de choc, vampirisme, Phénix…).

### Armes, commandes de combat, réanimation

- **Armes** : batte et nunchaku renforcent et allongent les coups légers ; pistolet et kalachnikov tirent avec Attaque (maintenir pour la rafale, munitions affichées à côté de la jauge de Super) ; Lourd lance l'arme. On en trouve au sol (halo doré), dans les caisses et à la boutique ; une kalachnikov est posée avant chaque boss.
- **Commandes de combat** (tous les héros ; pavé numérique relatif au regard, diagonales tolérées, saisie terminable jusqu'à 9 images après le bouton). Sur manette et tactile, **Spécial + direction** fait la même chose pour les trois premières. Le mode Entraînement affiche tes entrées et le nom de la commande réussie.

| Coup | Saisie | Raccourci |
| --- | --- | --- |
| Boule de Ki | ↓ ↘ → + Attaque | Spécial + avant |
| Grande boule de Ki | ↓ ↘ → ↓ ↘ → + Attaque (50 Super) | |
| Dragon montant (anti-aérien invincible) | → ↓ ↘ + Attaque | Spécial + haut |
| Tourbillon (4 coups) | ↓ ↙ ← + Lourd | Spécial + arrière |
| Cent pieds | ↓ ↘ → + Lourd | |
| Onde basse | ← → + Attaque | |
| Salto éclair | ↓ ↑ + Lourd | |
| Saisie (imparable) | Attaque + Lourd | |
| Piledriver | tour complet + Attaque (30 Super) | |
| Poing d'un pouce (brise-garde) | ↘ + Attaque | |
| Poing éclair (lanceur) | → N ↓ ↘ + Attaque | |
| Coup-sauté (frappe haute) | ↘ + Lourd | |
| Coup latéral | → + Attaque | |
| Rafale du dragon | Attaque ×4 | |
| Coup volant | en l'air : → + Attaque | |

  Reculer ne retourne pas le personnage quand un ennemi est devant (pas arrière), ce qui rend possibles les quarts de cercle arrière.
- **Réanimation** : un allié KO se réanime en maintenant Attaque près de lui ; un joueur KO peut aussi se réanimer seul pour 40 pièces communes en appuyant sur Attaque, ou revient avec une vie après quelques secondes. Des consignes lisibles s'affichent sur le corps.

### En ligne : salons publics, voix, reprise

- **Salons publics, sans code** : l'écran « Jouer en ligne » propose **⚡ Partie rapide** (rejoint le salon public le plus rempli, ou en ouvre un si aucun n'est libre) et la liste des **salons publics** (hôte, mode, difficulté, joueurs, actualisation toutes les 3 s) avec un bouton Rejoindre. Un salon créé est privé par défaut (code, lien ou QR code) ; la case « Public » à la création ou le bouton Visibilité de l'hôte dans le salon le rend visible ou invisible. Un salon complet ou en partie n'est jamais proposé.
- **Chat vocal** : bouton 🎙️ sur le bord droit de l'écran (salon et partie en ligne). Un premier appui rejoint la conversation (le navigateur demande l'autorisation du micro). **Par défaut c'est appuyer-parler : le micro est coupé et n'émet que pendant que tu maintiens le bouton, la touche `V` ou le bouton Select d'une manette.** Le petit bouton « Appuyer-parler / Micro ouvert » change de mode (le choix est mémorisé) ; en micro ouvert, un appui sur le bouton ou sur `V` coupe / réactive le micro. Le ✕ quitte la conversation. Les voix passent directement entre les joueurs (WebRTC), le serveur ne relaie que la mise en relation. Rien ne démarre sans action du joueur ; si le micro est refusé, on peut quand même écouter. Un 🔊 s'affiche à côté du joueur qui parle. Le micro exige une adresse **https** (Render) ou `localhost` ; sur des réseaux très stricts la connexion directe peut échouer. Casque conseillé.
- **Reprise de partie** : en ligne, le serveur garde ta place 20 minutes. Si ton téléphone se coupe, le jeu se reconnecte tout seul ; si tu recharges la page ou rouvres l'appli, le menu propose « Reprendre la partie en ligne ». Ton combattant est joué par une IA pendant l'absence, puis tu reprends la main au même instant pour tout le monde. En local, la partie est sauvegardée toutes les 5 secondes : « Reprendre la partie locale » la reconstruit et démarre en pause.

### Nouveautés de jeu (v2.3)

- **Réactions élémentaires** (façon Magicka) : feu sur cible ralentie ou gelée = **FONTE** ; feu sur poison = **explosion toxique** ; glace sur cible mouillée = **GEL TOTAL** ; éclair sur cible mouillée = **ÉLECTROCUTION** (×1,8) ; glace sur brûlé = **VAPEUR**. Les Abysses mouillent tout le monde.
- **Rogue-lite** : bonus entre les vagues avec **raretés** (commun → légendaire, plus fréquentes avec les vagues), bonus **cumulables** (Force, Vitesse, Crit…), **synergies** (Choc thermique, Soif de sang, Forteresse…) et bonus de **coop** (+6 % par allié partageant un bonus).
- **Objets façon Isaac, visibles sur le personnage** : Force/Champignon/Vitalité le font **grandir**, Vitesse ajoute des traînées de plus en plus longues, Double saut = ailes (Phénix = ailes de feu), Hérisson = pointes, Plastron = plaques, Garde = bulle, Pyromane = flammes, Cryo = cristaux, Berserk = lueur rouge ; **Satellites** (orbes qui frappent), **Larmes de feu** (tir automatique), **Cœur d'or** (régénération) ; les autres objets orbitent en icônes. En Survie, tous les 5 vagues le tirage est meilleur (trésor).
- **Coffres et salles bonus** (façon Lost Castle) : à la fin de chaque vague un **coffre** (bois, argent, or, légendaire selon l'avancée) apparaît : va le frapper pour l'ouvrir (pièces + choix d'objet ; il s'ouvre seul après 20 s). Une vague sur deux, tu choisis une **salle bonus** : Fontaine de vie (+70 % PV, +1 vie), Forge (+1 niveau sur un objet), Salle au trésor (coffre plus rare), Cache d'or, Salle de défi (vague plus dure, coffre légendaire).
- **Équipes en ligne** : chaque joueur choisit 🔵 / 🔴 dans le salon, les IA complètent le 2 contre 2, anneaux d'équipe au sol.
- **Défi du jour** (menu) : même graine et même modificateur pour tout le monde (Lune, Verre, Nuée, Sac à bonus), classement du serveur (`/api/daily`, fichier `DAILY_FILE`).
- **Rediffusions** : « 🎬 Revoir la partie » en fin de match (vitesse ×0,25 à ×4, saut, moments forts ⭐) et « 🔗 Partager la rediffusion » (lien `?replay=ID`, `/api/replay`, fichier `REPLAYS_FILE`). Le déterminisme rejoue la partie à l'identique à partir de la graine et des entrées.
- **Stages interactifs** : projette les ennemis dans la cloison (dojo), l'enseigne néon, l'étal du marché (pièces + soin), le rail électrique du métro, la baie vitrée de la tour (défenestration), le pylône Tesla ; courant sous-marin dans les Abysses.
- **Boss** : zones d'attaque annoncées au sol (cercle qui se remplit, élément selon le boss), plus de zones à chaque phase, puis **fenêtre de point faible** (dégâts ×1,8).
- **Mini-jeux** entre les stages : planches à casser (matraquer) et barre de timing ; les gains vont à la cagnotte.
- **Cosmétiques** : chapeaux et auras débloqués par la progression, choisis dans le salon, visibles en ligne.
- **Application installable** (PWA) : bouton « Installer l'application », jeu complet en cache dès la 1re visite (solo et local hors ligne).
- **Tactile** : gestes (toucher = attaque, glisser ↑ saut / ↓ garde / ↔ lourd, appui long = Ki, 2 doigts = Super) et **mode une main** (Options).

### v2.4 : design et rétention

- **Élites** (dès la 3ᵉ vague de campagne) : ennemis *Blindé*, *Rapide*, *Explosif* ou *Vampire*, repérables à leur anneau et leur étiquette, récompense ×2,4.
- **Renforts** : quand il ne reste qu'un ennemi, deux autres surgissent des bords (second acte de chaque vague).
- **Esquive parfaite** : esquiver une attaque à l'instant où elle devient active donne ralenti, Ki, Super et un prochain coup ×1,5.
- **Ralenti cinématique** sur le dernier ennemi d'une vague.
- **Boss** : coffre légendaire garanti à sa défaite ; en survie, un boss toutes les 10 vagues.
- **Boutique et succès** : les pièces des parties s'accumulent ; 5 cosmétiques payants (toque, tricorne, oreilles de chat, auras Cœurs et Code vert) ; 15 succès avec récompenses ; série de jours du défi quotidien.

### Audit v2.3.1

Quatre revues (sécurité/réseau, UX/accessibilité, équilibrage/performance, marché) ont conduit à : serveur durci (requêtes malformées, messages trop gros, validation des options/personnages/frames, limite de débit `RATE_PER_S`, plafond de connexions par IP, en-têtes de sécurité, XSS des rediffusions), filtre de pseudos et de chat, page `legal.html` (confidentialité, âge, crédits), balises OpenGraph, zoom autorisé, carte de première partie, pause automatique en arrière-plan, rôles ARIA, cibles tactiles de 44 px, rareté des coffres liée à l'avancée en campagne, plafonds de cumul des objets, relances de bonus à prix croissant, rééquilibrage de Tora/Gorr/Zed/Vex, transformation plus courte, rendu limité à 60 images/s, décor hors écran ignoré. **Restent à faire** : traduction anglaise, boutique de cosmétiques avec les pièces, succès et quêtes, tutoriel guidé, export du profil, TURN dédié (`ICE_SERVERS`), stockage persistant des classements.

## Les héros

Kai (karaté équilibré), Tora (muay-thaï, armure, brise-garde), Zed (ninja, kunaïs, téléportation), Vex (fouet à longue allonge, lasso),
Orion (zoneur au Ki), Blaze (pyromane, dégâts sur la durée), Frost (gel), Shade (contres, forme ombre) ;
Gorr (colosse) et Nova (boss final) se débloquent en campagne.

## Modes

- **Campagne** (coop 1-4) : 7 stages, 3 vagues + boss chacun, bonus entre les vagues, 4 difficultés. Le stage de départ est débloqué au fur et à mesure.
- **Duel** : meilleur des 1/3/5, jusqu'à 4 combattants, chacun pour soi ou 2 équipes, bots IA en renfort, timer de 99 s.
- **Survie** : vagues infinies, record sauvegardé.
- **Entraînement** : mannequin qui régénère, affichage des boîtes de collision (Options).

## Architecture

```
shared/protocol.ts   messages client <-> serveur
server/index.ts      salons + relais d'entrées + fichiers statiques (Node, ws)
src/sim/             simulation déterministe (aucune horloge, aucun Math.random, aucune trig) : combattants, coups, IA, vagues, bonus
src/net/             client WebSocket + session lockstep (délai d'entrée adaptatif, redondance, prise en charge des départs, hash anti-désync)
src/input/           clavier (codes physiques), manettes, tactile
src/render/          caméra 2.5D, stickmen « encre » à poses procédurales, décors parallaxe, effets, HUD
src/audio/           synthèse WebAudio (effets + musique procédurale par stage)
src/ui/              écrans DOM (menus, salon, options, aide), manette tactile
tests/               déterminisme, stabilité, lockstep
```

**Reprise et déterminisme.** Le serveur garde le journal des entrées de la partie. Un client qui revient reçoit ce journal et rejoue la partie à toute vitesse (quelques secondes pour une partie de 10 minutes) ; la reprise de ses commandes est annoncée 2 secondes à l'avance pour que tous les clients appliquent le changement à la même image. Si le serveur détecte un écart entre clients, chacun se reconstruit automatiquement depuis son journal.

**Pourquoi le lockstep ?** Chaque client simule la partie entière ; seules les entrées (16 bits par
joueur et par frame) transitent par le serveur, qui ne fait que relayer. Une frame n'est jouée que
lorsque les entrées de tous sont connues : impossible de désynchroniser ou de tricher sur la position
d'un combattant. Si un joueur quitte, son combattant passe sous contrôle de l'IA au même instant pour
tout le monde. Un hash de l'état est comparé toutes les 60 frames pour détecter une désynchronisation.

## Idées des joueurs

Le bouton **💡 Proposer une idée** (menu principal, pause, fin de partie) ouvre un formulaire : texte ou **dictée vocale** (Chrome / Android / Safari récent). Les idées arrivent sur le serveur (`POST /api/ideas`) avec le contexte (mode, stage, appareil…).

Variables d'environnement du serveur :

| Variable | Rôle |
|---|---|
| `IDEAS_KEY` | clé pour consulter les idées : `https://TON-SITE/ideas?key=LA_CLE` (JSON : `/api/ideas?key=…`). Sans clé, la consultation est désactivée. |
| `IDEAS_WEBHOOK` | URL (Discord, Slack, n8n, Make…) qui reçoit chaque idée en JSON. **Recommandé sur Render gratuit** : le disque y est effacé à chaque redémarrage. |
| `GITHUB_TOKEN` + `GITHUB_REPO` | crée un ticket GitHub (`owner/repo`, label « idée ») par suggestion. |
| `IDEAS_FILE` | fichier JSONL de stockage (défaut `data/ideas.jsonl`). |

## Chat vocal : réseau

Le chat vocal est en WebRTC direct entre joueurs. Deux joueurs sur des réseaux différents (4G/5G, box) ont besoin d'un relais **TURN**. Par défaut, le serveur annonce STUN Google + le relais public Open Relay. Pour ton propre TURN : `ICE_SERVERS='[{"urls":"stun:..."},{"urls":"turn:...","username":"...","credential":"..."}]'`. Le bouton 🩺 du chat vocal affiche un diagnostic copiable.
