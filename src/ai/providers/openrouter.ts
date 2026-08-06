import type { AiProviderClient, JsonCompletionRequest } from "./types.js";
import { completeJsonWithRetry } from "./json-completion.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterClient implements AiProviderClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  completeJson<T>(request: JsonCompletionRequest): Promise<T> {
    return completeJsonWithRetry<T>(
      () => buildMessages(request),
      (messages) => this.chat(messages, request.schema),
    );
  }

  private async chat(messages: unknown[], schema: object): Promise<string> {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        // See ollama.ts — deterministic decoding for literal extraction/
        // classification tasks, not creative generation.
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "response", schema, strict: true } },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter request failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

function buildMessages(request: JsonCompletionRequest): unknown[] {
  if (!request.images?.length) {
    return [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userPrompt },
    ];
  }
  const content: unknown[] = [{ type: "text", text: request.userPrompt }];
  for (const image of request.images) {
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } });
  }
  return [{ role: "system", content: request.systemPrompt }, { role: "user", content }];
}
