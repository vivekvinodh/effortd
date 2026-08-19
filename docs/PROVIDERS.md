# Provider & Agent Claims Register

**This file is the citable single source for every provider/agent fact effortd's code depends on.** Rule (plan §0.11): code may only depend on VERIFIED rows. The E0.3 spike (2026-08-18) resolved all eight formerly-UNVERIFIED claims below; three required corrections — recorded inline so nobody re-learns the stale version.

## Agent-side facts (verified 2026-08-18)

| # | Fact | Source |
|---|---|---|
| V1 | Anthropic effort lives at `output_config.effort`, values `low\|medium\|high\|xhigh\|max`, GA (no beta header), default `high` | Anthropic API reference |
| V2 | Model support: Fable 5 / Opus 5 / Opus 4.8 / Opus 4.7 / Sonnet 5 → all five levels; Opus 4.6 & Sonnet 4.6 → no `xhigh` (map → `high`); Opus 4.5 → `low\|medium\|high` only; Sonnet 4.5 / Haiku 4.5 / older → **error** | Anthropic API reference |
| V3 | Sending effort to an unsupported model → 400 `This model does not support the effort parameter` | Claude Code changelog 2.1.70, 2.1.154 |
| V4 | Claude Code honors `ANTHROPIC_BASE_URL`; native effort surfaces: `/effort`, `--effort`, `CLAUDE_CODE_EFFORT_LEVEL` (2.1.132), `effortLevel` settings key (2.1.203), skill/agent `effort:` frontmatter (2.1.80) | Claude Code changelog + docs + bundle strings (v2.1.235) |
| V5 | No auto/dynamic effort selection exists in Claude Code v2.1.235 | research-agent report (bundle grep + docs + changelog) |
| V6 | Claude Code warns about prompt-cache misses when effort changes mid-conversation | changelog 2.1.129 |
| V7 | Anthropic effort is usable via Bedrock / Vertex / Foundry model IDs | changelog 2.1.122, 2.1.158 |
| V8 | npm names `effortd`, `reasongate`, `effort-gate`, `spendgate` unclaimed | `npm view` E404 |

## Resolved E0.3 claims (all verified 2026-08-18)

| # | Resolution | Source |
|---|---|---|
| R1 (was U1) | **OpenAI, corrected/expanded**: Responses API `reasoning: {effort}` is the primary surface; the effort value space is now `none\|minimal\|low\|medium\|high\|xhigh\|max` — **"Supported values are model-dependent"** (gpt-5.x era; e.g. gpt-5.5/5.6 default `medium`). Applies to "gpt-5 and o-series models only". Chat Completions carries the same shared `ReasoningEffort` enum as top-level `reasoning_effort` (SDK shared type; treat chat surface as clamp-only conservatively — see mapper policy below). | developers.openai.com/api/docs/guides/reasoning; openai-python `src/openai/types/shared_params/reasoning.py` |
| R2 (was U2) | **OpenAI streamed usage**: chat completions include usage only with `stream_options: {"include_usage": true}` — all chunks carry `usage: null` except one final chunk (empty `choices: []`) with totals; an interrupted stream may never deliver it. Coverage limitation accepted (effortd never injects `stream_options` — transparency outranks telemetry). | developers.openai.com API reference; OpenAI announcement thread |
| R3 (was U3) | **Gemini, corrected**: current thinking control is `generationConfig.thinkingConfig` with **`thinkingLevel`** enum (`minimal\|low\|medium\|high`, model-dependent) as the primary surface and **`thinkingBudget`** number (`0` = DISABLED, `-1` = AUTOMATIC, ranges model-dependent) still accepted. Guide matrix: gemini-3.7-flash `low\|medium\|high` (default medium); 3.6-flash `minimal..high`; 3.5-flash-lite `minimal..high` (default minimal); 2.5-pro/flash `low\|medium\|high`; 2.5-flash-lite thinking off by default. | ai.google.dev/gemini-api/docs/thinking; js-genai `ThinkingConfig` typedoc |
| R4 (was U4) | **Gemini usage**: `usageMetadata` with `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `cachedContentTokenCount`, `totalTokenCount` (+ per-modality detail arrays); streaming responses are "a stream of GenerateContentResponse instances" — per-chunk `usageMetadata` presence/cumulativeness to be pinned by the E4.1 live fixture. | ai.google.dev/api/generate-content |
| R5 (was U5) | **Codex CLI, corrected**: custom provider via `[model_providers.<id>]` with `name`, `base_url`, `env_key` (+`env_key_instructions`); **`wire_api = "responses"` is the only supported wire** (chat wire not offered — effortd's Codex path is the Responses endpoint). Effort via `model_reasoning_effort = "minimal"\|"low"\|"medium"\|"high"\|"xhigh"` (+ `plan_mode_reasoning_effort`). Selection via top-level `model_provider = "<id>"`; `openai_base_url` config key also exists. | learn.chatgpt.com/docs/config-file/config-sample (Codex docs) |
| R6 (was U6) | **Gemini CLI**: `GOOGLE_GEMINI_BASE_URL` env var (honored by the underlying google/genai SDK; also settable in settings.json) redirects Gemini API traffic — applies to API-key auth mode. | gemini-cli merged PRs #2899/#6380 + issue #6746; google/genai SDK |
| R7 (was U7) | **Claude Code auth through a gateway — corrected, better than assumed**: setting only `ANTHROPIC_BASE_URL` routes requests through the gateway while **a saved claude.ai subscription login remains the active credential** (its limits/billing apply); a gateway credential (`ANTHROPIC_AUTH_TOKEN`/`apiKeyHelper`) *replaces* the subscription. Gateways passing OAuth traffic to Anthropic must forward the OAuth capability in `anthropic-beta` — effortd forwards all headers verbatim, so **both subscription and API-key users are in scope**. | code.claude.com/docs/en/llm-gateway ("Subscriptions and gateways") |
| R8 (was U8) | **Anthropic SSE usage, exact payloads**: `message_start` → `"usage": {"input_tokens": …, "output_tokens": …}` (cache fields included in full examples); `message_delta` → `"usage": {"output_tokens": …}` with the doc's own warning: *"The token counts shown in the `usage` field of the `message_delta` event are **cumulative**"*; the final `message_delta` may carry full usage incl. `input_tokens` + `cache_creation_input_tokens`/`cache_read_input_tokens`. | platform.claude.com/docs/en/build-with-claude/streaming |

## Mapper policy derived from the register

- **Anthropic**: full matrix known (V2) → clamp and (when configured) inject on allowlisted models; `xhigh` downgrades to `high` on the 4.6 pair; ≤4.5-era non-Opus models are never touched.
- **OpenAI**: values are *model-dependent* (R1) with no published per-model matrix → **clamp-only, and clamp targets restricted to the conservative core `low|medium|high`** unless the request already used an extended value; never inject.
- **Gemini**: prefer clamping whichever field the request already uses (`thinkingLevel` ↔ level scale; `thinkingBudget` via level→budget table per R3 ranges); inject only `thinkingLevel` and only on guide-matrix models.
- **Environment recon (2026-08-18, founder machine)**: `OPENAI_API_KEY` present; `codex`, `gemini`, `claude`, `gh` installed (gh authed as vivekvinodh); no `ANTHROPIC_API_KEY`/`ant` CLI; `npm whoami` → ENEEDAUTH (npm login is a founder action before E8.2 publish).
