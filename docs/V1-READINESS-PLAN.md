# effortd — V1 Readiness Plan (v1-ready)

> **Working name**: `effortd` ("effort daemon"). npm availability verified 2026-08-18: `effortd`, `reasongate`, `effort-gate`, `spendgate` all return E404 (unclaimed). Renaming is a one-commit operation until E8.2 (npm publish) locks the name.

**Objective-driven, step-by-step plan to take effortd from an empty git repo to a published, open-source, agent-agnostic reasoning-spend policy gateway — a local proxy that any coding agent (Claude Code, Codex CLI, Gemini CLI, and whatever ships next) points its provider base URL at, which normalizes each provider's reasoning-effort dial into one scale, applies user policy on a strict `observe → suggest → enforce` ladder, and produces truthful per-session spend telemetry — without ever breaking, slowing, or silently degrading the agent it serves.**

Grounded in (a) a research pass verified against **Claude Code v2.1.235** — changelog, official docs (code.claude.com/docs), and CLI-bundle string extraction via a dedicated research agent — covering the automode-classifier architecture this project's policy design deliberately echoes, and every Claude-side effort surface; (b) the **current Anthropic API reference** (effort parameter semantics, per-model support matrix, error modes); (c) a **router-economics design analysis** (2026-08-18 session) whose four conclusions are binding constraints (§2.3); (d) live npm-registry name checks. Dated 2026-08-18.

**Precondition**: empty repo at `/Users/vivekvinodh/Development/effortd`, `git init` on `main`, zero commits; this plan is the repo's first artifact. Local Node v25.9.0; runtime target Node ≥ 20 (built-in `fetch`/undici). Founder decision on record (2026-08-18): the **policy gateway** shape was chosen over the launcher-CLI and MCP-delegation alternatives — those become §8 backlog *modes*, not v1 scope.

**The design's headline verdict** (§2.3, binding): a naive per-message effort *downgrade* router is negative-value for interactive agents — adaptive thinking already absorbs most of the savings inside the model, task difficulty is illegible before execution, misclassification costs are asymmetric (silent quality loss ≫ wasted tokens), and mid-session parameter flips churn prompt cache at dollar scale. effortd therefore ships **observe-first**, **escalate-only by default** when enforcement is on, and treats **"never break the agent"** as its prime invariant. The v1 differentiators are the effort-normalization layer, agent-aware safe policy, honest telemetry, and published receipts (E7) — *not* classification cleverness.

---

## 0. How to execute this plan (instructions for Claude)

1. **Work one step at a time**, in order, respecting `Depends on`. Never start a milestone whose Gate is not green.
2. **TDD, with evidence**: for every step that adds or changes behavior, write the failing test *first*, watch it fail, then implement. Failing-first must leave evidence: the test commit precedes the fix commit (checkable via `git log --oneline`), or the observed failing output is pasted into the Progress Log (§11).
3. **Observe, don't assert**: an integration claim (all of E1.3, E6.x) is "done" only when the flow was *exercised* against the real thing — a live provider call through the proxy, a real agent session pointed at it — and the observed evidence (request/response transcript, telemetry lines, terminal output) is pasted into the Progress Log. "Compiles" and "the test mocks pass" are not done for integration steps.
4. **The regression gate is a hard floor**: after every step, `npm run verify` (typecheck + full unit suite; defined in E0.1) must exit 0. Until the repo is on GitHub (E8.2), the gate runs locally; E0.1 also authors the CI workflow so it activates on first push.
5. **Ship dark where behavior mutates**: request-mutation capability lands behind the mode ladder with `mode: observe` as the immutable default. `enforce` semantics stronger than escalate-only require E7 receipts first. Pure passthrough, telemetry, and reporting are exempt.
6. **Commit per step** directly on `main` while pre-0.1 (no stacked-PR ceremony for a greenfield solo repo); conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). From E8.2 (published) onward, work moves to PR-per-step.
7. **Update this file after every step**: tick the checkbox, append a dated Progress Log line (§11) with commit hash and observed evidence.
8. **Standing rule — docs ride along**: E0.2 creates `README.md` and `docs/PROVIDERS.md`; every later step that changes behavior updates them in the same commit. A README quickstart line that was never actually executed is a §10 trap — quickstarts ship only with E6 evidence behind them.
9. **Standing rule — reject the traps (§10)**: per-message downgrade routing, buffered streaming, LLM calls in the hot path, prompt/key persistence, gateway feature-creep, unverified param injection. Any commit that reintroduces one fails review.
10. **Cost awareness**: every step that makes live provider calls (E1.3, E6.x, E7.2) records the actual spend in the Progress Log. E7.2's eval matrix gets a projected budget **founder-approved before the run**.
11. **Verify-before-code for §2.2 UNVERIFIED rows**: those claims are *leads from training data, not facts*. Each must be re-verified against live official docs (dated citation recorded in `docs/PROVIDERS.md`) before any code depends on it. E0.3 is the bulk spike; anything it can't confirm blocks its dependent step, never gets guessed.
12. **Privacy floor on every step**: no code path may persist prompt/message content, tool payloads, or credentials — telemetry is metadata + usage numbers only (§1). Any fixture captured from live traffic is scrubbed before commit.

**What "done" means here**: a stranger can `npm i -g effortd`, point any of the three launch agents at it using a quickstart that was actually executed, watch truthful per-session effort/token/cost telemetry appear, opt into enforcement whose semantics are documented and receipt-backed, and read `docs/RECEIPTS.md` to see why the defaults are what they are — with `npm run verify` green throughout and every §2.2 UNVERIFIED row resolved to VERIFIED or descoped.

---

## 1. Ground rules (constraints on every step)

- **Prime invariant — fail-open, never break the agent**: any internal effortd error (policy, parsing, telemetry, session store) results in forwarding the request untouched and logging the error locally. The agent must work *identically* with a broken effortd in the middle. A policy feature that cannot fail open does not ship.
- **Byte-transparency in observe mode**: with `mode: observe`, the forwarded request body is byte-identical to what the agent sent, and the response is streamed through unmodified. This is a *tested guarantee* (E1.1/E3.4), not an intention.
- **Streaming is sacred**: SSE responses are piped through unbuffered, chunk timing preserved. Usage extraction tees the stream; if the tee parser dies mid-stream, the client stream must be unaffected. No code path may hold a response until complete.
- **Telemetry is metadata-only**: timestamps, provider, model, effort in/out, decision + reason, usage token counts, cost estimate, session fingerprint (a hash). Never message content, never headers, never keys. Session fingerprints are one-way hashes.
- **BYO credentials, zero credential handling**: auth headers pass through verbatim; effortd never stores, logs, or requires API keys of its own. (Consequence, stated honestly in docs: Claude Code *subscription/OAuth* traffic is out of scope — the audience is API-key/gateway users, who are exactly the cost-sensitive audience.)
- **Effort injection allowlist**: effortd only *sets* an effort field on models in the verified support matrix (§2.2); on unknown models it may clamp a value the agent already sent, never add one. Rationale: Anthropic returns 400 `This model does not support the effort parameter` (verified — Claude Code changelog 2.1.70/2.1.154 fixed exactly this class of bug).
- **Enforcement semantics are conservative by construction**: default `mode: observe`; `enforce` defaults to session-sticky + escalate-only (a session's effort may rise, never silently fall). Mid-session downgrades exist only behind an explicit config key whose docs state the cache-churn and quality-risk tradeoffs.
- **Dependency austerity**: runtime dependencies = `yaml` only; everything else is Node ≥ 20 built-ins. Dev-deps: `typescript`, `tsx`, `vitest`, `@types/node`. Every added dep is an OSS trust-surface decision recorded in the Progress Log.
- **Pricing honesty**: the bundled price table is a dated snapshot for *estimates*, overridable in config, labeled as such in every report. effortd never presents cost figures as billing truth.
- **Cross-platform floor**: macOS + Linux at v1; no shell-outs in the runtime path. Windows is §8 backlog (verify, don't assume).

---

## 2. Current state — verified baseline (do NOT re-research)

### 2.1 What exists

Empty `git init` repo; this plan. Name candidates npm-free (2026-08-18). No code, no CI, no README.

### 2.2 Provider & agent claims register

**VERIFIED this session** (source: current Anthropic API reference via the claude-api skill; Claude Code v2.1.235 changelog/docs/bundle via research agent):

| # | Claim | Source |
|---|---|---|
| V1 | Anthropic effort lives at `output_config.effort`, values `low\|medium\|high\|xhigh\|max`, GA (no beta header), default `high` | API reference 2026-08 |
| V2 | Model support: Fable 5 / Opus 5 / Opus 4.8 / Opus 4.7 / Sonnet 5 → all five; Opus 4.6 & Sonnet 4.6 → no `xhigh` (map → `high`); Opus 4.5 → `low\|medium\|high` only; Sonnet 4.5 / Haiku 4.5 / older → **error** | API reference 2026-08 |
| V3 | Sending effort to an unsupported model → 400 `This model does not support the effort parameter` | Claude Code changelog 2.1.70, 2.1.154 |
| V4 | Claude Code honors `ANTHROPIC_BASE_URL` for gateway routing (API-key auth path); effort surfaces: `/effort`, `--effort`, `CLAUDE_CODE_EFFORT_LEVEL` env (2.1.132), `effortLevel` settings key (2.1.203), skill/agent `effort:` frontmatter (2.1.80) | changelog + docs + bundle strings |
| V5 | No auto/dynamic effort selection exists in Claude Code v2.1.235 (bundle grep: no `autoEffort`/`dynamicEffort`/classifier strings) — effortd is not duplicating a native feature | research agent report 2026-08-18 |
| V6 | Claude Code warns about prompt-cache misses when effort changes mid-conversation (2.1.129) — grounding for escalate-only/sticky defaults | changelog |
| V7 | Anthropic effort is available via Bedrock/Vertex/Foundry model IDs too (Claude Code runs effort there) — upstream targets beyond api.anthropic.com are viable later (§8) | changelog 2.1.122, 2.1.158 |
| V8 | npm names `effortd`/`reasongate`/`effort-gate`/`spendgate` unclaimed | `npm view` E404, 2026-08-18 |

**RESOLVED at E0.3 (2026-08-18)** — every row verified against live official sources; full citations + mapper policy in `docs/PROVIDERS.md` (R1–R8). Three priors required correction:

| # | Outcome |
|---|---|
| U1 → R1 | VERIFIED+corrected: OpenAI effort space is now `none…max` and **model-dependent**; Responses `reasoning.effort` primary; chat `reasoning_effort` same shared enum → clamp-only policy |
| U2 → R2 | VERIFIED: `stream_options.include_usage` → single final usage chunk (`choices: []`); interrupted streams may lack it (accepted coverage gap) |
| U3 → R3 | VERIFIED+**corrected**: Gemini is `thinkingLevel`-enum-first now (`minimal…high`, model-dependent); `thinkingBudget` (0=off, −1=auto) still accepted |
| U4 → R4 | VERIFIED fields (`promptTokenCount`/`candidatesTokenCount`/`thoughtsTokenCount`/…); per-chunk cumulativeness pinned at the E4.1 live fixture |
| U5 → R5 | VERIFIED+**corrected**: Codex `wire_api = "responses"` is the only wire; `model_reasoning_effort` = `minimal…xhigh`; top-level `model_provider` selects |
| U6 → R6 | VERIFIED: `GOOGLE_GEMINI_BASE_URL` honored (genai SDK; merged gemini-cli PRs #2899/#6380) — API-key auth mode |
| U7 → R7 | **Corrected, favorably**: base-URL-only routing keeps a saved claude.ai subscription login active (gateway forwards `anthropic-beta` OAuth capability — effortd passes headers verbatim) → subscription users in scope; README/DESIGN updated |
| U8 → R8 | VERIFIED with exact payloads: `message_start` usage (input + cache fields), `message_delta` usage **cumulative** (doc's own warning), final delta may carry full usage |

### 2.3 Binding design conclusions (2026-08-18 analysis — the "why" record)

1. **Adaptive thinking absorbs most naive savings**: current models already modulate per-message reasoning inside the chosen effort ceiling. The realizable delta of external *downgrade* routing is thin.
2. **Difficulty is illegible pre-execution**: message text does not predict agentic workload ("why is this test failing" = 30 seconds or 3 hours). Pre-flight classification of workload is a prediction problem with a bad error profile.
3. **Asymmetric misclassification costs**: over-effort wastes bounded tokens; under-effort silently degrades output quality — undetectable per-message, corrosive to trust. Therefore: escalation is safe to automate, downgrading is not.
4. **Cache economics punish mid-session flips** (V6): one invalidated 100K-token prefix at full input rates outweighs many messages of saved thinking tokens.

**Derived defaults (non-negotiable without E7 receipts)**: `mode: observe` default → `suggest` is loud but inert → `enforce` is sticky + escalate-only. Heuristics run in-process (zero latency); no LLM call ever sits in the request hot path.

### 2.4 Prior art / positioning (refresh honestly at E8.1)

LiteLLM (generic proxy: keys, fallbacks, budgets — no effort-policy layer) · RouteLLM (OSS model routing, chat-shaped, pre-reasoning-era) · OpenRouter/NotDiamond/Martian (hosted, model-level). **effortd's wedge**: reasoning-*effort* normalization + agent-aware safe policy + receipts. **Named risk**: LiteLLM adds this as a feature — mitigation is focus plus shipping the policy core as embeddable middleware (§8), not proxy-or-nothing.

---

## E0 — Foundations: substrate + verification gate + claims resolution

*Gate: `npm run verify` exists and is green in CI-shape; README + PROVIDERS.md exist; every §2.2 UNVERIFIED row is VERIFIED, corrected, or descoped with rationale.*

### [x] E0.1 Project scaffold + regression gate
- **Objective**: a strict-TS, tested, CI-ready skeleton where `npm run verify` is the single gate every later step holds green.
- **Depends on**: nothing.
- Tasks: `package.json` (`"name": "effortd"`, `type: module`, `engines.node >= 20`, `bin`, scripts: `build` (tsc), `dev` (tsx), `test` (vitest run), `verify` (typecheck + test)); `tsconfig.json` (strict, NodeNext); vitest config; `LICENSE` (MIT, Vivek Vinodh, 2026); `.gitignore`; `.github/workflows/ci.yml` (node 20 + 22 matrix → `npm run verify`); `src/index.ts` CLI stub (`start|init|report|help`) with one smoke test.
- **Definition of Done**:
  - [ ] `npm run verify` exits 0; deliberately breaking a type then a test each fails it (evidence: both failure outputs in Progress Log).
  - [ ] Runtime dep list is exactly `["yaml"]` (rule: dependency austerity).
- **Verify**: `npm run verify`; `npm pack --dry-run` lists only intended files.

### [x] E0.2 Docs substrate: README skeleton + PROVIDERS.md + design record
- **Objective**: the repo explains itself from commit ~2, and the docs-ride-along rule has somewhere to land.
- **Depends on**: E0.1.
- Tasks: `README.md` — positioning (from §2.3/§2.4, honest), the mode ladder, **"status: pre-release, quickstarts land only with recorded evidence"** banner; `docs/PROVIDERS.md` seeded with the §2.2 register verbatim (VERIFIED + UNVERIFIED tables, to be updated by E0.3); `docs/DESIGN.md` capturing §2.3 + the prime invariant so the "why" survives outside this plan.
- **Definition of Done**:
  - [ ] All three docs exist; README makes zero executable claims (no untested quickstart — rule 8).
- **Verify**: read-through against §2; `npm run verify` untouched-green.

### [x] E0.3 Provider claims verification spike (U1–U8)
- **Objective**: convert every UNVERIFIED row to a dated, cited fact — or a documented correction — before any mapper code exists. This is the plan's verify-before-fix discipline applied to training-data memory.
- **Depends on**: E0.2 (PROVIDERS.md exists to receive results).
- Tasks: for U1–U6: fetch current official docs (OpenAI API ref, Gemini API ref, Codex CLI config docs, Gemini CLI docs), record exact field names/values/model gates with URL + date in `docs/PROVIDERS.md`; for U7: check Claude Code gateway docs for the auth-mode statement; for U8: defer final confirmation to the E4.1 live fixture but capture the documented shape now. Where a claim is wrong, write what IS true; where a surface doesn't exist (e.g. no Gemini CLI base-URL override), mark the integration **descoped** and adjust E6.3's approach (documented alternative or removal) — do not force it.
- **Definition of Done**:
  - [ ] §2.2's UNVERIFIED table updated in this plan: every row → VERIFIED (with correction noted if the prior was wrong) or DESCOPED.
  - [ ] `docs/PROVIDERS.md` is the citable single source for every param shape the code will use.
- **Verify**: grep the plan for `UNVERIFIED` → only historical mentions remain.

---

## E1 — Transparent passthrough proxy (do no harm)

*Gate: an agent pointed at effortd in observe mode is provably unaffected: byte-identical requests, unbuffered streams, verbatim errors, clean disconnects — proven by tests and one live call.*

### [x] E1.1 HTTP core: mounts, forwarding, streaming passthrough
- **Objective**: `/anthropic/*`, `/openai/*`, `/gemini/*` mounts forwarding to their upstreams with sanitized hop-by-hop headers, buffered *request* bodies (bounded), and **unbuffered** response streaming.
- **Depends on**: E0.1.
- Tasks: native `http` server; mount → upstream map; header handling (strip `host`/`connection`, recompute `content-length`, force `accept-encoding: identity` upstream so later tee-parsing sees plaintext); request-body cap (64 MB → 413); response piped chunk-for-chunk; `/` help+health page. TDD against an in-process fake upstream: echo tests (method/path/query/headers/body fidelity), SSE fixture streamed in N chunks arrives in ≥N writes (buffering tripwire), binary body round-trip.
- **Definition of Done**:
  - [ ] Byte-fidelity test: forwarded request body hash === sent hash; response bytes === fixture bytes.
  - [ ] Streaming tripwire test proves chunk-timing preservation (fails if anyone later adds buffering).
- **Verify**: `npm run verify`.

### [x] E1.2 Failure semantics: fail-open, verbatim errors, disconnect propagation
- **Objective**: the prime invariant becomes tested behavior, not aspiration.
- **Depends on**: E1.1.
- Tasks: upstream 4xx/5xx bodies+status pass through verbatim; upstream connect failure → 502 with an effortd-identifying JSON body (the one place effortd speaks for itself); unparseable JSON on an inference path → forward raw untouched (fail-open test); client abort → upstream request aborted (`AbortController` wired; test with a slow fake upstream); internal handler throw → forward untouched + local error log (inject a poisoned policy hook in the test).
- **Definition of Done**:
  - [ ] Fail-open test: a throwing internal stage still yields the upstream's exact response.
  - [ ] Abort test: upstream sees cancellation ≤ 1s after client disconnect.
- **Verify**: `npm run verify`.

### [x] E1.3 Live smoke through the proxy
- **Objective**: reality check before building on top — one real Anthropic call (cheapest current model, trivial prompt) via `curl` through `effortd start`, and one streamed.
- **Depends on**: E1.2. **Cost**: ~$0.01 — record actual.
- **Definition of Done**:
  - [ ] Both transcripts (non-stream + SSE) pasted in Progress Log; streamed tokens observed arriving incrementally through the proxy.
- **Verify**: manual run evidence (rule 3).

---

## E2 — Effort normalization layer

*Gate: one internal scale round-trips to every provider's dial, capability-guarded per model, with table-driven tests for every §2.2 fact.*

### [ ] E2.1 Internal scale + Anthropic mapper
- **Objective**: `Effort = low|medium|high|xhigh|max` with rank/clamp/compare utilities; Anthropic read+write mapper enforcing V2/V3.
- **Depends on**: E0.3.
- Tasks: `src/effort.ts` (scale, ranks, `clamp(floor, ceiling)`); `src/providers/anthropic.ts`: inference-path matcher (`/v1/messages` exactly — **not** `/batches`, **not** `/count_tokens`), `getEffort` (`output_config.effort`), `setEffort` with per-model capability table from V2 (xhigh→high on the 4.6 pair; opus-4.5 caps at high; matcher tolerant of Bedrock-style prefixed IDs), `supportsEffort` allowlist gate (never inject outside it — §1). Table-driven tests mirroring V2 row-for-row + path-matcher negative cases.
- **DoD**: [ ] Every V2 row is a test case; injection against `claude-haiku-4-5` is proven impossible. 
- **Verify**: `npm run verify`.

### [ ] E2.2 OpenAI mapper (per E0.3-verified shapes)
- **Objective**: chat-completions + Responses read/write mapping (`xhigh|max → high`), model-gated (o-series/gpt-5-family per E0.3), path matchers for both endpoints.
- **Depends on**: E0.3, E2.1. 
- **DoD**: [ ] Table tests cite PROVIDERS.md rows; non-reasoning models (e.g. gpt-4.1) proven un-injected.
- **Verify**: `npm run verify`.

### [ ] E2.3 Gemini mapper (per E0.3-verified shapes)
- **Objective**: level ↔ thinking-budget numeric mapping (per-model ranges from E0.3), `:generateContent`/`:streamGenerateContent` matchers (model parsed from path), nearest-level reverse mapping for policy decisions on numeric budgets.
- **Depends on**: E0.3, E2.1.
- **DoD**: [ ] Round-trip property test: `toBudget(fromBudget(b))` never exits the model's valid range; non-thinking models un-injected.
- **Verify**: `npm run verify`.

---

## E3 — Policy engine (the mode ladder)

*Gate: observe never mutates (byte-proven), enforce mutates exactly per documented semantics (sticky, escalate-only, floor/ceiling), every decision carries a reason, all under fail-open.*

### [ ] E3.1 Config: `effortd.yaml` loading + `effortd init`
- **Objective**: policy-as-code file with strict validation and safe defaults; unknown keys warn loudly (typo'd `celing:` must not silently no-op).
- **Depends on**: E0.1.
- Tasks: schema — `mode` (observe default), `default`, `floor`, `ceiling`, `session_sticky` (true), `escalate_only` (true), `inject` (false), `suggest.enabled` (true), `pricing` overrides, `port` (4141); search order `./effortd.yaml` → `~/.effortd/config.yaml` → defaults; `effortd init` writes a commented example (the example file doubles as config reference docs — every key + tradeoff commented).
- **DoD**: [ ] Invalid values rejected with actionable errors; unknown-key warning tested; zero-config boot works.
- **Verify**: `npm run verify`.

### [ ] E3.2 Pure decision core
- **Objective**: `decide(input) → {applied?, action, reason}` as a pure, exhaustively-tested function — the project's money logic, isolated from I/O.
- **Depends on**: E3.1, E2.1.
- Tasks: inputs `{mode, config, model, supportsEffort, requestedEffort?, sessionEffort?, suggestion?}`; semantics: observe → never `applied`, but full would-have decision recorded; clamp to floor/ceiling; sticky: session's established effort wins except a *higher* candidate when `escalate_only` (which updates the session); `inject: false` → absent effort stays absent; every path emits machine-readable `reason` (mirroring automode's surfaced denial reasons — V-series design echo).
- **DoD**: [ ] Decision-table test covering the full mode × sticky × escalate × inject × support matrix (enumerated, not sampled); failing-first evidence for the sticky/escalate cases.
- **Verify**: `npm run verify`.

### [ ] E3.3 Session fingerprinting + store
- **Objective**: stable conversation identity so stickiness works across turns without storing content.
- **Depends on**: E2.1 (provider body shapes).
- Tasks: per-provider fingerprint = sha256 (truncated) over stable prefix material (Anthropic: system head + first user message head; OpenAI/Gemini equivalents per E0.3 shapes); in-memory store with TTL + size cap; **collision honesty**: document that fingerprints are best-effort (a re-asked identical first message = same session — acceptable for stickiness semantics, stated in DESIGN.md).
- **DoD**: [ ] Fixture-based tests: multi-turn growth of the same conversation → constant fingerprint; different conversations → distinct; content never retained (store holds hash → effort/counters only, asserted).
- **Verify**: `npm run verify`.

### [ ] E3.4 Wire policy into the proxy
- **Objective**: the pipeline — parse (inference paths only) → fingerprint → decide → (enforce: mutate via E2 mapper) → forward — under the fail-open guarantee.
- **Depends on**: E1.2, E2.1, E3.2, E3.3.
- Tasks: integrate; observe-mode **byte-identity regression test** (same harness as E1.1 — this is where transparency is easiest to lose); enforce-mode tests (clamp applied; injection only when configured AND allowlisted; non-inference paths untouched); poisoned-decide fail-open test at this layer.
- **DoD**: [ ] Observe byte-identity holds post-integration. [ ] Enforce-mode Anthropic request shows exactly one changed field. [ ] E2.2/E2.3 providers wired behind the same tests.
- **Verify**: `npm run verify`; repeat E1.3 live smoke in enforce mode with a floor, actual effort change visible in the response's billed behavior or echoed request (evidence pasted).

---

## E4 — Telemetry + report (the payoff users feel first)

*Gate: every proxied inference request yields one honest JSONL record; `effortd report` turns a week of logs into per-session/model/effort spend truth, with coverage gaps stated.*

### [ ] E4.1 Usage extraction (tee, never block)
- **Objective**: token usage from streaming and non-streaming responses on all three providers, parsed off a tee that cannot affect the client stream.
- **Depends on**: E1.1; U8/U2/U4 resolved (E0.3 + live fixtures).
- Tasks: bounded accumulator (cap ~2 MB — beyond it, record `usage: null`, never stall); Anthropic JSON + SSE (`message_start`/`message_delta`, cache fields included); OpenAI (+ `include_usage` caveat recorded as coverage, never injected by us — mutating `stream_options` would violate observe transparency); Gemini `usageMetadata`. Capture one live scrubbed fixture per provider format we can access; recorded fixtures drive the tests.
- **DoD**: [ ] Fixture tests per provider/stream-mode; tee-failure test (corrupt SSE mid-stream → client unaffected, `usage: null` logged). [ ] U8 confirmed against the live fixture; PROVIDERS.md updated.
- **Verify**: `npm run verify`.

### [ ] E4.2 JSONL sink + pricing estimates
- **Objective**: append-only `~/.effortd/requests.jsonl` (metadata-only per §1) + config-overridable dated price table → per-request cost estimate (cache read/write rates included for Anthropic).
- **Depends on**: E4.1, E3.4 (decision records land in the same row).
- **DoD**: [ ] Privacy test: serialized record proven free of body/header content by construction (type-level + runtime assert). [ ] Cost math unit-tested against hand-computed rows; unknown model → `cost: null` + "unpriced" flag (never $0 — that would be a lie).
- **Verify**: `npm run verify`.

### [ ] E4.3 `effortd report`
- **Objective**: aggregate JSONL → terminal report: totals + by day/model/effort/session; suggest-mode what-if counts; **coverage line** ("N of M requests had usage data") so absence of data is never displayed as absence of spend.
- **Depends on**: E4.2.
- **DoD**: [ ] Fixture-log report matches hand-computed numbers exactly; empty/missing log states handled with guidance, not stack traces.
- **Verify**: `npm run verify` + a real report over E1.3/E3.4 live-smoke telemetry (output pasted).

---

## E5 — Suggest mode + heuristics (advice before authority)

*Gate: effortd forms opinions loudly and inertly; the only automated enforcement addition is the receipt-free-safe one: escalation.*

### [ ] E5.1 Heuristic signals + suggest mode
- **Objective**: zero-latency, in-process signals at session start (trivial-verb list, hard-signal list, length, code-fence density) → logged suggestion + would-have-saved accounting in `report`. No LLM call (§10 trap).
- **Depends on**: E3.4, E4.3.
- **DoD**: [ ] Signals table-tested; suggestions appear in report as counts + what-if, never as applied effort; `suggest.enabled: false` silences it.
- **Verify**: `npm run verify`.

### [ ] E5.2 Escalation ratchet (the one safe automation)
- **Objective**: opt-in `enforce` + `escalate_on_suggestion: true` — a hard-signal session start may *raise* effort toward `ceiling` (never lower, never mid-session flip-flop; §2.3-consistent by construction).
- **Depends on**: E5.1, E3.2.
- **DoD**: [ ] One-way property test: across arbitrary suggestion sequences, applied effort is monotonically non-decreasing within a session. [ ] Off by default, stated tradeoffs in the config example.
- **Verify**: `npm run verify`.

---

## E6 — Agent integrations: proven, not claimed

*Gate: each README quickstart was executed for real; telemetry from a genuine agent session exists; limitations are written down where users will read them.*

### [ ] E6.1 Claude Code end-to-end
- **Objective**: real Claude Code session through effortd (`ANTHROPIC_BASE_URL=http://localhost:4141/anthropic`, API-key auth): observe telemetry, then a floor-clamp enforce run.
- **Depends on**: E3.4, E4.3. **Cost**: record actual.
- Tasks: run both modes; confirm subagent + main-loop calls all land in telemetry; write the README quickstart *from the transcript*; document U7's resolution (subscription-auth limitation) in README candidly.
- **DoD**: [ ] Session telemetry + report output pasted; quickstart == what was actually typed. [ ] Cache behavior sanity: repeat-turn requests show cache reads in telemetry (proves we didn't break caching).
- **Verify**: live evidence (rule 3).

### [ ] E6.2 Codex CLI end-to-end
- **Objective**: same bar via the E0.3-verified provider config; quickstart from transcript.
- **Depends on**: E2.2, E3.4; E0.3 (U5). **DoD**: [ ] Evidence + quickstart; if U5 resolved DESCOPED, this step converts to a documented limitation + issue link instead — honestly, not silently.
- **Verify**: live evidence.

### [ ] E6.3 Gemini CLI end-to-end
- **Objective/DoD**: as E6.2 for U6/U3 — evidence-backed quickstart or honest descope.
- **Depends on**: E2.3, E3.4; E0.3 (U6).

---

## E7 — Receipts: the eval harness

*Gate: every enforcement default stronger than observe/suggest cites measured numbers; the published curves state n, variance, and total cost.*

### [ ] E7.1 Harness + task set
- **Objective**: `eval/` runner: K small self-checkable coding tasks (deterministic pass/fail), matrix {effort levels × N trials} on one Anthropic model through effortd (telemetry doubles as the cost meter — dogfooding E4).
- **Depends on**: E6.1.
- **DoD**: [ ] Dry-run mode proves the matrix + budget math without spend; projected budget written down.
- **Verify**: `npm run verify` + dry-run output.

### [ ] E7.2 Run + publish `docs/RECEIPTS.md`
- **Objective**: execute (founder-approved budget — rule 10), publish cost-vs-success per effort level with honest caveats (n, variance, task class, date, model).
- **Depends on**: E7.1.
- **DoD**: [ ] RECEIPTS.md live; defaults re-examined against it in the Progress Log (change or explicitly reaffirm). [ ] Actual spend recorded vs projection.
- **Verify**: numbers reproducible from the committed raw results (scrubbed).

---

## E8 — OSS launch gate

### [ ] E8.1 Launch readiness
- **Objective**: a stranger-proof repo: README complete (positioning, mode ladder, quickstarts-with-evidence, limitations, privacy/telemetry statement, §2.4 refreshed honestly), CONTRIBUTING.md, SECURITY.md (it's a proxy — disclosure contact), final name decision, `npm pack --dry-run` audit, **history hygiene**: full-history scan proves no keys/tokens/fixture-content ever committed.
- **Depends on**: E0–E7 complete (E6/E7 descopes documented count as complete).
- **DoD**: [ ] History scan output clean (pasted). [ ] README executable-claims audit: every command shown was run.
- **Verify**: fresh-clone `npm install && npm run verify && npm run build` on a clean checkout.

### [ ] E8.2 Publish
- **Objective**: GitHub public + `npm publish` + `v0.1.0` tag; CI green on the real remote.
- **Depends on**: E8.1.
- **DoD**: [ ] `npm i -g effortd && effortd start` works from the registry on a machine that never saw the repo (evidence). [ ] Post-publish: §8 backlog triaged into issues.
- **Verify**: the fresh-install run.

---

## 8. Backlog — leads, not commitments (verify value before scheduling)

*None of these gate v1. Each needs its own value-verification before promotion to a milestone.*

- **LiteLLM middleware distribution** of the policy core (mitigates the §2.4 named risk; needs LiteLLM plugin-API research).
- **Launcher mode** (`effortd run -- claude ...`): classify per *task*, set env/flags, no proxy in path — the founder-rejected-for-v1 shape, still a good second mode.
- **MCP delegation server** (`delegate(task, quality)`): per-subtask cheap-model routing for agents with weak subagent stories.
- **LLM-assisted classification** — only if E7 receipts show heuristics leave real money on the table, and only ever off the hot path (§10).
- **Bedrock/Vertex/Foundry upstreams** (V7 says effort works there; enterprise audience).
- **Hard budget caps** (429 the agent past a daily $ limit — needs UX thought: a hard-stopped agent mid-task is its own failure mode).
- **Daemonization + `effortd doctor`**; **OTel export** (Claude Code emits effort attributes natively — correlation opportunity); **persistent session store**; **Windows support**; **Homebrew formula**; **subagent-call detection heuristics** (route subagent traffic lower automatically — attractive, fragile, needs evidence).

## 9. Traceability matrix — requirement → step

| # | Requirement (from the founding analysis) | Step(s) |
|---|---|---|
| R1 | Works with any agent via a universal surface (base URL) | E1.1, E6.1–E6.3 |
| R2 | Never breaks/slows/degrades the host agent (fail-open, streaming, byte-transparency) | E1.1–E1.3, E3.4 |
| R3 | One reasoning-spend scale across providers, capability-guarded | E2.1–E2.3, E0.3 |
| R4 | Safe policy: observe default; sticky, escalate-only enforce; reasons on every decision | E3.1–E3.4, E5.2 |
| R5 | Truthful spend visibility incl. cache + coverage honesty | E4.1–E4.3 |
| R6 | Advice before authority (suggest mode, what-if accounting) | E5.1 |
| R7 | Receipts: defaults justified by measurement | E7.1–E7.2 |
| R8 | Credible OSS artifact (privacy, security posture, honest README, clean history) | E0.2, E8.1–E8.2 |

## 10. Rejected approaches (traps — reintroducing any fails review)

- **Per-message downgrade routing** — the founding analysis (§2.3) exists because this is the seductive wrong version: cache churn + silent quality degradation. Escalation and task-boundary decisions only.
- **An LLM call in the request hot path** — every message would pay latency to maybe save tokens. Heuristics in-process; LLM assistance (if ever) async and off-path (§8).
- **Buffering responses** to parse usage or "simplify" — streaming UX is the agent's lifeline; tee or don't parse.
- **Persisting prompts, tool payloads, or credentials** in telemetry/fixtures/sessions — metadata only, hashes only, scrubbed fixtures only.
- **Silently mutating anything beyond the effort field** (e.g. injecting `stream_options.include_usage` to improve our own coverage) — transparency outranks telemetry completeness.
- **Injecting effort into models outside the verified matrix** — a 400 from us is "effortd broke my agent" (V3 is the receipt).
- **Guessing provider param shapes from memory** — §2.2 UNVERIFIED rows go through E0.3 or the code doesn't ship. (This plan's own U-table exists because training priors drift.)
- **Gateway feature-creep** (key management, model fallbacks, load balancing, retries) — that's LiteLLM's job; effortd stays the effort-policy layer and integrates instead (§8).
- **TLS interception / system-proxy tricks** to catch agents without base-URL support — explicit opt-in base URLs only; a security tool posture is a different product.
- **Hardcoded price tables presented as truth** — dated snapshot + overrides + "estimate" labels, or no cost display at all.
- **Untested quickstarts / n=1 benchmark claims** — README commands ship with E6 transcripts behind them; RECEIPTS.md states n, variance, and spend.

## 11. Progress log

*(append-only; newest last — `YYYY-MM-DD — EX.Y — commit — result/evidence`)*

- 2026-08-18 — Plan created. Source: same-session research (Claude Code v2.1.235 changelog/docs/bundle via research agent; current Anthropic API reference; router-economics analysis; npm E404 checks). Founder decisions on record: policy-gateway shape chosen over launcher/MCP (those → §8); comprehensive plan requested before any scaffolding (an in-flight scaffold attempt was intentionally halted — repo contains only `git init` + this plan). 24 steps across E0–E8; 8 UNVERIFIED provider claims gating E2/E4/E6 via the E0.3 spike. **Plan approved by founder 2026-08-18 — execution started.**
- 2026-08-18 — E0.2 — `dfd6ec8` — README (positioning, mode ladder, invariants, pre-release banner; zero executable claims by audit — it contains no commands at all), docs/DESIGN.md (four binding conclusions + derived defaults + prime invariant + positioning), docs/PROVIDERS.md (V1–V8 + U1–U8 register seeded verbatim). `verify-exit=0` untouched-green.
- 2026-08-18 — E0.3 — `a5c5980` — all 8 claims resolved against live sources (fetch transcripts in-session). **Three corrections caught**: (1) Gemini thinking is now `thinkingLevel`-enum-first (`minimal…high`, model-dependent; budget 0/−1 semantics retained) — the numeric-ranges prior was stale; (2) Codex `wire_api = "responses"` is the only wire + `model_reasoning_effort` = `minimal…xhigh`; (3) Claude Code gateway docs: base-URL-only routing keeps subscription OAuth active (gateway forwards `anthropic-beta` OAuth capability) — **scope expanded to subscription users**, README/DESIGN corrected in the same commit. Also: OpenAI effort space now `none…max` model-dependent → clamp-only mapper policy; Anthropic SSE payloads pinned verbatim (message_delta usage cumulative per the doc's own warning). Env recon: `OPENAI_API_KEY` present; codex/gemini/claude/gh installed (gh authed); no ANTHROPIC_API_KEY/ant; `npm whoami` ENEEDAUTH → **npm login is a founder action before E8.2**. Pre-registered deviation: E1.3 live smoke will run on the available OpenAI credential (real HTTP+SSE proof); the Anthropic live proof lands at E6.1 via Claude Code OAuth-through-gateway per R7. DoD grep: remaining "UNVERIFIED" mentions are historical/procedural only.
- 2026-08-18 — E1.1 — `7c5bd55` — passthrough core, 10/10 green. Failing-first: `Failed to load url ../src/server.js` before implementation. Tests caught a real bug during the step: the body-cap path destroyed the socket before the 413 could be written (client saw `other side closed`) → fixed with drain-and-discard. `exactOptionalPropertyTypes` forced the conditional `RequestInit.body` shape (recorded as expected friction). Chunk-timing tripwire proves unbuffered SSE (≥3 chunks, ≥60ms spread).
- 2026-08-18 — E1.2 — `efce8fb` — 5 failure-semantics tests, all green. Honesty note: guarantees were co-implemented with E1.1's core, so these are pinning tests, not failing-first (rule-2 "or" clause). Pinned: verbatim 429+`retry-after`+body; 502 `effortd_upstream_unreachable` shape; poisoned rewrite hook → original (deliberately invalid-JSON) body forwarded byte-identical + `onInternalError("rewriteRequestBody")` observed; tap dying mid-stream invisible to client; client abort reaches upstream ≤1s (measured via upstream `close`).
- 2026-08-18 — E1.3 — `b9bd220` — live smoke, two deviations logged. (1) OpenAI: real HTTPS through the gateway — `GET /openai/v1/models` → 200, 118 models, ~0.99s, $0; streamed generation attempt returned upstream `insufficient_quota` verbatim through the proxy (live E1.2 evidence; **the machine's OPENAI_API_KEY has no billing quota — founder item for E6.2/E7.2**). (2) Anthropic streamed proof via the R7 path instead of curl+API key (none available): real Claude Code with subscription OAuth pointed at the gateway — access log shows `HEAD /anthropic/api/hello -> 200` then `POST /anthropic/v1/messages?beta=true -> 200`, agent printed `OK`. Real agent + OAuth + live SSE through effortd, ~$0 (one trivial subscription query). Minimal `start` command (loopback-only, access log) landed as part of making the smoke executable through the real CLI.
- 2026-08-18 — E0.1 — `a7d498b` — scaffold + gate live. **Failing-first evidence**: `test/cli.test.ts` written before `src/` existed → `npm test` failed with `Failed to load url ../src/cli.js … Does the file exist?` (1 file failed); implementation then flipped it to 4/4 green. **Deliberate-break evidence (DoD)**: temp `src/_break.ts` → `error TS2322: Type 'string' is not assignable to type 'number'`; temp `test/_break.test.ts` → `FAIL … AssertionError: expected 1 to be 2` — both halves of `verify` catch, both reverted, `verify-exit=0` re-confirmed. CLI smoke on the compiled `dist/`: `help`→0, stub commands→1 with honest not-implemented message, unknown→2 (first measurement showed `unknown-exit=0` — artifact of reading `$?` after a `| head` pipeline, i.e. head's exit; re-measured unpiped → 2). `npm pack --dry-run`: LICENSE + dist/cli.js + dist/index.js + package.json only. Runtime deps `["yaml"]` exactly. CI workflow authored (node 20/22 matrix, no event-derived inputs); activates at E8.2 first push.
