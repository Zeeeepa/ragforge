/**
 * Test the analyze_files handler directly
 */
import { generateAnalyzeFilesHandler } from '../packages/core/src/tools/brain-tools.js';

async function main() {
  // Create a mock context
  const mockCtx = { brain: null as any };

  const handler = generateAnalyzeFilesHandler(mockCtx);

  const result = await handler({
    paths: ['/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/runtime/agents/research-agent.ts'],
    target_lines: {
      '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/src/runtime/agents/research-agent.ts': [1596]
    },
    format: 'json'
  });

  if (typeof result === 'string') {
    console.log('Result is markdown string');
  } else {
    console.log('=== Result ===');
    console.log('Scopes:', result.totalScopes);
    console.log('Relationships:', result.totalRelationships);

    for (const file of result.files) {
      for (const scope of file.scopes) {
        console.log(`\n${scope.name} (${scope.type}):`);
        console.log('  Relationships:', scope.relationships.length);
        for (const rel of scope.relationships) {
          const lines = rel.targetStartLine && rel.targetEndLine 
            ? ` (${rel.targetStartLine}-${rel.targetEndLine})` 
            : ' (NO LINES)';
          if (rel.targetFile) {
            console.log(`    - [${rel.type}] ${rel.target}${lines} @ ${rel.targetFile}`);
          } else {
            console.log(`    - [${rel.type}] ${rel.target}${lines}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
