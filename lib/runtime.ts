import { env } from 'cloudflare:workers';
import type { Bindings } from './types';

export function getBindings() {
  return env as unknown as Bindings;
}
