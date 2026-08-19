# Security Policy

effortd is a local proxy that sits between coding agents and model providers, which makes its security posture worth stating plainly:

- **Loopback-only**: the gateway binds `127.0.0.1` and has no remote-exposure option. Putting it on a network is deliberately unsupported.
- **No credential handling**: auth headers pass through verbatim; effortd never stores, logs, or requires API keys. Query strings (which can carry keys) are stripped from every log line and telemetry record.
- **Telemetry is metadata-only**: token counts, effort levels, decision reasons, hashed session fingerprints. Never message content, never headers.
- **Fail-open by design**: internal errors forward traffic untouched rather than interposing behavior.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via **GitHub Security Advisories** on this repository ("Report a vulnerability"). Expect an acknowledgment within a week. Please don't open public issues for security reports.
