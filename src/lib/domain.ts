export type SlotStatus = "available" | "held" | "booked";

export type ConversationStatus =
  | "ready"
  | "searching"
  | "awaiting_confirmation"
  | "clarifying"
  | "recovering"
  | "booked"
  | "handoff";

export type Slot = {
  id: string;
  startsAt: string;
  provider: string;
  appointmentType: string;
  location: string;
  status: SlotStatus;
  heldBy: string | null;
  holdExpiresAt: string | null;
  patientName: string | null;
};

export type TurnoEventType =
  | "reset"
  | "transcript"
  | "search"
  | "hold"
  | "clarification"
  | "booking"
  | "duplicate_blocked"
  | "conflict"
  | "recovery"
  | "handoff";

export type TurnoEvent = {
  sequence: number;
  id: string;
  conversationId: string;
  type: TurnoEventType;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type Booking = {
  id: string;
  conversationId: string;
  proposalId: string;
  slotId: string;
  patientName: string;
  confirmationEventId: string;
  createdAt: string;
};

export type Handoff = {
  id: string;
  conversationId: string;
  reason: string;
  summary: string;
  status: "open";
  createdAt: string;
};

export type Proposal = {
  proposalId: string;
  slot: Slot;
  holdExpiresAt: string;
  readback: string;
};

export type DashboardSnapshot = {
  conversationId: string;
  status: ConversationStatus;
  proposal: Proposal | null;
  slots: Slot[];
  bookings: Booking[];
  handoffs: Handoff[];
  events: TurnoEvent[];
  reliability: {
    confirmationProtected: true;
    duplicateProtected: true;
    ambiguityCaught: boolean;
    retryBlocked: boolean;
    conflictRecovered: boolean;
    handoffCreated: boolean;
  };
};

export type ToolResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | {
      ok: false;
      code:
        | "NOT_FOUND"
        | "SLOT_UNAVAILABLE"
        | "HOLD_EXPIRED"
        | "STALE_PROPOSAL"
        | "CONFIRMATION_REQUIRED"
        | "INVALID_REQUEST";
      message: string;
      recoverable: boolean;
    };
