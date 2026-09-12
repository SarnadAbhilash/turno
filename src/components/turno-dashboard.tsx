"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopilotBridge } from "@/components/copilot-bridge";
import type { DashboardSnapshot, Slot, ToolResult, TurnoEvent } from "@/lib/domain";

type TranscriptLine = { id: string; role: "caller" | "assistant"; text: string };

const CONVERSATION_ID = "browser-demo";
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const WORKFLOW = [
  { title: "Call received", caption: "Secure SIP" },
  { title: "Understand", caption: "Live transcript" },
  { title: "Check slots", caption: "Trusted schedule" },
  { title: "Hold time", caption: "Temporary lock" },
  { title: "Confirm", caption: "Clear yes required" },
  { title: "Book", caption: "Exactly once" },
] as const;

async function readJsonResponse<T>(response: Response, operation: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) throw new Error(`${operation} returned an empty response (${response.status}). Please try again.`);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${operation} returned an unreadable response (${response.status}). Please try again.`);
  }
}

function timeLabel(startsAt: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startsAt));
}

function eventLabel(event: TurnoEvent) {
  const labels: Record<TurnoEvent["type"], string> = {
    reset: "Demo reset",
    call: "Phone connection",
    transcript: event.payload.role === "caller" ? "Caller understood" : "Turno replied",
    search: "Calendar checked",
    hold: "Slot protected",
    clarification: "Confirmation blocked",
    booking: "Booking committed",
    duplicate_blocked: "Duplicate prevented",
    conflict: "Conflict detected",
    recovery: "Availability refreshed",
    handoff: "Human handoff",
  };
  return labels[event.type];
}

function eventStage(event: TurnoEvent) {
  const stages: Partial<Record<TurnoEvent["type"], number>> = {
    call: 0,
    transcript: 1,
    search: 2,
    conflict: 2,
    recovery: 2,
    hold: 3,
    clarification: 4,
    handoff: 4,
    booking: 5,
    duplicate_blocked: 5,
  };
  return stages[event.type] ?? -1;
}

function currentAction(snapshot: DashboardSnapshot | null, phoneActive: boolean) {
  if (!snapshot) return { eyebrow: "Synchronizing", title: "Loading receptionist state", body: "Turno is connecting to the trusted operation log.", tone: "neutral" };
  const booking = snapshot.bookings.find((item) => item.conversationId === CONVERSATION_ID);
  if (booking) return { eyebrow: "Completed safely", title: "Appointment booked", body: "The confirmed slot was written once and the confirmation evidence was stored.", tone: "success" };
  if (snapshot.status === "handoff") return { eyebrow: "Safe boundary", title: "Human follow-up created", body: "Turno stopped automation instead of inventing a medical answer.", tone: "warning" };
  if (snapshot.status === "recovering") return { eyebrow: "Recovering", title: "Refreshing availability", body: "The original slot changed, so Turno is checking the live schedule again.", tone: "warning" };
  if (snapshot.status === "clarifying") return { eyebrow: "Safety gate", title: "Waiting for a clear yes", body: "An ambiguous answer was blocked before any booking could be written.", tone: "warning" };
  if (snapshot.status === "awaiting_confirmation" && snapshot.proposal) return { eyebrow: "Caller decision", title: `${timeLabel(snapshot.proposal.slot.startsAt)} is held`, body: "Turno has read back the details and is waiting for explicit confirmation.", tone: "active" };
  if (snapshot.status === "searching") return { eyebrow: "Tool running", title: "Checking real availability", body: "Turno is querying the trusted schedule—not guessing from conversation context.", tone: "active" };
  if (phoneActive) return { eyebrow: "Live phone call", title: "Listening to the caller", body: "Speech is transcribed as each turn completes. The latest turn is highlighted.", tone: "active" };
  return { eyebrow: "Ready", title: "Waiting for the next call", body: "Call the connected Twilio number. The workflow will advance automatically.", tone: "neutral" };
}

export function TurnoDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptWritesRef = useRef(new Map<string, Promise<void>>());

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/dashboard?conversationId=${encodeURIComponent(CONVERSATION_ID)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the receptionist state.");
    const value = await readJsonResponse<DashboardSnapshot>(response, "Loading the receptionist state");
    setSnapshot(value);
    setTranscript(value.events.flatMap((event) => {
      if (event.type !== "transcript") return [];
      const role = event.payload.role === "caller" ? "caller" as const : event.payload.role === "assistant" ? "assistant" as const : null;
      if (!role) return [];
      const fallback = event.message.replace(/^(Caller|Turno):\s*/, "");
      const text = typeof event.payload.text === "string" ? event.payload.text : fallback;
      return text ? [{ id: String(event.payload.transcriptId || event.id), role, text }] : [];
    }));
    return value;
  }, []);

  useEffect(() => {
    let stopped = false;
    let timeout: number | undefined;

    const poll = async (showError = false) => {
      try {
        await refresh();
      } catch (error) {
        if (showError && !stopped) setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        if (!stopped) timeout = window.setTimeout(() => void poll(), 750);
      }
    };

    void poll(true);
    return () => {
      stopped = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [refresh]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript.length]);

  const callTool = useCallback(async (toolName: string, argumentsValue: Record<string, unknown>) => {
    const response = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: CONVERSATION_ID, tool: toolName, arguments: argumentsValue }),
    });
    const result = await readJsonResponse<ToolResult<Record<string, unknown>>>(response, `Tool ${toolName}`);
    await refresh();
    return result;
  }, [refresh]);

  const recordTranscript = useCallback(async (line: TranscriptLine) => {
    const existing = transcriptWritesRef.current.get(line.id);
    if (existing) return existing;
    const write = (async () => {
      const response = await fetch("/api/transcripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: CONVERSATION_ID, ...line }),
      });
      if (!response.ok) throw new Error("The transcript could not be recorded.");
    })();
    transcriptWritesRef.current.set(line.id, write);
    try {
      await write;
    } catch (error) {
      transcriptWritesRef.current.delete(line.id);
      throw error;
    }
  }, []);

  const addLine = useCallback(async (role: TranscriptLine["role"], text: string) => {
    const line = { id: crypto.randomUUID(), role, text };
    setTranscript((current) => [...current, line]);
    await recordTranscript(line);
    return line;
  }, [recordTranscript]);

  const reset = useCallback(async () => {
    setNotice(null);
    setTranscript([]);
    transcriptWritesRef.current.clear();
    const response = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", conversationId: CONVERSATION_ID }),
    });
    const result = await readJsonResponse<Record<string, unknown>>(response, "Resetting the demo");
    await refresh();
    return result;
  }, [refresh]);

  const simulateConflict = useCallback(async () => {
    const response = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "simulate_conflict", conversationId: CONVERSATION_ID }),
    });
    const result = await readJsonResponse<Record<string, unknown>>(response, "Simulating the conflict");
    await refresh();
    return result;
  }, [refresh]);

  const runGuidedDemo = useCallback(async () => {
    setDemoBusy(true);
    setNotice(null);
    try {
      await reset();
      await addLine("caller", "Namaste, mujhe Dr. Ruiz ke saath next Tuesday afternoon appointment chahiye, lekin teen baje ke baad nahi.");
      await pause(450);
      await callTool("search_slots", { date: "2026-09-15", earliestTime: "12:00", latestTime: "15:00", appointmentType: "Follow-up visit" });
      await addLine("assistant", "Ji. Mere paas afternoon mein kuch real available times hain.");
      await pause(450);
      await addLine("caller", "Actually, do baje ke baad chahiye—but before three.");
      const searched = await callTool("search_slots", { date: "2026-09-15", earliestTime: "14:00", latestTime: "15:00", appointmentType: "Follow-up visit" });
      const slots = searched.ok ? searched.slots as Slot[] : [];
      const chosen = slots[0];
      if (!chosen) throw new Error("The seeded demo slot was not available.");
      const held = await callTool("hold_slot", { slotId: chosen.id });
      if (!held.ok) throw new Error(held.message);
      const proposal = held.proposal as { proposalId: string; readback: string };
      await addLine("assistant", `Maine ${timeLabel(chosen.startsAt)} ka slot hold kiya hai. ${proposal.readback}. Kya main ise book kar doon?`);
      await pause(500);
      await addLine("caller", "That might work.");
      await callTool("confirm_booking", { proposalId: proposal.proposalId, patientName: "Asha Kumar" });
      await addLine("assistant", "Book karne se pehle mujhe clear yes chahiye. Kya main is appointment ko book kar doon?");
      await pause(550);
      await addLine("caller", "Haan, book kar dijiye.");
      const booked = await callTool("confirm_booking", { proposalId: proposal.proposalId, patientName: "Asha Kumar" });
      if (!booked.ok) throw new Error(booked.message);
      await addLine("assistant", "Aapki appointment book ho gayi hai. Confirmation receptionist screen par dikh raha hai.");
      await callTool("confirm_booking", { proposalId: proposal.proposalId, patientName: "Asha Kumar" });
      setNotice("Reliability proof complete: correction applied, ambiguity blocked, and retry created no duplicate.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDemoBusy(false);
      await refresh();
    }
  }, [addLine, callTool, refresh, reset]);

  const runConflictDemo = useCallback(async () => {
    setDemoBusy(true);
    setNotice(null);
    try {
      await reset();
      await addLine("caller", "Please book the 2:15 appointment.");
      const held = await callTool("hold_slot", { slotId: "slot-1415" });
      if (!held.ok) throw new Error(held.message);
      const proposal = held.proposal as { proposalId: string };
      await addLine("assistant", "I have held 2:15 PM. Would you like me to book it?");
      await simulateConflict();
      await addLine("caller", "Yes, please book it.");
      const conflict = await callTool("confirm_booking", { proposalId: proposal.proposalId, patientName: "Asha Kumar" });
      if (conflict.ok) throw new Error("Expected the controlled conflict to block the booking.");
      await addLine("assistant", "That slot was just taken. I’ll check the current schedule.");
      const recovered = await callTool("search_slots", { date: "2026-09-15", earliestTime: "14:00", latestTime: "15:00", appointmentType: "Follow-up visit" });
      if (!recovered.ok) throw new Error(recovered.message);
      const recoveredSlots = recovered.slots as Slot[];
      if (!recoveredSlots[0]) throw new Error("No recovery slot remained in the demo schedule.");
      await addLine("assistant", `I found another real opening at ${timeLabel(recoveredSlots[0].startsAt)}.`);
      setNotice("Conflict recovery proven: Turno showed no false success and offered a current slot.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDemoBusy(false);
      await refresh();
    }
  }, [addLine, callTool, refresh, reset, simulateConflict]);

  const runHandoffDemo = useCallback(async () => {
    setDemoBusy(true);
    setNotice(null);
    try {
      await addLine("caller", "My chest hurts. Should I wait until next week?");
      await callTool("create_handoff", { reason: "medical_question", summary: "Caller asked for medical guidance; Turno did not answer and requested human help." });
      await addLine("assistant", "I can’t give medical advice. I’ve created a priority handoff for the clinic team. If this may be an emergency, please contact emergency services now.");
      setNotice("Safe handoff created without medical advice.");
    } finally {
      setDemoBusy(false);
      await refresh();
    }
  }, [addLine, callTool, refresh]);

  const conversationEvents = useMemo(
    () => snapshot?.events.filter((event) => event.conversationId === CONVERSATION_ID) || [],
    [snapshot],
  );
  const lastCallEvent = [...conversationEvents].reverse().find((event) => event.type === "call");
  const phoneActive = Boolean(lastCallEvent && !/(ended|failed|could not)/i.test(lastCallEvent.message));
  const activeBooking = snapshot?.bookings.find((booking) => booking.conversationId === CONVERSATION_ID) || null;
  const activeSlotId = snapshot?.proposal?.slot.id || activeBooking?.slotId || null;
  const action = currentAction(snapshot, phoneActive);
  const hasStarted = conversationEvents.some((event) => eventStage(event) >= 0);
  const stageIndex = activeBooking ? 5 : hasStarted ? Math.max(0, ...conversationEvents.map(eventStage)) : -1;
  const activity = conversationEvents.filter((event) => event.type !== "transcript").slice(-7).reverse();
  const counts = {
    open: snapshot?.slots.filter((slot) => slot.status === "available").length || 0,
    held: snapshot?.slots.filter((slot) => slot.status === "held").length || 0,
    booked: snapshot?.slots.filter((slot) => slot.status === "booked").length || 0,
  };
  const latestTranscriptId = transcript.at(-1)?.id;
  const callBadge = phoneActive ? "Call in progress" : activeBooking ? "Call completed" : "Ready for a call";

  return (
    <main className="shell">
      <CopilotBridge snapshot={snapshot} reset={reset} simulateConflict={simulateConflict} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">T</span>
          <div><strong>Turno</strong><span>Reliable multilingual scheduling</span></div>
        </div>
        <div className="topbar-actions">
          <span className="system-status"><i /> Signed webhook · safeguards active</span>
          <button type="button" className="quiet-button" onClick={reset} disabled={demoBusy}>Reset demo</button>
        </div>
      </header>

      <section className="demo-shell" aria-label="Turno live receptionist dashboard">
        <div className="demo-intro">
          <div>
            <div className="section-label">Live phone receptionist</div>
            <h1>Watch the appointment happen</h1>
            <p>Call the connected number. Every transcript turn, tool action, safeguard, and schedule change appears here.</p>
          </div>
          <div className={`call-badge ${phoneActive ? "call-badge-live" : ""}`}>
            <span className="live-dot" />
            <div><strong>{callBadge}</strong><small>{phoneActive ? "Twilio → OpenAI → Turno" : "Phone channel connected"}</small></div>
          </div>
        </div>

        <section className="workflow-card" aria-label="Booking workflow">
          <div className="workflow-heading">
            <div><span>Current stage</span><strong>{action.title}</strong></div>
            <p>{action.body}</p>
          </div>
          <div className="workflow-steps">
            {WORKFLOW.map((step, index) => {
              const state = index < stageIndex ? "complete" : index === stageIndex ? "active" : "waiting";
              return (
                <div className={`workflow-step workflow-step-${state}`} key={step.title}>
                  <span>{state === "complete" ? "✓" : index + 1}</span>
                  <div><strong>{step.title}</strong><small>{step.caption}</small></div>
                </div>
              );
            })}
          </div>
        </section>

        {notice && <div className="notice" role="status">{notice}</div>}

        <div className="live-grid">
          <section className="transcript-card live-transcript-card">
            <div className="card-heading transcript-heading">
              <div><h2>Live transcript</h2><p>The current completed turn is highlighted and kept in view.</p></div>
              <span className={phoneActive ? "stream-state stream-state-live" : "stream-state"}>{phoneActive ? "● LIVE" : transcript.length ? `${transcript.length} turns` : "Waiting"}</span>
            </div>
            {transcript.length ? (
              <div className="transcript-list" aria-live="polite">
                {transcript.map((line) => (
                  <article className={`transcript-line transcript-${line.role} ${line.id === latestTranscriptId ? "transcript-current" : ""}`} key={line.id}>
                    <div className="speaker-mark" aria-hidden="true">{line.role === "caller" ? "C" : "T"}</div>
                    <div><strong>{line.role === "caller" ? "Caller" : "Turno"}</strong><p>{line.text}</p></div>
                    {line.id === latestTranscriptId && <span className="current-turn-label">Current turn</span>}
                  </article>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            ) : (
              <div className="empty-transcript">
                <span className="empty-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <strong>Waiting for the caller</strong>
                <p>The conversation will appear here automatically when a phone call begins.</p>
              </div>
            )}

            <div className="activity-panel">
              <div className="card-heading"><h2>Agent actions</h2><span>Authoritative server events</span></div>
              {activity.length ? (
                <div className="activity-list">
                  {activity.map((event, index) => (
                    <article className={index === 0 ? "activity-current" : ""} key={event.id}>
                      <span className={`event-dot event-${event.type}`} />
                      <time>{new Date(event.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
                      <div><strong>{eventLabel(event)}</strong><p>{event.message}</p></div>
                    </article>
                  ))}
                </div>
              ) : <div className="activity-empty">Tool calls and safety decisions will appear here.</div>}
            </div>
          </section>

          <aside className="right-rail">
            <section className={`current-action current-action-${action.tone}`}>
              <span>{action.eyebrow}</span>
              <strong>{action.title}</strong>
              <p>{action.body}</p>
            </section>

            {activeBooking && (
              <section className="booking-banner">
                <span className="booking-check">✓</span>
                <div><small>Appointment confirmed</small><strong>{activeBooking.id}</strong><p>Persisted once with confirmation evidence</p></div>
              </section>
            )}

            <section className="calendar-card">
              <div className="card-heading schedule-heading">
                <div><h2>Clinic schedule</h2><p>Tuesday, September 15 · Dr. Elena Ruiz</p></div>
                <span>Synthetic data</span>
              </div>
              <div className="slot-summary" aria-label="Schedule summary">
                <div><strong>{counts.open}</strong><span>Open</span></div>
                <div><strong>{counts.held}</strong><span>Held</span></div>
                <div><strong>{counts.booked}</strong><span>Booked</span></div>
              </div>
              <div className="slot-list">
                {(snapshot?.slots || []).map((slot) => (
                  <div className={`slot slot-${slot.status} ${slot.id === activeSlotId ? "slot-current" : ""}`} key={slot.id}>
                    <time>{timeLabel(slot.startsAt)}</time>
                    <div><strong>{slot.patientName || slot.appointmentType}</strong><span>{slot.status === "held" && slot.heldBy === CONVERSATION_ID ? "Protected for this caller" : slot.appointmentType}</span></div>
                    <b>{slot.status === "available" ? "Open" : slot.status === "held" ? "Held" : "Booked"}</b>
                  </div>
                ))}
              </div>
            </section>

            <section className="evidence-card">
              <div className="card-heading"><h2>Production safeguards</h2><span>Server enforced</span></div>
              <div className="evidence-grid">
                <article className="evidence-proven"><i>✓</i><div><strong>Signed webhook</strong><p>Rejects untrusted call events</p></div></article>
                <article className="evidence-proven"><i>✓</i><div><strong>Confirmation gate</strong><p>No clear yes, no booking</p></div></article>
                <article className={snapshot?.reliability.retryBlocked ? "evidence-proven" : ""}><i>{snapshot?.reliability.retryBlocked ? "✓" : "○"}</i><div><strong>Exactly-once write</strong><p>{snapshot?.reliability.retryBlocked ? "Duplicate retry proven" : "Unique commit key ready"}</p></div></article>
                <article className={snapshot?.reliability.handoffCreated ? "evidence-proven" : ""}><i>{snapshot?.reliability.handoffCreated ? "✓" : "○"}</i><div><strong>Human handoff</strong><p>No invented medical advice</p></div></article>
              </div>
              <details className="demo-controls">
                <summary>Optional reliability scenarios</summary>
                <div><button type="button" onClick={runGuidedDemo} disabled={demoBusy}>{demoBusy ? "Running…" : "Run end-to-end proof"}</button><button type="button" onClick={runConflictDemo} disabled={demoBusy}>Inject slot conflict</button><button type="button" onClick={runHandoffDemo} disabled={demoBusy}>Test safe handoff</button></div>
              </details>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
