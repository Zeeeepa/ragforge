# RagForge - Publication Strategy

## Executive Summary

RagForge peut etre distribue de plusieurs facons. Voici l'analyse des options et la strategie recommandee.

---

## 1. Etat Actuel des Dependances

### 1.1 Dependances Locales a Publier

| Package | Version | Statut | Action |
|---------|---------|--------|--------|
| `@luciformresearch/codeparsers` | 0.1.3 | Local (`file:`) | **Publier sur npm** |
| `@luciformresearch/ragforge` (core) | 0.3.0 | Monorepo | Publier apres codeparsers |
| `@luciformresearch/ragforge-cli` | 0.2.3 | Monorepo | Publier apres core |

### 1.2 Dependances Natives (Potentiellement Problematiques)

| Package | Usage | Probleme | Solution |
|---------|-------|----------|----------|
| `@vscode/ripgrep` | Grep tool | Binaires pre-compiles | OK, s'installe bien |
| `canvas` | 3D rendering (Three.js) | Necessite Cairo | Rendre **optionnel** |
| `gl` | 3D rendering (Three.js) | Necessite OpenGL | Rendre **optionnel** |
| `playwright` | Web scraping | Telecharge browsers | Import dynamique, OK |
| `tesseract.js` | OCR | WASM | OK, pas de compilation |

### 1.3 Dependances WASM (Sans Probleme)

- `web-tree-sitter` (codeparsers) - Pure WASM
- `tesseract.js` - WASM-based OCR
- `pdf2json` - Pure JS

---

## 2. Options de Distribution

### Option A: MCP Server pour Claude (RECOMMANDEE)

**Description**: Package npm installable qui fournit un serveur MCP.

```bash
# Installation
npm install -g @luciformresearch/ragforge-cli

# Configuration Claude Desktop
# ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "ragforge": {
      "command": "ragforge",
      "args": ["mcp"]
    }
  }
}
```

**Avantages**:
- Integration native avec Claude Code/Desktop
- Pas besoin de gerer une API
- Le daemon se lance automatiquement
- Neo4j se configure automatiquement (Docker)

**Inconvenients**:
- Limite a Claude comme client
- Necessite Docker pour Neo4j

### Option B: CLI Global

**Description**: Outil en ligne de commande global.

```bash
npm install -g @luciformresearch/ragforge-cli
ragforge ingest ./mon-projet
ragforge search "authentication logic"
```

**Avantages**:
- Utilisable dans n'importe quel workflow
- Scriptable, CI/CD friendly

**Inconvenients**:
- Moins "magique" que MCP
- Necessite configuration manuelle

### Option C: API HTTP/REST

**Description**: Serveur HTTP exposant les fonctionnalites.

```bash
ragforge serve --port 3000
```

**Avantages**:
- Integrable dans n'importe quelle app
- Multi-clients

**Inconvenients**:
- Plus de travail de developpement
- Gestion de l'authentification
- Documentation API necessaire

---

## 3. Strategie Recommandee

### Phase 1: Publication NPM (Immediate)

1. **Publier `@luciformresearch/codeparsers`** sur npm
   ```bash
   cd ~/LR_CodeRag/packages/codeparsers
   npm publish --access public
   ```

2. **Mettre a jour les references file:**
   - `packages/core/package.json`: `"@luciformresearch/codeparsers": "^0.1.3"`
   - `packages/cli/package.json`: `"@luciformresearch/ragforge": "^0.3.0"`

3. **Rendre canvas/gl optionnels** (pour les utilisateurs sans besoin 3D)
   - Deplacer vers `optionalDependencies`
   - Ajouter try/catch a l'import dans threed-tools.ts

4. **Publier core puis cli**
   ```bash
   cd packages/core && npm publish
   cd packages/cli && npm publish
   ```

### Phase 2: Documentation MCP (Cette Semaine)

Creer un README focuse sur l'utilisation MCP avec Claude:

```markdown
# RagForge - Brain for Claude

Transformez Claude en un agent avec memoire persistante.

## Quick Start

\`\`\`bash
# 1. Installer
npm install -g @luciformresearch/ragforge-cli

# 2. Configurer Claude Desktop
ragforge setup-claude

# 3. C'est tout! Claude a maintenant acces a RagForge
\`\`\`
```

### Phase 3: Simplification Installation (Moyen Terme)

1. **Creer `ragforge setup-claude`** qui configure automatiquement:
   - Claude Desktop config
   - Docker Neo4j
   - Cles API Gemini

2. **Package Docker optionnel** pour eviter deps natives:
   ```bash
   docker run -it ragforge/brain
   ```

---

## 4. Pre-requis Utilisateur Final

### Minimal (MCP Only)
- Node.js >= 18
- Docker (pour Neo4j)
- Cle API Gemini (gratuite)

### Complet (avec 3D)
- Tout ce qui precede
- Cairo (pour canvas)
- OpenGL libs (pour gl)
- `npm install playwright && npx playwright install chromium`

---

## 5. Checklist Pre-Publication

### codeparsers
- [ ] Verifier que les tests passent
- [ ] Bump version si necessaire
- [ ] npm publish --access public

### ragforge (core)
- [ ] Remplacer `file:` par version npm de codeparsers
- [ ] Deplacer canvas/gl vers optionalDependencies
- [ ] Ajouter try/catch pour imports optionnels
- [ ] Mettre a jour README avec instructions installation
- [ ] npm publish --access public

### ragforge-cli
- [ ] Remplacer `file:` par version npm de core
- [ ] Ajouter commande `setup-claude`
- [ ] Creer README MCP-focused
- [ ] npm publish --access public

---

## 6. Pricing / Monetisation (Reflexion)

### Option A: Open Source Complet
- Core + CLI gratuits
- Support payant
- Fonctionnalites enterprise (auth, multi-tenant)

### Option B: Freemium
- CLI gratuit (fonctions basiques)
- Features avancees payantes (3D, OCR, agents)

### Option C: License Commercial
- Open source pour usage personnel/recherche
- License payante pour usage commercial
- Modele a la GitLab/Sourcegraph

---

## 7. Next Steps Immediats

1. **Tester l'installation from scratch**:
   ```bash
   # Dans un dossier vide
   npm init -y
   npm install @luciformresearch/ragforge-cli
   npx ragforge --version
   ```

2. **Documenter les erreurs possibles**:
   - Docker non installe
   - Gemini API key manquante
   - Deps natives manquantes

3. **Creer script setup-claude**:
   - Detecte OS
   - Configure claude_desktop_config.json
   - Lance Docker si necessaire
