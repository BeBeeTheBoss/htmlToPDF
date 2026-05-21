const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

function normalizeHtml(inputText) {
  const trimmed = inputText.trim();

  // Supports HTML passed as a JSON-style quoted string with escaped newlines.
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed.replace(/^'/, '"').replace(/'$/, '"'));
    } catch {
      return inputText;
    }
  }

  return inputText;
}

async function htmlToPdf(inputPath, outputPath) {
  const absoluteInput = path.resolve(inputPath);
  const absoluteOutput = path.resolve(outputPath);

  if (!fs.existsSync(absoluteInput)) {
    throw new Error(`Input HTML file not found: ${absoluteInput}`);
  }

  const raw = fs.readFileSync(absoluteInput, 'utf8');
  const html = normalizeHtml(raw);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--no-zygote',
      '--single-process',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: ['load', 'networkidle0'] });

    await page.pdf({
      path: absoluteOutput,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });
  } finally {
    await browser.close();
  }

  return absoluteOutput;
}

async function main() {
  const input = process.argv[2] || 'input.html';
  const output = process.argv[3] || 'output.pdf';

  try {
    const result = await htmlToPdf(input, output);
    console.log(`PDF created: ${result}`);
  } catch (error) {
    console.error('Failed to create PDF:', error.message);
    process.exit(1);
  }
}

main();
