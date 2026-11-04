// Tiny static server for the demo app. Usage: node serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 8765);
http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
  const file = path.join(dir, path.basename(name));
  if (!file.endsWith('.html') || !fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(fs.readFileSync(file));
}).listen(port, () => console.log(`demo app on http://localhost:${port}`));
