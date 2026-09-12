# Turno

Turno is a multilingual voice receptionist for a fictional clinic. A caller can speak in Hindi, English, Spanish, or a mix; interrupt the assistant; correct appointment details; hear available times; and confirm a booking.

The central engineering idea is simple:

> The AI handles the conversation. Normal, testable software controls the booking.

## What the demo should prove

- A caller has a natural voice conversation in the browser.
- Turno understands a correction made during the conversation.
- Availability comes from the scheduling service, not from the model.
- Turno reads back the full appointment and waits for a clear confirmation.
- The booking is stored exactly once, even if confirmation is repeated.
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
