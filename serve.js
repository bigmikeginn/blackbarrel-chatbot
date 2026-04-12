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
  const filePath = path.join(__dirname, req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Preview at http://localhost:${PORT}`));
