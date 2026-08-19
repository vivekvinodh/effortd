# Provider & Agent Claims Register

**This file is the citable single source for every provider/agent fact effortd's code depends on.** Rule (plan §0.11): code may only depend on VERIFIED rows. UNVERIFIED rows are training-data priors awaiting the E0.3 spike — each must gain a dated citation to live official documentation (or a correction, or a DESCOPED verdict) before its dependent step ships.

Seeded 2026-08-18 from the V1 plan §2.2. E0.3 updates this file in place.

## VERIFIED

| # | Fact | Source | Verified |
|---|---|---|---|
| V1 | Anthropic effort lives at `output_config.effort`, values `low\|medium\|high\|xhigh\|max`, GA (no beta header), default `high` | Anthropic API reference | 2026-08-18 |
| V2 | Model support: Fable 5 / Opus 5 / Opus 4.8 / Opus 4.7 / Sonnet 5 → all five levels; Opus 4.6 & Sonnet 4.6 → no `xhigh` (map → `high`); Opus 4.5 → `low\|medium\|high` only; Sonnet 4.5 / Haiku 4.5 / older → error | Anthropic API reference | 2026-08-18 |
| V3 | Sending effort to an unsupported model → 400 `This model does not support the effort parameter` | Claude Code changelog 2.1.70, 2.1.154 (bugfixes for exactly this) | 2026-08-18 |
| V4 | Claude Code honors `ANTHROPIC_BASE_URL` for gateway routing (API-key auth path); native effort surfaces: `/effort`, `--effort`, `CLAUDE_CODE_EFFORT_LEVEL` (2.1.132), `effortLevel` settings key (2.1.203), skill/agent `effort:` frontmatter (2.1.80) | Claude Code changelog + docs + bundle strings (v2.1.235) | 2026-08-18 |
| V5 | No auto/dynamic effort selection exists in Claude Code v2.1.235 (bundle grep: no `autoEffort`/`dynamicEffort`/effort-classifier strings) | research-agent report | 2026-08-18 |
| V6 | Claude Code warns about prompt-cache misses when effort changes mid-conversation | changelog 2.1.129 | 2026-08-18 |
| V7 | Anthropic effort is usable via Bedrock / Vertex / Foundry model IDs (Claude Code runs effort there) | changelog 2.1.122, 2.1.158 | 2026-08-18 |
| V8 | npm names `effortd`, `reasongate`, `effort-gate`, `spendgate` unclaimed | `npm view` E404 | 2026-08-18 |

## UNVERIFIED — training-data priors (resolve in E0.3)

| # | Claim (as remembered — may be wrong) | Blocks |
|---|---|---|
| U1 | OpenAI chat completions: `reasoning_effort` top-level; Responses API: `reasoning: {effort}`; values include `minimal\|low\|medium\|high`; reasoning-capable models only (o-series / gpt-5 family) | E2.2 |
| U2 | OpenAI streamed usage requires `stream_options: {include_usage: true}` on chat completions; absent otherwise | E4.1 |
| U3 | Gemini: `generationConfig.thinkingConfig.thinkingBudget` (numeric; 2.5-flash 0–24576, 2.5-pro 128–32768, `-1` dynamic); newer models may use a level-style control (`thinkingLevel`) | E2.3 |
| U4 | Gemini usage arrives as `usageMetadata` on (final) stream chunks | E4.1 |
| U5 | Codex CLI: custom provider via config.toml `model_providers.*.base_url`; effort via `model_reasoning_effort` | E6.2 |
| U6 | Gemini CLI: base-URL override via `GOOGLE_GEMINI_BASE_URL` env var | E6.3 |
| U7 | Claude Code subscription (OAuth) traffic cannot target a third-party base URL (API-key/gateway only) — an assumption to confirm in gateway docs | E6.1 README wording |
| U8 | Anthropic SSE usage shape: `message_start` carries `usage.input_tokens` (+ cache fields); `message_delta` carries cumulative `usage.output_tokens` | E4.1 |
