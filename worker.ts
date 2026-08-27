import app from 'vinext/server/app-router-entry';
import { bootstrapLiveData, runIngestion } from './lib/ingest';
import type { Bindings } from './lib/types';

const worker = {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);
    // Sites currently serves the production Worker reliably through fetch events,
    // while scheduled events are not guaranteed in every hosting workspace. Seed
    // the real official-announcement snapshot on the first authenticated visit so
    // the application never falls back to browser-only demo data.
    if (request.method === 'GET' && pathname === '/') {
      const existing = await env.DB.prepare('SELECT id FROM announcements LIMIT 1').first();
      if (!existing) await bootstrapLiveData(env);
    }
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runIngestion(env, { days: 2, downloadLimit: 4, parseLimit: 2 }));
  },
};

export default worker;
