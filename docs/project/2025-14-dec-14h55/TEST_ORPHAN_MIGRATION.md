# Test Orphan to Project Migration

Date: 2025-12-14 15:35

## Objectif

Ce fichier teste le flow de migration des fichiers orphelins vers un projet.

## Scénario

1. Ce fichier est créé dans un dossier non-ingéré
2. Le TouchedFilesWatcher devrait le détecter comme orphelin
3. Ensuite, on ingère le dossier parent
4. Les orphelins devraient être migrés vers le nouveau projet

## UUID Déterministe

Les UUIDs sont maintenant générés de manière déterministe basée sur le chemin absolu.
Cela permet de réutiliser le même UUID lors de la migration orphan → project.
