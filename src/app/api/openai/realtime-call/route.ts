import OpenAI from "openai";
import { z } from "zod";
import { acceptIncomingPhoneCall, phoneIntegrationStatus } from "@/lib/server/phone-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const incomingCallSchema = z.object({
  type: z.literal("realtime.call.incoming"),
  data: z.object({ call_id: z.string().min(1).max(240) }),
});

export async function GET() {
  return Response.json(phoneIntegrationStatus(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (process.env.TELEPHONY_ENABLED !== "true") {
    return Response.json({ error: "Phone answering is disabled." }, { status: 503 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const webhookSecret = process.env.OPENAI_WEBHOOK_SECRET?.trim();
  if (!apiKey || !webhookSecret) {
    return Response.json({ error: "The OpenAI phone webhook is not configured." }, { status: 503 });
  }

  const body = await request.text();
  let event: unknown;
  try {
    const client = new OpenAI({ apiKey, webhookSecret });
    event = await client.webhooks.unwrap(body, request.headers);
  } catch {
    return Response.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  const incoming = incomingCallSchema.safeParse(event);
  if (!incoming.success) return Response.json({ received: true, handled: false });

  try {
    const result = await acceptIncomingPhoneCall(incoming.data.data.call_id);
    return Response.json({ received: true, handled: true, ...result });
  } catch {
    return Response.json({ error: "The incoming phone call could not be accepted." }, { status: 502 });
  }
}
