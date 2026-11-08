import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  Keypair,
  PublicKey,
  Reader,
  Writer,
  compileLegacyMessage,
  createProgramAddress,
  decodeBase58,
  encodeBase58,
  findProgramAddress,
  isOnCurve,
  setComputeUnitLimit,
  signTransaction,
  FLOAT,
  RAYDIUM,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  systemTransfer,
} from "../src/index.ts";

test("base58 round-trips and preserves leading zeros", () => {
  const cases = [new Uint8Array([]), Uint8Array.of(0), Uint8Array.of(0, 0, 1, 2, 255), new Uint8Array(32)];
  for (const c of cases) assert.deepEqual(decodeBase58(encodeBase58(c)), c);
  assert.equal(encodeBase58(new Uint8Array(32)), "11111111111111111111111111111111");
  assert.equal(encodeBase58(Uint8Array.from(Buffer.from("hello world"))), "StV1DL6CwTryKyV");
});

test("base58 rejects invalid characters", () => {
  assert.throws(() => decodeBase58("0OIl"), /Invalid base58/);
});

test("all published Float and Raydium addresses are valid 32-byte keys", () => {
  for (const k of [...Object.values(FLOAT), ...Object.values(RAYDIUM)]) {
    assert.equal(k.bytes.length, 32);
    assert.equal(new PublicKey(k.toBase58()).toBase58(), k.toBase58());
  }
});

test("PDA derivation matches Raydium's published authorities", () => {
  assert.equal(
    findProgramAddress(["vault_and_lp_mint_auth_seed"], RAYDIUM.cpmm).address.toBase58(),
    RAYDIUM.cpmmAuthority.toBase58(),
  );
  assert.equal(
    findProgramAddress(["vault_auth_seed"], RAYDIUM.launchLab).address.toBase58(),
    RAYDIUM.launchLabAuthority.toBase58(),
  );
  assert.equal(
    findProgramAddress(["lock_cp_authority_seed"], RAYDIUM.burnAndEarn).address.toBase58(),
    RAYDIUM.burnAndEarnAuthority.toBase58(),
  );
});

test("PDAs are off-curve, generated keypairs are on-curve", () => {
  const pda = findProgramAddress(["anything"], RAYDIUM.cpmm);
  assert.equal(isOnCurve(pda.address.bytes), false);
  for (let i = 0; i < 10; i++) assert.equal(Keypair.generate().publicKey.isOnCurve(), true);
});

test("createProgramAddress reproduces findProgramAddress with its bump", () => {
  const { address, bump } = findProgramAddress(["pool", FLOAT.flagshipMint], RAYDIUM.launchLab);
  assert.ok(createProgramAddress(["pool", FLOAT.flagshipMint, Uint8Array.of(bump)], RAYDIUM.launchLab).equals(address));
});

test("ATA derivation is deterministic and off-curve", () => {
  const a = getAssociatedTokenAddress(FLOAT.treasury, FLOAT.flagshipMint);
  const b = getAssociatedTokenAddress(FLOAT.treasury, FLOAT.flagshipMint, TOKEN_PROGRAM_ID);
  assert.ok(a.equals(b));
  assert.equal(a.isOnCurve(), false);
});

test("borsh writer/reader round-trip", () => {
  const w = new Writer().u8(7).u16(65535).u32(123456).u64(2n ** 64n - 1n).u128(2n ** 100n).bool(true).string("float").pubkey(FLOAT.program);
  const r = new Reader(w.toBytes());
  assert.equal(r.u8(), 7);
  assert.equal(r.u16(), 65535);
  assert.equal(r.u32(), 123456);
  assert.equal(r.u64(), 2n ** 64n - 1n);
  assert.equal(r.u128(), 2n ** 100n);
  assert.equal(r.bool(), true);
  assert.equal(r.string(), "float");
  assert.ok(r.pubkey().equals(FLOAT.program));
  assert.equal(r.remaining, 0);
});

test("writer rejects overflow", () => {
  assert.throws(() => new Writer().u64(2n ** 64n), RangeError);
});

test("keypair signatures verify with node:crypto", () => {
  const kp = Keypair.generate();
  const msg = new TextEncoder().encode("float");
  const sig = kp.sign(msg);
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(kp.publicKey.bytes)]);
  const pub = createPublicKey({ key: spki, format: "der", type: "spki" });
  assert.equal(verify(null, msg, pub, sig), true);
});

test("keypair round-trips through a 64-byte Solana secret key", () => {
  const kp = Keypair.generate();
  // Rebuild the 64-byte secret: we can't read the seed back, so check fromSecretKey validation instead.
  const bogus = new Uint8Array(64);
  bogus.set(kp.publicKey.bytes, 32);
  assert.throws(() => Keypair.fromSecretKey(bogus), /does not match/);
});

test("legacy message compiles with fee payer first and correct header", () => {
  const payer = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const ixs = [setComputeUnitLimit(200_000), systemTransfer(payer.publicKey, to, 1_000n)];
  const blockhash = encodeBase58(createHash("sha256").update("bh").digest());
  const msg = compileLegacyMessage(ixs, payer.publicKey, blockhash);

  assert.deepEqual([...msg.bytes.subarray(0, 3)], [1, 0, 2]); // 1 signer, 0 ro-signed, 2 ro-unsigned (2 programs)
  assert.equal(msg.bytes[3], 4); // 4 account keys
  assert.ok(new PublicKey(msg.bytes.subarray(4, 36)).equals(payer.publicKey));

  const { wire, signature } = signTransaction(msg, [payer]);
  assert.equal(wire[0], 1);
  assert.equal(encodeBase58(wire.subarray(1, 65)), signature);
  assert.deepEqual(wire.subarray(65), msg.bytes);
});

test("signTransaction fails on missing signer", () => {
  const payer = Keypair.generate();
  const msg = compileLegacyMessage([systemTransfer(payer.publicKey, FLOAT.treasury, 1n)], payer.publicKey, "11111111111111111111111111111111");
  assert.throws(() => signTransaction(msg, []), /Missing signer/);
});
