// src/index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

/**
 * Voice Review plugin for OpenClaw.
 *
 * Intercepts inbound voice messages via the inbound_claim hook, transcribes
 * (and optionally translates to English) them using OpenRouter's Whisper
 * endpoint, then presents the text for user approval before the LLM sees it.
 *
 * Returns { handled: true, reply: { text: "..." } } to claim the message
 * and prevent the built-in transcript from reaching the LLM.
 */

export interface VoiceReviewConfig {
  /** "transcribe" = original language; "translate_to_en" = transcribe + translate to English */
  mode?: "transcribe" | "translate_to_en";
  /** OpenRouter Whisper model ID */
  model?: string;
  /** Hint text shown below the transcription preview */
  confirmMessage?: string;
  /** Optional Whisper context prompt (e.g. language hints) */
  promptText?: string;
}

/**
 * Detect audio format from file extension.
 */
function detectFormat(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "ogg";
  const map: Record<string, string> = {
    ogg: "ogg",
    mp3: "mp3",
    m4a: "mp4",
    wav: "wav",
    webm: "webm",
    flac: "flac",
    opus: "ogg",
  };
  return map[ext] ?? ext;
}

export default definePluginEntry({
  id: "voice-review",
  name: "Voice Review",
  description:
    "Intercept voice messages, transcribe/translate via OpenRouter Whisper, show preview for user approval before LLM processing",

  register(api) {
    const cfg: VoiceReviewConfig = (api.pluginConfig ?? {}) as VoiceReviewConfig;
    const mode = cfg.mode ?? "translate_to_en";
    const model = cfg.model ?? "openai/whisper-large-v3-turbo";
    const confirmHint = cfg.confirmMessage ?? "Reply ok to submit, or edit and send.";

    api.on("inbound_claim", async (event, _ctx) => {
      // Only intercept audio messages.
      // event.metadata.mediaType is set when inbound has audio media.
      const mediaType = event.metadata?.mediaType as string | undefined;
      const mediaPath = event.metadata?.mediaPath as string | undefined;

      if (!mediaType?.startsWith("audio") && !mediaPath) return;

      try {
        // 1. Read and base64-encode the audio file
        const fs = await import("node:fs/promises");
        const audioBuffer = await fs.readFile(mediaPath!);
        const audioB64 = audioBuffer.toString("base64");
        const format = detectFormat(mediaPath!);

        // 2. Call OpenRouter transcriptions API
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          api.logger.error(
            "OPENROUTER_API_KEY not set — voice-review cannot process audio, falling through to default handler"
          );
          return; // fall through to default audio handling
        }

        const payload: Record<string, unknown> = {
          model,
          input_audio: {
            data: audioB64,
            format,
          },
        };

        // For translate mode, Whisper translates directly to English
        if (mode === "translate_to_en") {
          payload.task = "translate";
        }

        // Optional whisper prompt for context/language hints
        if (cfg.promptText) {
          payload.prompt = cfg.promptText;
        }

        const response = await fetch(
          "https://openrouter.ai/api/v1/audio/transcriptions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          api.logger.error(
            `OpenRouter transcription failed: ${response.status} ${errorText}`
          );
          return; // fall through to default handling
        }

        const result = (await response.json()) as { text?: string };
        const text = result.text?.trim();

        if (!text) {
          api.logger.warn(
            "OpenRouter returned empty transcription — falling through to default handler"
          );
          return;
        }

        // 3. Format the preview message
        const modeLabel =
          mode === "translate_to_en" ? "Translation" : "Transcription";
        const preview = `*${modeLabel}:*\n\`\`\`\n${text}\n\`\`\`\n\n_${confirmHint}_`;

        // 4. Claim the message: send preview, suppress LLM processing
        // This prevents the built-in transcript from reaching the agent
        return {
          handled: true,
          reply: { text: preview },
        };
      } catch (err) {
        api.logger.error(`voice-review plugin error: ${err}`);
        return; // fall through to default handling on any error
      }
    });
  },
});
