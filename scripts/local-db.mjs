import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
process.env.LC_ALL = process.env.LC_ALL || 'C';
process.env.LANG = process.env.LANG || 'C';
const root = resolve(import.meta.dirname, '..');
const bin = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin';
const data = resolve(root, 'data/postgres-local');
const archive = resolve(root,'data/pdf-archive');
const config = resolve(root,'.env.development.local');
if (!existsSync(`${bin}/pg_ctl`)) throw new Error('Install PostgreSQL 16 or set PG_BIN to its bin directory');
mkdirSync(archive,{recursive:true});
if (!existsSync(`${data}/PG_VERSION`)) {
 const password = randomBytes(32).toString('hex');
 const passwordFile = resolve(root,'data/.pg-init-password');
 writeFileSync(passwordFile,password,{mode:0o600});
 try { execFileSync(`${bin}/initdb`,['-D',data,'-U','finance_app','--auth=scram-sha-256',`--pwfile=${passwordFile}`,'--encoding=UTF8','--locale=C'],{stdio:'inherit'}); }
 finally { unlinkSync(passwordFile); }
 let settings = existsSync(config)?readFileSync(config,'utf8'):'';
 settings = settings.split('\n').filter(l=>!l.startsWith('DATABASE_URL=')&&!l.startsWith('REPORTS_DIR=')).join('\n');
 writeFileSync(config,settings+`\nDATABASE_URL=postgresql://finance_app:${password}@127.0.0.1:55432/postgres\nREPORTS_DIR=${archive}\n`,{mode:0o600});
}
try { execFileSync(`${bin}/pg_ctl`,['-D',data,'status'],{stdio:'pipe'});console.log('Local PostgreSQL already running'); }
catch { execFileSync(`${bin}/pg_ctl`,['-D',data,'-l',resolve(root,'data/postgres-local.log'),'-o',`-h 127.0.0.1 -p 55432 -k ${resolve(root,'data')}`,'start'],{stdio:'inherit'}); }
console.log('Local PostgreSQL ready on 127.0.0.1:55432');
