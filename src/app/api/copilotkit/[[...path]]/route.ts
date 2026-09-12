import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const copilotRuntime = new CopilotRuntime({
  agents: () => ({
    default: new BuiltInAgent({
      model: process.env.COPILOTKIT_MODEL || "openai:gpt-5.6-luna",
      prompt: "You assist a clinic receptionist by explaining the trusted Turno state. Never claim an appointment was booked unless a committed booking ID is present. Never give medical advice.",
      maxSteps: 6,
    }),
  }),
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
