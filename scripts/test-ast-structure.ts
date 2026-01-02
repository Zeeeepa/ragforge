/**
 * Debug AST structure to understand where decorators and implements are
 */
import { TypeScriptLanguageParser, ScopeExtractionParser } from '@luciformresearch/codeparsers';

async function main() {
  const parser = new ScopeExtractionParser('typescript');
  await parser.initialize();

  // Access the internal parser via private property (for debugging)
  const internalParser = (parser as any).parser;

  const code = `
@Injectable('singleton')
@Deprecated('Use NewUserService instead')
export class UserService extends BaseService implements ILogger, IConfigurable {
  constructor() {
    super('UserService');
  }
}
`;

  const tree = internalParser.parse(code);

  function printNode(node: any, depth = 0) {
    const indent = '  '.repeat(depth);
    const text = node.text.length > 50 ? node.text.slice(0, 50) + '...' : node.text;
    console.log(`${indent}[${node.type}] "${text.replace(/\n/g, '\\n')}"`);

    if (depth < 6) {  // Limit depth
      for (const child of node.children) {
        printNode(child, depth + 1);
      }
    }
  }

  console.log('=== Full AST ===');
  printNode(tree.rootNode);

  console.log('\n\n=== Looking for specific nodes ===');

  // Find export_statement or class_declaration
  function findNodes(node: any, types: string[]): any[] {
    const found: any[] = [];
    if (types.includes(node.type)) {
      found.push(node);
    }
    for (const child of node.children) {
      found.push(...findNodes(child, types));
    }
    return found;
  }

  const exportStmts = findNodes(tree.rootNode, ['export_statement']);
  console.log(`\nFound ${exportStmts.length} export_statement nodes`);

  for (const stmt of exportStmts) {
    console.log('\nExport statement children:');
    for (const child of stmt.children) {
      console.log(`  - [${child.type}]`);
    }
  }

  const classDecls = findNodes(tree.rootNode, ['class_declaration']);
  console.log(`\nFound ${classDecls.length} class_declaration nodes`);

  for (const cls of classDecls) {
    console.log('\nClass declaration children:');
    for (const child of cls.children) {
      console.log(`  - [${child.type}] "${child.text?.slice(0, 30) || ''}..."`);
    }

    // Look for class_heritage
    const heritage = cls.children.find((c: any) => c.type === 'class_heritage');
    if (heritage) {
      console.log('\n  class_heritage children:');
      for (const child of heritage.children) {
        console.log(`    - [${child.type}] "${child.text?.slice(0, 50) || ''}"`);
        // Also check grandchildren
        for (const grandchild of child.children || []) {
          console.log(`      - [${grandchild.type}] "${grandchild.text?.slice(0, 50) || ''}"`);
        }
      }
    }
  }

  // Find decorators
  const decorators = findNodes(tree.rootNode, ['decorator']);
  console.log(`\nFound ${decorators.length} decorator nodes`);
  for (const dec of decorators) {
    console.log(`  - "${dec.text}"`);
    console.log(`    Parent type: ${dec.parent?.type}`);
  }
}

main().catch(console.error);
