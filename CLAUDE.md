# Ableton Simon Plugs — contexte du repo

Collection de devices Max for Live pour Ableton Live 12 Suite (Max 9), créés au fil des sessions. Chaque nouveau plugin est ajouté ici.

## Structure
```
plugins/<nom>/
  build.py        génère les .amxd dans dist/ (aucun .amxd édité à la main)
  *.js            logique (js / jsui, ES5 : pas de let/const/=>, moteur JS classique de Max)
  dist/*.amxd     devices générés, versionnés pour l'installation directe
  docs/*.png      captures utilisées par les README
  README.md       rôle, installation, utilisation, limites
tools/            outils partagés (ex. render_view.js : rend un jsui en SVG/PNG via une API mgraphics simulée)
README.md         index : un lien vers le README de chaque plugin + description courte + capture
```

## Règles
- **Chaque plugin a son README** (`plugins/<nom>/README.md`) : ce qu'il fait, installation, utilisation, limites connues.
- **Le README racine liste tous les plugins** : lien vers le README du plugin, une phrase sur ce qu'il fait, une capture d'écran (`plugins/<nom>/docs/*.png`). À mettre à jour à chaque ajout ou changement visible.
- Captures : une vraie capture dans Live quand elle existe ; sinon un rendu du code d'affichage avec `tools/render_view.js`, signalé comme tel dans la légende.
- Format `.amxd` : `ampf` + u32 4 + type (`aaaa` audio, `mmmm` MIDI, `iiii` instrument) + `meta` + u32 4 + u32 0 + `ptch` + u32 longueur + JSON du patcher terminé par `\n\0` (longueur incluant le `\0`).
- Devices non gelés : les `.js` doivent être dans le même dossier que les `.amxd` (ou dans `Documents/Max 9/Library`). Pour distribuer un seul fichier : ouvrir dans Max → Freeze Device.
- Tester la logique JS hors Max (Node + API simulée) avant de livrer, et dire explicitement ce qui n'a pas été vérifié dans Live.
- Installation locale : `Documents/Ableton/User Library/Presets/<Audio Effects|MIDI Effects|Instruments>/Max .../<Nom>/`.
- Repo public : aucune donnée personnelle, aucun chemin machine dans le code ou les README.
