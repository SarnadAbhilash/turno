# Turno

Turno is a multilingual voice receptionist for a fictional clinic. A caller can speak in Hindi, English, Spanish, or a mix; interrupt the assistant; correct appointment details; hear available times; and confirm a booking.

## Who it is for

Turno is built for a small outpatient clinic that receives appointment-booking calls.

- **Paying customer:** The clinic or medical practice.
- **End user:** A patient calling to schedule an annual checkup or follow-up visit.
- **Staff user:** A receptionist who monitors calls, confirmed appointments, and requests that need human help.

Patients get a simple voice experience in their preferred language. The clinic gets fewer unanswered calls, less repetitive scheduling work, reliable bookings, and clear human handoffs.

Turno is a scheduling receptionist, not a medical assistant. It does not diagnose symptoms, recommend treatment, perform triage, or make medical decisions.

The central engineering idea is simple:

> The AI handles the conversation. Normal, testable software controls the booking.

## What makes Turno different

A general-purpose voice agent can talk and call a calendar tool. Turno focuses on the harder problem: completing a consequential transaction safely when the caller interrupts, changes their mind, responds ambiguously, or causes the same action to be retried.

> Turno is a reliability layer for real-world voice transactions, demonstrated through appointment scheduling.

## What the demo should prove

- A caller has a natural voice conversation in the browser.
- Turno understands a correction made during the conversation.
- Availability comes from the scheduling service, not from the model.
- Turno reads back the full appointment and waits for a clear confirmation.
- An ambiguous response asks for clarification and cannot create a booking.
- The booking is stored exactly once, even if confirmation is repeated.
- If a held slot is lost, Turno explains the conflict and offers a new real slot.
- A receptionist dashboard shows the transcript, tool activity, calendar, booking, and audit trail.
- Unsupported or uncertain requests become a human handoff instead of a fabricated answer.

The browser voice experience is the main path. A real inbound phone number, cited clinic-information search, and public deployment are optional additions.

## Start here

- Coding agents: read [AGENTS.md](AGENTS.md).
- Builders: read [docs/BUILD_SPEC.md](docs/BUILD_SPEC.md).
- New teammates: read [docs/TEAM_GUIDE.md](docs/TEAM_GUIDE.md).

## Proposed stack

- TypeScript, Next.js, React, and Tailwind CSS
- OpenAI Realtime API over WebRTC
- CopilotKit for visible agent/application state
- Zod for runtime validation
- SQLite with `better-sqlite3`
- Vitest for deterministic tests
- Optional: Exa, Google Cloud Run, and an inbound SIP phone provider

## Status

The repository begins with the public build plan. Implementation is completed collaboratively during the hackathon.

## Safety and privacy

Turno is a fictional-clinic prototype. Use synthetic names and appointments only. Do not use real patient information, provide medical advice, record raw audio, or commit API keys.
