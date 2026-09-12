import { z } from "zod";
import { getTurnoStore } from "@/lib/server/turno-store";

const base = { conversationId: z.string().min(1).max(120) };

export const turnoToolRequestSchema = z.discriminatedUnion("tool", [
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
  z.object({ ...base, tool: z.literal("confirm_booking"), arguments: z.object({ proposalId: z.string().min(1).max(120), patientName: z.string().trim().min(1).max(120) }) }),
  z.object({ ...base, tool: z.literal("create_handoff"), arguments: z.object({ reason: z.string().min(1).max(200), summary: z.string().min(1).max(1000) }) }),
]);

export type TurnoToolRequest = z.infer<typeof turnoToolRequestSchema>;

export function executeTurnoTool(value: TurnoToolRequest) {
  const store = getTurnoStore();
  switch (value.tool) {
    case "search_slots":
      return store.searchSlots(value.conversationId, value.arguments);
    case "hold_slot":
      return store.holdSlot(value.conversationId, value.arguments.slotId);
    case "confirm_booking":
      return store.confirmBooking(value.conversationId, value.arguments.proposalId, value.arguments.patientName);
    case "create_handoff":
      return store.createHandoff(value.conversationId, value.arguments.reason, value.arguments.summary);
  }
}

export function parseAndExecuteTurnoTool(input: unknown) {
  const parsed = turnoToolRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: "INVALID_REQUEST" as const,
      message: "The tool request did not match its contract.",
      recoverable: false,
    };
  }
  return executeTurnoTool(parsed.data);
}
