import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

function reportsRoot() {
  return resolve(/* turbopackIgnore: true */ process.env.REPORTS_DIR ?? '/data/reports');
}

function resolveKey(key: string) {
  const root = reportsRoot();
  // The archive directory is a VM mount supplied at runtime, not an application asset to trace.
  const target = resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error('Unsafe report path');
  return target;
}

export async function putReport(key: string, bytes: ArrayBuffer) {
  const target = resolveKey(key);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.part`;
  await writeFile(temporary, new Uint8Array(bytes));
  await rename(temporary, target);
}

export async function readReport(key: string) {
  try {
    return await readFile(resolveKey(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function removeReport(key: string) {
  try {
    await unlink(resolveKey(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
