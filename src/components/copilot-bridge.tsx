"use client";

import { useEffect, useRef } from "react";
import { useAgentContext, useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { DashboardSnapshot } from "@/lib/domain";

export function CopilotBridge({
  snapshot,
  reset,
  simulateConflict,
}: {
  snapshot: DashboardSnapshot | null;
  reset: () => Promise<unknown>;
  simulateConflict: () => Promise<unknown>;
}) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const reportRegistrationError = (error: unknown) => console.warn("Turno WebMCP registration failed", error);

    const registrations = [
      context.registerTool(
        {
          name: "read_turno_workspace",
          title: "Read Turno workspace",
          description: "Read the currently visible synthetic schedule, booking, handoff, and reliability state without changing it.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute: async () => snapshotRef.current ? {
            status: snapshotRef.current.status,
            slots: snapshotRef.current.slots.map(({ id, startsAt, appointmentType, status }) => ({ id, startsAt, appointmentType, status })),
            bookingIds: snapshotRef.current.bookings.map(({ id }) => id),
            openHandoffIds: snapshotRef.current.handoffs.map(({ id }) => id),
            reliability: snapshotRef.current.reliability,
          } : { status: "loading" },
        },
        { signal: lifecycle.signal },
      ),
      context.registerTool(
        {
          name: "reset_turno_demo",
          title: "Reset Turno demo",
          description: "Reset only Turno's synthetic demo schedule and activity to its known starting state.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async () => {
            await reset();
            return { ok: true, status: "reset" };
          },
        },
        { signal: lifecycle.signal },
      ),
      context.registerTool(
        {
          name: "simulate_turno_slot_conflict",
          title: "Simulate Turno slot conflict",
          description: "Take the currently held synthetic slot as another caller so Turno's honest recovery path can be demonstrated.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async () => simulateConflict(),
        },
        { signal: lifecycle.signal },
      ),
    ];
    for (const registration of registrations) void Promise.resolve(registration).catch(reportRegistrationError);
    return () => lifecycle.abort();
  }, [reset, simulateConflict]);

  useAgentContext({
    description:
      "The current Turno clinic receptionist workspace. This is trusted server state: appointment slots, current proposal, committed bookings, handoffs, and reliability evidence. The model cannot mutate this state directly.",
    value: snapshot ? JSON.parse(JSON.stringify(snapshot)) : null,
  });

  useFrontendTool(
    {
      name: "reset_turno_demo",
      description: "Reset Turno to its known synthetic clinic schedule. This deletes demo-only activity and never touches real data.",
      parameters: z.object({}),
      handler: async () => reset(),
    },
    [reset],
  );

  useFrontendTool(
    {
      name: "simulate_turno_slot_conflict",
      description: "After Turno holds a slot, simulate another caller taking it so conflict recovery can be demonstrated.",
      parameters: z.object({}),
      handler: async () => simulateConflict(),
    },
    [simulateConflict],
  );

  return null;
}
