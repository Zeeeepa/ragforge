/**
 * Download SEC 10-K filings from major tech companies
 *
 * These are annual reports with real business data:
 * - Financial figures
 * - Mentions of competitors, partners
 * - Dates, places, people
 * - Perfect for demonstrating document RAG with entity extraction
 */

import * as fs from 'fs';
import * as path from 'path';
import https from 'https';

// SEC requires a User-Agent header with contact info
const USER_AGENT = 'RagForge Demo (contact@example.com)';

// Major tech companies and their CIK numbers
const COMPANIES = [
  { name: 'Apple', cik: '0000320193', ticker: 'AAPL' },
  { name: 'Microsoft', cik: '0000789019', ticker: 'MSFT' },
  { name: 'Alphabet (Google)', cik: '0001652044', ticker: 'GOOGL' },
  { name: 'Amazon', cik: '0001018724', ticker: 'AMZN' },
  { name: 'Meta (Facebook)', cik: '0001326801', ticker: 'META' },
];

interface Filing {
  accessionNumber: string;
  filingDate: string;
  primaryDocument: string;
  primaryDocDescription: string;
}

async function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e}`));
        }
      });
    }).on('error', reject);
  });
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const options = {
      headers: {
        'User-Agent': USER_AGENT,
      }
    };

    https.get(url, options, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
        }
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

async function getCompanyFilings(cik: string): Promise<Filing[]> {
  // Remove leading zeros for API call
  const cikNum = cik.replace(/^0+/, '');
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;

  console.log(`  Fetching filings list from ${url}`);
  const data = await fetchJson(url);

  const filings: Filing[] = [];
  const recentFilings = data.filings?.recent;

  if (!recentFilings) {
    console.log(`  No filings found`);
    return filings;
  }

  // Find 10-K filings (annual reports)
  for (let i = 0; i < recentFilings.form.length; i++) {
    const form = recentFilings.form[i];
    // 10-K is the main annual report, 10-K/A is an amendment
    if (form === '10-K') {
      filings.push({
        accessionNumber: recentFilings.accessionNumber[i],
        filingDate: recentFilings.filingDate[i],
        primaryDocument: recentFilings.primaryDocument[i],
        primaryDocDescription: recentFilings.primaryDocDescription[i] || '10-K',
      });

      // Just get the most recent one
      if (filings.length >= 1) break;
    }
  }

  return filings;
}

async function downloadFiling(
  company: typeof COMPANIES[0],
  filing: Filing,
  outputDir: string
): Promise<string | null> {
  const accession = filing.accessionNumber.replace(/-/g, '');
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${company.cik.replace(/^0+/, '')}/${accession}`;

  // Try to get the filing index to find PDF version
  const indexUrl = `${baseUrl}/index.json`;

  try {
    const indexData = await fetchJson(indexUrl);
    const files = indexData.directory?.item || [];

    // Look for PDF first, then HTML
    let targetFile = files.find((f: any) => f.name.endsWith('.pdf'));
    if (!targetFile) {
      targetFile = files.find((f: any) =>
        f.name.endsWith('.htm') &&
        f.name.toLowerCase().includes('10-k')
      );
    }
    if (!targetFile) {
      targetFile = { name: filing.primaryDocument };
    }

    const fileUrl = `${baseUrl}/${targetFile.name}`;
    const ext = path.extname(targetFile.name) || '.htm';
    const fileName = `${company.ticker}_10K_${filing.filingDate}${ext}`;
    const destPath = path.join(outputDir, fileName);

    console.log(`  Downloading ${fileUrl}`);
    await downloadFile(fileUrl, destPath);

    const stats = fs.statSync(destPath);
    console.log(`  ✓ Saved ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    return destPath;
  } catch (error: any) {
    console.log(`  ✗ Failed: ${error.message}`);
    return null;
  }
}

async function main() {
  const outputDir = path.join(__dirname, '../docs/sec-filings');

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(60));
  console.log('SEC EDGAR 10-K Downloader');
  console.log('='.repeat(60));
  console.log(`\nOutput directory: ${outputDir}\n`);

  const downloaded: string[] = [];

  for (const company of COMPANIES) {
    console.log(`\n[${company.name}] (CIK: ${company.cik})`);

    try {
      const filings = await getCompanyFilings(company.cik);

      if (filings.length === 0) {
        console.log(`  No 10-K filings found`);
        continue;
      }

      for (const filing of filings) {
        console.log(`  Found 10-K from ${filing.filingDate}`);
        const filePath = await downloadFiling(company, filing, outputDir);
        if (filePath) {
          downloaded.push(filePath);
        }

        // Be nice to SEC servers
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (error: any) {
      console.log(`  Error: ${error.message}`);
    }

    // Rate limiting between companies
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Downloaded ${downloaded.length} filings`);
  console.log('='.repeat(60));

  if (downloaded.length > 0) {
    console.log('\nFiles:');
    for (const file of downloaded) {
      console.log(`  - ${path.basename(file)}`);
    }

    console.log('\nNext steps:');
    console.log('  1. Review the downloaded documents');
    console.log('  2. Run the document ingestion:');
    console.log('     cd examples/document-rag && npx tsx scripts/ingest.ts');
  }
}

main().catch(console.error);
