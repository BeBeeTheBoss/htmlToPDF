const http = require('http');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;

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

function buildCombinedHtml(items) {
  const chunks = items.map((item) => normalizeHtml(item.html || ''));
  return chunks
    .map((html, idx) => {
      if (idx === chunks.length - 1) return html;
      return `${html}<div style="page-break-after: always;"></div>`;
    })
    .join('\n');
}

async function htmlToPdfBuffer(html) {
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

        const pdf = await htmlToPdfBuffer(combinedHtml);

        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="vouchers.pdf"',
          'Content-Length': pdf.length,
        });
        return res.end(pdf);
      } catch (error) {
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

        const pdf = await htmlToPdfBuffer(combinedHtml);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="vouchers.pdf"',
          'Content-Length': pdf.length,
        });
        return res.end(pdf);
      } catch (error) {
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
