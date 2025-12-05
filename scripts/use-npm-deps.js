#!/usr/bin/env node
/**
 * Switch back to npm package versions (for publishing)
 *
 * Usage: npm run dev:unlink
 *
 * This replaces file: paths with npm package versions.
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

// NPM versions to restore
const npmVersions = {
  '@luciformresearch/codeparsers': '^0.1.3',
  '@luciformresearch/ragforge-core': '^0.2.0',
  '@luciformresearch/ragforge-runtime': '^0.2.1',
};

console.log('📦 Switching to npm dependencies...\n');

for (const pkgPath of packages) {
  const fullPath = join(rootDir, pkgPath);

  try {
    const pkg = JSON.parse(readFileSync(fullPath, 'utf-8'));
    let modified = false;

    for (const [depName, npmVersion] of Object.entries(npmVersions)) {
      if (pkg.dependencies?.[depName]?.startsWith('file:')) {
        console.log(`  ${pkgPath}: ${depName} -> ${npmVersion}`);
        pkg.dependencies[depName] = npmVersion;
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

console.log('\n✅ Done! Run `npm install` to fetch npm packages.');
