import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const baseUrl = searchParams.get('baseUrl') || 'http://localhost:3000';

  let browser = null;

  try {
    // Configure chromium for serverless environment
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 794, height: 2000, deviceScaleFactor: 2 },
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    // Set viewport to A4 width
    await page.setViewport({
      width: 794,
      height: 2000,
      deviceScaleFactor: 2,
    });

    // Navigate to CV page with print mode
    await page.goto(`${baseUrl}/cv?print=true`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait for content to settle
    await new Promise(resolve => setTimeout(resolve, 500));

    // Add styles for PDF generation
    await page.addStyleTag({
      content: `
        /* Hide navigation and export button */
        nav, button[data-export-pdf] { display: none !important; }

        /* Ensure dark background prints */
        html, body {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          background: #0a0a0f !important;
        }

        /* Hide code blocks for cleaner PDF */
        .print\\:hidden { display: none !important; }

        /* Ensure links are styled visibly */
        a[href] {
          text-decoration: underline !important;
          text-decoration-color: currentColor !important;
        }

        /* Reduce overall scale to fit page 1 content better */
        .print-content {
          padding: 25px 35px !important;
          font-size: 0.92em !important;
        }

        /* Tighter spacing for skills section on page 1 */
        .print-content > section {
          margin-bottom: 12px !important;
        }

        .print-content .space-y-6 {
          gap: 12px !important;
        }

        .print-content .mb-8 {
          margin-bottom: 16px !important;
        }

        .print-content .mb-6 {
          margin-bottom: 12px !important;
        }

        .print-content .p-4 {
          padding: 10px !important;
        }

        .print-content .gap-4 {
          gap: 8px !important;
        }

        /* Force page break before Professional Experience */
        .cv-page-break {
          break-before: page !important;
          page-break-before: always !important;
          padding-top: 15px !important;
        }

        /* Tighter spacing for page 2 content */
        .cv-page-break ~ section,
        .cv-page-break {
          margin-bottom: 16px !important;
        }

        .cv-page-break ~ section .space-y-4 > * {
          margin-bottom: 8px !important;
        }

        /* Reduce font size slightly for professional experience section */
        .cv-page-break,
        .cv-page-break ~ section {
          font-size: 0.95em;
        }

        /* Reduce padding in experience cards */
        .cv-page-break .py-2 {
          padding-top: 4px !important;
          padding-bottom: 4px !important;
        }

        /* Compact project cards */
        .cv-page-break ~ section .p-4 {
          padding: 12px !important;
        }
      `
    });

    // Generate PDF with links preserved
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '1cm',
        bottom: '1cm',
        left: '1.2cm',
        right: '1.2cm',
      },
      displayHeaderFooter: false,
    });

    await browser.close();

    // Return PDF as download - convert to Buffer for NextResponse
    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Lucie_Defraiteur_CV.pdf"',
      },
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    if (browser) await browser.close();

    return NextResponse.json(
      { error: 'Failed to generate PDF', details: String(error) },
      { status: 500 }
    );
  }
}
