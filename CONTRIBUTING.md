# Contributing

Thanks for helping keep these docs and tools accurate.

## Ground rules

1. **The official docs win.** Every rule, percentage and address here must be
   traceable to <https://www.floatlaunch.xyz/docs> or to on-chain data. Cite
   your source in the PR.
2. **Don't guess at the Float program.** Its source and IDL are not public.
   Describe observable behaviour, and keep interpretations clearly marked as
   such in code comments.
3. **Keep the SDK dependency-free.** Node built-ins only.
4. **Vendored files stay verbatim.** To update them, follow
   [`vendor/raydium/README.md`](vendor/raydium/README.md).

## Workflow

```bash
npm install
npm run check                    # typecheck + TS tests (incl. IDL freshness)
cargo test -p float-core         # Rust core
cargo clippy -p float-core --all-targets -- -D warnings
anchor build && node scripts/dev/check-anchor-idl.ts target/idl/float_router.json
npm run lint:docs
```

- Changing an Accounts struct, instruction signature, state account, event or
  error in `programs/float-router`? Run `node scripts/dev/gen-router-idl.ts`
  and commit the regenerated `packages/sdk/idl/float_router.json`.
- Pure logic belongs in `crates/float-core` with a unit test. If TypeScript
  mirrors it, add a shared vector to both test suites.

- New SDK logic needs tests in `packages/sdk/test/`.
- New CLI commands need a case in `packages/cli/test/cli.test.ts` (use the mock RPC).
- Docs: one topic per page, link instead of repeating, use real addresses only
  from [`docs/contracts.md`](docs/contracts.md).

## Commit style

Conventional commits (`feat(sdk): …`, `fix(cli): …`, `docs: …`).
