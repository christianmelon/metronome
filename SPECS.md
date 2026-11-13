# Métronome musical — SPEC.md

## 1. Présentation du projet

Créer une application Web de métronome musical évolué, destinée notamment au travail de partitions avec des métriques complexes.

L'objectif est de dépasser les limites des métronomes classiques en permettant de décrire précisément les groupes rythmiques et les accents tels qu'ils sont réellement battus par un chef d'orchestre.

L'application doit être :
- simple à utiliser ;
- précise rythmiquement ;
- configurable à partir d'un fichier JSON ;
- utilisable sur ordinateur et smartphone ;
- capable de fonctionner hors connexion après son premier chargement.

## 2. Architecture générale

Application entièrement exécutée dans le navigateur.
En production, un Service Worker précache les fichiers compilés pour permettre une réouverture hors connexion après le premier accès.

Technologies retenues :
- Vue 3
- TypeScript
- Vite
- Web Audio API native
- Nginx en production pour servir les fichiers statiques.

Aucun backend n'est nécessaire.

Node.js est utilisé uniquement pour l'environnement de développement et la compilation.

Architecture cible :

```text
Navigateur
   |
   +-- Interface Vue
   |
   +-- Lecture JSON
   |
   +-- Parser musical
   |
   +-- Générateur de séquence
   |
   +-- Audio Scheduler
           |
           +-- Web Audio API
```

Nginx sert simplement les fichiers compilés.

## 3. Principe fondamental : pré-calcul des séquences

La logique musicale doit être séparée du moteur audio.

Avant le démarrage :
1. Charger le fichier JSON.
2. Analyser les indications de mesure.
3. Déterminer les groupes rythmiques.
4. Développer les plages de mesures.
5. Générer une séquence d'événements ordonnée.
6. Préparer les accents et les sons à jouer.

Au démarrage, le moteur audio reçoit une séquence préparée.

Il ne doit pas avoir à interpréter la partition pendant la lecture.

Le moteur audio doit rester indépendant de Vue et de la logique musicale.

## 4. Gestion du tempo

Le tempo est exprimé en BPM.

Pour une pulse à la noire :

```text
Intervalle = 60 / BPM
```

Exemples :
- 100 BPM = 0,600 seconde
- 120 BPM = 0,500 seconde
- 132 BPM = 0,454545 seconde
- 200 BPM = 0,300 seconde

Le tempo doit pouvoir être modifié pendant la lecture.

Le tempo de session est indépendant du fichier JSON.

## 5. Gestion des métriques

L'application devra gérer des métriques simples avec des valeurs par défaut.

Exemples :

| Mesure | Groupes par défaut |
|---|---|
| 3/4 | 4 + 4 + 4 |
| 4/4 | 4 + 4 + 4 + 4 |
| 5/4 | 4 + 4 + 4 + 4 + 4 |
| 3/8 | 2 + 2 + 2 |

Les valeurs représentent le nombre d'unités rythmiques élémentaires dans chaque groupe.

Les métriques complexes pourront préciser explicitement leurs groupes.

Exemple :

```json
{
  "meter": "15/16",
  "groups": [4, 4, 3, 4]
}
```

Cela représente quatre groupes successifs.

Important : le mapping entre le BPM de référence et l'unité rythmique élémentaire devra être explicite et configurable. Ne pas déduire arbitrairement la durée d'une double-croche à partir du tempo.

## 6. Exemple de partition complète

Exemple de structure JSON envisagée :

```json
{
  "tempo": 132,
  "tempoUnit": {
    "denominator": 4,
    "elementaryUnitsPerTempoBeat": 4
  },
  "sequence": [
    {
      "measures": "1-4",
      "meter": "4/4"
    },
    {
      "measures": "5-10",
      "meter": "15/16",
      "groups": [4, 4, 3, 4]
    },
    {
      "measures": "11-12",
      "meter": "3/4"
    },
    {
      "measures": "13",
      "meter": "3/8"
    },
    {
      "measures": "14-17",
      "meter": "4/4"
    }
  ]
}
```

Les groupes par défaut sont fournis par l'application. Il n'est pas nécessaire de les répéter dans le JSON.

`tempoUnit.denominator` indique la valeur de note correspondant au BPM (`4` pour une noire, `8` pour une croche). `elementaryUnitsPerTempoBeat` donne explicitement le nombre d'unités élémentaires dans cette pulse. Le nombre d'unités élémentaires d'une unité de mesure est calculé à partir de ces deux valeurs et du dénominateur de la métrique. Le mapping doit être exact; sinon le document est invalide.

Les plages de mesures sont inclusives, ordonnées et contiguës, en commençant à la mesure 1. Les groupes personnalisés doivent être des entiers positifs dont la somme couvre exactement la mesure. Sans groupes personnalisés, les valeurs par défaut sont disponibles pour `1/4`, `2/4`, `3/4`, `4/4`, `5/4`, `6/4` et `3/8`; toute autre métrique doit définir explicitement ses groupes.

Le format est décrit par `src/music/score.schema.json` et validé par le parseur TypeScript. Le modèle développé expose une entrée par mesure et une séquence ordonnée d'événements, un par unité élémentaire, avec son numéro de groupe et un indicateur de début de groupe. Le moteur audio et l'application ne chargent pas encore de fichier dans l'interface à cette phase.

Pour borner l'expansion, les métriques acceptent un numérateur jusqu'à 4096 et un dénominateur puissance de deux jusqu'à 64; une mesure peut compter au plus 65 536 unités élémentaires. Un document est limité à 100 000 mesures et 1 000 000 d'événements développés.

## 7. Accents et sons

Chaque début de mesure produit un bip plus aigu et plus marqué.

Chaque début de groupe produit un bip normal.

Les subdivisions pourront éventuellement produire un bip discret.

Configuration sonore envisagée :

- début de mesure : son aigu ;
- début de groupe : son normal ;
- subdivision : son discret.

La configuration sonore doit être indépendante de la structure musicale.

## 8. Plage de travail

L'utilisateur doit pouvoir sélectionner :
- une mesure de début ;
- une mesure de fin.

Exemple : mesures 5 à 10 incluses.

L'application développe automatiquement la plage en six mesures.

Une option de boucle permettra de revenir au début de la plage après la dernière mesure.

## 9. Décompte avant lecture

Avant de commencer la mesure sélectionnée, l'application doit jouer un décompte de quatre pulses.

Exemple :

```text
4 pulses de préparation
        |
        v
Mesure 5
Mesure 6
...
Mesure 10
```

Le nombre de pulses de préparation pourra être configurable.

## 10. Interface cible

Éléments prévus :
- mode Pulse standard ;
- mode Séquences avec une liste de partitions prédéfinies intégrées à l'application (pas de sélecteur de fichiers) ;
- réglage du tempo en mode Standard ou Mécanique ;
- sélection d'une séquence prédéfinie ;
- affichage du tempo ;
- modification du tempo ;
- mesure de début ;
- mesure de fin ;
- nombre de pulses de préparation ;
- activation de la boucle ;
- boutons START et STOP ;
- affichage de la mesure en cours ;
- affichage de la métrique et des groupes.

Le mode Standard conserve la plage 30–300 BPM et un pas de 1 BPM. Le mode Mécanique parcourt les paliers 40–60 par 2, 60–72 par 3, 72–120 par 4, 120–144 par 6 et 144–208 par 8 BPM. Les bornes communes sont dédupliquées. Lors de son activation, le tempo est aligné au palier autorisé le plus proche; en cas d'égalité, le palier inférieur est choisi.

## 11. Précision audio

Utiliser impérativement la Web Audio API.

Ne jamais déclencher directement un son depuis setInterval ou setTimeout.

Le scheduler JavaScript doit programmer les événements audio à l'avance avec AudioContext.currentTime.

Les oscillateurs et enveloppes audio doivent être programmés avec des horaires absolus.

Les timers JavaScript servent uniquement à alimenter le scheduler.

Sur Safari/iOS, AudioContext doit être activé ou repris depuis une interaction utilisateur.

## 12. Phases de développement

### Phase 1 — Pulse audio

Objectif : valider la précision et la stabilité du moteur audio.

- Vite
- Vue 3
- TypeScript
- Web Audio API
- réglage BPM
- START / STOP
- changement de tempo en lecture
- scheduler avec anticipation
- tests Mac et iPhone.

Aucune gestion de partition ou de JSON.

### Phase 2 — Modèle musical et JSON

- définition du format JSON ;
- lecture et validation du JSON ;
- métriques par défaut ;
- groupes explicites ;
- développement des plages de mesures ;
- génération de la séquence pré-calculée.

### Phase 3 — Lecture musicale

- deux modes d’utilisation : pulse standard et lecture de séquences ;
- sélection d’une séquence dans une liste prédéfinie embarquée ;
- accents de début de mesure ;
- bips de début de groupe ;
- décompte ;
- sélection début/fin ;
- boucle ;
- tempo modifiable pendant la lecture.

### Phase 4 — Améliorations

- subdivisions configurables ;
- choix des sons ;
- interface améliorée ;
- installation PWA ;
- tests complémentaires sur mobile.

Le fonctionnement hors connexion de base est assuré par le Service Worker de production : le premier accès nécessite le réseau et HTTPS ou `localhost`. L’installation PWA reste une amélioration distincte.

## 13. Règle de développement

Développer progressivement.

Ne jamais anticiper les phases suivantes sans validation.

Conserver une séparation stricte entre :
- interface ;
- modèle musical ;
- calcul des séquences ;
- moteur audio.

La priorité absolue est la fiabilité du timing.
