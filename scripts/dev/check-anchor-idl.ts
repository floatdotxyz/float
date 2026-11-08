/**
 * Compares the IDL produced by `anchor build` with the committed one that
 * the TypeScript client uses. Fails on any difference in instruction names,
 * discriminators, account order/flags, argument types or account layouts.
 *
 *   node scripts/dev/check-anchor-idl.ts target/idl/float_router.json
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const anchorPath = process.argv[2] ?? "target/idl/float_router.json";
const committedPath = fileURLToPath(new URL("../../packages/sdk/idl/float_router.json", import.meta.url));

type Ix = { name: string; discriminator: number[]; accounts: { name: string; writable?: boolean; signer?: boolean }[]; args: { name: string; type: unknown }[] };
type Idl = { instructions: Ix[]; accounts?: { name: string; discriminator: number[] }[]; types?: { name: string; type: unknown }[] };

const a = JSON.parse(readFileSync(anchorPath, "utf8")) as Idl;
const b = JSON.parse(readFileSync(committedPath, "utf8")) as Idl;

const norm = (idl: Idl) => ({
  instructions: idl.instructions
    .map((i) => ({
      name: i.name,
      discriminator: i.discriminator,
      accounts: i.accounts.map((x) => `${x.name}:${x.writable ? "w" : ""}${x.signer ? "s" : ""}`),
      args: i.args.map((x) => `${x.name}:${JSON.stringify(x.type)}`),
    }))
    .sort((x, y) => x.name.localeCompare(y.name)),
  accounts: (idl.accounts ?? []).map((x) => `${x.name}:${x.discriminator.join(",")}`).sort(),
  types: (idl.types ?? [])
    .filter((t) => (idl.accounts ?? []).some((x) => x.name === t.name))
    .map((t) => `${t.name}:${JSON.stringify(t.type)}`)
    .sort(),
});

const [na, nb] = [norm(a), norm(b)];
const diffs: string[] = [];
const cmp = (label: string, x: unknown, y: unknown) => {
  if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push(`${label}\n  anchor:    ${JSON.stringify(x)}\n  committed: ${JSON.stringify(y)}`);
};
cmp("instruction names", na.instructions.map((i) => i.name), nb.instructions.map((i) => i.name));
for (const ia of na.instructions) {
  const ib = nb.instructions.find((i) => i.name === ia.name);
  if (ib) cmp(`instruction ${ia.name}`, ia, ib);
}
cmp("accounts", na.accounts, nb.accounts);
cmp("account layouts", na.types, nb.types);

if (diffs.length) {
  console.error(`IDL mismatch (${diffs.length}):\n${diffs.join("\n")}`);
  process.exit(1);
}
console.log("anchor IDL matches the committed client IDL");
