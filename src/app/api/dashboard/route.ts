import { z } from "zod";
import { getTurnoStore } from "@/lib/server/turno-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId") || "browser-demo";
  return Response.json(getTurnoStore().snapshot(conversationId));
}

const actionSchema = z.object({
  action: z.enum(["reset", "simulate_conflict"]),
  conversationId: z.string().min(1).max(120).default("browser-demo"),
});

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ ok: false, code: "INVALID_REQUEST", message: "Invalid dashboard action." }, { status: 400 });
  const store = getTurnoStore();
  if (parsed.data.action === "reset") {
    store.reset();
    return Response.json({ ok: true, snapshot: store.snapshot(parsed.data.conversationId) });
  }
  const result = store.simulateConflict(parsed.data.conversationId);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
