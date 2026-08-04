const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 3003;

http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const preview = fs.readFileSync(path.join(__dirname, 'preview.html'), 'utf8');
    const widget = fs.readFileSync(path.join(__dirname, 'widget-embed.html'), 'utf8');
    const combined = preview.replace('</body>', widget + '\n</body>');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(combined);
    return;
  }
  // Resolve and confine to the project directory — req.url is untrusted and
  // "/../../" would otherwise read files outside the project.
  const filePath = path.resolve(__dirname, '.' + path.posix.normalize('/' + req.url.split('?')[0]));
  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
  // Bind to loopback only — this is a local preview, not a LAN service.
}).listen(PORT, '127.0.0.1', () => console.log(`Preview at http://localhost:${PORT}`));
