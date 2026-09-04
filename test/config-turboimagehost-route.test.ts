import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleConfigRoutes } from "../src/config/routes.js";
import { resolverRegistry } from "../src/core/images/registry.js";

function makeCtx() {
  const req = { on() {}, headers: {} };
  let captured: { status?: number; body?: string } = {};
  const res = {
    writeHead(status: number) {
      captured.status = status;
    },
    end(body?: string) {
      captured.body = body;
    },
  };
  return {
    ctx: {
      req,
      res,
      url: new URL("http://localhost/api/config/turboimagehost/verification-data"),
      method: "DELETE",
      app: {},
    },
    captured,
  };
}

describe("DELETE /api/config/turboimagehost/verification-data", () => {
  it("clears only the TurboImageHost verification profile", async () => {
    const original = resolverRegistry.clearTurboImageHostVerificationData;
    let clearCalls = 0;
    resolverRegistry.clearTurboImageHostVerificationData = async () => {
      clearCalls += 1;
    };

    try {
      const { ctx, captured } = makeCtx();
      const handled = await handleConfigRoutes(ctx as never);

      assert.equal(handled, true);
      assert.equal(clearCalls, 1);
      assert.equal(captured.status, 200);
      assert.match(captured.body ?? "", /verification data cleared/);
    } finally {
      resolverRegistry.clearTurboImageHostVerificationData = original;
    }
  });
});
