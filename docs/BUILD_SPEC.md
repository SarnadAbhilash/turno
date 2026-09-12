# Turno Build Specification

## Product in plain English

Turno answers a clinic call, speaks with the caller, checks a real demo schedule, and safely books an appointment. The browser is both the caller's voice interface and the receptionist's live screen.

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

- **Input from:** Tool bridge requests, stored conversation state, and final caller transcript events.
- **Output to:** Scheduling commands, safety decisions, optional approved searches, structured results, and audit events.
- **Can be built with:** Mock scheduling results and transcript fixtures.

### 5. Scheduling engine

- **Input from:** Validated search, hold, confirm, commit, and handoff commands.
- **Output to:** Available slots, hold tokens, canonical readbacks, bookings, handoffs, or typed errors.
- **Can be built with:** An in-memory repository before SQLite is ready.

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
6. The caller clearly confirms.
7. The database creates one booking and the calendar updates.
8. Repeat confirmation and show that no duplicate appears.
9. Ask one unsupported question and show a safe human handoff.

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
