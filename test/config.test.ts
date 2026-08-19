import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  exampleConfig,
  parseConfig,
} from "../src/config.js";

describe("E3.1 config", () => {
  it("returns safe defaults for an empty document", () => {
    const { config, warnings } = parseConfig("");
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.mode).toBe("observe");
    expect(config.inject).toBe(false);
    expect(config.sessionSticky).toBe(true);
    expect(config.escalateOnly).toBe(true);
    expect(config.port).toBe(4141);
    expect(warnings).toEqual([]);
  });

  it("parses a full document", () => {
    const { config, warnings } = parseConfig(
      [
        "mode: enforce",
        "default: high",
        "floor: medium",
        "ceiling: xhigh",
        "session_sticky: false",
        "escalate_only: false",
        "inject: true",
        "port: 5151",
        "suggest:",
        "  enabled: false",
        "  escalate_on_suggestion: true",
        "pricing:",
        "  claude-opus-5: { input: 5, output: 25 }",
      ].join("\n"),
    );
    expect(warnings).toEqual([]);
    expect(config.mode).toBe("enforce");
    expect(config.defaultEffort).toBe("high");
    expect(config.floor).toBe("medium");
    expect(config.ceiling).toBe("xhigh");
    expect(config.sessionSticky).toBe(false);
    expect(config.escalateOnly).toBe(false);
    expect(config.inject).toBe(true);
    expect(config.port).toBe(5151);
    expect(config.suggest.enabled).toBe(false);
    expect(config.suggest.escalateOnSuggestion).toBe(true);
    expect(config.pricing["claude-opus-5"]).toEqual({ input: 5, output: 25 });
  });

  it("warns loudly on unknown keys (the typo'd ceiling must not silently no-op)", () => {
    const { warnings } = parseConfig("celing: high\nsuggest:\n  enabeld: true");
    expect(warnings.join(" ")).toContain("celing");
    expect(warnings.join(" ")).toContain("enabeld");
  });

  it("rejects invalid values with actionable errors", () => {
    expect(() => parseConfig("mode: aggressive")).toThrow(/mode.*aggressive/);
    expect(() => parseConfig("floor: ultra")).toThrow(/floor/);
    expect(() => parseConfig("port: 99999999")).toThrow(/port/);
    expect(() => parseConfig("floor: xhigh\nceiling: low")).toThrow(
      /floor.*ceiling|ceiling.*floor/,
    );
  });

  it("the init example is valid, warning-free, and encodes the defaults", () => {
    const { config, warnings } = parseConfig(exampleConfig());
    expect(warnings).toEqual([]);
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});
