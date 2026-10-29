# Prompt : mettre un autre jeu en ligne avec la même architecture qu'AI Fighter 2

Copie tout ce qui suit dans une nouvelle conversation Claude (Claude Code, avec accès à un dépôt GitHub vide ou existant).
Remplace uniquement les passages entre [CROCHETS] dans la section « LE JEU ».

---

Tu es mon développeur principal. Construis **[NOM DU JEU]** en TypeScript, jouable **en ligne à 1–4 joueurs**, avec exactement l'architecture réseau et les paramètres que j'ai validés sur mon jeu « AI Fighter 2 ». Travaille de façon autonome jusqu'à ce que tout soit fini, testé, poussé sur la branche que je t'indique. Ne me pose pas de questions sauf blocage réel ; prends des décisions raisonnables et dis-les-moi à la fin.

## LE JEU
- Genre / concept : [ex. course de voitures vue de dessus, tower defense coop, jeu de cartes, platformer coop…]
- Joueurs : [1 à 4], coop ou versus : [coop / versus / les deux]
- Boucle de jeu en une phrase : [...]
- Contrôles de base : [clavier / manette / tactile]
- Style visuel : [ex. aplats simples, low-poly, pixel art], rendu 2D sur `<canvas>`.

## STACK (identique à AI Fighter 2)
- TypeScript strict, **Vite** (front), **Vitest** (tests), serveur **Node + `ws`** (WebSocket), `tsx` pour lancer le serveur en dev.
- Un seul dossier de projet avec : `src/` (client), `server/index.ts`, `shared/` (code partagé client/serveur, ex. `protocol.ts`), `tests/`, `public/` (manifest, sw.js, icônes), `render.yaml`, `Dockerfile`, `README.md`.
- Le serveur sert aussi les fichiers statiques de `dist/` : **un seul processus** (`npm start`), `/health` renvoie 200 (health check Render).
- Scripts npm : `dev` (vite), `server` (tsx), `build` (tsc --noEmit puis vite build), `start`, `test`.
- Vite : `base: './'`, proxy dev de `/ws` (websocket), `/api` vers `localhost:8787`.

## ARCHITECTURE RÉSEAU : LOCKSTEP DÉTERMINISTE (le cœur, à respecter à la lettre)
1. **Toute la simulation tourne sur chaque client** (`src/sim/`), sans aucune dépendance au rendu, au DOM, à `Date`, ni à `Math.random`. Le hasard passe par un PRNG xorshift dont l'état est dans le monde (`world.rng`). Positions arrondies (quantifiées) si nécessaire. Un `step(world, inputs[])` fait avancer d'une frame (60 FPS fixes).
2. **Le serveur est un simple relais** : il gère les salons et retransmet les entrées de chaque joueur. Il ne simule rien.
3. Entrées = un **entier de bits** par joueur et par frame (gauche, droite, haut, bas, actions…). Le client envoie `{t:'input', f, bits:[…]}` avec **redondance** (les 3 dernières frames) contre la perte de paquets.
4. Une frame n'est simulée que quand **les entrées de tous les joueurs sont connues**. **Délai d'entrée** (frames) pour absorber la latence ; il s'**adapte automatiquement** (monte quand on attend souvent un joueur lent, redescend quand tout va bien).
5. **Empreinte de synchro** : toutes les 60 frames chaque client envoie `hash(world)` ; en cas de divergence, le serveur déclenche une **resynchronisation** (reconstruction par rejeu du journal). `hashWorld` doit inclure TOUT l'état qui influence la sim (et rien du rendu).
6. **Journal des entrées** côté serveur (compressé RLE) → permet : reprise après coupure, arrivée en cours de partie, rediffusions.
7. **Reprise de partie** : si un joueur est coupé, une **IA joue à sa place** (événement de contrôle `{slot, from, ai:true}` à une frame future identique pour tous), le serveur garde sa place 20 min, il se reconnecte tout seul (jeton), reconstruit la partie par rejeu accéléré puis reprend la main à la frame annoncée (`REJOIN_MARGIN` ≈ 120 frames).
8. **Rejoindre en cours de partie** : un nouveau joueur entre via un événement `join` à une frame future ; la partie solo peut être « ouverte » (un lien invite des amis qui rejoignent en cours de route).
9. **Détection d'inactivité (AFK)** après 60 s (variable `AFK_MS`) : une IA remplace le joueur ; l'hôte peut **expulser** (kick) un joueur (bannissement par IP pour le salon).
10. Protocole JSON dans `shared/protocol.ts` avec `PROTOCOL_VERSION` (refuser les clients incompatibles), messages typés : hello, create, quick, list, join, rejoin, leave, kick, lobby (perso/couleur/prêt/nom/équipe), options, start, input, hash, end, chat, ping/pong, resync, rtc (signalisation voix). Mesure de latence (ping/pong).

## SALONS ET LOBBY
- **Salons** avec code à 5 caractères (alphabet sans caractères ambigus), **lien d'invitation** (`?salon=CODE`) et **QR code**, bouton Copier/Partager (Web Share API).
- **Salons publics** : « ⚡ Partie rapide » (rejoint le salon public le plus rempli, sinon en ouvre un) + liste rafraîchie toutes les 3 s ; salon **privé par défaut**, l'hôte peut le rendre public.
- Lobby : choix du personnage/véhicule/etc., couleur, « Prêt ? », options de partie réglées par l'hôte, bouton Lancer. 4 places max, hôte = premier joueur.
- **Jeu local** (même écran) jusqu'à 4 : clavier(s), manettes (Gamepad API), tactile ; chaque joueur rejoint en appuyant sur son périphérique.
- Option « Partie solo ouverte » : démarre tout de suite seul, des amis peuvent rejoindre par lien.

## CHAT VOCAL
- WebRTC pair-à-pair, le serveur ne relaie que la signalisation (`rtc`). **Appuyer-parler par défaut** (touche V / bouton), mode micro ouvert en option, indicateur 🔊 de qui parle, bouton quitter. Serveurs ICE configurables par variable `ICE_SERVERS` (TURN indispensable entre réseaux mobiles ; prévoir un TURN public par défaut). Rien ne démarre sans action du joueur.

## TACTILE / MOBILE
- Joystick flottant (moitié gauche) + boutons (droite), multi-touch, zone de toucher élargie, vibrations optionnelles, taille/opacité réglables, mode gaucher.
- Gestes optionnels et **mode une main**.
- Interface responsive (paysage ET portrait), menus au-dessus de la couche tactile (`#ui` z-index supérieur ; le calque tactile est masqué quand un menu est ouvert), plein écran + paysage demandés au lancement du jeu sur mobile.

## PWA / HORS LIGNE
- `manifest.webmanifest` + service worker : plugin Vite qui, après le build, **injecte dans `sw.js` la liste de tous les fichiers** à précacher (jeu complet jouable hors ligne dès la 1re visite) ; navigation réseau-d'abord, fichiers hachés cache-d'abord ; ignorer `/ws`, `/api`, `/health`. Bouton « Installer l'application » (beforeinstallprompt, astuce iOS), badge « Hors ligne ».

## SERVEUR : AUTRES FONCTIONS
- `POST /api/ideas` : formulaire « Proposer une idée » (texte ou dictée vocale) → fichier JSONL + `IDEAS_WEBHOOK` (Discord/Slack/n8n/Make) + ticket GitHub (`GITHUB_TOKEN` + `GITHUB_REPO`) ; consultation protégée par `IDEAS_KEY` (`/ideas?key=…`). Limite de débit par IP.
- Classement quotidien optionnel `/api/daily` (date UTC, meilleur score par nom, validation stricte, limite de débit).
- Rediffusions partageables `/api/replay` (seed + journal d'entrées RLE ; lecture avec vitesse, saut, moments forts).
- Variables d'environnement : `PORT`, `ICE_SERVERS`, `AFK_MS`, `IDEAS_*`, `GITHUB_*`, `DAILY_FILE`, `REPLAYS_FILE`. Tout est optionnel.
- Déploiement : `render.yaml` (plan free, `healthCheckPath: /health`, Node 22, `buildCommand: npm ci && npm run build`, `startCommand: npm start`), plus Dockerfile, fly.toml et railway.json. Précise dans le README que le disque Render gratuit est éphémère.

## QUALITÉ À LIVRER
- **Tests Vitest** (au minimum) : déterminisme de la sim (même seed + mêmes entrées = même hash) ; lockstep entre 2 sessions avec faux réseau (entrées perdues/retardées) ; salons publics et partie rapide sur le **vrai serveur** lancé en sous-processus ; reprise après coupure (IA puis retour, hashes identiques) ; arrivée en cours de partie ; AFK + kick ; rediffusion identique ; un test de campagne/partie complète joué par IA. Les tests doivent tous passer et `npx tsc --noEmit` être propre avant chaque commit.
- Vérifie le rendu **dans un vrai navigateur** (Playwright/Chromium) : captures d'écran du menu, du lobby, d'une partie, d'un mobile en paysage et en portrait ; corrige ce qui est cassé avant de me dire que c'est fini.
- Code en français pour les textes affichés ; commentaires concis ; fichiers courts et lisibles.
- README : lancement local, déploiement Render, commandes, architecture, variables d'environnement.

## MÉTHODE
1. D'abord le squelette complet (menu, lobby local, boucle de jeu minimale avec sim déterministe, serveur, protocole, 2 clients qui jouent ensemble en ligne, tests de lockstep) — pousse ce premier jalon.
2. Puis le jeu lui-même (contenu, IA/bots, règles, rendu, sons synthétisés WebAudio, effets).
3. Puis tout le reste de la liste (reprise, AFK, voix, PWA, idées, rediffusions, tactile) avec tests.
4. Commits fréquents avec messages clairs, push sur la branche indiquée, jamais de PR sauf demande.
5. À la fin : liste ce qui est fait, ce qui reste, les limites connues, et les variables à régler sur Render.

Commence maintenant par l'étape 1.
