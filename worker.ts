import app from 'vinext/server/app-router-entry';
import { runIngestion } from './lib/ingest';
import type { Bindings } from './lib/types';

const worker = {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runIngestion(env, { days: 2, downloadLimit: 4, parseLimit: 1 }));
  },
};

export default worker;
