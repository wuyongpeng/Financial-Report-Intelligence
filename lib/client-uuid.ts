/** RFC 4122 UUID for browsers where crypto.randomUUID is missing (plain HTTP). */
const HEX = 16;

function bytesToUuid(bytes: Uint8Array) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomBytes(size: number) {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function fallbackUuid(bytes = randomBytes(HEX)) {
  return bytesToUuid(bytes.length >= HEX ? bytes.slice(0, HEX) : randomBytes(HEX));
}

export function clientUuid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* insecure http: randomUUID throws or is missing */
  }
  return fallbackUuid();
}
