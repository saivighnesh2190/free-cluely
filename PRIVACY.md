# Privacy & Data Handling

This app is a screen/audio "copilot": by design it takes screenshots and can
record your microphone, then sends that content to an AI model so it can help
you. That's inherently more sensitive than a typical app, so this document
explains exactly what happens to your data, and how to minimize what leaves
your machine.

## What the app can capture

- **Screenshots** of your screen, taken when you press the screenshot shortcut
  (`Cmd/Ctrl + H`) or use the tray menu.
- **Microphone audio**, only while you are actively recording via the voice
  input feature.
- **Text you type** into the chat box.

Nothing is captured continuously or in the background — screenshots and audio
are only collected when you explicitly trigger them.

## Where your data goes

This depends entirely on which AI provider you configure in `.env`:

| Provider | Data leaves your device? | Notes |
| --- | --- | --- |
| **Ollama** (`USE_OLLAMA=true`) | **No** | Fully local inference. Screenshots/audio/text never leave your machine. |
| **Google Gemini** | Yes | Screenshots/audio/text are sent directly to Google's Gemini API using your own API key. Subject to [Google's API terms](https://ai.google.dev/gemini-api/terms). |
| **K2 Think V2** | Yes | Sent directly to the configured K2 Think API using your own API key. |
| **OpenRouter** | Yes | Sent directly to OpenRouter, which may route to one of several underlying model providers depending on the model you pick. |

In every cloud case, requests go **directly from your device to the provider's
API** using the API key you supplied — there is no first-party backend server
run by this project that your data passes through, and no analytics/telemetry
SDK is bundled with the app.

If you want a 100% local, nothing-leaves-my-machine setup, use the **Ollama**
option (see the README for setup).

## What's stored on disk, and for how long

- Screenshots are written to a temporary folder inside Electron's per-app
  `userData` directory (not a shared/public folder).
- As soon as a screenshot (or recording) has been sent to the AI and a
  response comes back, the file is **deleted from disk immediately** — it's
  no longer needed once its contents have been extracted into the
  conversation.
- If you close the app before a screenshot is processed (or a request fails),
  anything still queued is wiped when the app quits, so nothing lingers
  between sessions.
- Chat history, screenshots, and recordings are **not synced anywhere** and
  are not written to any database — they only exist transiently in memory and
  on disk for as long as described above.

## Rendering safety (indirect prompt injection)

Because the AI's answers are generated from whatever text appears on your
screen or is transcribed from audio, that input should be treated as
untrusted — a malicious webpage, document, or audio clip could try to smuggle
instructions or raw HTML into the model's response ("indirect prompt
injection"). To reduce the blast radius if that happens:

- AI responses are rendered through a Markdown sanitizer (`rehype-sanitize`)
  that strips dangerous constructs (`<script>` tags, inline event handlers
  like `onerror=`, `javascript:` URLs, etc.) before anything is shown,
  while still allowing safe Markdown/LaTeX formatting.
- The Electron renderer runs with `nodeIntegration` disabled and
  `contextIsolation` enabled, so even if something did execute in the
  renderer, it would not have direct access to Node.js or the filesystem —
  only the small, explicit API surface exposed via `preload.ts`.

## Logging

The app logs high-level status messages (e.g. "calling LLM", "switched
provider") to help with debugging, but avoids writing full AI responses,
transcripts, or problem statements to the console/logs.

## Your responsibility

If you use this tool during calls, interviews, or meetings with other people,
be mindful of consent and disclosure requirements in your jurisdiction before
recording or capturing anyone else's screen/audio/voice. This project does not
provide legal advice — check your local laws (e.g. two-party consent
recording laws) and any relevant policies (e.g. your employer's, or an
exam/interview provider's terms) before using it in those settings.
