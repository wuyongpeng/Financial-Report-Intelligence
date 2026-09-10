import { ensureSchema } from '../lib/migrate';
import { closeDb } from '../lib/db';

void ensureSchema().then(() => console.log('Backend V1 schema ready'))
  .catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; })
  .finally(() => closeDb());
