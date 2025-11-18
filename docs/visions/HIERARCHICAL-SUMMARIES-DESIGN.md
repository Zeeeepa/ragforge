# Résumés Hiérarchiques et Contexte Dual - Design Détaillé

## 🎯 Objectifs

1. **Résumés hiérarchiques basés sur caractères** - tous les niveaux (L1, L2, L3...) se créent quand un seuil de caractères est atteint
2. **Contexte dual** - deux sources de contexte distinctes et complémentaires
3. **Résumés structurés** - conversation + actions séparément
4. **Tool calls formatés** - liens entre reasoning et tool calls

## 📊 Système de Résumés Basé sur Caractères

### Principe

**Tous les niveaux** se basent sur le nombre de caractères, pas sur le nombre d'éléments :

```
Configuration:
- summarizeEveryNChars: 10000 (par défaut)

Niveau L1:
- Trigger: Tous les 10k caractères de conversation brute
- Résume: Messages bruts (user + assistant)
- Format: { conversation_summary, actions_summary }

Niveau L2:
- Trigger: Tous les 10k caractères de résumés L1
- Résume: Résumés L1 (pas les messages!)
- Format: { conversation_summary, actions_summary }

Niveau L3:
- Trigger: Tous les 10k caractères de résumés L2
- Résume: Résumés L2
- Format: { conversation_summary, actions_summary }

... et ainsi de suite
```

### Exemple Concret

```
Messages bruts (avec char counts):
├─ Turn 1: User (500 chars) + Assistant (1500 chars) = 2000 chars
├─ Turn 2: User (800 chars) + Assistant (2200 chars) = 3000 chars
├─ Turn 3: User (1000 chars) + Assistant (4000 chars) = 5000 chars
│  → Total: 10000 chars
│  → TRIGGER L1 Summary #1 (chars 0-10000)
│
├─ Turn 4: User (600 chars) + Assistant (2400 chars) = 3000 chars
├─ Turn 5: User (1200 chars) + Assistant (5800 chars) = 7000 chars
│  → Total: 20000 chars (10k nouveaux)
│  → TRIGGER L1 Summary #2 (chars 10000-20000)
│
├─ Turn 6-10: ... 10k chars more
│  → TRIGGER L1 Summary #3 (chars 20000-30000)
│
├─ Turn 11-15: ... 10k chars more
│  → TRIGGER L1 Summary #4 (chars 30000-40000)
│
│  → CHECK L2: Summaries L1 totaux:
│     - L1 #1: ~500 chars summary
│     - L1 #2: ~500 chars summary
│     - L1 #3: ~500 chars summary
│     - L1 #4: ~500 chars summary
│     → Total L1 summaries chars: 2000 chars (pas encore 10k)
│     → PAS de L2 trigger
│
├─ Turns 16-50: ... plus de conversations
│  → 20 L1 summaries créés (20 * 500 chars = 10000 chars de summaries L1)
│  → TRIGGER L2 Summary #1 (résume L1 #1-20, covering chars 0-200000)
│
├─ Turns 51-100: ... encore plus
│  → 20 L1 summaries de plus (L1 #21-40)
│  → TRIGGER L2 Summary #2 (résume L1 #21-40)
│
│  → CHECK L3: Summaries L2 totaux:
│     - L2 #1: ~500 chars
│     - L2 #2: ~500 chars
│     → Total: 1000 chars (pas encore 10k)
│     → PAS de L3 trigger
```

### Stockage dans Neo4j

```cypher
// L1 Summary (résume messages bruts)
(:Summary {
  level: 1,
  char_range_start: 0,
  char_range_end: 10000,
  content: {
    conversation_summary: "L'utilisateur a demandé d'analyser AuthService. Je lui ai expliqué qu'il contient 3 fonctions principales...",
    actions_summary: "J'ai utilisé search_functions pour trouver les fonctions (→ 15 résultats), puis get_function_details sur AuthService.validatePassword..."
  },
  created_at: "2025-01-15T10:00:00Z",
  parent_summaries: []  // Empty pour L1
})

// L2 Summary (résume 20 L1 summaries)
(:Summary {
  level: 2,
  char_range_start: 0,          // Char range des MESSAGES originaux couverts
  char_range_end: 200000,
  content: {
    conversation_summary: "Session de refactoring d'authentification. L'utilisateur a exploré AuthService, UserService, et TokenService...",
    actions_summary: "Recherches multiples de fonctions, analyse de dépendances avec get_dependents, extraction de code avec batch_analyze..."
  },
  created_at: "2025-01-15T12:00:00Z",
  parent_summaries: ["l1-uuid-1", "l1-uuid-2", ..., "l1-uuid-20"]
})
```

## 🔄 Contexte Dual - Deux Systèmes Séparés

### Contexte 1: Recent Messages (Non-résumés)

**But**: Garder les derniers échanges en détail pour cohérence immédiate

**Configuration**:
```typescript
config: {
  recentContextMaxChars: 5000,    // Max chars de messages récents
  recentContextMaxTurns: 10       // Max nombre de turns (user+assistant)
}
```

**Fonctionnement**:
```
Toujours inclure dans le contexte:
- Les N derniers turns complets (user + assistant)
- OU jusqu'à ce qu'on atteigne X caractères
- Format: Messages bruts, pas résumés
- Ordre: Chronologique
```

**Exemple**:
```
Recent Context (derniers 3 turns):

Turn 8:
  User: "Show me the validatePassword function"
  Assistant: "Here's the code... [500 chars]"
  Reasoning: "I'll use get_function_code to retrieve it"
  Tools: [get_function_code(name="validatePassword")]

Turn 9:
  User: "What are its dependencies?"
  Assistant: "It depends on hashPassword and checkPasswordStrength... [400 chars]"
  Reasoning: "I'll use get_dependents to find them"
  Tools: [get_dependents(scopeName="validatePassword")]

Turn 10:
  User: "Suggest refactoring"
  Assistant: "I suggest splitting into... [600 chars]"
  Reasoning: "Based on complexity analysis, I'll use batch_analyze"
  Tools: [batch_analyze(...)]
```

### Contexte 2: RAG sur Summaries (Historique lointain)

**But**: Récupérer contexte pertinent des conversations passées via similarité sémantique

**Configuration**:
```typescript
config: {
  ragMaxSummaries: 5,                // Top N summaries les plus pertinentes
  ragMinScore: 0.7,                  // Score minimum de similarité
  ragLevelBoost: {                   // Boost selon niveau
    1: 1.0,                          // L1: pas de boost
    2: 1.1,                          // L2: +10%
    3: 1.2,                          // L3: +20%
  },
  ragRecencyBoost: true,             // Boost pour summaries récents
  ragRecencyDecayDays: 7             // Décroissance sur 7 jours
}
```

**Scoring**:
```typescript
// Score final = similarity × levelBoost × recencyBoost

function calculateSummaryScore(
  summary: Summary,
  cosineSimilarity: number
): number {
  // 1. Base similarity
  let score = cosineSimilarity;

  // 2. Level boost (higher levels = plus abstrait = plus utile)
  const levelBoost = config.ragLevelBoost[summary.level] || 1.0;
  score *= levelBoost;

  // 3. Recency boost (plus récent = plus pertinent)
  if (config.ragRecencyBoost) {
    const ageInDays = (Date.now() - summary.created_at) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.exp(-ageInDays / config.ragRecencyDecayDays);
    // Decay exponentiel: 1.0 (aujourd'hui) → 0.37 (7 jours) → 0.14 (14 jours)
    score *= (0.5 + 0.5 * recencyBoost);  // Entre 0.5x et 1.0x
  }

  return score;
}
```

**Query Flow**:
```
1. User message: "How did we handle authentication before?"

2. Generate embedding du message

3. Vector search sur tous les Summary nodes:
   MATCH (s:Summary)
   WHERE s.embedding IS NOT NULL
   WITH s, vector.similarity.cosine(s.embedding, $queryEmbedding) as similarity
   RETURN s, similarity

4. Calculer score final pour chaque summary:
   - Summary L3 "auth refactoring", similarity=0.85, age=2 days
     → score = 0.85 × 1.2 (L3 boost) × 0.93 (recency) = 0.95

   - Summary L1 "validatePassword details", similarity=0.90, age=10 days
     → score = 0.90 × 1.0 × 0.61 = 0.55

5. Prendre top 5 summaries par score

6. Inclure dans contexte
```

### Contexte Final = Recent + RAG

```typescript
// System prompt construction

const context = `
## Recent Conversation (derniers échanges détaillés)

Turn 8:
User: "Show me validatePassword"
Assistant: "Here's the code..."
[reasoning: Using get_function_code]
[tools: get_function_code(name="validatePassword") → success]

Turn 9:
User: "What are its dependencies?"
Assistant: "It depends on hashPassword..."
[reasoning: Using get_dependents]
[tools: get_dependents(scopeName="validatePassword") → 2 dependencies found]

---

## Relevant Past Context (RAG sur historique)

[L3 Summary - Auth Refactoring Session - 2 days ago]
Conversation: "L'utilisateur a mené une session complète de refactoring du système d'authentification, explorant AuthService, UserService, et les dépendances..."
Actions: "Recherches multiples avec search_functions, analyses de complexité avec batch_analyze, extraction de dépendances avec get_dependents..."

[L2 Summary - Password Validation Analysis - 5 days ago]
Conversation: "L'utilisateur a analysé en détail validatePassword et checkPasswordStrength, posant des questions sur la sécurité..."
Actions: "Recherche de fonctions de validation, analyse de code avec get_function_code, suggestions de refactoring..."

[L1 Summary - hashPassword Implementation - 3 days ago]
Conversation: "L'utilisateur a demandé l'implémentation de hashPassword. J'ai expliqué l'utilisation de bcrypt..."
Actions: "Récupération du code avec get_function_code, analyse des dépendances externes..."

---

Now answer the user's question with this context.
`;
```

## 📝 Structure des Résumés

### Format Structuré

Chaque summary contient **deux parties distinctes** :

```typescript
interface SummaryContent {
  conversation_summary: string;   // 3-4 lignes max
  actions_summary: string;        // 3-4 lignes max
}
```

### Partie 1: Conversation Summary

**Focus**: Questions de l'utilisateur et réponses de l'assistant

**Format**: "L'utilisateur a demandé X, donc je lui ai répondu Y..."

**Exemple**:
```
L'utilisateur a demandé d'analyser la fonction validatePassword pour comprendre
son fonctionnement. Je lui ai expliqué qu'elle utilise bcrypt pour hasher les
mots de passe et vérifie la force via checkPasswordStrength. Il a ensuite demandé
les dépendances, j'ai listé hashPassword et checkPasswordStrength.
```

### Partie 2: Actions Summary

**Focus**: Tool calls effectués par l'assistant avec leurs résultats

**Format**: Lier reasoning + tool calls de manière narrative

**Exemple**:
```
J'ai d'abord utilisé search_functions(query="password validation") qui a retourné
15 fonctions. Puis j'ai appelé get_function_code(name="validatePassword") pour
récupérer l'implémentation (157 lignes). Ensuite get_dependents(scopeName="validatePassword")
a révélé 2 dépendances: hashPassword et checkPasswordStrength.
```

### Génération avec LLM

**Prompt pour L1** (résume messages bruts):
```typescript
const messagesFormatted = `
Turn 1:
User: "Show me validatePassword"
Assistant: "Here's the implementation... [code]"
Reasoning: "I'll use get_function_code to retrieve the full implementation"
Tools:
  - get_function_code(name="validatePassword")
    → Success: Returned 157 lines of code

Turn 2:
User: "What are its dependencies?"
Assistant: "It depends on two functions: hashPassword and checkPasswordStrength..."
Reasoning: "I'll use get_dependents to find all functions that validatePassword calls"
Tools:
  - get_dependents(scopeName="validatePassword")
    → Success: Found 2 dependencies
`;

const prompt = `Summarize this conversation segment into two parts:

1. **Conversation Summary** (3-4 lines max):
   Focus on what the user asked and what you answered.
   Format: "L'utilisateur a demandé X, donc je lui ai répondu Y..."

2. **Actions Summary** (3-4 lines max):
   Focus on the tools you called and their results, linked with your reasoning.
   Format: "J'ai utilisé tool_name(args) qui a retourné X, puis..."

Be factual and preserve critical details.`;

const result = await llm.call({
  prompt,
  input: messagesFormatted,
  outputSchema: {
    conversation_summary: { type: 'string', maxLength: 500 },
    actions_summary: { type: 'string', maxLength: 500 }
  }
});
```

**Prompt pour L2+** (résume des summaries L1):
```typescript
const l1Summaries = `
L1 Summary #1 (chars 0-10k):
  Conversation: "L'utilisateur a demandé d'analyser validatePassword..."
  Actions: "J'ai utilisé search_functions puis get_function_code..."

L1 Summary #2 (chars 10k-20k):
  Conversation: "L'utilisateur a demandé les dépendances de validatePassword..."
  Actions: "J'ai utilisé get_dependents qui a trouvé 2 fonctions..."

L1 Summary #3 (chars 20k-30k):
  Conversation: "L'utilisateur a demandé des suggestions de refactoring..."
  Actions: "J'ai utilisé batch_analyze sur les 3 fonctions liées..."
`;

const prompt = `Synthesize these conversation summaries into a higher-level summary.

Combine them into two coherent parts:

1. **Conversation Summary** (3-4 lines max):
   What were the main topics and questions across all these segments?

2. **Actions Summary** (3-4 lines max):
   What were the main tools used and patterns of investigation?

Maintain chronological flow if relevant.`;

const result = await llm.call({
  prompt,
  input: l1Summaries,
  outputSchema: {
    conversation_summary: { type: 'string', maxLength: 500 },
    actions_summary: { type: 'string', maxLength: 500 }
  }
});
```

## 🔗 Formatage des Tool Calls avec Reasoning

### Principe

Au lieu de stocker séparément:
- Liste de reasonings
- Liste de tool calls

On **lie** chaque tool call à son reasoning dans le formatage.

### Structure dans Message

```typescript
interface Message {
  uuid: string;
  content: string;         // Réponse de l'assistant
  reasoning?: string;      // Thinking global (optionnel)
  tool_calls?: ToolCall[]; // Tools appelés
}

interface ToolCall {
  tool_name: string;
  arguments: any;
  reasoning?: string;      // Reasoning spécifique à ce tool call
  result: any;
  success: boolean;
  duration_ms: number;
}
```

### Exemple de Formatage pour Résumé

Quand on prépare les messages pour le résumé L1, on les formate ainsi:

```
Turn 5:
User: "Find authentication functions and analyze them"
On **lie** chaque tool call à son reasoning dans le formatage.

### Structure dans Message

```typescript
interface Message {
  uuid: string;
  content: string;         // Réponse de l'assistant
  reasoning?: string;      // Thinking global (optionnel)
  tool_calls?: ToolCall[]; // Tools appelés
}

interface ToolCall {
  tool_name: string;
  arguments: any;
  reasoning?: string;      // Reasoning spécifique à ce tool call (NEW)
  result: any;
  success: boolean;
  duration_ms: number;
  iteration?: number;      // Si per-item mode
}
```

### Exemple de Formatage pour Résumé

Quand on prépare les messages pour le résumé L1, on les formate ainsi:

```
Turn 5:
User: "Find authentication functions and analyze them"


# note lucie: personnae .luciform additionnelle pour l'agent dans sa réponse finale, pour donner un petit caractère au llm:
voir /home/luciedefraiteur/lr_hmm/personas
pour expliquer: une personnae .luciform est un xml qui est envoyé au llm, il contient des symboles qui doivent etre passés aussi au llm.


#note lucie 2: generation de relationship par topic, et de topics, quand on fait des résumés, possibilité de rechercher des topics, merge de topics triggerés quand ceux ci sont proposés proches par un llm (quand génération résumé l + 1), 

possibilité de contraindre une recherche par topic

#note lucie 3: si evalution llm propose un merge de topics mais avec un score pas très haut de confidence, possibilité de générer plutot des relationship "related topics" pour un topic donné.