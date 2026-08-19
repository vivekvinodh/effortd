# effortd

**A reasoning-spend policy gateway for AI coding agents.** Point your agent's provider base URL at effortd: it normalizes each provider's reasoning-effort dial (Anthropic `output_config.effort`, OpenAI `reasoning_effort`, Gemini thinking budgets) into one scale, applies your policy on a strict `observe → suggest → enforce` ladder, and records truthful per-session effort/token/cost telemetry. It works with any agent that can target a custom base URL — Claude Code, Codex CLI, Gemini CLI, and whatever ships next — because the API call is the one integration surface every agent shares.

> **Status: pre-release.** Built in the open against [docs/V1-READINESS-PLAN.md](docs/V1-READINESS-PLAN.md). Every quickstart below was executed for real, with the transcript recorded in the plan's progress log — a standing rule, not a promise.

## Quickstarts (executed 2026-08-19)

Build once: `npm install && npm run build`, then start the gateway (localhost-only, port 4141):

```bash
node dist/index.js start        # becomes `effortd start` once installed from npm
node dist/index.js report --since 24h
```

Zero config = observe mode: byte-identical forwarding plus telemetry. `node dist/index.js init` writes a commented `effortd.yaml` when you want policy.

### Claude Code

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:4141/anthropic claude
```

With only the base URL set, a saved claude.ai subscription login stays active and its limits/billing apply (documented Claude Code gateway semantics — effortd forwards the OAuth capability headers verbatim); API-key users keep their usual env. Verified live: main-loop **and** subagent calls land in telemetry with per-call cache economics, and enforce-mode clamps are accepted by the real API.

### Codex CLI

```toml
# $CODEX_HOME/config.toml (use a dedicated CODEX_HOME to keep your real config untouched)
model_provider = "effortd"

[model_providers.effortd]
name = "effortd gateway"
base_url = "http://127.0.0.1:4141/openai/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
```

Verified live: `codex exec` requests transit effortd (`POST /openai/v1/responses`) and Codex's `model_reasoning_effort` arrives as `reasoning.effort`, visible to policy and telemetry. (Full-generation verification on this machine was blocked only by an unfunded OpenAI key.)

### Gemini CLI

```bash
GEMINI_DEFAULT_AUTH_TYPE=gemini-api-key GEMINI_API_KEY=... \
GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:4141/gemini gemini
```

API-key auth mode routes through effortd (verified live to the upstream's own response); the CLI's individual Google-login path does not use the Gemini API base URL and is deprecated upstream.

## Why this shape

effortd is deliberately **not** a per-message "auto effort" classifier that downgrades your requests to save tokens. The design analysis behind the project ([docs/DESIGN.md](docs/DESIGN.md)) concluded that naive downgrade routing is negative-value for interactive agents:

1. Modern models already modulate reasoning per message (*adaptive thinking*) inside whatever effort ceiling you set — the cheap savings are already taken.
2. Task difficulty is not legible from a prompt before execution; "why does this test fail" is five words and anywhere from thirty seconds to three hours.
3. Misclassification costs are asymmetric: over-effort wastes bounded tokens, under-effort silently degrades answer quality — the expensive, trust-destroying failure.
4. Mid-session parameter flips can invalidate prompt caches, costing more than the thinking they save.

What *is* worth building: one normalized effort scale across providers, policy you can write down (floors, ceilings, session stickiness, escalate-only automation), honest spend telemetry per session, and published measurements before any default gets aggressive. That's effortd.

## The mode ladder

| Mode | Behavior |
|---|---|
| `observe` *(default)* | Byte-identical forwarding. effortd only watches: every inference request yields one telemetry record (model, effort, tokens, estimated cost, session). |
| `suggest` | Observe, plus loudly logged suggestions ("this session's opener looks trivial/hard") and what-if accounting in reports. Never mutates a request. |
| `enforce` | Applies policy: clamp to your floor/ceiling, session-sticky, **escalate-only by default** — a session's effort may rise on hard signals, never silently fall. |

## Invariants

- **Fail-open — never break the agent.** Any internal effortd error forwards the request untouched. The agent must behave identically with a broken effortd in the middle.
- **Streaming is sacred.** SSE passes through unbuffered; usage parsing tees the stream and can die without the client noticing.
- **Telemetry is metadata-only.** Token counts, effort levels, decision reasons, hashed session fingerprints. Never message content, never headers, never keys.
- **BYO credentials.** Auth headers pass through verbatim — including OAuth capability headers — and effortd stores nothing. Per Claude Code's own gateway docs, base-URL routing with a saved claude.ai subscription login keeps that subscription as the active credential, so both subscription and API-key users are in scope (API-key/gateway users are still the ones with per-token cost exposure).
- **No blind injection.** effortd only sets an effort field on models in its verified support matrix ([docs/PROVIDERS.md](docs/PROVIDERS.md)); unknown models pass through untouched.

## License

MIT © 2026 Vivek Vinodh
