# Récapitulatif : Intégration GraphRAG pour Documents dans RagForge

Ce document récapitule les étapes entreprises pour intégrer la gestion de documents enrichie par GraphRAG dans le framework `ragforge`.

## Objectif

Étendre `ragforge` pour traiter des documents (PDF, Markdown) et en extraire des entités/relations afin de construire un graphe de connaissances dans Neo4j. Ce graphe sera ensuite exploité par les agents de `ragforge` via des outils générés.

## Découverte Clé

Lors de l'analyse, il a été constaté que l'intégration avancée de LlamaIndex avec Neo4j (notamment le `Neo4jGraphStore` et `KnowledgeGraphIndex` pour la construction automatisée de graphes) est principalement disponible dans la version **Python** de LlamaIndex, et non dans la version TypeScript (`llamaindex`) utilisée dans ce projet.

## Stratégie Adoptée : Approche Hybride et Modulaire

Pour contourner cette limitation tout en capitalisant sur les points forts de `ragforge` et de LlamaIndex.js, une stratégie hybride a été mise en place :

1.  **Chargement et "Chunking" des Documents (via LlamaIndex.js)** :
    *   Nous utilisons les lecteurs (`PDFReader`, `MarkdownReader`) et les splitters (`RecursiveCharacterTextSplitter`) de LlamaIndex.js pour gérer la lecture de divers formats de documents et leur découpage en "chunks" de texte pertinents.

2.  **Extraction d'Entités/Relations & Persistance dans Neo4j (implémentation `ragforge/core`)** :
    *   La logique de transformation du texte en graphe est implémentée directement dans `ragforge/core`. Pour chaque "chunk" :
        *   Un `IStructuredLLMExecutor` (abstraction de votre `StructuredLLMExecutor` existant) est utilisé pour appeler un LLM (Gemini) afin d'extraire des entités et des relations structurées selon un schéma `GraphExtractionSchema` défini.
        *   Un `INeo4jClient` (abstraction de votre `Neo4jClient` existant) est utilisé pour exécuter des requêtes Cypher qui fusionnent ces entités et relations dans Neo4j, liant également les chunks et les documents sources.

3.  **Génération d'Outils `ragforge`** : Une fois le graphe peuplé dans Neo4j, la commande existante `ragforge generate` introspectera le nouveau schéma (incluant les nœuds `Document`, `Chunk`, `Company`, `RiskFactor`, etc., et leurs relations) pour générer automatiquement les outils de requête typés que les agents pourront utiliser.

## Composants Clés Créés ou Modifiés

*   **`packages/core/src/database/neo4j-client.ts`** : Définition de l'interface `INeo4jClient` et `Neo4jConfig` pour permettre le découplage de `core` vis-à-vis de l'implémentation `runtime`.
*   **`packages/core/src/llm/llm-provider.ts`** : Définition de l'interface `ILLMProvider` pour l'abstraction des fournisseurs de LLM.
*   **`packages/core/src/llm/structured-llm-executor.ts`** : Définition de l'interface `IStructuredLLMExecutor` pour l'abstraction de l'exécution structurée de LLM, essentielle à l'extraction.
*   **`packages/core/src/ingestion/document-ingestion-pipeline.ts`** : La classe principale de la pipeline, intégrant les lecteurs LlamaIndex, l'extraction via `IStructuredLLMExecutor` et la logique de persistance Cypher via `INeo4jClient`.
*   **`packages/core/src/ingestion/ExtractedGraphData.ts`** : Interface pour le format de données attendu après extraction par le LLM. (Note: initialement définie dans le même fichier que la pipeline, peut être déplacée si nécessaire).
*   **`packages/core/src/index.ts`** : Exportations mises à jour pour inclure les nouveaux modules `database`, `llm` et `ingestion`.
*   **`packages/runtime/package.json`** : Ajout de la dépendance `@llamaindex/readers` pour le chargement des documents.
*   **`examples/tool-calling-agent/scripts/ingest-document.ts`** : Un script d'exemple pour orchestrer et lancer la `DocumentIngestionPipeline`, configurant les clients réels (`Neo4jClient` et `GeminiAPIProvider` du `runtime`) et une `GraphExtractionSchema` d'exemple.

## État Actuel et Prochaines Étapes

*   **État Actuel** : Tous les composants de la pipeline d'ingestion ont été esquissés et configurés. Le script d'exemple est prêt.
*   **Prochaine Étape** : Exécuter le script `ingest-document.ts` pour peupler votre base Neo4j avec le graphe extrait du document.
    *   **Pré-requis** : Assurez-vous que Neo4j est démarré et que `GEMINI_API_KEY` est configurée.
    *   **Commande** : `tsx examples/tool-calling-agent/scripts/ingest-document.ts`

Une fois l'ingestion réussie, nous pourrons passer à l'étape `ragforge generate`.