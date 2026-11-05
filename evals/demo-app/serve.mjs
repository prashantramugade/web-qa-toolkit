// Small demo shop with deliberately seeded defects, used as a test fixture for the toolkit.
// Run: node evals/demo-app/serve.mjs [port]      No dependencies.
// Set POST_LOG=<file> to record every write request the server receives (used to prove read-only mode).
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 8765);

const shell = (title, body, { lang = true, description = true } = {}) => `<!doctype html>
<html${lang ? ' lang="en"' : ''}><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${description ? '<meta name="description" content="Corner Shop: a small demo shop used to test the QA toolkit.">' : ''}
<style>
body{font-family:Arial,sans-serif;margin:0;color:#222}
header{background:#14532d;padding:12px 20px}header a{color:#dcfce7;margin-right:16px;text-decoration:none}
main{padding:20px;max-width:900px;margin:auto}.card{border:1px solid #ddd;padding:12px;margin:8px 0;display:flex;gap:12px;align-items:center}
button{padding:8px 14px;border:0;background:#15803d;color:#fff;cursor:pointer}input,textarea{padding:6px;margin:4px 0;outline:none}
table.wide{width:900px;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}
</style></head><body>
<header><nav><a href="/">Home</a><a href="/shop">Shop</a><a href="/contact">Contact</a><a href="/login">Login</a><a href="/about">About</a><a href="/slow">Slow</a></nav></header>
<main>${body}</main><footer style="padding:20px"><small>Corner Shop 2026</small></footer></body></html>`;

const products = [['Tea Kettle', 24], ['Plant Pot', 9], ['Wall Clock', 15]];

const pages = {
  '/': () => shell('Corner Shop', `<h1>Welcome to Corner Shop</h1><h1>Everyday things for your home</h1>
    <img src="/img/banner.png" width="300" height="100"><p>Browse our kettles, pots and clocks.</p>
    <a href="#">Learn more</a> <a href="/shop">Shop now</a> <a href="/team">Meet the team</a> <a href="/gone">Old sale page</a>`, { description: false }),
  '/shop': u => {
    const q = u.searchParams.get('q') ?? '';
    const shown = products.filter(([name]) => !q || name.includes(q)); // case-sensitive on purpose
    return shell('Shop - Corner Shop', `<h1>Shop</h1>
      <div id="cart">Cart: 0</div>
      <form method="get" action="/shop"><input name="q" placeholder="Search the shop" value="${q}"><button type="submit">Search</button></form>
      ${q ? `<p>Showing results for: ${q}</p>` : ''}
      ${shown.map(([name, price], i) => `<div class="card"><img src="/img/p${i}.svg" width="50" height="50" alt=""><div><b>${name}</b><br>EUR ${price}</div>
        <input type="number" id="qty${i}" value="1" style="width:50px"><button onclick="addToCart(${i})">Add to cart</button></div>`).join('')}
      ${shown.length ? '' : '<p>No products found.</p>'}
      <table class="wide"><tr><th>SKU</th><th>Stock</th><th>Warehouse</th><th>Notes</th></tr><tr><td>KT-1</td><td>14</td><td>North</td><td>-</td></tr></table>
      <script>let n=0;function addToCart(i){const q=parseInt(document.getElementById('qty'+i).value);n+=q*2;document.getElementById('cart').textContent='Cart: '+n;}</script>`);
  },
  '/contact': () => shell('Contact - Corner Shop', `<h1>Contact us</h1>
    <form id="contact" method="post" action="/contact">
      <input name="name" placeholder="Your name"><br>
      <input name="email" type="text" placeholder="Email"><br>
      <textarea name="message" placeholder="Message"></textarea><br>
      <button type="submit">Send</button>
    </form><p id="status" role="status"></p>
    <script>document.getElementById('contact').addEventListener('submit',e=>{e.preventDefault();
      fetch('/contact',{method:'POST',body:new URLSearchParams(new FormData(e.target))}).then(r=>r.text()).then(t=>{document.getElementById('status').textContent=t;});});</script>`),
  '/login': () => shell('Login - Corner Shop', `<h1>Login</h1>
    <form method="post" action="/login"><label>Username <input name="username"></label><br>
    <label>Password <input type="password" name="password"></label><br><button>Sign in</button></form>`),
  '/about': () => shell('About - Corner Shop', `<h1>About us</h1><p>We opened in 2019 with one kettle.</p>
    <p>Follow us on <a href="https://example.org/corner-shop" target="_blank">our social page</a>.</p>
    <div onclick="document.getElementById('more').style.display='block'" style="cursor:pointer;color:#15803d">Show more about us</div>
    <p id="more" style="display:none">Family run, two shops, one dog.</p>
    <script>console.error('Failed to initialise team widget: widget is undefined');</script>`, { lang: false }),
  '/slow': () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Slow page - Corner Shop</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Styles and content arrive late here; the page looks fine once it has loaded.">
    <script>setTimeout(()=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/late.css';document.head.appendChild(l);},1800);
    setTimeout(()=>{document.getElementById('app').innerHTML='<h2>Our story</h2><p>Content that fits the screen.</p>';},3000);</script>
    </head><body><main><h1>Slow page</h1><table style="width:1200px"><tr><td>Wide table before the stylesheet arrives</td></tr></table><div id="app"><p>Loading...</p></div></main></body></html>`,
};

const svg = c => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="${c}"/></svg>`;

http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (process.env.POST_LOG && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) fs.appendFileSync(process.env.POST_LOG, `${req.method} ${u.pathname}\n`);
  const send = (code, body, type = 'text/html; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, Server: 'Express/4.1.0', 'X-Powered-By': 'Express', ...extra }); res.end(body); };
  if (u.pathname === '/late.css') return send(200, 'body{font-family:Arial;margin:0}main{padding:20px;max-width:700px;margin:auto}table{width:100%!important}', 'text/css');
  if (u.pathname.startsWith('/img/p')) return send(200, svg('#86efac'), 'image/svg+xml');
  if (u.pathname === '/gone' || u.pathname === '/img/banner.png') return send(404, 'gone', 'text/plain');
  if (u.pathname === '/robots.txt' || u.pathname === '/sitemap.xml') return send(404, 'no', 'text/plain');
  if (req.method === 'POST' && u.pathname === '/contact') { req.resume(); req.on('end', () => send(200, 'Thanks! We will reply soon.', 'text/plain')); return; } // accepts anything (bug)
  if (req.method === 'POST' && u.pathname === '/login') {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      const p = new URLSearchParams(body);
      if (p.get('username') !== 'demo') return send(200, shell('Login', '<h1>Login</h1><p>User not found</p>')); // user enumeration (bug)
      if (p.get('password') !== 'demo123') return send(200, shell('Login', '<h1>Login</h1><p>Wrong password</p>'));
      send(302, '', 'text/plain', { Location: '/' });
    });
    return;
  }
  const page = pages[u.pathname];
  if (page) return send(200, page(u), 'text/html; charset=utf-8', u.pathname === '/' ? { 'Set-Cookie': 'sessionid=qa123; Path=/' } : {}); // cookie without flags (bug)
  send(200, shell('Not found', '<h1>Not found</h1><p>Sorry, nothing here.</p>')); // soft 404 (bug)
}).listen(port, () => console.log(`demo shop on http://localhost:${port}`));
