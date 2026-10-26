# Identité Camtoone actuelle — vérifiée le 24 octobre 2026

Ne pas reprendre `sources/rebranding/cam2one-logo-transparent.png` ou les icônes
historiques macOS : elles appartiennent à l'ancienne identité.

Sources canoniques actuellement publiées :
- Mot-symbole blanc/rouge et slogan : https://camtoone.app/assets/camtoone-logo.svg
- Variante sombre sur fond clair : https://camtoone.com/_launch/beta-20261022/assets/f109afbb69f2.svg
- Icône transparente : https://camtoone.com/_launch/beta-20261022/assets/a70ea0a15229.png
- Favicon : https://camtoone.app/assets/favicon.svg

Le HTML embarque le SVG exact, sans retraitement, et le favicon exact. `icon.png`
est identique octet pour octet à l'icône publique .com. `logo.png` est un export
PNG transparent du SVG .app, avec les zones blanches en gris neutre #7b7b80.
Cette variante de présentation conserve les tracés et le rouge du logo, et reste
lisible sur les thèmes clairs comme sombres de la fiche native HA, qui utilise
une seule image fixe. Aucun cartouche ni contour ajouté. L'icône reste inchangée.

Fichiers locaux correspondants : `output/camtoone-app-landing-20261023/assets/`
et `output/public-beta-20261022/_launch/beta-20261022/assets/` à la racine du projet.
Les empreintes du site ont été vérifiées avant copie : preuve complète
`qa/bridge-brand-correction-20261024/brand-provenance.json`.

Style du pont : noir #000, rouge #ff002c, texte #f5f5f7, gris #929297,
séparateurs fins et boutons arrondis. Conserver le parcours compact d'administration.

Depuis 0.3.3, le mot-symbole blanc .app est utilisé sur fonds sombres et la
variante noire .com sur fonds clairs. Les couleurs d'interface suivent le thème
HA effectivement actif (rôles CSS résolus du parent Ingress), sans recolorer
l'artwork canonique. Hors HA, repli clair/sombre du système.
