import { afterEach, describe, expect, it } from "vitest";
import { TurnoStore } from "@/lib/server/turno-store";

const stores: TurnoStore[] = [];

function makeStore() {
  const store = new TurnoStore(":memory:");
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("Turno scheduling boundary", () => {
  it("uses only the corrected time window", () => {
    const store = makeStore();
    const result = store.searchSlots("correction", {
      date: "2026-09-15",
      earliestTime: "14:00",
      latestTime: "15:00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots.map((slot) => slot.id)).toEqual(["slot-1415", "slot-1445"]);
  });

  it("filters real availability by appointment type", () => {
    const store = makeStore();
    const followUps = store.searchSlots("follow-ups", {
      date: "2026-09-15",
      earliestTime: "13:00",
      latestTime: "16:00",
      appointmentType: "Follow-up visit",
    });
    const checkups = store.searchSlots("checkups", {
      date: "2026-09-15",
      earliestTime: "13:00",
      latestTime: "16:00",
      appointmentType: "Annual checkup",
    });
    expect(followUps.ok && followUps.slots.map((slot) => slot.id)).toEqual(["slot-1415", "slot-1445"]);
    expect(checkups.ok && checkups.slots.map((slot) => slot.id)).toEqual(["slot-1330", "slot-1545"]);
  });

  it("blocks ambiguity, accepts explicit confirmation, and commits exactly once", () => {
    const store = makeStore();
    const held = store.holdSlot("exactly-once", "slot-1415");
    expect(held.ok).toBe(true);
    if (!held.ok) return;

    store.recordTranscript("exactly-once", "ambiguous", "caller", "That might work");
    const ambiguous = store.confirmBooking("exactly-once", held.proposal.proposalId, "Asha Kumar");
    expect(ambiguous).toMatchObject({ ok: false, code: "CONFIRMATION_REQUIRED" });
    expect(store.snapshot("exactly-once").bookings).toHaveLength(0);

    store.recordTranscript("exactly-once", "clear", "caller", "Haan, book kar dijiye");
    const first = store.confirmBooking("exactly-once", held.proposal.proposalId, "Asha Kumar");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const retry = store.confirmBooking("exactly-once", held.proposal.proposalId, "Asha Kumar");
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.duplicate).toBe(true);
    expect(retry.booking.id).toBe(first.booking.id);
    expect(store.snapshot("exactly-once").bookings).toHaveLength(1);
  });

  it("reports a conflict without publishing booking success", () => {
    const store = makeStore();
    const held = store.holdSlot("conflict", "slot-1415");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    store.recordTranscript("conflict", "confirm", "caller", "Yes, please book it");
    expect(store.simulateConflict("conflict").ok).toBe(true);

    const result = store.confirmBooking("conflict", held.proposal.proposalId, "Asha Kumar");
    expect(result).toMatchObject({ ok: false, code: "SLOT_UNAVAILABLE" });
    const snapshot = store.snapshot("conflict");
    expect(snapshot.bookings).toHaveLength(0);
    expect(snapshot.events.some((event) => event.type === "booking")).toBe(false);
    expect(snapshot.events.some((event) => event.type === "conflict")).toBe(true);
  });

  it("records conflict recovery once, on the next current search", () => {
    const store = makeStore();
    const held = store.holdSlot("recovery", "slot-1415");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    store.recordTranscript("recovery", "confirm", "caller", "Yes, please book it");
    store.simulateConflict("recovery");
    store.confirmBooking("recovery", held.proposal.proposalId, "Asha Kumar");

    store.searchSlots("recovery", { earliestTime: "14:00", latestTime: "15:00", appointmentType: "Follow-up visit" });
    store.searchSlots("recovery", { earliestTime: "14:00", latestTime: "15:00", appointmentType: "Follow-up visit" });
    const recoveryEvents = store.snapshot("recovery").events.filter((event) => event.type === "recovery");
    expect(recoveryEvents).toHaveLength(1);
  });

  it("creates a visible human handoff for unsupported work", () => {
    const store = makeStore();
    const result = store.createHandoff("handoff", "medical_question", "Caller asked for medical advice.");
    expect(result.ok).toBe(true);
    const snapshot = store.snapshot("handoff");
    expect(snapshot.handoffs).toHaveLength(1);
    expect(snapshot.status).toBe("handoff");
  });
});
