/**
 * Implements the `ragforge create` command.
 *
 * Creates a new TypeScript project with minimal structure:
 * - package.json (ESM, TypeScript, tsx)
 * - tsconfig.json (strict, ES2022)
 * - src/index.ts (entry point)
 * - .gitignore
 * - .ragforge/ (RAG workspace with quickstart)
 */

import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { runQuickstart, type QuickstartOptions } from './quickstart.js';
import { ensureEnvLoaded } from '../utils/env.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateOptions {
  name: string;
  path: string;
  dev: boolean;
  rag: boolean;
}

export function printCreateHelp(): void {
  console.log(`Usage:
  ragforge create <project-name> [options]

Description:
  Creates a new TypeScript project with RAG capabilities.

  Generated structure:
  my-project/
  ├── package.json          # ESM, TypeScript, tsx for dev
  ├── tsconfig.json         # Strict mode, ES2022, NodeNext
  ├── src/
  │   └── index.ts          # Entry point
  ├── .gitignore
  ├── README.md
  └── .ragforge/            # RAG workspace
      ├── ragforge.config.yaml
      ├── docker-compose.yml
      ├── .env
      └── generated/        # TypeScript client

Options:
  --path <dir>    Parent directory for the project (default: current directory)
  --dev           Development mode: use local file: dependencies
  --no-rag        Skip RAG setup (just create TypeScript project)
  -h, --help      Show this help

Examples:
  # Create project with RAG (default)
  ragforge create my-app

  # Create project with RAG in dev mode
  ragforge create my-app --dev

  # Create project without RAG
  ragforge create my-app --no-rag

  # After creation
  cd my-app
  npm run dev                                    # Run your code
  cd .ragforge/generated && npm run query       # Query with RAG
`);
}

export function parseCreateOptions(args: string[]): CreateOptions {
  let name = '';
  let parentPath = process.cwd();
  let dev = false;
  let rag = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--path':
        parentPath = args[++i];
        break;
      case '--dev':
        dev = true;
        break;
      case '--no-rag':
        rag = false;
        break;
      case '--rag':
        rag = true;
        break;
      case '-h':
      case '--help':
        printCreateHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!name) {
          name = arg;
        } else {
          throw new Error(`Unexpected argument: ${arg}`);
        }
    }
  }

  if (!name) {
    throw new Error('Project name is required. Usage: ragforge create <project-name>');
  }

  // Validate project name (kebab-case, no spaces)
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Invalid project name "${name}". Use lowercase letters, numbers, and hyphens (e.g., my-project)`
    );
  }

  return {
    name,
    path: path.resolve(parentPath),
    dev,
    rag
  };
}

/**
 * Load a template file and replace placeholders
 */
async function loadTemplate(templateName: string, variables: Record<string, string>): Promise<string> {
  // Templates are in ./templates/create/ relative to this file
  // But after compilation, we need to handle dist/esm structure
  const possiblePaths = [
    path.join(__dirname, 'templates', 'create', templateName),
    path.join(__dirname, '..', 'templates', 'create', templateName),
    path.join(__dirname, '..', '..', 'templates', 'create', templateName),
    path.join(__dirname, '..', '..', 'commands', 'templates', 'create', templateName),
  ];

  let content: string | null = null;
  for (const templatePath of possiblePaths) {
    try {
      content = await fs.readFile(templatePath, 'utf-8');
      break;
    } catch {
      // Try next path
    }
  }

  if (!content) {
    throw new Error(`Template not found: ${templateName}`);
  }

  // Replace all {{VARIABLE}} placeholders
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  return content;
}

export async function runCreate(options: CreateOptions): Promise<void> {
  const { name, path: parentPath, dev, rag } = options;
  const projectPath = path.join(parentPath, name);

  const variables = {
    PROJECT_NAME: name
  };

  console.log(`\n🚀 Creating TypeScript project: ${name}`);
  console.log('═'.repeat(50));

  // Check if directory already exists
  try {
    await fs.access(projectPath);
    throw new Error(`Directory already exists: ${projectPath}`);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // Directory doesn't exist, good!
  }

  // 1. Create directories
  console.log('\n📁 Creating project structure...');
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
  console.log('   ✓ Created directories');

  // 2. Write package.json
  const packageJson = await loadTemplate('package.json.template', variables);
  await fs.writeFile(path.join(projectPath, 'package.json'), packageJson);
  console.log('   ✓ Created package.json');

  // 3. Write tsconfig.json
  const tsconfig = await loadTemplate('tsconfig.json.template', variables);
  await fs.writeFile(path.join(projectPath, 'tsconfig.json'), tsconfig);
  console.log('   ✓ Created tsconfig.json');

  // 4. Write src/index.ts
  const indexTs = await loadTemplate('index.ts.template', variables);
  await fs.writeFile(path.join(projectPath, 'src', 'index.ts'), indexTs);
  console.log('   ✓ Created src/index.ts');

  // 5. Write .gitignore
  const gitignore = await loadTemplate('gitignore.template', variables);
  await fs.writeFile(path.join(projectPath, '.gitignore'), gitignore);
  console.log('   ✓ Created .gitignore');

  // 6. Write README.md
  const readme = await loadTemplate('README.md.template', variables);
  await fs.writeFile(path.join(projectPath, 'README.md'), readme);
  console.log('   ✓ Created README.md');

  // 7. Install dependencies
  console.log('\n📦 Installing dependencies...');
  try {
    await execAsync('npm install', { cwd: projectPath });
    console.log('   ✓ Dependencies installed');
  } catch (error: any) {
    console.warn('   ⚠️  npm install failed:', error.message);
    console.warn('   Run "npm install" manually in the project directory');
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ TypeScript project created: ${projectPath}`);

  // 8. Setup RAG if requested
  if (rag) {
    console.log('\n');
    console.log('═'.repeat(50));
    console.log('🔧 Setting up RAG in .ragforge/ ...');
    console.log('═'.repeat(50));

    // Create .ragforge directory
    const ragforgePath = path.join(projectPath, '.ragforge');
    await fs.mkdir(ragforgePath, { recursive: true });

    // Change to .ragforge directory and run quickstart
    const originalCwd = process.cwd();
    process.chdir(ragforgePath);

    try {
      const rootDir = ensureEnvLoaded(import.meta.url);

      const quickstartOptions: QuickstartOptions = {
        sourceType: 'code',
        root: projectPath,  // Point to the parent project as source
        ingest: true,
        embeddings: true,
        force: false,
        rootDir,
        dev,
        debug: false
      };

      await runQuickstart(quickstartOptions);
    } finally {
      // Restore original directory
      process.chdir(originalCwd);
    }

    // Success message with RAG
    console.log('\n' + '═'.repeat(50));
    console.log(`✅ Project with RAG created: ${projectPath}`);
    console.log('\n🚀 Next steps:');
    console.log(`   cd ${name}`);
    console.log('   npm run dev                              # Run your code');
    console.log('   cd .ragforge/generated && npm run query  # Query with RAG');
  } else {
    // Success message without RAG
    console.log('\n🚀 Next steps:');
    console.log(`   cd ${name}`);
    console.log('   npm run dev');
  }

  console.log('');
}
