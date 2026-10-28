import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
process.env.LC_ALL = process.env.LC_ALL || 'C';
process.env.LANG = process.env.LANG || 'C';
const root = resolve(import.meta.dirname, '..');
const bin = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin';
const data = resolve(root, 'data/postgres-local');
const archive = resolve(root,'data/pdf-archive');
const config = resolve(root,'.env.development.local');
const listenHost = '0.0.0.0';
const listenPort = '55432';
const lanCidrs = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

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
 // Keep app DATABASE_URL on loopback; LAN peers use this Mac's LAN IP + same credentials.
 writeFileSync(config,settings+`\nDATABASE_URL=postgresql://finance_app:${password}@127.0.0.1:${listenPort}/postgres\nREPORTS_DIR=${archive}\n`,{mode:0o600});
}

/** Idempotent: ensure private-LAN SCRAM host rules exist in pg_hba.conf. */
function ensureLanHba() {
 const hbaPath = resolve(data, 'pg_hba.conf');
 if (!existsSync(hbaPath)) return;
 let hba = readFileSync(hbaPath, 'utf8');
 const marker = '# financeAnalysis: allow company LAN (SCRAM)';
 const lines = lanCidrs.map((cidr) => `host    all             all             ${cidr}          scram-sha-256`);
 if (hba.includes(marker)) {
  // Refresh the three CIDR lines under the marker if someone edited them away.
  for (const line of lines) {
   if (!hba.includes(line)) {
    hba = hba.replace(marker, `${marker}\n${line}`);
   }
  }
 } else {
  const block = `\n${marker}\n${lines.join('\n')}\n`;
  hba = hba.trimEnd() + block;
 }
 writeFileSync(hbaPath, hba.endsWith('\n') ? hba : hba + '\n');
}

function primaryLanIp() {
 const nets = networkInterfaces();
 for (const name of Object.keys(nets)) {
  for (const net of nets[name] ?? []) {
   if (net.family !== 'IPv4' || net.internal) continue;
   const a = net.address;
   if (a.startsWith('10.') || a.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(a)) {
    return a;
   }
  }
 }
 return null;
}

ensureLanHba();

const startOpts = `-h ${listenHost} -p ${listenPort} -k ${resolve(root,'data')}`;
try {
 execFileSync(`${bin}/pg_ctl`,['-D',data,'status'],{stdio:'pipe'});
 console.log('Local PostgreSQL already running');
} catch {
 execFileSync(`${bin}/pg_ctl`,['-D',data,'-l',resolve(root,'data/postgres-local.log'),'-o',startOpts,'start'],{stdio:'inherit'});
}

const lanIp = primaryLanIp();
console.log(`Local PostgreSQL ready on localhost:${listenPort} and LAN ${listenHost}:${listenPort}`);
if (lanIp) {
 console.log(`LAN peers: postgresql://finance_app:<password-from-.env.development.local>@${lanIp}:${listenPort}/postgres`);
} else {
 console.log(`LAN peers: postgresql://finance_app:<password-from-.env.development.local>@<this-Mac-LAN-IP>:${listenPort}/postgres`);
}
