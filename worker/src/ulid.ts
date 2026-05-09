// Cloudflare Workers-compatible ULID generator.
//
// We avoid the npm `ulid` package because it falls back to `node:crypto` in
// non-browser environments, which doesn't exist in the Workers runtime. The
// Web Crypto API (`crypto.getRandomValues`) is available everywhere we run.
//
// Output: 26 Crockford base32 characters
//   - 10 chars encode a 48-bit millisecond timestamp (sortable)
//   - 16 chars encode 80 bits of randomness
//
// We allocate one random byte per output character and read its low 5 bits.
// That's a few wasted bits per byte but the code stays trivial.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;

function encodeTime(ms: number): string {
  let out = '';
  for (let i = 0; i < TIME_LEN; i++) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RAND_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < RAND_LEN; i++) {
    out += ALPHABET[bytes[i]! & 31];
  }
  return out;
}

export function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom();
}
