import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OllamaClient } from "../src/ai/providers/ollama.js";
import { OpenRouterClient } from "../src/ai/providers/openrouter.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OllamaClient", () => {
  it("posts to {baseUrl}/api/chat with the schema as `format` and parses message.content", async () => {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ ok: true }) } }), { status: 200 });
    }) as typeof fetch;

    const client = new OllamaClient("http://localhost:11434", "qwen2.5:0.5b");
    const schema = { type: "object" };
    const result = await client.completeJson<{ ok: boolean }>({ systemPrompt: "sys", userPrompt: "user", schema });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://localhost:11434/api/chat");
    const body = calls[0]?.body as Record<string, unknown>;
    assert.equal(body.model, "qwen2.5:0.5b");
    assert.equal(body.stream, false);
    assert.deepEqual(body.format, schema);
    assert.deepEqual(body.options, { temperature: 0 });
    assert.deepEqual(body.messages, [
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
  });

  it("base64-encodes images onto the user message when provided", async () => {
    let sentBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 });
    }) as typeof fetch;

    const client = new OllamaClient("http://localhost:11434", "qwen2.5vl:3b");
    await client.completeJson({
      systemPrompt: "sys",
      userPrompt: "user",
      images: [Buffer.from("fake-jpeg-bytes")],
      schema: {},
    });

    const messages = sentBody?.messages as Array<Record<string, unknown>>;
    assert.equal(messages[1]?.images && (messages[1].images as string[])[0], Buffer.from("fake-jpeg-bytes").toString("base64"));
  });

  it("retries once and eventually throws if Ollama never returns valid JSON", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: { content: "not json" } }), { status: 200 })) as typeof fetch;

    const client = new OllamaClient("http://localhost:11434", "qwen2.5:0.5b");
    await assert.rejects(client.completeJson({ systemPrompt: "sys", userPrompt: "user", schema: {} }));
  });
});

describe("OpenRouterClient", () => {
  it("posts to the chat/completions endpoint with a bearer token and json_schema response_format", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = new OpenRouterClient("sk-test-key", "openai/gpt-4o-mini");
    const schema = { type: "object" };
    const result = await client.completeJson<{ ok: boolean }>({ systemPrompt: "sys", userPrompt: "user", schema });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk-test-key");
    const body = JSON.parse(calls[0]?.init.body as string);
    assert.equal(body.response_format.type, "json_schema");
    assert.deepEqual(body.response_format.json_schema.schema, schema);
    assert.equal(body.temperature, 0);
  });

  it("sends images as image_url content parts alongside the text prompt", async () => {
    let sentBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    }) as typeof fetch;

    const client = new OpenRouterClient("sk-test-key", "openai/gpt-4o-mini");
    await client.completeJson({
      systemPrompt: "sys",
      userPrompt: "describe this",
      images: [Buffer.from("fake-jpeg-bytes")],
      schema: {},
    });

    const messages = sentBody?.messages as Array<{ role: string; content: unknown }>;
    const userContent = messages[1]?.content as Array<Record<string, unknown>>;
    assert.equal(userContent[0]?.type, "text");
    assert.equal(userContent[1]?.type, "image_url");
    const imageUrl = (userContent[1]?.image_url as { url: string }).url;
    assert.match(imageUrl, /^data:image\/jpeg;base64,/);
  });

  it("throws a descriptive error on a non-2xx response", async () => {
    globalThis.fetch = (async () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" })) as typeof fetch;

    const client = new OpenRouterClient("bad-key", "openai/gpt-4o-mini");
    await assert.rejects(client.completeJson({ systemPrompt: "sys", userPrompt: "user", schema: {} }), /401/);
  });
});
