// src/index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export interface VoiceReviewConfig {
  mode?: "transcribe" | "translate_to_en";
  model?: string;
  confirmMessage?: string;
  promptText?: string;
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

    api.on("inbound_claim", async (event, ctx) => {
      // Only intercept audio messages
      const mediaType = (event as Record<string, unknown>).mediaType as string | undefined;
      if (mediaType !== "audio") return;

      const mediaPath = (event as Record<string, unknown>).mediaPath as string | undefined;
      if (!mediaPath) return;

      try {
        // 1. Read and base64-encode the audio file
        const fs = await import("node:fs/promises");
        const audioBuffer = await fs.readFile(mediaPath);
        const audioB64 = audioBuffer.toString("base64");

        // Detect format from extension
        const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "ogg";
        const formatMap: Record<string, string> = {
          ogg: "ogg",
          mp3: "mp3",
          m4a: "mp4",
          wav: "wav",
          webm: "webm",
          flac: "flac",
        };
        const format = formatMap[ext] ?? ext;

        // 2. Call OpenRouter transcriptions API
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          api.logger.error("OPENROUTER_API_KEY not set — falling through to default audio handling");
          return;
        }

        const payload: Record<string, unknown> = {
          model,
          input_audio: {
            data: audioB64,
            format,
          },
        };

        // For translate mode, set task=translate
        if (mode === "translate_to_en") {
          payload.task = "translate";
        }

        // Optional whisper prompt
        if (cfg.promptText) {
          payload.prompt = cfg.promptText;
        }

        const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          api.logger.error(`OpenRouter transcription failed: ${response.status} ${errorText}`);
          return; // fall through to default handling
        }

        const result = (await response.json()) as { text?: string };
        const text = result.text?.trim();
        if (!text) {
          api.logger.warn("OpenRouter returned empty transcription — falling through");
          return;
        }

        // 3. Format the preview message
        const modeLabel = mode === "translate_to_en" ? "Translation" : "Transcription";
        const preview = `*${modeLabel}:*\n\`\`\`\n${text}\n\`\`\`\n\n_${confirmHint}_`;

        // 4. Claim the message: send preview as synthetic reply, suppress LLM processing
        return {
          action: "reply",
          reply: preview,
        };
      } catch (err) {
        api.logger.error(`voice-review plugin error: ${err}`);
        return; // fall through to default handling
      }
    });
  },
});
