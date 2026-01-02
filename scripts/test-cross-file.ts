/**
 * Test cross-file CONSUMED_BY relationships with DYNAMIC imports
 * fs-tools.ts uses dynamic imports from brain-tools.ts
 */
import { generateAnalyzeFilesHandler } from '../packages/core/src/tools/brain-tools.js';

async function main() {
  const mockCtx = { brain: null as any };
  const handler = generateAnalyzeFilesHandler(mockCtx);

  // Test: analyze fs-tools.ts and brain-tools.ts
  // Filter to formatAnalyzeFilesAsMarkdown in brain-tools.ts
  // fs-tools.ts uses formatAnalyzeFilesAsMarkdown via DYNAMIC import
  const result = await handler({
    paths: [
      '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/tools/fs-tools.ts',
      '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/tools/brain-tools.ts'
    ],
    target_lines: {
      // formatAnalyzeFilesAsMarkdown is around line 3174 in brain-tools.ts
      '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/tools/brain-tools.ts': [3174]
    },
    format: 'json'
  });

  if (typeof result === 'string') {
    console.log('Result is markdown string');
    console.log(result);
  } else {
    console.log('=== Testing Cross-File CONSUMED_BY with DYNAMIC Imports ===');
    console.log('Scopes:', result.totalScopes);
    console.log('Relationships:', result.totalRelationships);

    for (const file of result.files) {
      // Only show brain-tools.ts (the filtered file)
      if (!file.path.includes('brain-tools')) continue;

      console.log(`\n=== File: ${file.path} ===`);
      for (const scope of file.scopes) {
        console.log(`\n${scope.name} (${scope.type}) [${scope.startLine}-${scope.endLine}]:`);

        // Show CONSUMED_BY relationships specifically
        const consumedBy = scope.relationships.filter((r: any) => r.type === 'CONSUMED_BY');
        if (consumedBy.length > 0) {
          console.log('  CONSUMED_BY:');
          for (const rel of consumedBy) {
            const lines = rel.targetStartLine && rel.targetEndLine
              ? ` (${rel.targetStartLine}-${rel.targetEndLine})`
              : ' (NO LINES)';
            const fileInfo = rel.targetFile ? ` @ ${rel.targetFile}` : '';
            console.log(`    - ${rel.target}${lines}${fileInfo}`);
          }
        } else {
          console.log('  CONSUMED_BY: (none - dynamic imports may not be detected yet)');
        }

        // Also show CONSUMES for context
        const consumes = scope.relationships.filter((r: any) => r.type === 'CONSUMES');
        if (consumes.length > 0) {
          console.log('  CONSUMES:');
          for (const rel of consumes) {
            const lines = rel.targetStartLine && rel.targetEndLine
              ? ` (${rel.targetStartLine}-${rel.targetEndLine})`
              : '';
            const fileInfo = rel.targetFile ? ` @ ${rel.targetFile}` : '';
            console.log(`    - ${rel.target}${lines}${fileInfo}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
