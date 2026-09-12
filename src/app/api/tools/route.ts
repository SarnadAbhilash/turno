import { z } from "zod";
import { getTurnoStore } from "@/lib/server/turno-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const base = { conversationId: z.string().min(1).max(120) };
const requestSchema = z.discriminatedUnion("tool", [
  z.object({
    ...base,
    tool: z.literal("search_slots"),
    arguments: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      earliestTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      latestTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      appointmentType: z.string().max(120).optional(),
    }),
  }),
  z.object({ ...base, tool: z.literal("hold_slot"), arguments: z.object({ slotId: z.string().min(1).max(120) }) }),
  z.object({ ...base, tool: z.literal("confirm_booking"), arguments: z.object({ proposalId: z.string().min(1).max(120), patientName: z.string().min(1).max(120).optional() }) }),
  z.object({ ...base, tool: z.literal("create_handoff"), arguments: z.object({ reason: z.string().min(1).max(200), summary: z.string().min(1).max(1000) }) }),
]);

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ ok: false, code: "INVALID_REQUEST", message: "The tool request did not match its contract.", recoverable: false }, { status: 400 });
  const store = getTurnoStore();
  const value = parsed.data;
  let result;
  switch (value.tool) {
    case "search_slots": {
      result = store.searchSlots(value.conversationId, value.arguments);
      break;
    }
    case "hold_slot":
      result = store.holdSlot(value.conversationId, value.arguments.slotId);
      break;
    case "confirm_booking":
      result = store.confirmBooking(value.conversationId, value.arguments.proposalId, value.arguments.patientName);
      break;
    case "create_handoff":
      result = store.createHandoff(value.conversationId, value.arguments.reason, value.arguments.summary);
      break;
  }
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
