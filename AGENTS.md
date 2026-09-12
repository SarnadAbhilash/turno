# Contributor Instructions for Coding Agents

This file gives any coding agent enough context to contribute safely. It is a neutral repository guide, not a fixed assignment plan. Read `README.md` and `docs/BUILD_SPEC.md` before making a large architectural change.

## Product goal

Build Turno: a multilingual voice receptionist for a fictional clinic. The required experience is a browser voice conversation in Hindi, English, Spanish, or a mix. The caller can correct details, hear real seeded availability, confirm an appointment, and see the booking appear on a receptionist dashboard.

The model manages conversation. Trusted server code controls validation, availability, holds, confirmation, persistence, duplicate prevention, and audit history.

## Working principles

- Make useful progress with the information already in the repository.
- Work independently against documented mocks when another component is unfinished.
- Keep components replaceable and communicate through typed contracts.
- Prefer small, testable changes that leave the main demo runnable.
- If a shared contract changes, update its type, fixture, tests, and documentation together.
- Do not rewrite unrelated work or remove another contributor's changes.
- Never commit secrets, tokens, caller phone numbers, real patient data, or raw audio.

## Required product behavior

1. Start and end a browser voice session.
2. Accept Hindi, English, Spanish, and natural code-switching.
3. Search seeded appointment availability through a tool.
4. Allow interruptions and corrections before booking.
5. Hold the selected slot temporarily.
6. Read back provider, appointment type, full date, time, and location.
7. Require explicit confirmation before any booking write.
8. Store the booking exactly once.
9. Update the receptionist dashboard from trusted server events.
10. Create a human handoff for unsafe, unsupported, ambiguous, or failed requests.

## Non-negotiable safety rules

- The model cannot write directly to the database.
- A booking cannot happen without explicit confirmation tied to the current proposal.
- Repeated or retried confirmation cannot create a duplicate booking.
- A slot shown as booked in the UI must already be committed in the database.
- The assistant does not diagnose, triage, recommend treatment, or verify insurance.
- Use synthetic demo data only.
- Keep `OPENAI_API_KEY` and all other secrets on the server.

These rules protect correctness; they do not require contributors to wait. Use mocks and fixtures to continue building independently.

## Shared conventions

- Use TypeScript end to end.
- Validate external and tool payloads with Zod.
- Pass `conversationId`, `requestId`, and correlation IDs through unchanged.
- Use `hi`, `en`, and `es` as preferred-language codes. A transcript may contain more than one language.
- Store timestamps as ISO strings. Speak and display appointments in `America/Los_Angeles`.
- Every tool request returns exactly one structured success or typed error.
- Every successful state change emits an audit event.
- Browser and optional phone sessions use the same tools and booking gateway.

## Recommended source layout

```text
app/                  Next.js routes and pages
components/           Browser call controls and receptionist UI
lib/contracts/        Zod schemas and shared TypeScript types
lib/realtime/         Realtime session and tool bridge
lib/scheduling/       Search, hold, confirmation, and booking logic
lib/repositories/     SQLite access and transactions
lib/events/           Trusted events and dashboard snapshots
lib/safety/           Handoff and policy decisions
tests/                Unit, integration, and scripted scenario tests
scripts/              Seed, reset, and demo helpers
```

Adjust this layout if the chosen starter already has strong conventions. Preserve the boundaries rather than forcing exact folder names.

## Component contracts

The detailed inputs, outputs, and neighboring components are in `docs/BUILD_SPEC.md`. Keep these broad boundaries:

- Browser call sends audio to Realtime and receives audio from Realtime.
- Realtime requests tools through the server-side tool bridge.
- The validation gate sends approved commands to the scheduling engine.
- The scheduling engine changes state only through the repository layer.
- The event layer publishes committed truth to the dashboard.
- Safety logic can ask for clarification or create a human handoff.
- Optional Exa and phone adapters cannot bypass the validation gate.

## Testing expectations

Add or preserve tests for the behavior a change affects. The minimum deterministic suite should prove:

- search returns only seeded available slots;
- a held slot cannot be taken by another booking;
- ambiguous or missing confirmation cannot book;
- a changed proposal invalidates old confirmation;
- retrying the same commit returns the existing booking;
- competing commits create at most one booking;
- failed persistence never appears as success in the UI;
- unsafe or unsupported requests create a handoff.

Also keep scripted multilingual scenarios for English, Spanish-English, Devanagari Hindi, and Romanized Hindi/Hinglish.

## Optional work

Exa retrieval, deployment, and real-phone/SIP calling may be developed independently behind configuration flags. They must not replace or destabilize the required browser path. Retrieval is limited to allowlisted, public, administrative clinic information and must return visible sources.

## Handing work to another contributor

For each contribution, state:

- what changed;
- how to run it;
- its input and output;
- which fixture or mock demonstrates it;
- which tests passed;
- any new environment variables;
- the next integration step.

## Definition of done

A change is done when another contributor can run it, understand its contract, and verify it without needing private chat history.
