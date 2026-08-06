// Shared "call the model, parse JSON, retry once on failure" logic used by
// both provider implementations (ollama.ts, openrouter.ts) — the only thing
// that differs between them is how a single chat turn is sent (buildMessages)
// and how the raw HTTP response maps to a message string (chat).
export async function completeJsonWithRetry<T>(
  buildMessages: () => unknown[],
  chat: (messages: unknown[]) => Promise<string>,
): Promise<T> {
  const messages = buildMessages();
  const first = await chat(messages);
  const parsed = tryParseJson<T>(first);
  if (parsed !== undefined) return parsed;

  const retryMessages = [
    ...messages,
    { role: "assistant", content: first },
    { role: "user", content: "Your last reply was not valid JSON matching the schema. Respond with JSON only, no prose." },
  ];
  const second = await chat(retryMessages);
  const reparsed = tryParseJson<T>(second);
  if (reparsed !== undefined) return reparsed;

  throw new Error("Model response was not valid JSON after retry");
}

function tryParseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
