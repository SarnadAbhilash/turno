# Turno Team Guide

## Quick pitch

> Turno is a multilingual voice receptionist for a fictional clinic. A caller speaks naturally, changes their mind, hears real available times, and confirms an appointment. The AI manages the conversation, while normal server code controls the booking and prevents unsafe or duplicate actions.

## What to tell someone who wants to join

> We are building one connected product. The browser voice flow is the main demonstration. Every part has a clear input and output, so you can choose an area that matches your strengths and work with mocks while other parts are being built. Please pick one useful outcome you can demonstrate, document its contract, and keep the main path runnable.

Ask the new teammate:

- What can you build fastest: voice, backend, frontend, testing, deployment, retrieval, or phone integration?
- Which component in `BUILD_SPEC.md` would you like to own or pair on?
- What small proof can you show before connecting it to the complete app?

## Ways to divide the work

- **Voice:** Browser audio, Realtime connection, transcripts, interruptions, and tool requests.
- **Backend:** Validation, state, scheduling, SQLite, confirmation, duplicate prevention, and handoff.
- **Interface:** Event stream, calendar, transcript, cards, and audit view.
- **Quality:** Seeds, reset, fixtures, deterministic tests, and multilingual scenarios.
- **Optional additions:** Exa, deployment, and phone/SIP.

This is not a fixed assignment chart. One person may combine areas, several people may split an area, and teammates may pair. Nobody should wait for another component: use the contracts and mocks in the build specification.

## How to proceed

1. Read `README.md`, `AGENTS.md`, and `docs/BUILD_SPEC.md`.
2. Agree on the shared types and one realistic fixture for each boundary.
3. Choose an outcome and say which inputs you expect and outputs you will provide.
4. Build the smallest runnable proof against mocks.
5. Add or update tests for the behavior you own.
6. Connect two components at a time and integrate frequently.
7. Keep the complete browser path working after every merge.
8. Add optional integrations only when they cannot endanger the core demo.

## What to hand back

- Short summary of the result
- Files changed
- How to run it
- Input and output contract
- Example fixture or mock
- Tests run and results
- New environment variables
- Known limitation
- Recommended next integration step

## Shared finish line

The team is finished when a judge can hear a real multilingual conversation, see a correction handled, watch a real slot become booked exactly once after confirmation, and see an uncertain request become a safe human handoff.
