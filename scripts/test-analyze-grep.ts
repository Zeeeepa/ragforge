#!/usr/bin/env npx tsx
/**
 * Test script for analyze_files with grep-like filtering
 *
 * Usage: npx tsx scripts/test-analyze-grep.ts <pattern> <file> [output_file]
 * Example: npx tsx scripts/test-analyze-grep.ts "generateAnalyze" packages/core/src/tools/brain-tools.ts /tmp/result.md
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import path from 'path';

async function main() {
  const [pattern, filePath, outputFile] = process.argv.slice(2);

  if (!pattern || !filePath) {
    console.error('Usage: npx tsx scripts/test-analyze-grep.ts <pattern> <file> [output_file]');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);

  // Step 1: Run grep to find matching lines
  console.log(`\n🔍 Grep for "${pattern}" in ${filePath}...`);
  let grepOutput: string;
  try {
    grepOutput = execSync(`rg -n "${pattern}" "${absPath}"`, { encoding: 'utf-8' });
  } catch (e: any) {
    if (e.status === 1) {
      console.log('No matches found.');
      process.exit(0);
    }
    throw e;
  }

  // Parse grep output to get line numbers
  const lines = grepOutput.trim().split('\n');
  const lineNumbers = lines.map(line => {
    const match = line.match(/^(\d+):/);
    return match ? parseInt(match[1], 10) : null;
  }).filter((n): n is number => n !== null);

  console.log(`Found ${lineNumbers.length} matches at lines: ${lineNumbers.join(', ')}`);

  // Step 2: Call analyze_files via CLI
  console.log(`\n📊 Analyzing scopes containing these lines...`);

  const targetLines = JSON.stringify({ [absPath]: lineNumbers });
  const analyzeParams = JSON.stringify({
    paths: [absPath],
    target_lines: { [absPath]: lineNumbers },
    max_top_scopes: 2,
  });

  // Use the MCP tool directly via the CLI
  const result = execSync(
    `cd "${path.dirname(absPath)}" && npx ragforge mcp-tool analyze_files '${analyzeParams}'`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  // Step 3: Output result
  const output = `# Grep + Analyze Test

**Pattern:** \`${pattern}\`
**File:** \`${filePath}\`
**Matched lines:** ${lineNumbers.join(', ')}

---

${result}
`;

  if (outputFile) {
    writeFileSync(outputFile, output);
    console.log(`\n✅ Result written to ${outputFile}`);
  } else {
    console.log('\n' + output);
  }
}

main().catch(console.error);
