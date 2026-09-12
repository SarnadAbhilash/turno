import { z } from "zod";
import { getTurnoStore } from "@/lib/server/turno-store";

export const runtime = "nodejs";

const transcriptSchema = z.object({
  conversationId: z.string().min(1).max(120),
  id: z.string().min(1).max(160),
  role: z.enum(["caller", "assistant"]),
  text: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  const parsed = transcriptSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ ok: false, code: "INVALID_REQUEST", message: "Invalid transcript event." }, { status: 400 });
  return Response.json(getTurnoStore().recordTranscript(parsed.data.conversationId, parsed.data.id, parsed.data.role, parsed.data.text));
}
