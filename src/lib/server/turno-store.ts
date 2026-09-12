import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isExplicitConfirmation } from "@/lib/confirmation";
import type {
  Booking,
  ConversationStatus,
  DashboardSnapshot,
  Handoff,
  Proposal,
  Slot,
  ToolResult,
  TurnoEvent,
  TurnoEventType,
} from "@/lib/domain";

type ConversationRow = {
  id: string;
  status: ConversationStatus;
  proposal_id: string | null;
  slot_id: string | null;
};

type SlotRow = {
  id: string;
  starts_at: string;
  provider: string;
  appointment_type: string;
  location: string;
  status: Slot["status"];
  held_by: string | null;
  hold_expires_at: string | null;
  patient_name: string | null;
};

type EventRow = {
  sequence: number;
  id: string;
  conversation_id: string;
  type: TurnoEventType;
  message: string;
  payload: string;
  created_at: string;
};

const seedSlots = [
  ["slot-1330", "2026-09-15T13:30:00-07:00", "Annual checkup", "available", null],
  ["slot-1415", "2026-09-15T14:15:00-07:00", "Follow-up visit", "available", null],
  ["slot-1445", "2026-09-15T14:45:00-07:00", "Follow-up visit", "available", null],
  ["slot-1515", "2026-09-15T15:15:00-07:00", "Annual checkup", "booked", "Jordan Lee"],
  ["slot-1545", "2026-09-15T15:45:00-07:00", "Annual checkup", "available", null],
] as const;

function toSlot(row: SlotRow): Slot {
  return {
    id: row.id,
    startsAt: row.starts_at,
    provider: row.provider,
    appointmentType: row.appointment_type,
    location: row.location,
    status: row.status,
    heldBy: row.held_by,
    holdExpiresAt: row.hold_expires_at,
    patientName: row.patient_name,
  };
}

function appointmentReadback(slot: Slot) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(slot.startsAt));
  return `${slot.appointmentType} with ${slot.provider} on ${time} at ${slot.location}`;
}

export class TurnoStore {
  readonly db: Database.Database;

  constructor(databasePath = process.env.DATABASE_PATH || ".data/turno.sqlite") {
    if (databasePath !== ":memory:") mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("foreign_keys = ON");
    if (databasePath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        starts_at TEXT NOT NULL,
        provider TEXT NOT NULL,
        appointment_type TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('available', 'held', 'booked')),
        held_by TEXT,
        hold_expires_at TEXT,
        patient_name TEXT
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        proposal_id TEXT,
        slot_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transcripts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL UNIQUE,
        proposal_id TEXT NOT NULL UNIQUE,
        slot_id TEXT NOT NULL UNIQUE,
        patient_name TEXT NOT NULL,
        confirmation_event_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM slots").get() as { count: number };
    if (count.count === 0) this.reset();
  }

  close() {
    this.db.close();
  }

  reset() {
    const reset = this.db.transaction(() => {
      this.db.exec("DELETE FROM events; DELETE FROM handoffs; DELETE FROM bookings; DELETE FROM transcripts; DELETE FROM conversations; DELETE FROM slots;");
      const insert = this.db.prepare(`
        INSERT INTO slots (id, starts_at, provider, appointment_type, location, status, held_by, hold_expires_at, patient_name)
        VALUES (?, ?, 'Dr. Elena Ruiz', ?, 'Harbor Clinic', ?, NULL, NULL, ?)
      `);
      for (const [id, startsAt, appointmentType, status, patientName] of seedSlots) {
        insert.run(id, startsAt, appointmentType, status, patientName);
      }
      this.emit("system", "reset", "Demo schedule reset to known synthetic data.");
    });
    reset();
  }

  private ensureConversation(conversationId: string) {
    this.db.prepare(`
      INSERT INTO conversations (id, status, proposal_id, slot_id, updated_at)
      VALUES (?, 'ready', NULL, NULL, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(conversationId, new Date().toISOString());
  }

  private updateConversation(
    conversationId: string,
    status: ConversationStatus,
    proposalId: string | null,
    slotId: string | null,
  ) {
    this.ensureConversation(conversationId);
    this.db.prepare(`
      UPDATE conversations SET status = ?, proposal_id = ?, slot_id = ?, updated_at = ? WHERE id = ?
    `).run(status, proposalId, slotId, new Date().toISOString(), conversationId);
  }

  private emit(
    conversationId: string,
    type: TurnoEventType,
    message: string,
    payload: Record<string, unknown> = {},
  ) {
    this.db.prepare(`
      INSERT INTO events (id, conversation_id, type, message, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), conversationId, type, message, JSON.stringify(payload), new Date().toISOString());
  }

  recordTranscript(conversationId: string, id: string, role: "caller" | "assistant", text: string) {
    this.ensureConversation(conversationId);
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO transcripts (id, conversation_id, role, text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, conversationId, role, text.trim(), new Date().toISOString());
    if (result.changes > 0) {
      this.emit(conversationId, "transcript", role === "caller" ? `Caller: ${text}` : `Turno: ${text}`, { transcriptId: id, role });
    }
    return { ok: true as const, transcriptId: id };
  }

  searchSlots(
    conversationId: string,
    input: { date?: string; earliestTime?: string; latestTime?: string; appointmentType?: string },
  ): ToolResult<{ slots: Slot[] }> {
    this.ensureConversation(conversationId);
    const previous = this.db.prepare("SELECT status FROM conversations WHERE id = ?").get(conversationId) as { status: ConversationStatus };
    const wasRecovering = previous.status === "recovering";
    const date = input.date || "2026-09-15";
    const earliest = input.earliestTime || "00:00";
    const latest = input.latestTime || "23:59";
    const appointmentType = input.appointmentType?.trim();
    this.updateConversation(conversationId, "searching", null, null);
    const query = `
      SELECT * FROM slots
      WHERE substr(starts_at, 1, 10) = ?
        AND substr(starts_at, 12, 5) >= ?
        AND substr(starts_at, 12, 5) < ?
        AND status = 'available'
        ${appointmentType ? "AND lower(appointment_type) = lower(?)" : ""}
      ORDER BY starts_at ASC
    `;
    const rows = this.db.prepare(query).all(...(appointmentType ? [date, earliest, latest, appointmentType] : [date, earliest, latest])) as SlotRow[];
    const slots = rows.map(toSlot);
    this.emit(conversationId, "search", `Checked current availability and found ${slots.length} matching slot${slots.length === 1 ? "" : "s"}.`, {
      date,
      earliestTime: earliest,
      latestTime: latest,
      appointmentType: appointmentType || null,
      slotIds: slots.map((slot) => slot.id),
    });
    if (wasRecovering) this.markRecovery(conversationId, slots.map((slot) => slot.id));
    return { ok: true, slots };
  }

  holdSlot(conversationId: string, slotId: string): ToolResult<{ proposal: Proposal }> {
    this.ensureConversation(conversationId);
    const result = this.db.transaction(() => {
      const previous = this.db.prepare("SELECT slot_id FROM conversations WHERE id = ?").get(conversationId) as { slot_id: string | null };
      if (previous.slot_id && previous.slot_id !== slotId) {
        this.db.prepare("UPDATE slots SET status = 'available', held_by = NULL, hold_expires_at = NULL WHERE id = ? AND held_by = ? AND status = 'held'").run(previous.slot_id, conversationId);
      }
      const row = this.db.prepare("SELECT * FROM slots WHERE id = ?").get(slotId) as SlotRow | undefined;
      if (!row) return { ok: false, code: "NOT_FOUND", message: "That appointment slot does not exist.", recoverable: true } as const;
      if (row.status !== "available" && row.held_by !== conversationId) {
        return { ok: false, code: "SLOT_UNAVAILABLE", message: "That time was just taken. Please search again.", recoverable: true } as const;
      }
      const proposalId = randomUUID();
      const holdExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      this.db.prepare("UPDATE slots SET status = 'held', held_by = ?, hold_expires_at = ? WHERE id = ?").run(conversationId, holdExpiresAt, slotId);
      this.updateConversation(conversationId, "awaiting_confirmation", proposalId, slotId);
      const slot = toSlot({ ...row, status: "held", held_by: conversationId, hold_expires_at: holdExpiresAt });
      const proposal = { proposalId, slot, holdExpiresAt, readback: appointmentReadback(slot) };
      this.emit(conversationId, "hold", `Held ${proposal.readback}. Waiting for explicit confirmation.`, { proposalId, slotId, holdExpiresAt });
      return { ok: true, proposal } as const;
    })();
    return result;
  }

  confirmBooking(conversationId: string, proposalId: string, patientName = "Asha Kumar"): ToolResult<{ booking: Booking; duplicate: boolean }> {
    const existing = this.db.prepare("SELECT * FROM bookings WHERE conversation_id = ? OR proposal_id = ?").get(conversationId, proposalId) as {
      id: string; conversation_id: string; proposal_id: string; slot_id: string; patient_name: string; confirmation_event_id: string; created_at: string;
    } | undefined;
    if (existing) {
      const booking = this.toBooking(existing);
      this.emit(conversationId, "duplicate_blocked", `Repeated commit returned existing booking ${booking.id}; no duplicate was created.`, { bookingId: booking.id, proposalId });
      return { ok: true, booking, duplicate: true };
    }

    const conversation = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as ConversationRow | undefined;
    if (!conversation || conversation.proposal_id !== proposalId || !conversation.slot_id) {
      return { ok: false, code: "STALE_PROPOSAL", message: "That proposal is no longer current. Please offer the latest available slot.", recoverable: true };
    }

    const transcript = this.db.prepare(`
      SELECT id, text FROM transcripts WHERE conversation_id = ? AND role = 'caller' ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(conversationId) as { id: string; text: string } | undefined;
    if (!transcript || !isExplicitConfirmation(transcript.text)) {
      this.updateConversation(conversationId, "clarifying", proposalId, conversation.slot_id);
      this.emit(conversationId, "clarification", "Ambiguous response blocked. Turno must ask for a clear yes or no.", {
        proposalId,
        transcriptEventId: transcript?.id ?? null,
      });
      return { ok: false, code: "CONFIRMATION_REQUIRED", message: "I need a clear yes before I can book this appointment.", recoverable: true };
    }

    const slot = this.db.prepare("SELECT * FROM slots WHERE id = ?").get(conversation.slot_id) as SlotRow | undefined;
    if (!slot || slot.status !== "held" || slot.held_by !== conversationId) {
      this.updateConversation(conversationId, "recovering", null, null);
      this.emit(conversationId, "conflict", "The held slot was no longer available. No booking was created.", { proposalId, slotId: conversation.slot_id });
      return { ok: false, code: "SLOT_UNAVAILABLE", message: "That time was just taken. I will check the current schedule and offer another option.", recoverable: true };
    }
    if (slot.hold_expires_at && new Date(slot.hold_expires_at).getTime() < Date.now()) {
      this.db.prepare("UPDATE slots SET status = 'available', held_by = NULL, hold_expires_at = NULL WHERE id = ?").run(slot.id);
      this.updateConversation(conversationId, "recovering", null, null);
      this.emit(conversationId, "conflict", "The temporary hold expired. No booking was created.", { proposalId, slotId: slot.id });
      return { ok: false, code: "HOLD_EXPIRED", message: "The temporary hold expired. I will find another current time.", recoverable: true };
    }

    const booking = this.db.transaction(() => {
      const id = `TRN-${randomUUID().slice(0, 8).toUpperCase()}`;
      const createdAt = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO bookings (id, conversation_id, proposal_id, slot_id, patient_name, confirmation_event_id, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, conversationId, proposalId, slot.id, patientName, transcript.id, `${conversationId}:${proposalId}`, createdAt);
      this.db.prepare("UPDATE slots SET status = 'booked', held_by = NULL, hold_expires_at = NULL, patient_name = ? WHERE id = ?").run(patientName, slot.id);
      this.updateConversation(conversationId, "booked", proposalId, slot.id);
      const value: Booking = { id, conversationId, proposalId, slotId: slot.id, patientName, confirmationEventId: transcript.id, createdAt };
      this.emit(conversationId, "booking", `Booking ${id} committed exactly once after explicit confirmation.`, {
        bookingId: id,
        proposalId,
        slotId: slot.id,
        confirmationEventId: transcript.id,
      });
      return value;
    })();
    return { ok: true, booking, duplicate: false };
  }

  simulateConflict(conversationId: string) {
    this.ensureConversation(conversationId);
    const conversation = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as ConversationRow;
    if (!conversation.slot_id) {
      return { ok: false as const, code: "INVALID_REQUEST" as const, message: "Hold a slot before simulating a conflict.", recoverable: true };
    }
    this.db.prepare("UPDATE slots SET status = 'booked', held_by = NULL, hold_expires_at = NULL, patient_name = 'Another caller' WHERE id = ?").run(conversation.slot_id);
    this.emit(conversationId, "conflict", "Demo conflict injected: another caller took the held slot.", { slotId: conversation.slot_id });
    return { ok: true as const, slotId: conversation.slot_id };
  }

  markRecovery(conversationId: string, slotIds: string[]) {
    this.emit(conversationId, "recovery", "Turno recovered by searching current availability and offering a new real slot.", { slotIds });
  }

  createHandoff(conversationId: string, reason: string, summary: string): ToolResult<{ handoff: Handoff }> {
    this.ensureConversation(conversationId);
    const handoff: Handoff = { id: `HND-${randomUUID().slice(0, 8).toUpperCase()}`, conversationId, reason, summary, status: "open", createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO handoffs (id, conversation_id, reason, summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(handoff.id, handoff.conversationId, handoff.reason, handoff.summary, handoff.status, handoff.createdAt);
    this.updateConversation(conversationId, "handoff", null, null);
    this.emit(conversationId, "handoff", `Human handoff ${handoff.id} created instead of inventing an answer.`, { handoffId: handoff.id, reason });
    return { ok: true, handoff };
  }

  snapshot(conversationId: string): DashboardSnapshot {
    this.ensureConversation(conversationId);
    const conversation = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as ConversationRow;
    const slots = (this.db.prepare("SELECT * FROM slots ORDER BY starts_at").all() as SlotRow[]).map(toSlot);
    const bookings = (this.db.prepare("SELECT * FROM bookings ORDER BY created_at DESC").all() as Array<{
      id: string; conversation_id: string; proposal_id: string; slot_id: string; patient_name: string; confirmation_event_id: string; created_at: string;
    }>).map((row) => this.toBooking(row));
    const handoffs = (this.db.prepare("SELECT * FROM handoffs ORDER BY created_at DESC").all() as Array<{
      id: string; conversation_id: string; reason: string; summary: string; status: "open"; created_at: string;
    }>).map((row) => ({ id: row.id, conversationId: row.conversation_id, reason: row.reason, summary: row.summary, status: row.status, createdAt: row.created_at }));
    const events = (this.db.prepare("SELECT * FROM events ORDER BY sequence DESC LIMIT 40").all() as EventRow[]).reverse().map((row): TurnoEvent => ({
      sequence: row.sequence,
      id: row.id,
      conversationId: row.conversation_id,
      type: row.type,
      message: row.message,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
    const slot = conversation.slot_id ? slots.find((candidate) => candidate.id === conversation.slot_id) : undefined;
    const proposal = conversation.proposal_id && slot && slot.holdExpiresAt ? {
      proposalId: conversation.proposal_id,
      slot,
      holdExpiresAt: slot.holdExpiresAt,
      readback: appointmentReadback(slot),
    } : null;
    return {
      conversationId,
      status: conversation.status,
      proposal,
      slots,
      bookings,
      handoffs,
      events,
      reliability: {
        confirmationProtected: true,
        duplicateProtected: true,
        ambiguityCaught: events.some((event) => event.type === "clarification"),
        retryBlocked: events.some((event) => event.type === "duplicate_blocked"),
        conflictRecovered: events.some((event) => event.type === "recovery"),
        handoffCreated: events.some((event) => event.type === "handoff"),
      },
    };
  }

  private toBooking(row: { id: string; conversation_id: string; proposal_id: string; slot_id: string; patient_name: string; confirmation_event_id: string; created_at: string }): Booking {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      proposalId: row.proposal_id,
      slotId: row.slot_id,
      patientName: row.patient_name,
      confirmationEventId: row.confirmation_event_id,
      createdAt: row.created_at,
    };
  }
}

const globalForTurno = globalThis as unknown as { turnoStore?: TurnoStore };

export function getTurnoStore() {
  if (!globalForTurno.turnoStore) globalForTurno.turnoStore = new TurnoStore();
  return globalForTurno.turnoStore;
}
