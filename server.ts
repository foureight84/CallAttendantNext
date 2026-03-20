import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { config } from './lib/config';

// instrumentation.ts handles DB init and modem daemon startup
// in Next.js's module context (shared with API routes)

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();
console.log('[server] Next.js ready');

const server = createServer((req, res) => {
  const parsedUrl = parse(req.url!, true);
  handle(req, res, parsedUrl);
});

server.listen(config.port, () => {
  console.log(`[server] Listening on http://localhost:${config.port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
