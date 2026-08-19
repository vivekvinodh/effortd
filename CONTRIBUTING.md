# Contributing to effortd

Thanks for looking under the hood. This repo runs on a small number of hard rules — they're what make a proxy trustworthy.

## The gate

`npm run verify` (typecheck + full test suite) must exit 0 on every commit. CI runs exactly this on Node 20 and 22.

## The invariants (non-negotiable in review)

1. **Fail-open** — an internal effortd error must forward the request untouched. A feature that can't fail open doesn't ship.
2. **Byte-transparency in observe mode** — tested, not intended (`test/pipeline.test.ts`).
3. **Streaming is never buffered** — the chunk-timing tripwire in `test/proxy.test.ts` will catch you.
4. **Telemetry is metadata-only** — no message content, no headers, no keys, ever. The marker test in `test/telemetry.test.ts` enforces it.
5. **No blind injection** — effort fields are only written for models in `docs/PROVIDERS.md`'s verified matrix. New provider facts need a dated citation to live official docs *before* the code that depends on them (see the claims-register discipline in `docs/V1-READINESS-PLAN.md` §0.11).
6. **No LLM calls in the request hot path** — heuristics are in-process; anything smarter runs off-path.

## Working style

- TDD with failing-first evidence; conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Runtime dependencies are a trust surface: the list is `yaml`, full stop. Adding one is a design discussion, not a `npm i`.
- Rejected approaches live in `docs/V1-READINESS-PLAN.md` §10 — reintroducing one fails review.
- `docs/DESIGN.md` explains *why* the defaults are conservative. Changing a default needs measurement (see `eval/`), not vibes.
