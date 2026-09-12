import { REALTIME_MODEL, REALTIME_VOICE } from "@/lib/realtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function createRealtimeClientSecret(apiKey: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            audio: { output: { voice: REALTIME_VOICE } },
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError;
}

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured. Use the guided demo or add the key to .env.local." }, { status: 503 });
  }
  let response: Response;
  try {
    response = await createRealtimeClientSecret(apiKey);
  } catch {
    return Response.json(
      { error: "OpenAI could not be reached after two attempts. Check the network and try Start voice call again." },
      { status: 502 },
    );
  }
  if (!response.ok) {
    const detail = await response.text();
    let message = detail.slice(0, 260);
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } };
      message = parsed.error?.message || message;
    } catch {
      // Preserve the short plain-text error when OpenAI does not return JSON.
    }
    return Response.json({ error: `OpenAI refused the Realtime session: ${message}` }, { status: response.status });
  }
  const data = (await response.json().catch(() => null)) as { value?: string } | null;
  if (!data?.value) return Response.json({ error: "OpenAI did not return a short-lived client secret." }, { status: 502 });
  return Response.json({ value: data.value, model: REALTIME_MODEL });
}
