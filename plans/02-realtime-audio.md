# Phase 2 — live OpenAI Realtime audio

## Goal

Replace simulated audio with a working two-way voice conversation. No tools or memory calls in this phase.

## Work sequence

1. Create an OpenAI API project, enable billing/API access as required by the account, create a project-scoped API key, and put it only in the API server's `OPENAI_API_KEY` secret. Check the account's current Realtime model access, limits, and pricing in the OpenAI dashboard. Use the server-owned `DEFAULT_REALTIME_MODEL` (`gpt-realtime-2.1`) for every session; clients do not select a model. The API platform [quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request) covers account/key setup, and the [Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc) covers connection setup. No Firebase project is needed.
2. In the browser transport, request microphone permission, create an `RTCPeerConnection`, add the microphone track, attach the remote track to an audio element, establish a data channel for Realtime events, and create an SDP offer. Expose state changes to the same `useVoiceSession` interface from phase 1.
3. Add authenticated `POST /v1/realtime/sessions` in Hono. Accept `application/sdp`, validate body size and authorization, construct the server-owned Realtime session config with `tool_choice: none`, and forward offer + config to `POST https://api.openai.com/v1/realtime/calls` using the server API key. Return the SDP answer with `application/sdp`; capture the call ID from OpenAI's `Location` header and persist it against the local session. OpenAI recommends this unified interface for simpler/faster browser connections. [Source](https://developers.openai.com/api/docs/guides/voice-webrtc)
4. Set the remote SDP answer and complete the WebRTC handshake. Show connecting, listening, speaking, interrupted, reconnecting, and failed states. Handle autoplay restrictions, microphone permission denial, device changes, network loss, and cleanup of tracks/peer connection on Stop or page exit. Add `POST /v1/realtime/sessions/{id}/end` for idempotent server cleanup.
5. Configure input/output audio, a selected voice, and turn detection on the server. Listen to Realtime events for transcript/status UI and interruption behavior. Keep phase 2 free of tools and memory injection so the audio path is easy to debug.
6. Instrument click-to-connection, speech-end-to-first-audio, session creation errors, and reconnect attempts. Capture request IDs, local session IDs, and OpenAI call IDs in server logs, while redacting content and credentials.

## Acceptance checks

- After login, a browser can start a session, speak, and hear a generated spoken reply through WebRTC. The API server is not in the ongoing audio path.
- The model cannot call tools; no memory records are read or written.
- Stop releases microphone and peer connection resources. An interrupted response stops or truncates playback correctly; reconnection and errors are visible rather than silently hanging.
- A bad/expired access JWT never creates an OpenAI call. A valid refresh made before Start avoids an intermittent authorization failure.
- The OpenAI key is absent from browser code and network responses; only session SDP and safe metadata return to the browser.

## Exit artifact

Repeatable live voice demo and a short troubleshooting guide for browser permissions, API access, model selection, WebRTC connection failures, and audio playback.
