# Publier les modules Camtoone

Chaque module possède son dossier, sa documentation et ses propres versions. Le catalogue principal renvoie vers la fiche de chaque module.

## Identifiants de versions

| Module | Préfixe de tag | Exemple de nom de paquet |
| --- | --- | --- |
| Bridge Home Assistant | `bridge-home-assistant-v` | `camtoone-bridge-home-assistant-X.Y.Z.tar.gz` |
| Bridge Docker | `bridge-docker-v` | `camtoone-bridge-docker-X.Y.Z.tar.gz` |
| Bridge Scrypted | `bridge-scrypted-v` | `camtoone-bridge-scrypted-X.Y.Z.zip` |

`X.Y.Z` est un exemple de numéro de version. Le format du paquet doit être vérifié avec l’installateur concerné avant sa première publication.

## Contenu d’une publication

Une version téléchargeable fournit :

- Le nom du module et son numéro de version.
- Les prérequis et la compatibilité vérifiée avec Camtoone et l’environnement cible.
- Le paquet d’installation, ses éventuelles variantes d’architecture et ses empreintes SHA-256.
- Les instructions d’installation et de mise à jour, ainsi que les changements de la version.
- Les limites connues et le résultat des vérifications réalisées sur le paquet distribué.

La fiche du module est mise à jour avec le lien exact vers cette version après vérification du téléchargement.

## Sélection des mises à jour

Les versions des différents modules partagent ce dépôt. Un mécanisme de mise à jour doit sélectionner les versions du module concerné à partir de son préfixe, puis appliquer sa politique de stabilité et de compatibilité.

L’adresse globale `releases/latest` peut désigner un autre module : les liens d’installation doivent viser la version exacte du bon module.

Les URL de mise à jour d’installations existantes ne sont modifiées qu’avec une migration compatible et vérifiée. La création de ce catalogue ne modifie pas leur configuration.

## Contenu distribué

Les paquets publics sont préparés à partir des seuls fichiers nécessaires au module. Les identifiants de connexion, jetons, clés privées, données d’installation et captures personnelles restent hors des publications.

La mention « disponible » est ajoutée au catalogue lorsque le paquet publié et son installation ont été vérifiés.
