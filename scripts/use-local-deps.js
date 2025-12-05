#!/usr/bin/env node
/**
 * Switch to local file: dependencies for development
 *
 * Usage: npm run dev:link
 *
 * This replaces npm package versions with file: paths for:
 * - @luciformresearch/codeparsers -> ../../packages/codeparsers
 * - @luciformresearch/ragforge-core -> local
 * - @luciformresearch/ragforge-runtime -> local
 *
 * @since 2025-12-05
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Packages to update
const packages = [
  'packages/core/package.json',
  'packages/runtime/package.json',
  'packages/cli/package.json',
];

// Local dependency mappings (relative to each package)
const localDeps = {
  '@luciformresearch/codeparsers': 'file:../../../packages/codeparsers',
  '@luciformresearch/ragforge-core': 'file:../core',
  '@luciformresearch/ragforge-runtime': 'file:../runtime',
};

console.log('🔗 Switching to local dependencies...\n');

for (const pkgPath of packages) {
  const fullPath = join(rootDir, pkgPath);

  try {
    const pkg = JSON.parse(readFileSync(fullPath, 'utf-8'));
    let modified = false;

    for (const [depName, localPath] of Object.entries(localDeps)) {
      if (pkg.dependencies?.[depName] && !pkg.dependencies[depName].startsWith('file:')) {
        console.log(`  ${pkgPath}: ${depName} -> ${localPath}`);
        pkg.dependencies[depName] = localPath;
        modified = true;
      }
    }

    if (modified) {
      writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  } catch (err) {
    console.warn(`  ⚠️  Skipping ${pkgPath}: ${err.message}`);
  }
}

console.log('\n✅ Done! Run `npm install` in each package to apply changes.');
console.log('   Or run `npm install` at root to update workspaces.');
