const http = require('http');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 6000;

function normalizeHtml(inputText) {
  const text = typeof inputText === 'string' ? inputText : String(inputText ?? '');
  const trimmed = text.trim();

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed.replace(/^'/, '"').replace(/'$/, '"'));
    } catch {
      return text;
    }
  }

  return text;
}

function extractVoucherCards(html) {
  const cards = [];
  const needle = '<div class="voucher-card"';
  let from = 0;

  while (true) {
    const start = html.indexOf(needle, from);
    if (start === -1) break;

    let i = start;
    let depth = 0;
    let foundStart = false;
    let end = -1;

    while (i < html.length) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);

      if (nextClose === -1 && nextOpen === -1) break;

      if (nextOpen !== -1 && (nextOpen < nextClose || nextClose === -1)) {
        depth += 1;
        foundStart = true;
        i = nextOpen + 4;
      } else {
        depth -= 1;
        i = nextClose + 6;
        if (foundStart && depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) break;
    cards.push(html.slice(start, end));
    from = end;
  }

  return cards;
}

function enforceThreePerPage(html) {
  if (!html.includes('voucher-card')) return html;

  const cards = extractVoucherCards(html);
  if (cards.length <= 3) return html;

  const bodyOpen = html.indexOf('<body');
  if (bodyOpen === -1) return html;
  const bodyStart = html.indexOf('>', bodyOpen);
  const bodyEnd = html.lastIndexOf('</body>');
  if (bodyStart === -1 || bodyEnd === -1 || bodyEnd <= bodyStart) return html;

  let rebuilt = '\n';
  for (let i = 0; i < cards.length; i += 3) {
    rebuilt += '  <div class="sheet">\n';
    rebuilt += cards.slice(i, i + 3).map((card) => `    ${card.trim()}`).join('\n\n');
    rebuilt += '\n  </div>\n\n';
  }

  return html.slice(0, bodyStart + 1) + rebuilt + html.slice(bodyEnd);
}

function buildCombinedHtml(items) {
  const chunks = items.map((item) => enforceThreePerPage(normalizeHtml(item.html || '')));
  return chunks
    .map((html, idx) => {
      if (idx === chunks.length - 1) return html;
      return `${html}<div style="page-break-after: always;"></div>`;
    })
    .join('\n');
}

async function htmlToPdfBuffer(html) {
  const common = {
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  };

  let browser;
  try {
    // Prefer a stable multi-process launch first.
    browser = await puppeteer.launch({
      ...common,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (firstErr) {
    // Fallback for restricted containers.
    browser = await puppeteer.launch({
      ...common,
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
    // Keep first error context for server logs.
    console.warn('[launch-fallback] Primary Chromium launch failed:', firstErr.message);
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: ['load', 'networkidle0'] });

    return await page.pdf({
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
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/convert') {
    let rawBody = '';
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    req.on('data', (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 25 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        let combinedHtml = '';

        if (contentType.includes('text/html')) {
          combinedHtml = normalizeHtml(rawBody);
          if (!combinedHtml.trim()) {
            return sendJson(res, 400, { error: 'HTML body is empty' });
          }
        } else {
          let body;
          try {
            body = JSON.parse(rawBody || '[]');
          } catch {
            return sendJson(res, 400, {
              error: 'Invalid JSON. Use valid JSON array: [{"html":"..."}]',
            });
          }

          if (!Array.isArray(body) || body.length === 0) {
            return sendJson(res, 400, {
              error: 'Request must be a non-empty array: [{"html":"..."}]',
            });
          }

          const invalid = body.some((x) => !x || typeof x.html !== 'string');
          if (invalid) {
            return sendJson(res, 400, {
              error: 'Every item must include html string: [{"html":"..."}]',
            });
          }

          combinedHtml = buildCombinedHtml(body);
        }

        const pdf = await htmlToPdfBuffer(enforceThreePerPage(combinedHtml));

        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="vouchers.pdf"',
          'Content-Length': pdf.length,
        });
        return res.end(pdf);
      } catch (error) {
        console.error('[convert] PDF generation failed:', error);
        return sendJson(res, 500, {
          error: 'PDF generation failed',
          message: error.message,
        });
      }
    });

    req.on('error', () => {
      sendJson(res, 400, { error: 'Invalid request body' });
    });

    return;
  }

  if (req.method === 'POST' && req.url === '/convert-vouchers') {
    let rawBody = '';
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    req.on('data', (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 25 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        let combinedHtml = '';

        if (contentType.includes('text/html')) {
          combinedHtml = normalizeHtml(rawBody);
          if (!combinedHtml.trim()) {
            return sendJson(res, 400, { error: 'HTML body is empty' });
          }
        } else {
          let body;
          try {
            body = JSON.parse(rawBody || '[]');
          } catch {
            return sendJson(res, 400, {
              error: 'Invalid JSON. Use valid JSON array: [{"html":"..."}]',
            });
          }

          if (!Array.isArray(body) || body.length === 0) {
            return sendJson(res, 400, {
              error: 'Request must be a non-empty array: [{"html":"..."}]',
            });
          }

          const invalid = body.some((x) => !x || typeof x.html !== 'string');
          if (invalid) {
            return sendJson(res, 400, {
              error: 'Every item must include html string: [{"html":"..."}]',
            });
          }

          combinedHtml = buildCombinedHtml(body);
        }

        const pdf = await htmlToPdfBuffer(enforceThreePerPage(combinedHtml));
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="vouchers.pdf"',
          'Content-Length': pdf.length,
        });
        return res.end(pdf);
      } catch (error) {
        console.error('[convert-vouchers] PDF generation failed:', error);
        return sendJson(res, 500, {
          error: 'PDF generation failed',
          message: error.message,
        });
      }
    });

    req.on('error', () => {
      sendJson(res, 400, { error: 'Invalid request body' });
    });

    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('HTML to PDF API running on:');
  console.log(`- http://localhost:${PORT}`);
  console.log(`- http://192.168.201.242:${PORT}`);
});
