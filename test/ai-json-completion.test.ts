import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { completeJsonWithRetry } from "../src/ai/providers/json-completion.js";

describe("completeJsonWithRetry", () => {
  it("returns the parsed object on a valid first reply", async () => {
    const result = await completeJsonWithRetry<{ ok: boolean }>(
      () => [{ role: "system", content: "sys" }],
      async () => JSON.stringify({ ok: true }),
    );
    assert.deepEqual(result, { ok: true });
  });

  it("retries once with a corrective message when the first reply isn't valid JSON", async () => {
    const calls: unknown[][] = [];
    const result = await completeJsonWithRetry<{ ok: boolean }>(
      () => [{ role: "system", content: "sys" }],
      async (messages) => {
        calls.push(messages);
        return calls.length === 1 ? "not json" : JSON.stringify({ ok: true });
      },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 2);
    // The retry carries the original messages plus the bad reply plus a correction.
    assert.equal(calls[1]?.length, 3);
  });

  it("throws after a second invalid reply", async () => {
    await assert.rejects(
      completeJsonWithRetry(
        () => [{ role: "system", content: "sys" }],
        async () => "still not json",
      ),
      /not valid JSON/,
    );
  });
});
