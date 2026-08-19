import { describe, expect, it } from "vitest";
import { SessionStore, fingerprintFor } from "../src/session.js";

const anthropicTurn1 = {
  model: "claude-opus-5",
  system: "You are a helpful coding agent.",
  messages: [{ role: "user", content: "Fix the login bug in auth.ts" }],
};

const anthropicTurn2 = {
  ...anthropicTurn1,
  messages: [
    ...anthropicTurn1.messages,
    { role: "assistant", content: "Looking at auth.ts now." },
    { role: "user", content: "Also add a test for it" },
  ],
};

describe("E3.3 session fingerprinting", () => {
  it("stays constant as the same conversation grows", () => {
    const first = fingerprintFor("anthropic", anthropicTurn1);
    const second = fingerprintFor("anthropic", anthropicTurn2);
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("distinguishes different conversations", () => {
    const other = fingerprintFor("anthropic", {
      ...anthropicTurn1,
      messages: [{ role: "user", content: "Write a README" }],
    });
    expect(other).not.toBe(fingerprintFor("anthropic", anthropicTurn1));
  });

  it("handles block-style content and system arrays", () => {
    const blocks = {
      system: [{ type: "text", text: "You are a helpful coding agent." }],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Fix the login bug in auth.ts" }],
        },
      ],
    };
    expect(fingerprintFor("anthropic", blocks)).toBe(
      fingerprintFor("anthropic", anthropicTurn1),
    );
  });

  it("fingerprints openai chat and responses shapes", () => {
    const chat = fingerprintFor("openai", {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
      ],
    });
    const grown = fingerprintFor("openai", {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "more" },
      ],
    });
    expect(chat).toBeDefined();
    expect(grown).toBe(chat);

    const responses = fingerprintFor("openai", {
      instructions: "sys",
      input: "hello",
    });
    expect(responses).toBeDefined();
  });

  it("fingerprints gemini contents", () => {
    const first = fingerprintFor("gemini", {
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    });
    const grown = fingerprintFor("gemini", {
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [
        { role: "user", parts: [{ text: "hello" }] },
        { role: "model", parts: [{ text: "hi" }] },
        { role: "user", parts: [{ text: "more" }] },
      ],
    });
    expect(first).toBeDefined();
    expect(grown).toBe(first);
  });

  it("returns undefined when there is nothing stable to anchor on", () => {
    expect(fingerprintFor("anthropic", {})).toBeUndefined();
    expect(fingerprintFor("anthropic", "not an object")).toBeUndefined();
  });
});

describe("E3.3 session store", () => {
  it("stores only hashes and counters — never content", () => {
    const store = new SessionStore();
    const fingerprint = fingerprintFor("anthropic", anthropicTurn1)!;
    store.record(fingerprint, "high");

    const state = store.get(fingerprint)!;
    expect(state.effort).toBe("high");
    expect(state.requests).toBe(1);
    const serialized = JSON.stringify([...store.entries()]);
    expect(serialized).not.toContain("login bug");
    expect(serialized).not.toContain("helpful coding agent");
  });

  it("expires entries past the TTL and caps the entry count", () => {
    let now = 1_000_000;
    const store = new SessionStore({
      ttlMs: 1000,
      maxEntries: 2,
      now: () => now,
    });
    store.record("aaa", "low");
    now += 1500;
    expect(store.get("aaa")).toBeUndefined(); // expired

    store.record("bbb", "low");
    store.record("ccc", "medium");
    store.record("ddd", "high"); // over cap → oldest evicted
    expect(store.get("bbb")).toBeUndefined();
    expect(store.get("ddd")?.effort).toBe("high");
  });
});
