/**
 * Custom Next.js server with voice WebSocket proxies on the same port.
 * Dev:  node server.mjs
 * Prod: NODE_ENV=production node server.mjs
 *
 * Bind host: use HOST / LISTEN_HOST only. Never read HOSTNAME — Docker sets that
 * to the container id, which breaks Next's hostname / listen binding.
 */
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { attachVoiceWebSockets } from './lib/voice/ws-proxy.mjs';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || process.env.LISTEN_HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  const parsed = parse(req.url, true);
  handle(req, res, parsed).catch((err) => {
    console.error('next request error', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('internal error');
    }
  });
});

try {
  attachVoiceWebSockets(server);
} catch (err) {
  console.error('voice websocket attach failed; HTTP continues without voice', err);
}

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port} (voice ws: /api/voice/asr|/api/voice/tts)`);
});
