/**
 * Minimal ed25519 point check.
 *
 * Program Derived Addresses must NOT lie on the ed25519 curve, so deriving a
 * PDA requires checking whether a 32-byte candidate decompresses to a valid
 * curve point. This mirrors `curve25519_dalek::edwards::CompressedEdwardsY::decompress`
 * as used by `Pubkey::is_on_curve` in the Solana runtime.
 */

const P = 2n ** 255n - 19n;
// d = -121665 / 121666 mod p
const D = mod(-121665n * inv(121666n));
// sqrt(-1) mod p
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

function mod(a: bigint): bigint {
  const r = a % P;
  return r >= 0n ? r : r + P;
}

function pow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b);
    b = mod(b * b);
    e >>= 1n;
  }
  return result;
}

function inv(a: bigint): bigint {
  return pow(a, P - 2n);
}

export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;

  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]!);
  y &= (1n << 255n) - 1n; // clear sign bit
  if (y >= P) return false;

  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);

  // x = (u/v)^((p+3)/8) computed as u*v^3*(u*v^7)^((p-5)/8)
  const v3 = mod(v * v * v);
  const v7 = mod(v3 * v3 * v);
  let x = mod(u * v3 * pow(mod(u * v7), (P - 5n) / 8n));

  const vx2 = mod(v * x * x);
  if (vx2 === u) return true;
  if (vx2 === mod(-u)) {
    x = mod(x * SQRT_M1);
    return true;
  }
  return false;
}
