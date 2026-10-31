import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const root = resolve('deploy/d2-public');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8080);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  if (!['GET', 'HEAD'].includes(req.method)) {
    return send(405, 'Metodo no permitido');
  }

  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (pathname === '/api/runtime-health') {
      try {
        const response = await fetch('http://127.0.0.1:3001/health', {
          signal: AbortSignal.timeout(2000)
        });

        if (!response.ok) throw new Error('internal_api_unavailable');

        const health = await response.json();

        if (health.status !== 'ok' ||
            health.service !== 'treadproof-local-auth' ||
            health.capabilities?.batch_operations !== false) {
          throw new Error('unexpected_internal_api');
        }

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store'
        });

        res.end(req.method === 'HEAD' ? undefined :
          JSON.stringify({
            service: 'treadproof-d2-runtime',
            status: 'ok',
            internalApi: 'restricted',
            writesEnabled: false
          }));
        return;
      } catch {
        return send(503, 'API interna no disponible');
      }
    }
    if (pathname === '/api/status') {
      const status = {
        service: 'treadproof-d2',
        mode: 'synthetic_read_only',
        network: 'testnet',
        verifiedOnStellar: false,
        signingEnabled: false,
        dispatchEnabled: false
      };

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store'
      });

      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(status));
      return;
    }

    if (pathname.startsWith('/api/') || pathname === '/api') {
      return send(404, 'API no expuesta');
    }

    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\0') || decoded.includes('\\')) {
      return send(400, 'Ruta invalida');
    }

    const segments = decoded.split('/');
    if (segments.includes('..') || segments.some(s => s.startsWith('.'))) {
      return send(403, 'Ruta no permitida');
    }

    const relative = decoded === '/' ? 'nfu-tracking.html' : decoded.slice(1);
    // Publicar exclusivamente la vista D2, su evidencia y
    // los recursos compilados que necesita esa página.
    const allowed =
      relative === 'nfu-tracking.html' ||
      relative === 'evidence/nfu-demo-d2-001-valorization.txt' ||
      /^assets\/tracking-[A-Za-z0-9_-]+\.(js|css)$/.test(relative) ||
      /^assets\/style-[A-Za-z0-9_-]+\.(js|css)$/.test(relative);

    if (!allowed) {
      return send(404, 'Recurso no publicado');
    }

    const target = resolve(root, relative);

    if (!target.startsWith(root + sep)) {
      return send(403, 'Ruta no permitida');
    }

    const info = await stat(target);
    if (!info.isFile()) return send(404, 'No encontrado');

    const type = mime[extname(target)];
    if (!type) return send(415, 'Tipo no permitido');

    const contents = await readFile(target);

    res.writeHead(200, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    });

    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch {
    send(404, 'No encontrado');
  }
}).listen(port, host, () => {
  console.log(`TreadProof D2 read-only: http://${host}:${port}`);
});