import OpenAI from "openai";
import WebSocket from "ws";
import { REALTIME_MODEL, REALTIME_VOICE } from "@/lib/realtime-config";
import { chooseReplyLanguage, replyLanguageInstruction, type ReplyLanguage } from "@/lib/language-style";
import { realtimeToolDefinitions } from "@/lib/server/realtime-tools";
import { parseAndExecuteTurnoTool } from "@/lib/server/turno-tools";
import { getTurnoStore } from "@/lib/server/turno-store";
import { phoneVoiceInstructions } from "@/lib/voice-instructions";

const PHONE_CONVERSATION_ID = process.env.PHONE_CONVERSATION_ID || "browser-demo";
const TRANSCRIPT_WAIT_MS = 3_000;

type PhoneCallState = "accepting" | "connecting" | "connected" | "closed" | "failed";

type PhoneCallRecord = {
  state: PhoneCallState;
  startedAt: string;
  socket?: WebSocket;
};

type RealtimeEvent = {
  type?: string;
  event_id?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  transcript?: string;
  languages?: Array<{ code?: string }>;
  error?: { message?: string };
};

const globalForPhone = globalThis as unknown as { turnoPhoneCalls?: Map<string, PhoneCallRecord> };
const phoneCalls = globalForPhone.turnoPhoneCalls ?? new Map<string, PhoneCallRecord>();
globalForPhone.turnoPhoneCalls = phoneCalls;

function requireApiKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  return apiKey;
}

function send(socket: WebSocket, event: Record<string, unknown>) {
  if (socket.readyState !== WebSocket.OPEN) throw new Error("The phone sideband connection is not open.");
  socket.send(JSON.stringify(event));
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown phone integration error";
}

function attachPhoneSideband(callId: string, apiKey: string) {
  const store = getTurnoStore();
  const record = phoneCalls.get(callId);
  if (!record) return;

  const socket = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  record.socket = socket;
  record.state = "connecting";

  let lastCallerTranscriptAt = 0;
  let lastAssistantTranscriptAt = 0;
  let callerTranscriptVersion = 0;
  let replyLanguage: ReplyLanguage = "English";
  let greetingSent = false;
  let toolQueue = Promise.resolve();

  const waitForConfirmationTranscript = async () => {
    if (lastCallerTranscriptAt > lastAssistantTranscriptAt) return;
    const initialVersion = callerTranscriptVersion;
    const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (callerTranscriptVersion > initialVersion || lastCallerTranscriptAt > lastAssistantTranscriptAt) return;
    }
  };

  const runTool = async (event: RealtimeEvent) => {
    if (!event.call_id || !event.name) return;
    if (event.name === "confirm_booking") await waitForConfirmationTranscript();

    let argumentsValue: unknown = null;
    try {
      argumentsValue = JSON.parse(event.arguments || "null");
    } catch {
      // The shared validation layer returns a typed error for malformed arguments.
    }

    const result = parseAndExecuteTurnoTool({
      conversationId: PHONE_CONVERSATION_ID,
      tool: event.name,
      arguments: argumentsValue,
    });

    send(socket, {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: event.call_id,
        output: JSON.stringify(result),
      },
    });
    send(socket, {
      type: "response.create",
      response: { instructions: replyLanguageInstruction(replyLanguage, "Continue after the completed clinic tool action.") },
    });
  };

  socket.on("open", () => {
    record.state = "connected";
    store.recordCallStatus(PHONE_CONVERSATION_ID, "Phone audio connected through Twilio and OpenAI SIP.", { channel: "phone" });
    send(socket, {
      type: "session.update",
      session: {
        type: "realtime",
        instructions: phoneVoiceInstructions,
        output_modalities: ["audio"],
        parallel_tool_calls: false,
        tools: realtimeToolDefinitions,
        tool_choice: "auto",
        reasoning: { effort: "minimal" },
        max_output_tokens: 600,
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            transcription: {
              model: "gpt-transcribe",
              languages: ["en", "hi", "es"],
              prompt: "Harbor Clinic appointment scheduling with Dr. Elena Ruiz. The caller may speak English, Hindi, Spanish, or mix Hindi and English.",
            },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "low",
              create_response: false,
              interrupt_response: true,
            },
          },
          output: { voice: REALTIME_VOICE },
        },
      },
    });
  });

  socket.on("message", (data) => {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(data.toString()) as RealtimeEvent;
    } catch {
      return;
    }

    if (event.type === "session.updated" && !greetingSent) {
      greetingSent = true;
      send(socket, {
        type: "response.create",
        response: {
          instructions: "Say exactly: Thank you for calling Harbor Clinic. I'm Turno. How can I help? Do not add anything else.",
        },
      });
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript?.trim()) {
      lastCallerTranscriptAt = Date.now();
      callerTranscriptVersion += 1;
      replyLanguage = chooseReplyLanguage(event.transcript, event.languages, replyLanguage);
      store.recordTranscript(PHONE_CONVERSATION_ID, `phone-caller-${event.item_id || event.event_id}`, "caller", event.transcript);
      send(socket, {
        type: "response.create",
        response: { instructions: replyLanguageInstruction(replyLanguage, event.transcript) },
      });
      return;
    }

    if (event.type === "response.output_audio_transcript.done" && event.transcript?.trim()) {
      lastAssistantTranscriptAt = Date.now();
      store.recordTranscript(PHONE_CONVERSATION_ID, `phone-assistant-${event.item_id || event.event_id}`, "assistant", event.transcript);
      return;
    }

    if (event.type === "response.function_call_arguments.done") {
      toolQueue = toolQueue.then(() => runTool(event)).catch((error) => {
        store.recordCallStatus(PHONE_CONVERSATION_ID, "A phone tool failed safely; no unverified action was reported.", {
          channel: "phone",
          error: safeErrorMessage(error).slice(0, 180),
        });
        if (event.call_id && socket.readyState === WebSocket.OPEN) {
          send(socket, {
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: event.call_id,
              output: JSON.stringify({ ok: false, code: "INVALID_REQUEST", message: "The clinic system could not complete that action. Please apologize and create a handoff.", recoverable: false }),
            },
          });
          send(socket, {
            type: "response.create",
            response: { instructions: replyLanguageInstruction(replyLanguage, "Continue after the failed clinic tool action.") },
          });
        }
      });
      return;
    }

    if (event.type === "error") {
      store.recordCallStatus(PHONE_CONVERSATION_ID, "OpenAI reported a phone-session error.", {
        channel: "phone",
        error: (event.error?.message || "Unknown session error").slice(0, 180),
      });
    }
  });

  socket.on("error", (error) => {
    record.state = "failed";
    store.recordCallStatus(PHONE_CONVERSATION_ID, "The secure phone control connection failed.", {
      channel: "phone",
      error: safeErrorMessage(error).slice(0, 180),
    });
  });

  socket.on("close", () => {
    const latest = phoneCalls.get(callId);
    if (latest) latest.state = "closed";
    store.recordCallStatus(PHONE_CONVERSATION_ID, "Phone call ended.", { channel: "phone" });
    phoneCalls.delete(callId);
  });
}

export async function acceptIncomingPhoneCall(callId: string) {
  const existing = phoneCalls.get(callId);
  if (existing && !["closed", "failed"].includes(existing.state)) {
    return { accepted: true as const, duplicate: true, state: existing.state };
  }

  const apiKey = requireApiKey();
  const startedAt = new Date().toISOString();
  phoneCalls.set(callId, { state: "accepting", startedAt });
  const store = getTurnoStore();
  store.recordCallStatus(PHONE_CONVERSATION_ID, "Incoming phone call received. Turno is answering.", { channel: "phone" });

  try {
    const client = new OpenAI({ apiKey });
    await client.realtime.calls.accept(callId, {
      type: "realtime",
      model: REALTIME_MODEL,
      instructions: phoneVoiceInstructions,
      output_modalities: ["audio"],
      audio: {
        output: { voice: REALTIME_VOICE },
      },
    });
    attachPhoneSideband(callId, apiKey);
    return { accepted: true as const, duplicate: false, state: "connecting" as const };
  } catch (error) {
    const record = phoneCalls.get(callId);
    if (record) record.state = "failed";
    store.recordCallStatus(PHONE_CONVERSATION_ID, "The incoming phone call could not be answered.", {
      channel: "phone",
      error: safeErrorMessage(error).slice(0, 180),
    });
    throw error;
  }
}

export function phoneIntegrationStatus() {
  return {
    enabled: process.env.TELEPHONY_ENABLED === "true",
    configured: Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_WEBHOOK_SECRET?.trim()),
    model: REALTIME_MODEL,
    voice: REALTIME_VOICE,
    activeCalls: [...phoneCalls.values()].filter((record) => !["closed", "failed"].includes(record.state)).length,
    conversationId: PHONE_CONVERSATION_ID,
  };
}
