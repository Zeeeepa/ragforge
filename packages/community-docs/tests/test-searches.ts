import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://127.0.0.1:6970';
const MIN_ACCEPTABLE_SCORE = 0.6;

interface SearchResult {
  documentId: string;
  content?: string;
  score: number;
  sourcePath?: string;
  nodeType?: string;
  metadata?: Record<string, any>;
}

interface TestCase {
  id: string;
  description: string;
  expectedFile: string;
  query: string;
  minScore?: number;
}

interface TestResult {
  testCase: TestCase;
  success: boolean;
  results: SearchResult[];
  topScore: number | null;
  topSourcePath: string | null;
  matchedExpected: boolean;
  error?: string;
}

interface EntityResult {
  name: string;
  entityType: string;
  score: number;
}

interface Report {
  timestamp: string;
  apiUrl: string;
  searchTests: TestResult[];
  entityTests: {
    query: string;
    results: EntityResult[];
  }[];
  indexedFiles: string[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
  };
}

const TEST_CASES: TestCase[] = [
  {
    id: 'excel',
    description: 'Excel Spreadsheet',
    expectedFile: 'NDA_synth.xlsx',
    // NDA_synth has summary of two sheets - very generic content, hard to distinguish
    query: 'spreadsheet Excel sheets NDA Aurialink HeliosTrack headers columns rows',
  },
  {
    id: '3d-model',
    description: '3D Model',
    expectedFile: 'lucie-demon-queen.glb',
    query: 'demon queen dark figure flowing dress horns',
  },
  {
    id: 'image',
    description: 'Image (PNG)',
    expectedFile: 'Symbole macabre',
    query: 'macabre symbol red ink graph paper occult sketch',
  },
  {
    id: 'pdf-research',
    description: 'PDF with text and images',
    expectedFile: 'pdf-with-text-and-images.pdf',
    query: '6G wireless communication foundation models AI cellular networks',
  },
  {
    id: 'pdf-text',
    description: 'PDF text only',
    expectedFile: 'text_only.pdf',
    // Unique: mentions "Rennes", has detailed legal sections like "Objet du contrat"
    query: 'NDA accord confidentialité Rennes février 2026 objet contrat obligations',
  },
  {
    id: 'docx',
    description: 'Word Document',
    expectedFile: 'docx-with-text-and-images.docx',
    query: 'Kindle ebook conversion Calibre font embedding EPUB',
  },
  {
    id: 'pdf-image',
    description: 'Image-based PDF (scanned)',
    expectedFile: 'image_based.pdf',
    // Unique: page 2 has Julien Caradec + HeliosTrack + données solaires
    query: 'Julien Caradec HeliosTrack Technologies données solaires NDA',
    minScore: 0.5,
  },
];

async function cypher(query: string): Promise<any[]> {
  const response = await fetch(`${API_URL}/cypher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await response.json();
  return data.records || [];
}

async function runSearchTest(testCase: TestCase): Promise<TestResult> {
  const minScore = testCase.minScore || MIN_ACCEPTABLE_SCORE;

  try {
    const response = await fetch(`${API_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: testCase.query, limit: 5, semantic: true }),
    });

    const data = await response.json();
    const results: SearchResult[] = data.results || [];

    const topResult = results[0];
    const topScore = topResult?.score || null;
    const topSourcePath = topResult?.sourcePath || null;

    // Check if expected file is in top result
    const matchedExpected = topSourcePath
      ? topSourcePath.toLowerCase().includes(testCase.expectedFile.toLowerCase())
      : false;

    return {
      testCase,
      success: results.length > 0 && (topScore || 0) >= minScore,
      results,
      topScore,
      topSourcePath,
      matchedExpected,
    };
  } catch (error: any) {
    return {
      testCase,
      success: false,
      results: [],
      topScore: null,
      topSourcePath: null,
      matchedExpected: false,
      error: error.message,
    };
  }
}

async function runEntityTest(query: string, types?: string[]): Promise<EntityResult[]> {
  try {
    const response = await fetch(`${API_URL}/search/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, types, limit: 5 }),
    });

    const data = await response.json();
    return (data.results || []).map((e: any) => ({
      name: e.name,
      entityType: e.entityType,
      score: e.score || 0,
    }));
  } catch {
    return [];
  }
}

async function getIndexedFiles(): Promise<string[]> {
  const files = await cypher(`
    MATCH (f:File) RETURN f.name + coalesce(f.extension, '') as filename
    UNION
    MATCH (m:MediaFile) RETURN m.file as filename
  `);
  return [...new Set(files.map(f => f.filename).filter(Boolean))];
}

function generateMarkdownReport(report: Report): string {
  let md = `# Search Test Report

**Generated:** ${report.timestamp}
**API:** ${report.apiUrl}

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${report.summary.total} |
| Passed | ${report.summary.passed} |
| Failed | ${report.summary.failed} |
| Average Score | ${report.summary.avgScore.toFixed(3)} |

## Indexed Files

\`\`\`
${report.indexedFiles.join('\n')}
\`\`\`

---

## Search Tests

`;

  for (const test of report.searchTests) {
    const status = test.success && test.matchedExpected ? '✅ PASS' : test.success ? '⚠️ WRONG FILE' : '❌ FAIL';
    const minScore = test.testCase.minScore || MIN_ACCEPTABLE_SCORE;

    md += `### ${status}: ${test.testCase.description}

| Field | Value |
|-------|-------|
| Query | \`${test.testCase.query}\` |
| Expected | \`${test.testCase.expectedFile}\` |
| Found | \`${test.topSourcePath || 'N/A'}\` |
| Score | ${test.topScore?.toFixed(3) || 'N/A'} (min: ${minScore}) |
| Match | ${test.matchedExpected ? '✅' : '❌'} |

`;

    if (test.results.length > 0) {
      md += `**Top 3 Results:**

| # | Score | Source File | Content Preview |
|---|-------|-------------|-----------------|
`;
      for (let i = 0; i < Math.min(3, test.results.length); i++) {
        const r = test.results[i];
        const preview = (r.content || '').substring(0, 50).replace(/\n/g, ' ').replace(/\|/g, '\\|');
        md += `| ${i + 1} | ${r.score.toFixed(3)} | \`${r.sourcePath || 'N/A'}\` | ${preview}... |\n`;
      }
      md += '\n';
    }

    if (test.error) {
      md += `**Error:** \`${test.error}\`\n\n`;
    }

    md += '---\n\n';
  }

  md += `## Entity Tests

`;

  for (const entityTest of report.entityTests) {
    md += `### Query: "${entityTest.query}"

`;
    if (entityTest.results.length > 0) {
      md += `| Entity | Type | Score |
|--------|------|-------|
`;
      for (const e of entityTest.results) {
        md += `| ${e.name} | ${e.entityType} | ${e.score.toFixed(3)} |\n`;
      }
    } else {
      md += `*No entities found*\n`;
    }
    md += '\n';
  }

  return md;
}

async function main() {
  console.log('============================================================');
  console.log('SEARCH TESTS - Community Docs API');
  console.log('============================================================\n');

  const report: Report = {
    timestamp: new Date().toISOString(),
    apiUrl: API_URL,
    searchTests: [],
    entityTests: [],
    indexedFiles: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      avgScore: 0,
    },
  };

  // Get indexed files
  report.indexedFiles = await getIndexedFiles();
  console.log(`Indexed files: ${report.indexedFiles.length}`);
  for (const f of report.indexedFiles) {
    console.log(`  - ${f}`);
  }
  console.log('');

  // Run search tests
  let totalScore = 0;
  for (const testCase of TEST_CASES) {
    process.stdout.write(`${testCase.description.padEnd(30)} `);
    const result = await runSearchTest(testCase);
    report.searchTests.push(result);

    if (result.success && result.matchedExpected) {
      console.log(`✅ ${result.topScore?.toFixed(3)} → ${result.topSourcePath}`);
      report.summary.passed++;
    } else if (result.success) {
      console.log(`⚠️  ${result.topScore?.toFixed(3)} → ${result.topSourcePath} (expected: ${testCase.expectedFile})`);
      report.summary.failed++;
    } else {
      console.log(`❌ ${result.error || 'No results or low score'}`);
      report.summary.failed++;
    }

    if (result.topScore) totalScore += result.topScore;
    report.summary.total++;
  }

  report.summary.avgScore = totalScore / report.summary.total;

  // Run entity tests
  console.log('\nEntity Search:');
  const entityQueries = ['Aurialink', 'Marion Vautrin', 'confidentiality'];
  for (const query of entityQueries) {
    const results = await runEntityTest(query);
    report.entityTests.push({ query, results });
    const status = results.length > 0 ? '✅' : '❌';
    const names = results.slice(0, 2).map(r => r.name).join(', ');
    console.log(`  ${status} "${query}": ${results.length} found${names ? ` (${names})` : ''}`);
  }

  // Write reports
  const reportDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // JSON report
  const jsonPath = path.join(reportDir, `search-report-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Markdown report
  const mdPath = path.join(reportDir, `search-report-${timestamp}.md`);
  fs.writeFileSync(mdPath, generateMarkdownReport(report));

  // Latest report (overwrite)
  const latestJsonPath = path.join(reportDir, 'latest-report.json');
  const latestMdPath = path.join(reportDir, 'latest-report.md');
  fs.writeFileSync(latestJsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestMdPath, generateMarkdownReport(report));

  // Summary
  console.log('\n============================================================');
  console.log('SUMMARY');
  console.log('============================================================');
  console.log(`  Passed:    ${report.summary.passed}/${report.summary.total}`);
  console.log(`  Failed:    ${report.summary.failed}/${report.summary.total}`);
  console.log(`  Avg Score: ${report.summary.avgScore.toFixed(3)}`);
  console.log(`\nReports: ${reportDir}/`);
  console.log('============================================================');

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
