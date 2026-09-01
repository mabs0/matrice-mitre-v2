# Banc d'essai

Vérification headless de l'application, sans navigateur : jsdom charge
`index.html`, `fetch` est remplacé par un mini-bundle ATT&CK synthétique, et le
parcours complet est joué — page d'accueil (sections, ancres de la barre haute,
matrice du haut de page, parcours, bénéfices, FAQ, pied de page), création d'un
layer, les questionnaires du catalogue, report des scores dans la matrice,
méthodes de notation et d'agrégation, contributions entre mitigations, filtre de
plateforme, modale d'une technique, aller-retour export/import (JSON clair, JSON
chiffré, Excel, classeur d'origine), ordre de parcours, atteignabilité du
niveau 0, progression du téléchargement, robustesse à un HTML en cache, retour à
l'accueil et bascule de thème.

541 assertions. Le banc affiche le décompte en fin de parcours : le recopier ici
l'avait déjà laissé dériver de plusieurs centaines sans que rien ne le signale.

```bash
cd test
npm install
npm test
```

Les dépendances ne servent qu'ici. Le site n'a **aucune** dépendance de build :
`index.html`, `css/` et `js/` se servent tels quels sur GitHub Pages.

Pour l'ouvrir en local, il faut un serveur — les modules ES ne se chargent pas
depuis `file://` :

```bash
python3 -m http.server 8000
```

## Ce que le banc ne couvre pas

- Le rendu visuel réel (jsdom n'applique pas les feuilles de style) : la mise
  en page, les contrastes et le défilement de la matrice se vérifient dans un
  vrai navigateur.
- Le bundle ATT&CK complet. `harness.mjs` travaille sur des données
  synthétiques pour rester rapide ; la normalisation a été vérifiée séparément
  contre la v19.1 réelle (15 tactiques, 222 techniques, 475 sous-techniques
  toutes rattachées, 44 mitigations).
