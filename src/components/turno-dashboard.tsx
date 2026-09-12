"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import { z } from "zod";
import { CopilotBridge } from "@/components/copilot-bridge";
import type { DashboardSnapshot, Slot, ToolResult, TurnoEvent } from "@/lib/domain";
import { REALTIME_MODEL } from "@/lib/realtime-config";

type CallStatus = "ready" | "connecting" | "live" | "demo" | "error";
type VoicePhase = "idle" | "listening" | "hearing" | "thinking" | "speaking";
type MicrophoneStatus = "unchecked" | "checking" | "ready" | "blocked";
type TranscriptLine = { id: string; role: "caller" | "assistant"; text: string };

const CONVERSATION_ID = "browser-demo";
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readJsonResponse<T>(response: Response, operation: string): Promise<T> {
  const body = await response.text();
  if (!body.trim()) throw new Error(`${operation} returned an empty response (${response.status}). Please try again.`);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${operation} returned an unreadable response (${response.status}). Please try again.`);
  }
}

const voiceInstructions = `
You are Turno, a voice receptionist for the fictional Harbor Clinic in Los Angeles.
You help callers schedule an annual checkup or follow-up visit with Dr. Elena Ruiz.
Speak in the caller's language: Hindi, English, Spanish, or a natural mix. Keep each response short and warm.
Today is Saturday, September 12, 2026. Next Tuesday is September 15, 2026.

RELIABILITY RULES:
- Match the caller's language exactly. If the caller speaks only English, reply only in English. Do not switch languages unprompted.
- Never replace the caller's requested date or time. "Today" means 2026-09-12 and "next Tuesday" means 2026-09-15.
- If the caller did not say whether this is an annual checkup or follow-up visit, ask that before searching.
- Never invent availability. Call search_slots and use only returned slots.
- If search_slots returns no slots, clearly say none match the requested constraints and ask whether the caller wants a different date or time.
- When the caller selects a slot, call hold_slot. Read back the returned appointment details.
- After every tool result, immediately tell the caller the outcome aloud. Never leave a tool result without a spoken follow-up.
- Ask for a clear yes or no. Call confirm_booking only after a clear affirmative response.
- If confirmation is ambiguous, ask a short clarification question. Never claim success without a booking ID.
- If a slot is unavailable or the hold expired, apologize, search again, and offer a new real slot.
- Repeated confirmation may return the existing booking. Explain that no duplicate was made.
- Do not give medical advice, diagnosis, triage, treatment, or insurance decisions. Call create_handoff instead.
- Never read IDs aloud. The receptionist can see them on screen.
`;

function timeLabel(startsAt: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startsAt));
}

function eventLabel(event: TurnoEvent) {
  const labels: Record<TurnoEvent["type"], string> = {
    reset: "Reset",
    transcript: "Transcript",
    search: "Availability",
    hold: "Slot held",
    clarification: "Safety gate",
    booking: "Committed",
    duplicate_blocked: "Retry blocked",
    conflict: "Conflict",
    recovery: "Recovered",
    handoff: "Handoff",
  };
  return labels[event.type];
}

export function TurnoDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>("ready");
  const [notice, setNotice] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [demoBusy, setDemoBusy] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("unchecked");
  const [microphoneName, setMicrophoneName] = useState("Default microphone");
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const transportRef = useRef<OpenAIRealtimeWebRTC | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const outputAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const latestCallerRef = useRef<TranscriptLine | null>(null);
  const transcriptWritesRef = useRef(new Map<string, Promise<void>>());

  const stopBrowserAudio = useCallback(() => {
    if (meterFrameRef.current !== null) window.cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (outputAudioRef.current) outputAudioRef.current.srcObject = null;
    setMicrophoneLevel(0);
  }, []);

  const openBrowserMicrophone = useCallback(async () => {
    if (!window.isSecureContext) {
      throw new Error("Microphone access requires a secure page. Open Turno at http://localhost:3100 or http://127.0.0.1:3100 in Chrome.");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not expose a microphone to Turno. Open the same address in Chrome or Safari.");
    }

    setMicrophoneStatus("checking");
    setNotice("Waiting for microphone permission… choose Allow if your browser asks.");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      setMicrophoneStatus("blocked");
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new Error("Microphone permission is blocked. Allow microphone access for this page, then press Start voice call again.");
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        throw new Error("No microphone was found. Connect or enable a microphone, then try again.");
      }
      throw new Error(`The microphone could not start${name ? ` (${name})` : ""}. Try opening Turno in Chrome.`);
    }

    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") {
      stream.getTracks().forEach((item) => item.stop());
      setMicrophoneStatus("blocked");
      throw new Error("The browser granted access but did not provide a live microphone track.");
    }

    mediaStreamRef.current = stream;
    setMicrophoneName(track.label || "Default microphone");
    setMicrophoneStatus("ready");

    track.addEventListener("ended", () => {
      setMicrophoneStatus("blocked");
      setNotice("The microphone stopped. End the call and start it again.");
    });

    try {
      const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextConstructor) {
        const context = new AudioContextConstructor();
        audioContextRef.current = context;
        await context.resume();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const updateMeter = () => {
          analyser.getByteTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            energy += normalized * normalized;
          }
          setMicrophoneLevel(Math.min(100, Math.round(Math.sqrt(energy / samples.length) * 360)));
          meterFrameRef.current = window.requestAnimationFrame(updateMeter);
        };
        updateMeter();
      }
    } catch {
      // The live call still works if a browser will not expose Web Audio for the visual meter.
    }

    return stream;
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/dashboard?conversationId=${encodeURIComponent(CONVERSATION_ID)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the receptionist state.");
    const value = await readJsonResponse<DashboardSnapshot>(response, "Loading the receptionist state");
    setSnapshot(value);
    return value;
  }, []);

  useEffect(() => {
    void refresh().catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
    const interval = window.setInterval(() => void refresh().catch(() => undefined), 900);
    return () => {
      window.clearInterval(interval);
      sessionRef.current?.close();
      sessionRef.current = null;
      transportRef.current = null;
      stopBrowserAudio();
    };
  }, [refresh, stopBrowserAudio]);

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
    if (role === "caller") latestCallerRef.current = line;
    setTranscript((current) => [...current, line]);
    await recordTranscript(line);
    return line;
  }, [recordTranscript]);

  const reset = useCallback(async () => {
    sessionRef.current?.close();
    sessionRef.current = null;
    transportRef.current = null;
    stopBrowserAudio();
    setCallStatus("ready");
    setVoicePhase("idle");
    setMicrophoneStatus("unchecked");
    setTranscript([]);
    setNotice(null);
    latestCallerRef.current = null;
    transcriptWritesRef.current.clear();
    const response = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", conversationId: CONVERSATION_ID }),
    });
    const result = await readJsonResponse<Record<string, unknown>>(response, "Resetting the demo");
    await refresh();
    return result;
  }, [refresh, stopBrowserAudio]);

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

  const connectVoice = useCallback(async () => {
    setCallStatus("connecting");
    setNotice(null);
    try {
      stopBrowserAudio();
      const mediaStream = await openBrowserMicrophone();
      const tokenResponse = await fetch("/api/realtime-token", { method: "POST" });
      const token = await readJsonResponse<{ value?: string; error?: string }>(tokenResponse, "Starting the voice session");
      if (!tokenResponse.ok || !token.value) throw new Error(token.error || "Could not start the voice session.");

      const searchSlots = tool({
        name: "search_slots",
        description: "Search the trusted clinic schedule using the caller's exact requested date, time window, and appointment type. Today is 2026-09-12 and next Tuesday is 2026-09-15. Times use 24-hour HH:mm. Never substitute Tuesday for today.",
        parameters: z.object({
          date: z.string().describe("Exact requested date in YYYY-MM-DD."),
          earliestTime: z.string().describe("Inclusive start of requested window in 24-hour HH:mm."),
          latestTime: z.string().describe("Exclusive end of requested window in 24-hour HH:mm."),
          appointmentType: z.enum(["Annual checkup", "Follow-up visit"]),
        }),
        execute: async (argumentsValue) => JSON.stringify(await callTool("search_slots", argumentsValue)),
      });
      const holdSlot = tool({
        name: "hold_slot",
        description: "Temporarily hold one slot selected from search_slots. Read back only the returned proposal details.",
        parameters: z.object({ slotId: z.string() }),
        execute: async (argumentsValue) => JSON.stringify(await callTool("hold_slot", argumentsValue)),
      });
      const confirmBooking = tool({
        name: "confirm_booking",
        description: "Commit the current proposal after the caller clearly confirms. The server checks the latest authoritative caller transcript and prevents duplicates.",
        parameters: z.object({ proposalId: z.string(), patientName: z.string().default("Asha Kumar") }),
        execute: async (argumentsValue) => {
          if (latestCallerRef.current) await recordTranscript(latestCallerRef.current);
          return JSON.stringify(await callTool("confirm_booking", argumentsValue));
        },
      });
      const createHandoff = tool({
        name: "create_handoff",
        description: "Create a receptionist handoff for medical advice, urgent, unsupported, uncertain, or failed requests.",
        parameters: z.object({ reason: z.string(), summary: z.string() }),
        execute: async (argumentsValue) => JSON.stringify(await callTool("create_handoff", argumentsValue)),
      });

      const agent = new RealtimeAgent({
        name: "Turno",
        instructions: voiceInstructions,
        tools: [searchSlots, holdSlot, confirmBooking, createHandoff],
      });
      const outputAudio = outputAudioRef.current;
      if (!outputAudio) throw new Error("The speaker output could not be initialized. Reload the page and try again.");
      outputAudio.autoplay = true;
      outputAudio.muted = false;
      outputAudio.volume = 1;
      const transport = new OpenAIRealtimeWebRTC({ mediaStream, audioElement: outputAudio });
      const session = new RealtimeSession(agent, { transport, model: REALTIME_MODEL });
      session.on("history_updated", (history) => {
        const lines: TranscriptLine[] = history
          .filter((item) => item.type === "message")
          .map((item) => {
            const text = item.content.map((part) => "transcript" in part ? part.transcript || "" : "text" in part ? part.text : "").join(" ").trim();
            return { id: item.itemId || crypto.randomUUID(), role: item.role === "user" ? "caller" as const : "assistant" as const, text };
          })
          .filter((line) => Boolean(line.text));
        setTranscript(lines);
        const latestCaller = [...lines].reverse().find((line) => line.role === "caller");
        if (latestCaller) latestCallerRef.current = latestCaller;
        for (const line of lines) void recordTranscript(line).catch(() => undefined);
      });
      session.on("transport_event", (event) => {
        if (event.type === "input_audio_buffer.speech_started") setVoicePhase("hearing");
        if (event.type === "input_audio_buffer.speech_stopped") setVoicePhase("thinking");
        if (event.type === "conversation.item.input_audio_transcription.completed") setVoicePhase("thinking");
      });
      session.on("agent_tool_start", () => setVoicePhase("thinking"));
      session.on("audio_start", () => setVoicePhase("speaking"));
      session.on("audio_stopped", () => setVoicePhase("listening"));
      session.on("error", (event) => {
        setNotice(String((event as { error?: unknown }).error || event));
        setCallStatus("error");
        setVoicePhase("idle");
      });
      await session.connect({ apiKey: token.value });
      sessionRef.current = session;
      transportRef.current = transport;
      setCallStatus("live");
      setVoicePhase("listening");
      setNotice("Microphone is live. Speak normally and watch the green input meter move.");
      void outputAudio.play().catch(() => {
        setNotice("Microphone is live. If you do not hear Turno, press Play on the speaker control below.");
      });
      transport.requestResponse({ instructions: "Greet the caller in one short English sentence, say you are Turno from Harbor Clinic, and ask how you can help." });
    } catch (error) {
      sessionRef.current?.close();
      sessionRef.current = null;
      transportRef.current = null;
      stopBrowserAudio();
      setNotice(error instanceof Error ? error.message : String(error));
      setCallStatus("error");
    }
  }, [callTool, openBrowserMicrophone, recordTranscript, stopBrowserAudio]);

  const disconnectVoice = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    transportRef.current = null;
    stopBrowserAudio();
    setCallStatus("ready");
    setVoicePhase("idle");
    setMicrophoneStatus("unchecked");
  }, [stopBrowserAudio]);

  const testSpeaker = useCallback(() => {
    const transport = transportRef.current;
    if (!transport) return;
    setVoicePhase("thinking");
    setNotice("Speaker test sent. Turno should answer aloud in a moment.");
    void outputAudioRef.current?.play().catch(() => {
      setNotice("Press Play on the speaker control, then press Test speaker again.");
    });
    transport.requestResponse({ instructions: "Reply aloud with exactly: Turno audio test successful." });
  }, []);

  const runGuidedDemo = useCallback(async () => {
    setDemoBusy(true);
    setNotice(null);
    try {
      await reset();
      setCallStatus("demo");
      await addLine("caller", "Namaste, mujhe Dr. Ruiz ke saath next Tuesday afternoon appointment chahiye, lekin teen baje ke baad nahi.");
      await pause(450);
      await callTool("search_slots", { date: "2026-09-15", earliestTime: "12:00", latestTime: "15:00", appointmentType: "Follow-up visit" });
      await addLine("assistant", "Ji. Mere paas afternoon mein kuch real available times hain.");
      await pause(450);
      await addLine("caller", "Actually, do baje ke baad chahiye—but before three.");
      await pause(350);
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
      await pause(500);
      await callTool("confirm_booking", { proposalId: proposal.proposalId, patientName: "Asha Kumar" });
      setNotice("Reliability demo complete: correction applied, ambiguity blocked, and retry returned one booking.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setCallStatus("error");
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
      setCallStatus("demo");
      await addLine("caller", "Please book the 2:15 appointment.");
      const held = await callTool("hold_slot", { slotId: "slot-1415" });
      if (!held.ok) throw new Error(held.message);
      const proposal = held.proposal as { proposalId: string };
      await addLine("assistant", "I have held 2:15 PM. Would you like me to book it?");
      await simulateConflict();
      await addLine("caller", "Yes, please book it.");
      const conflict = await callTool("confirm_booking", { proposalId: proposal.proposalId, patientName: "Asha Kumar" });
      if (conflict.ok) throw new Error("Expected the controlled conflict to block the booking.");
      await addLine("assistant", "I’m sorry, that slot was just taken. I’ll check the current schedule.");
      const recovered = await callTool("search_slots", { date: "2026-09-15", earliestTime: "14:00", latestTime: "15:00", appointmentType: "Follow-up visit" });
      if (!recovered.ok) throw new Error(recovered.message);
      const recoveredSlots = recovered.slots as Slot[];
      if (!recoveredSlots[0]) throw new Error("No recovery slot remained in the demo schedule.");
      await addLine("assistant", `I found another real opening at ${timeLabel(recoveredSlots[0].startsAt)}.`);
      setNotice("Conflict recovery proven: no false success was shown, and Turno offered new current availability.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setCallStatus("error");
    } finally {
      setDemoBusy(false);
      await refresh();
    }
  }, [addLine, callTool, refresh, reset, simulateConflict]);

  const runHandoffDemo = useCallback(async () => {
    setDemoBusy(true);
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

  const activeBooking = snapshot?.bookings.find((booking) => booking.conversationId === CONVERSATION_ID) || null;
  const events = snapshot?.events.filter((event) => event.conversationId === CONVERSATION_ID || event.conversationId === "system").slice(-9).reverse() || [];
  const statusText = callStatus === "live" ? "Live" : callStatus === "connecting" ? "Connecting" : callStatus === "demo" ? "Guided demo" : callStatus === "error" ? "Needs attention" : "Ready";
  const voicePhaseText = voicePhase === "hearing" ? "Hearing you…" : voicePhase === "thinking" ? "Thinking…" : voicePhase === "speaking" ? "Turno is speaking" : "Microphone connected";

  return (
    <main className="shell">
      <CopilotBridge snapshot={snapshot} reset={reset} simulateConflict={simulateConflict} />
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">T</span><div><strong>Turno</strong><span>Clinic voice operations</span></div></div>
        <div className="system-status"><i /> Server safeguards active</div>
      </header>

      <section className="workspace" aria-label="Turno receptionist workspace">
        <aside className="call-panel">
          <div className="section-label">Live call</div>
          <div className="caller-row">
            <div className="caller-avatar">AK</div>
            <div><h1>Appointment call</h1><p>Browser · Hindi + English</p></div>
            <span className={`call-state call-state-${callStatus}`}>{statusText}</span>
          </div>

          <div className={`voice-stage voice-stage-${callStatus}`}>
            <div className="voice-orbit" aria-hidden="true"><span className="voice-core" /><span className="voice-ring voice-ring-one" /><span className="voice-ring voice-ring-two" /></div>
            <p>{callStatus === "live" ? voicePhaseText : callStatus === "connecting" ? "Opening a secure call" : callStatus === "demo" ? "Showing the reliable flow" : "Turno is ready to listen"}</p>
            <span>{callStatus === "live" ? (voicePhase === "listening" ? "Say your request now. This label changes when Turno detects speech." : "The conversation and trusted activity will update below.") : `Voice uses ${REALTIME_MODEL}. The guided demo works without an API key.`}</span>
            {(callStatus === "connecting" || callStatus === "live") && (
              <div className="microphone-check" aria-live="polite">
                <div><i className={`microphone-dot microphone-dot-${microphoneStatus}`} /><strong>{microphoneStatus === "checking" ? "Checking microphone" : microphoneStatus === "ready" ? microphoneName : "Microphone not ready"}</strong></div>
                <div className="microphone-meter" aria-label={`Microphone input level ${microphoneLevel} percent`}><span style={{ width: `${microphoneLevel}%` }} /></div>
                <small>Speak and confirm the green bar moves</small>
              </div>
            )}
          </div>

          {callStatus === "live" ? (
            <div className="live-call-actions"><button className="start-call end-call" type="button" onClick={disconnectVoice}>End voice call</button><button className="speaker-test" type="button" onClick={testSpeaker}>Test speaker</button></div>
          ) : (
            <button className="start-call" type="button" onClick={connectVoice} disabled={callStatus === "connecting" || demoBusy}><span className="phone-icon" aria-hidden="true">●</span>{callStatus === "connecting" ? "Connecting…" : "Start voice call"}</button>
          )}
          <audio ref={outputAudioRef} className={callStatus === "live" ? "call-audio call-audio-live" : "call-audio"} autoPlay playsInline controls aria-label="Turno speaker output" />
          <button className="demo-button" type="button" onClick={runGuidedDemo} disabled={demoBusy || callStatus === "live"}>{demoBusy ? "Running proof…" : "Run guided reliability demo"}</button>
          <div className="language-row" aria-label="Supported languages"><span>हिंदी</span><span>English</span><span>Español</span></div>

          {notice && <div className="notice" role="status">{notice}</div>}

          <section className="transcript-card">
            <div className="card-heading"><h2>Conversation</h2><span>{transcript.length ? `${transcript.length} turns` : "Waiting"}</span></div>
            {transcript.length ? (
              <div className="transcript-list">{transcript.slice(-7).map((line) => <article className={`transcript-line transcript-${line.role}`} key={line.id}><strong>{line.role === "caller" ? "Caller" : "Turno"}</strong><p>{line.text}</p></article>)}</div>
            ) : (
              <div className="empty-transcript"><span className="quote-mark">“</span><p>The live transcript and corrections will appear here.</p></div>
            )}
          </section>
        </aside>

        <section className="operations">
          <div className="operations-head">
            <div><div className="section-label">Receptionist view</div><h2>Tuesday, September 15</h2><p>Dr. Elena Ruiz · Harbor Clinic · Synthetic demo data</p></div>
            <button type="button" className="quiet-button" onClick={reset} disabled={demoBusy}>Reset demo</button>
          </div>

          <div className="proof-strip">
            <div className={snapshot?.events.some((event) => event.type === "transcript") ? "proof-active" : ""}><span>01</span><strong>Listen</strong><small>Natural voice</small></div>
            <div className={snapshot?.events.some((event) => event.type === "search") ? "proof-active" : ""}><span>02</span><strong>Verify</strong><small>Real availability</small></div>
            <div className={snapshot?.reliability.ambiguityCaught ? "proof-active" : ""}><span>03</span><strong>Confirm</strong><small>Explicit yes</small></div>
            <div className={activeBooking ? "proof-active" : ""}><span>04</span><strong>Commit</strong><small>Exactly once</small></div>
          </div>

          {activeBooking && <div className="booking-banner"><div><span>Appointment confirmed</span><strong>{activeBooking.id}</strong></div><p>Persisted once · confirmation evidence recorded</p></div>}

          <div className="operation-grid">
            <section className="calendar-card">
              <div className="card-heading"><h2>Afternoon schedule</h2><span>{snapshot?.slots.length || 0} slots</span></div>
              <div className="slot-list">
                {(snapshot?.slots || []).map((slot) => (
                  <div className={`slot slot-${slot.status}`} key={slot.id}>
                    <time>{timeLabel(slot.startsAt)}</time>
                    <div><strong>{slot.patientName || slot.appointmentType}</strong><span>{slot.status === "held" && slot.heldBy === CONVERSATION_ID ? "Held for this caller" : slot.status}</span></div>
                    <b>{slot.status === "available" ? "Open" : slot.status === "held" ? "Held" : "Booked"}</b>
                  </div>
                ))}
              </div>
            </section>

            <section className="evidence-card">
              <div className="card-heading"><h2>Safety evidence</h2><span>Live</span></div>
              <div className="evidence-list">
                <article><i className="evidence-ok" /><div><strong>No booking without confirmation</strong><p>Server-enforced boundary</p></div></article>
                <article><i className={snapshot?.reliability.retryBlocked ? "evidence-ok" : "evidence-idle"} /><div><strong>Duplicate protection</strong><p>{snapshot?.reliability.retryBlocked ? "Retry returned the same booking" : "Ready to prove exactly once"}</p></div></article>
                <article><i className={snapshot?.reliability.conflictRecovered ? "evidence-ok" : "evidence-idle"} /><div><strong>Conflict recovery</strong><p>{snapshot?.reliability.conflictRecovered ? "New real availability offered" : "No false success on lost slots"}</p></div></article>
                <article><i className={snapshot?.reliability.handoffCreated ? "evidence-ok" : "evidence-idle"} /><div><strong>Human handoff</strong><p>{snapshot?.reliability.handoffCreated ? "Unsupported request escalated" : "No invented medical answers"}</p></div></article>
              </div>
              <div className="evidence-actions"><button type="button" onClick={runConflictDemo} disabled={demoBusy || callStatus === "live"}>Prove conflict recovery</button><button type="button" onClick={runHandoffDemo} disabled={demoBusy || callStatus === "live"}>Create safe handoff</button></div>
            </section>
          </div>

          <section className="activity-card">
            <div className="card-heading"><h2>Trusted activity</h2><span>Server events only</span></div>
            {events.length ? <div className="activity-list">{events.map((event) => <article key={event.id}><span className={`event-dot event-${event.type}`} /><time>{new Date(event.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time><strong>{eventLabel(event)}</strong><p>{event.message}</p></article>)}</div> : <div className="activity-empty"><span>Waiting for the first call</span><p>Searches, holds, confirmations, bookings, retries, and handoffs will be recorded here.</p></div>}
          </section>
        </section>
      </section>
    </main>
  );
}
