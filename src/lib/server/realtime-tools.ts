import type { RealtimeFunctionTool } from "openai/resources/realtime/realtime";

export const realtimeToolDefinitions: RealtimeFunctionTool[] = [
  {
    type: "function",
    name: "search_slots",
    description: "Search the trusted clinic schedule using the caller's exact requested date, time window, and appointment type. Today is 2026-09-12 and next Tuesday is 2026-09-15. Times use 24-hour HH:mm. Never substitute Tuesday for today.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: { type: "string", description: "Exact requested date in YYYY-MM-DD." },
        earliestTime: { type: "string", description: "Inclusive start of requested window in 24-hour HH:mm." },
        latestTime: { type: "string", description: "Exclusive end of requested window in 24-hour HH:mm." },
        appointmentType: { type: "string", enum: ["Annual checkup", "Follow-up visit"] },
      },
      required: ["date", "earliestTime", "latestTime", "appointmentType"],
    },
  },
  {
    type: "function",
    name: "hold_slot",
    description: "Temporarily hold one slot selected from search_slots. Read back only the returned proposal details.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { slotId: { type: "string" } },
      required: ["slotId"],
    },
  },
  {
    type: "function",
    name: "confirm_booking",
    description: "Commit the current proposal only after the caller states their name and clearly confirms the complete appointment readback. patientName must be the name the caller actually provided; never invent a name. The server checks the latest authoritative caller transcript and prevents duplicates.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        proposalId: { type: "string" },
        patientName: { type: "string", description: "The caller's name exactly as they stated it during this call." },
      },
      required: ["proposalId", "patientName"],
    },
  },
  {
    type: "function",
    name: "create_handoff",
    description: "Create a receptionist handoff for medical advice, urgent, unsupported, uncertain, or failed requests.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        reason: { type: "string" },
        summary: { type: "string" },
      },
      required: ["reason", "summary"],
    },
  },
];
