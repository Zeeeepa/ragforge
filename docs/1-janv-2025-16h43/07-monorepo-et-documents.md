# 07 - Monorepos et Documents

## Cas concret: ragforge

```
/ragforge
├── package.json                    ← Root (workspaces)
├── docs/                           ← Documentation
│   └── 1-janv-2025-16h43/
├── packages/
│   ├── core/
│   │   └── package.json           ← @luciformresearch/ragforge
│   ├── cli/
│   │   └── package.json           ← @luciformresearch/ragforge-cli
│   ├── studio/
│   │   └── package.json           ← @luciformresearch/ragforge-studio
│   ├── desktop/
│   │   └── package.json           ← @luciformresearch/ragforge-desktop
│   └── luciform-hub/
│       └── package.json           ← luciform-hub
└── LucieCode                       ← Binaire, pas de package.json
```

### Questions

1. **Combien de projets créer?**
   - 1 projet pour tout le monorepo?
   - 1 projet par package.json (6 projets)?
   - 1 projet root + sous-projets liés?

2. **Comment gérer les relations cross-package?**
   - `cli` importe `core`
   - `studio` importe `core`
   - Ces relations doivent être visibles

3. **Où rattacher `/docs`?**
   - Au projet root?
   - Projet séparé "docs"?

---

## Proposition: Hiérarchie de projets

```
┌─────────────────────────────────────────────────────────────────┐
│  ROOT PROJECT (workspace)                                       │
│  path: /ragforge                                                │
│  type: monorepo-root                                            │
│  ─────────────────────────────────────────────                  │
│  Contient:                                                      │
│    • /docs/**                                                   │
│    • /scripts/**                                                │
│    • Fichiers racine (README, etc.)                             │
│    • Relations vers sous-projets                                │
└─────────────────────────────────────────────────────────────────┘
         │
         │ HAS_SUBPROJECT
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  SUBPROJECTS                                                    │
│  ─────────────────────────────────────────                      │
│  • packages/core      → @luciformresearch/ragforge              │
│  • packages/cli       → @luciformresearch/ragforge-cli          │
│  • packages/studio    → @luciformresearch/ragforge-studio       │
│  • packages/desktop   → @luciformresearch/ragforge-desktop      │
│  • packages/luciform-hub → luciform-hub                         │
└─────────────────────────────────────────────────────────────────┘
```

### Détection de monorepo

```typescript
async function detectMonorepo(rootPath: string): Promise<MonorepoInfo | null> {
  const pkgPath = path.join(rootPath, 'package.json');

  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

    // Détecter workspaces (npm/yarn/pnpm)
    const workspaces = pkg.workspaces || pkg.workspaces?.packages;

    if (workspaces) {
      return {
        type: 'npm-workspaces',
        root: rootPath,
        workspacePatterns: Array.isArray(workspaces) ? workspaces : [workspaces],
      };
    }

    // Détecter pnpm-workspace.yaml
    const pnpmWorkspace = path.join(rootPath, 'pnpm-workspace.yaml');
    if (await fileExists(pnpmWorkspace)) {
      const content = await fs.readFile(pnpmWorkspace, 'utf-8');
      const parsed = yaml.parse(content);
      return {
        type: 'pnpm-workspaces',
        root: rootPath,
        workspacePatterns: parsed.packages || [],
      };
    }

    // Détecter lerna.json
    const lernaPath = path.join(rootPath, 'lerna.json');
    if (await fileExists(lernaPath)) {
      const lerna = JSON.parse(await fs.readFile(lernaPath, 'utf-8'));
      return {
        type: 'lerna',
        root: rootPath,
        workspacePatterns: lerna.packages || ['packages/*'],
      };
    }
  } catch {
    // Pas de package.json ou erreur de parsing
  }

  return null;
}
```

### Création des projets

```typescript
async function createMonorepoProjects(monorepo: MonorepoInfo): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];

  // 1. Créer le projet root
  const rootProject: ProjectInfo = {
    id: generateProjectId(monorepo.root),
    path: monorepo.root,
    name: await getPackageName(monorepo.root) || path.basename(monorepo.root),
    type: 'monorepo-root',
    subprojects: [],
  };
  projects.push(rootProject);

  // 2. Trouver et créer les sous-projets
  for (const pattern of monorepo.workspacePatterns) {
    const packageJsons = await glob(`${pattern}/package.json`, {
      cwd: monorepo.root,
      absolute: true,
    });

    for (const pkgPath of packageJsons) {
      const subPath = path.dirname(pkgPath);
      const subProject: ProjectInfo = {
        id: generateProjectId(subPath),
        path: subPath,
        name: await getPackageName(subPath),
        type: 'workspace-package',
        parent: rootProject.id,
      };

      projects.push(subProject);
      rootProject.subprojects.push(subProject.id);
    }
  }

  return projects;
}
```

---

## Gestion des documents

### Types de "dossiers docs"

| Pattern | Exemple | Rattachement |
|---------|---------|--------------|
| `docs/` dans un projet | `/ragforge/docs/` | Projet root |
| `README.md` | `/ragforge/packages/core/README.md` | Projet core |
| Dossier docs standalone | `/home/user/notes/` | Projet "documents" |
| Fichiers .md épars | `/home/user/todo.md` | touched-files |

### Détection des dossiers docs

```typescript
const DOC_FOLDER_PATTERNS = [
  'docs',
  'doc',
  'documentation',
  'wiki',
  'notes',
];

const DOC_FILE_PATTERNS = [
  '**/*.md',
  '**/*.pdf',
  '**/*.docx',
  '**/*.txt',
];

async function detectDocFolders(rootPath: string): Promise<DocFolderInfo[]> {
  const docFolders: DocFolderInfo[] = [];

  // Chercher les dossiers docs connus
  for (const pattern of DOC_FOLDER_PATTERNS) {
    const docPath = path.join(rootPath, pattern);
    if (await directoryExists(docPath)) {
      docFolders.push({
        path: docPath,
        type: 'doc-folder',
        parentProject: rootPath,
      });
    }
  }

  return docFolders;
}
```

### Rattachement des documents

```typescript
function attachDocumentToProject(docPath: string, projects: ProjectInfo[]): string | null {
  // Trouver le projet le plus proche (parent le plus spécifique)
  let bestMatch: ProjectInfo | null = null;
  let bestMatchLength = 0;

  for (const project of projects) {
    if (docPath.startsWith(project.path) && project.path.length > bestMatchLength) {
      bestMatch = project;
      bestMatchLength = project.path.length;
    }
  }

  return bestMatch?.id || null;
}
```

---

## Scénario: LucieCode lancé dans /ragforge

```
./LucieCode (cwd: /ragforge)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. DÉCOUVERTE                                                  │
│  ─────────────────────────────────────────                      │
│  • Détecte monorepo (workspaces dans package.json)              │
│  • Trouve 5 sous-projets dans packages/                         │
│  • Trouve /docs/ → rattaché au root                             │
│  • Crée 6 projets: 1 root + 5 packages                          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. PRIORISATION                                                │
│  ─────────────────────────────────────────                      │
│  cwd = /ragforge → root project prioritaire                     │
│  Queue d'ingestion:                                             │
│    1. ragforge (root) - HIGH                                    │
│    2. packages/core - MEDIUM (souvent importé)                  │
│    3. packages/cli - LOW                                        │
│    4. packages/studio - LOW                                     │
│    5. packages/desktop - LOW                                    │
│    6. luciform-hub - LOW                                        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. INGESTION BACKGROUND                                        │
│  ─────────────────────────────────────────                      │
│  • Root ingéré en premier (docs/, scripts/, README)             │
│  • Puis core (le plus utilisé)                                  │
│  • Puis le reste en parallèle/séquentiel                        │
│  • Tous en schema-ready (pas d'embeddings)                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. AGENT ACCÈDE packages/core/src/tools/fs-tools.ts            │
│  ─────────────────────────────────────────                      │
│  • fs-tools.ts → HIGH priority embedding                        │
│  • Ses imports (brain-tools.ts, etc.) → MEDIUM (contamination)  │
│  • Tout packages/core → boost priorité                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Relations cross-package

### Problème

```typescript
// Dans packages/cli/src/commands/daemon.ts
import { BrainManager } from '@luciformresearch/ragforge';
```

Cette relation doit être visible comme:
```
(cli:daemon.ts)-[:CONSUMES]->(core:brain-manager.ts)
```

### Solution

Lors du parsing, résoudre les imports de workspace:

```typescript
async function resolveWorkspaceImport(
  importPath: string,  // '@luciformresearch/ragforge'
  monorepo: MonorepoInfo
): Promise<string | null> {
  // Trouver quel package correspond
  for (const subproject of monorepo.subprojects) {
    const pkg = await getPackageJson(subproject.path);
    if (pkg.name === importPath) {
      // Résoudre le main/exports
      const mainFile = pkg.main || pkg.exports?.['.'] || 'index.js';
      return path.join(subproject.path, mainFile);
    }
  }
  return null;
}
```

---

## Questions ouvertes

### Q1: Ingérer le monorepo comme un tout ou séparément?

**Option A:** Un seul projet (tout /ragforge)
- Pro: Simple, relations cross-package automatiques
- Con: Gros, lent, tout ou rien

**Option B:** Projets séparés mais liés
- Pro: Granulaire, peut ingérer un package à la fois
- Con: Relations cross-package à résoudre

**Recommandation:** Option B avec résolution des workspace imports.

### Q2: Que faire si l'agent travaille seulement dans packages/core?

Si `cwd = /ragforge/packages/core`:
- Ingérer seulement `core` en priorité?
- Ou tout le monorepo quand même?

**Recommandation:** Ingérer `core` en HIGH, reste en LOW. Si l'agent accède à un autre package, boost sa priorité.

### Q3: Comment gérer LucieCode (binaire sans package.json)?

```
/ragforge/LucieCode  ← Binaire compilé, pas de sources
```

Options:
- Ignorer (pas de sources)
- Créer un "pseudo-projet" pour les fichiers associés

**Recommandation:** Ignorer les binaires, ils n'ont pas de sources à indexer.

### Q4: Les dossiers docs standalone?

Si l'utilisateur a `/home/user/docs/` sans package.json:

Options:
- Ignorer (pas de code)
- Créer un projet "documents"
- Attendre qu'il soit accédé

**Recommandation:** Créer un projet "documents" si on détecte un dossier docs significatif (>5 fichiers .md/.pdf).
