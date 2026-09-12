# Turno phone setup

Turno can answer a real Twilio number while keeping the same scheduling engine, SQLite records, safety rules, and receptionist dashboard used by the browser demo.

## How the call travels

```text
Your phone
  -> Twilio phone number
  -> Twilio Elastic SIP Trunk
  -> OpenAI Realtime SIP (gpt-realtime-2.1)
  -> Turno's signed webhook and private control connection
  -> The same search, hold, confirmation, booking, and handoff code
  -> Receptionist dashboard
```

Twilio and OpenAI carry the audio. Turno receives transcripts and tool requests over a private server connection. Turno does not store the caller's phone number or raw audio.

## What you need

- A Twilio account with one voice-capable phone number.
- The OpenAI project that owns the API key already used by Turno.
- A public HTTPS address that forwards to the running Turno app.
- The OpenAI project ID, which begins with `proj_`.
- An OpenAI webhook signing secret, which begins with `whsec_`.

Never commit or paste API keys, auth tokens, or webhook secrets into chat. Put them only in `.env.local`.

## 1. Give the local app a public HTTPS address

Keep Turno running in one terminal:

```bash
pnpm dev
```

For a hackathon demo, a temporary Cloudflare tunnel is enough:

```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:3100
```

Copy the generated `https://...trycloudflare.com` address. Keep both the Turno server and tunnel running. A quick-tunnel address changes when the tunnel restarts, so update the webhook if that happens.

## 2. Configure the OpenAI incoming-call webhook

1. Open the OpenAI API dashboard for the same project as your API key.
2. In **Project > General**, copy the project ID beginning with `proj_`.
3. In **Project > Webhooks**, create an endpoint using:

   ```text
   https://YOUR-PUBLIC-ADDRESS/api/openai/realtime-call
   ```

4. Subscribe it to `realtime.call.incoming`.
5. Copy the webhook signing secret beginning with `whsec_`.
6. Add these values to `.env.local`:

   ```dotenv
   TELEPHONY_ENABLED=true
   OPENAI_PROJECT_ID=proj_your_project_id
   OPENAI_WEBHOOK_SECRET=whsec_your_webhook_secret
   PHONE_CONVERSATION_ID=browser-demo
   ```

7. Restart `pnpm dev` after changing `.env.local`.

Check the safe status endpoint. It reports only readiness and never returns secrets:

```bash
curl https://YOUR-PUBLIC-ADDRESS/api/openai/realtime-call
```

The response should show `"enabled":true` and `"configured":true`.

## 3. Route the Twilio number to OpenAI

1. In Twilio Console, open **Elastic SIP Trunking > Trunks** and create a trunk named `Turno Demo`.
2. Open the trunk's **Origination** settings.
3. Add this Origination SIP URI, replacing the project ID:

   ```text
   sip:proj_your_project_id@sip.api.openai.com;transport=tls
   ```

4. Save the origination settings.
5. Open the trunk's **Numbers** section and associate your Twilio phone number with this trunk.

The application does not need your Twilio Account SID or Auth Token for this inbound SIP route.

## 4. Make the test call

1. Keep the Turno dashboard open at `http://127.0.0.1:3100`.
2. Press **Reset demo** so the synthetic schedule starts clean.
3. Do not start a browser voice call at the same time.
4. Call the Twilio number from your phone.
5. Say: “I need a follow-up appointment next Tuesday between two and three.”
6. Choose one of the offered times, give a synthetic name, listen to the full readback, and say a clear “yes.”

The dashboard should show the phone connection, final transcript turns, availability search, hold, explicit confirmation, and exactly-once booking.

## Fast troubleshooting

- **Call does not reach Turno:** confirm that the Twilio number is attached to the trunk and the SIP URI contains the correct OpenAI project ID.
- **Webhook is not delivered:** confirm that the public tunnel is still running and the OpenAI webhook URL uses HTTPS.
- **Webhook returns 400:** copy the correct OpenAI webhook signing secret into `.env.local` and restart Turno.
- **Webhook returns 503:** set `TELEPHONY_ENABLED=true`, confirm both OpenAI secrets are present, and restart Turno.
- **Turno answers but tools do not run:** keep the Turno Node process alive for the entire call; the private sideband connection runs there.
- **Confirmation is rejected:** wait for Turno's full readback and answer with a clear “yes” or “confirm.” This is intentional safety behavior.

## Demo fallback

Phone calling is an enhancement, not the only demo path. If venue networking or the tunnel fails, use the already-tested browser voice flow and guided reliability controls.
