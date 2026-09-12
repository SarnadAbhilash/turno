import { REALTIME_MODEL, REALTIME_VOICE } from "@/lib/realtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured. Use the guided demo or add the key to .env.local." }, { status: 503 });
  }
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        audio: { output: { voice: REALTIME_VOICE } },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return Response.json({ error: `OpenAI refused the Realtime session: ${detail.slice(0, 260)}` }, { status: response.status });
  }
  const data = (await response.json()) as { value?: string };
  if (!data.value) return Response.json({ error: "OpenAI did not return a short-lived client secret." }, { status: 502 });
  return Response.json({ value: data.value, model: REALTIME_MODEL });
}
