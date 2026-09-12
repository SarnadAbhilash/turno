# Turno Build Specification

## Product in plain English

Turno answers a clinic call, speaks with the caller, checks a real demo schedule, and safely books an appointment. The browser is both the caller's voice interface and the receptionist's live screen.

## Customer and users

Turno is built for a small outpatient clinic that receives appointment-booking calls.

| Role | Who they are | Value they receive |
| --- | --- | --- |
| Customer | The clinic or medical practice | Fewer unanswered calls, less repetitive scheduling work, dependable records, and clear handoffs |
| Caller | A patient scheduling an annual checkup or follow-up | Natural voice booking in Hindi, English, Spanish, or a mix, with clear readback and correction |
| Staff user | The clinic receptionist | A live view of the conversation, tools, calendar, booking result, audit trail, and requests needing human help |

The clinic is the likely buyer. The patient is the end user of the voice experience. The receptionist supervises the workflow and handles exceptions.

Turno is a scheduling receptionist, not a medical assistant. Medical advice, diagnosis, treatment recommendations, triage, and insurance decisions are outside the product boundary and must be handed to a person.

## What makes the project different

Voice, tool calling, and multilingual conversation are useful foundations, but they are not the final product claim. Turno demonstrates a reliability layer around a non-deterministic voice model.

The key question is:

> Can the agent still complete the correct transaction when the caller interrupts, changes a constraint, gives an unclear answer, repeats confirmation, or loses the selected slot?

Turno must provide visible and testable evidence that the answer is yes. The voice assistant owns conversation; deterministic server code owns consequential state changes.

## System map

```text
Caller
  -> Browser microphone
  -> Realtime voice assistant
  -> Server tool bridge
  -> Validation and conversation state
  -> Scheduling engine
  -> SQLite database
  -> Trusted event stream
  -> Receptionist dashboard

Optional phone number -> SIP -> same Realtime assistant and server tools
Optional clinic search -> validation gate -> allowlisted Exa search -> cited answer
```

## Components and connections

### 1. Browser call controls

- **Input from:** Caller clicks and microphone audio; server session details.
- **Output to:** Realtime receives audio; caller receives spoken audio; event stream receives call status.
- **Can be built with:** A mocked Realtime session.

### 2. Realtime voice assistant

- **Input from:** Browser or optional phone audio; server instructions; tool results.
- **Output to:** Caller audio, tool requests, transcripts, and agent status.
- **Can be built with:** Mock tool results.

### 3. Server tool bridge

- **Input from:** Realtime tool name, arguments, tool-call ID, and conversation ID.
- **Output to:** Validation gate receives a normalized request; Realtime receives one matching result; event stream receives tool activity.
- **Can be built with:** Saved Realtime tool-call fixtures and a mock backend.

### 4. Validation and conversation state

- **Input from:** Tool bridge requests, stored conversation state, and authoritative final caller transcript events.
- **Output to:** Scheduling commands, clarification requests, safety decisions, optional approved searches, structured results, and audit events.
- **Can be built with:** Mock scheduling results and transcript fixtures.
- **Reliability rule:** Confirmation is valid only when it refers to the current `proposalId` and its transcript evidence is clearly affirmative. An old proposal or ambiguous reply cannot advance to booking.

### 5. Scheduling engine

- **Input from:** Validated search, hold, confirm, commit, and handoff commands.
- **Output to:** Available slots, hold tokens, canonical readbacks, bookings, handoffs, or typed errors such as `SLOT_UNAVAILABLE` and `HOLD_EXPIRED`.
- **Can be built with:** An in-memory repository before SQLite is ready.
- **Reliability rule:** A retry with the same idempotency key returns the existing booking. A conflict or expired hold returns to search/recovery and never reports false success.

### 6. SQLite repositories

- **Input from:** Trusted scheduling and state operations.
- **Output to:** Records, conflicts, committed transactions, and stored state.
- **Can be built with:** Direct integration tests; no voice or UI is needed.

### 7. Trusted events and snapshots

- **Input from:** Call, transcript, tool, state, hold, booking, handoff, and audit events.
- **Output to:** Ordered dashboard events and a reloadable current-state snapshot.
- **Can be built with:** A set of example event fixtures.

### 8. Receptionist dashboard

- **Input from:** Event fixtures or the live event stream.
- **Output to:** Visible transcript, call state, tool activity, calendar, proposal, booking, handoff, and audit trail.
- **Can be built with:** Static fixture playback.
- **Reliability proof:** Make correction, clarification, confirmation, retry/deduplication, conflict recovery, and handoff events understandable without reading logs.

### 9. Safety and human handoff

- **Input from:** Caller request, conversation state, proposed action, and failures.
- **Output to:** Continue, clarify, refuse medical guidance, or create a receptionist handoff.
- **Can be built with:** A table of allowed and unsupported example requests.

### 10. Seeds, reset, tests, and evaluations

- **Input from:** Component contracts and scripted scenarios.
- **Output to:** Known demo state, reusable fixtures, and readable pass/fail results.
- **Can be built with:** Every documented contract, even before implementations exist.

### 11. Optional clinic-information search

- **Input from:** An approved administrative question, language, and allowlisted domains.
- **Output to:** A concise answer with source URLs, or a no-answer/handoff result.
- **Restriction:** Never answer medical, insurance, or availability questions through search.

### 12. Optional deployment

- **Input from:** The working application and environment configuration.
- **Output to:** A public origin, health endpoint, and optional webhook URL.
- **Restriction:** Keep local execution available as a fallback.

### 13. Optional inbound phone adapter

- **Input from:** A call to a dedicated demo number and a verified incoming-call webhook.
- **Output to:** The same Realtime session, tool bridge, events, and dashboard used by browser calls.
- **Restriction:** No separate scheduling logic and no stored caller phone numbers.

## Golden demonstration

1. Start the browser call.
2. Request an appointment in Hindi-English.
3. Correct the time constraint while talking.
4. Turno searches seeded availability and offers a slot.
5. Turno holds it and reads back every important detail.
6. Give an ambiguous response such as “that might work.” Turno asks for a clear answer and creates no booking.
7. Clearly confirm. The database creates one booking and the calendar updates.
8. Repeat confirmation or replay the commit. The same booking ID returns and no duplicate appears.
9. Show a prepared slot-conflict scenario: the hold is lost, Turno explains the problem, searches again, and offers a new real slot.
10. Ask one unsupported question and show a safe human handoff.

The live presentation may show the correction, ambiguity, and exactly-once path, then show conflict recovery and handoff as fast prepared scenarios or deterministic test results if time is limited.

## Reliability acceptance scenarios

### A. Correction survives code-switching

- Start with a Hindi-English time constraint.
- Interrupt and replace it with a different constraint.
- Assert that offered slots match only the latest constraint.
- Show the correction event on the dashboard.

### B. Ambiguous confirmation cannot book

- Create and hold a proposal.
- Respond with “maybe,” “I think so,” or “that might work.”
- Assert that no booking row exists.
- Turno must ask a short clarification question.

### C. Confirmation is tied to the current proposal

- Confirming an old or replaced `proposalId` returns `STALE_PROPOSAL`.
- The server looks up the authoritative final transcript by event ID; it does not trust confirmation text supplied by the model.
- A successful confirmation records the proposal ID and transcript event ID in the audit trail.

### D. A retry books exactly once

- Send the same commit twice with the same idempotency key.
- Both responses return the same booking ID.
- The database contains one booking and the dashboard shows one appointment.

### E. A slot conflict recovers honestly

- Invalidate or take the held slot immediately before commit.
- Commit returns `SLOT_UNAVAILABLE` or `HOLD_EXPIRED`.
- No success event is published.
- Turno apologizes, searches current availability, and offers a different slot.

### F. Uncertain work becomes a handoff

- Ask for medical advice or trigger a controlled tool failure.
- Turno does not invent an answer or claim success.
- A concise handoff appears in the receptionist view with the reason and conversation summary.

## Completion priorities

### Required

- Browser voice conversation
- Search, hold, readback, confirm, and exactly-once booking
- Hindi-English live path
- Visible calendar, tool activity, and audit history
- One safe handoff path
- Deterministic reliability tests

### Add only when stable

- Live Spanish demonstration
- Exa administrative search with citations
- Public deployment
- Real inbound phone number
