# Métronome — Pulse et séquences musicales

Application Web de métronome avec deux modes : une pulse régulière et la lecture de séquences musicales prédéfinies. Le moteur audio utilise la Web Audio API native et reste indépendant de l’interface Vue.

## Installation et lancement

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Environnement Node.js

Le projet épingle Node.js **24.22.3** avec Volta, dans le champ `volta.node` de `package.json`. Lorsque Volta est installé et présent dans le `PATH`, il sélectionne automatiquement cette version à la racine du projet. Vérifier avec `node --version`, qui doit afficher `v24.22.3`. Sans Volta, utiliser Node.js 24.22.3 est recommandé; les outils et tests requièrent Node.js 22 ou supérieur.

Le navigateur doit autoriser l’audio. Appuyer sur **START** active ou reprend l’`AudioContext`, conformément aux restrictions de Safari et iOS. Le mode **Pulse** est le mode d’ouverture; **Séquences** permet de choisir une partition dans la liste intégrée, sans sélectionner de fichier.

## Modes de lecture

- **Pulse** : pulse régulière de 30 à 300 BPM, avec changement de tempo pendant la lecture.
- **Séquences** : lecture de Redline, sélection de la plage de mesures, décompte, accents de mesure et de groupe, boucle et tempo modifiable.

La liste contient actuellement uniquement la partition Redline (`examples/Redline_tangp.json`). Pour ajouter une entrée, ajouter son JSON puis l’enregistrer dans `src/music/sequenceCatalog.ts`. Il n’y a aucun chargement distant ni sélecteur de fichiers.

Un appui court sur **+** ou **−** modifie le tempo d’1 BPM. Maintenir le bouton déclenche une répétition après 400 ms; le pas passe à 5 BPM après 1,5 seconde. La répétition s’arrête au relâchement et reste limitée à 30–300 BPM.

Le bouton **Mode tempo**, en bas à gauche, bascule entre **Standard** et **Mécanique**. Le mode mécanique parcourt les valeurs de 40 à 208 BPM par pas de 2 (40–60), 3 (60–72), 4 (72–120), 6 (120–144) et 8 (144–208). Les bornes communes ne sont présentes qu’une fois. À l’activation, le tempo est aligné sur la valeur autorisée la plus proche; une égalité est arrondie vers le bas. Le maintien parcourt les valeurs une à une et accélère la répétition sans sauter de palier.

Le bouton **Aléatoire**, entre le tempo et les boutons START/STOP, règle l’omission des clics : désactivé au démarrage, chaque appui passe à 10 %, 20 %, 30 %, 40 %, 50 %, puis revient à désactivé. Le pourcentage est une probabilité indépendante par clic, pas un quota exact. Les cinq premiers clics musicaux et tous les clics du décompte restent audibles. En mode Séquences, le réglage s’applique aux événements de mesure et de groupe; il ne crée pas de clics pour les subdivisions.

## Moteur audio

`src/audio/AudioEngine.ts` programme chaque clic à l’avance sur l’horloge `AudioContext.currentTime`. Le timer JavaScript réveille uniquement le scheduler; il ne déclenche jamais directement un son. Le clic est un oscillateur sinusoïdal court avec une enveloppe de gain. Lors d’un changement de tempo, les clics déjà programmés finissent, puis le nouvel intervalle est appliqué après le dernier clic en attente.

Au démarrage, l’application demande le type `auto` à `navigator.audioSession` lorsque cette API existe. C’est le réglage par défaut du navigateur. Le maintien de la lecture lorsque l’iPhone est verrouillé n’est pas garanti. La valeur demandée est exposée sur `data-audio-session-request` dans l’élément principal.

Sur mobile, l’application demande automatiquement le Screen Wake Lock pendant la lecture. La détection utilise l’indicateur mobile du navigateur lorsqu’il existe, sinon le type d’interaction tactile. Sur ordinateur, aucun Wake Lock n’est demandé. Si l’API est indisponible ou refuse la demande, le métronome continue et l’interface affiche l’état. Le Wake Lock nécessite une page visible en HTTPS; il évite la veille automatique, mais n’empêche pas un verrouillage manuel et ne garantit pas la lecture audio en arrière-plan.

## Vérifications audio manuelles

À effectuer sur ordinateur et sur un appareil iOS/Safari :

- écouter et vérifier les tempos 60, 100, 120, 132, 200 et 264 BPM ;
- laisser jouer plusieurs minutes, puis vérifier que la pulse reste régulière ;
- modifier plusieurs fois le tempo pendant la lecture et vérifier l’absence de clics doubles ou d’interruption ;
- vérifier le cycle du bouton **Aléatoire**, les cinq premiers clics audibles, les omissions en Pulse et en Séquences et le changement de taux pendant la lecture ;
- vérifier START et STOP; en cas de suspension audio quand la page est visible, l’application tente une reprise automatique. Sur mobile, vérifier que l’écran ne s’assombrit pas automatiquement pendant la lecture et que le Wake Lock est libéré à l’arrêt; sur ordinateur, vérifier qu’aucun Wake Lock n’est demandé. Tester séparément le verrouillage manuel, qui n’est pas empêché par cette API. Toucher **START** si l’audio reste interrompu ou silencieux. Ce bouton redémarre la lecture depuis le début de la pulse ou de la séquence sélectionnée. La lecture pendant le verrouillage n’est pas garantie par le navigateur.
- pour diagnostiquer la version et l’état audio sur iOS, consulter les attributs `data-build-id` et `data-audio-state` de l’élément principal dans l’inspecteur Web.

Le build valide TypeScript et la compilation Vite, mais ne mesure pas la régularité audible. La précision perçue dépend aussi du navigateur, de la charge de l’appareil, du matériel audio et de sa latence. Ces essais réels restent nécessaires.

## Phase 2 — modèle musical et JSON

Le contrat JSON est défini dans `src/music/score.schema.json`. Un document contient le tempo, le mapping explicite BPM/unité élémentaire et des plages de mesures avec leur métrique. Les groupes sont facultatifs uniquement pour les métriques ayant des valeurs par défaut dans `SPECS.md`; sinon, ils doivent être fournis.

`parseScoreJson` et `parseScore` dans `src/music/score.ts` valident le document et développent les plages en mesures contiguës. La première plage peut commencer à n’importe quel numéro positif; les plages suivantes doivent continuer sans saut (par exemple `105-106`, puis `107-108`). Le résultat inclut le détail des mesures et une séquence ordonnée d’événements, un par unité élémentaire, marquant les débuts de groupe. Cette phase fournit le modèle de données seulement : aucun chargement JSON dans l’interface et aucune lecture musicale ne sont ajoutés.

Exécuter les tests du modèle avec :

```bash
npm test
```

Les tests utilisent le runner natif de Node.js et nécessitent Node.js 22 ou supérieur. L'expansion est limitée à 100 000 mesures et 1 000 000 d'événements rythmiques.

## Utilisation hors ligne

Le build de production précache l’application et les séquences avec un Service Worker, sans dépendance supplémentaire. Construire et lancer la version de production avec :

```bash
npm run build
npm run preview
```

Le premier accès doit se faire en ligne. Attendre le message **Application prête hors ligne** avant de couper le réseau; ensuite, recharger la page pour vérifier que l’application démarre. Les Service Workers nécessitent HTTPS ou `localhost`; un accès HTTP via l’adresse IP locale d’un ordinateur ne suffit pas. Sur iOS, le système peut supprimer les données de site et les caches; l’usage hors ligne n’est donc pas une garantie de conservation permanente.

## Déploiement GitHub Pages

Le workflow `.github/workflows/deploy.yml` exécute les tests et le build sur chaque push vers `main`, puis publie `dist` sur GitHub Pages. Pour activer le déploiement, ouvrir **Settings → Pages** dans le dépôt et choisir **GitHub Actions** comme source (*Build and deployment → Source*). Le site du dépôt `christianmelon/metronome` est publié à l’adresse `https://christianmelon.github.io/metronome/`.

## Lecture des séquences

Dans **Séquences**, choisis une entrée de la liste intégrée, puis ajuste la plage de mesures et le décompte. Le menu **Répétition** propose une lecture unique, une boucle continue, une boucle avec deux secondes de pause ou une progression de tempo. Le décompte est joué au début de chaque cycle. La progression répète la plage entière, augmente ou diminue le tempo à chaque cycle, insère deux secondes de pause et s’arrête après le passage au tempo final. Si l’incrément ne tombe pas exactement sur le tempo final, le dernier pas est raccourci pour l’atteindre.

Les débuts de mesure utilisent un bip plus aigu et plus long; les débuts de groupe utilisent le timbre de base. Les subdivisions ne sont pas jouées. Le tempo peut être modifié pendant la lecture; les sons déjà programmés finissent avant que le nouvel intervalle ne s'applique.

Dans **Pulse**, vérifier les tempos 60, 100, 120, 132, 200 et 264 BPM, puis laisser jouer plusieurs minutes. Dans **Séquences**, vérifier le décompte, une plage partielle, la boucle, les accents, le changement de mode pendant la lecture et le tempo modifié en cours de séquence. Effectuer les essais sur Safari/iPhone, haut-parleur du téléphone et AirPlay. Les tests automatisés contrôlent les horaires Web Audio programmés, pas le rendu acoustique ni la latence AirPlay. Pour valider le cache hors ligne, effectuer au moins un test manuel après le premier accès en production.
