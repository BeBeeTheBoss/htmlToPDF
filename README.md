# HTML to PDF Converter (Node.js)

## CLI usage

```bash
npm install
npm run convert
```

## API usage

Start server:

```bash
npm start
```

Endpoint:

- `POST /convert`
- Content-Type: `application/json`
- Body format:

```json
[
  {
    "html": "<!DOCTYPE html><html>...</html>"
  }
]
```

Response:

- `200 OK`
- `application/pdf` (direct PDF file)

Example cURL:

```bash
curl -X POST http://localhost:3000/convert \
  -H "Content-Type: application/json" \
  --data @request.json \
  --output output.pdf
```

Notes:
- Supports one or more items in array.
- If multiple items are sent, each item is separated with a page break in the output PDF.

Raw HTML mode (no JSON escaping needed):

```bash
curl -X POST http://localhost:3000/convert \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @voucher.html \
  --output output.pdf
```


Fixed template API (same layout as voucher.html):

```bash
curl -X POST http://localhost:3000/convert-vouchers --output vouchers.pdf
```
