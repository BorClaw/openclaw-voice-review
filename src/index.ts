// src/index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Voice Review plugin for OpenClaw.
 *
 * Uses before_dispatch to intercept audio messages, transcribes via OpenRouter,
 * and shows a preview for user approval before LLM processing.
 */

export interface VoiceReviewConfig {
  mode?: "transcribe" | "translate_to_en";
  model?: string;
  confirmMessage?: string;
  promptText?: string;
}

const MEDIA_INBOUND_DIR = join(
  process.env.HOME ?? "/tmp",
  ".openclaw/media/inbound"
);

function detectFormat(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "ogg";
  const map: Record<string, string> = {
    ogg: "ogg", mp3: "mp3", m4a: "mp4", wav: "wav",
    webm: "webm", flac: "flac", opus: "ogg",
  };
  return map[ext] ?? ext;
}

/**
 * Find the most recent audio file in the inbound media directory
 * that was modified within `maxAgeMs` of the reference time.
 */
async function findRecentAudioFile(
  refTime: number,
  maxAgeMs = 15000
): Promise<string | undefined> {
  try {
    const entries = await readdir(MEDIA_INBOUND_DIR);
    let best: { path: string; age: number } | undefined;

    for (const entry of entries) {
      if (!entry.includes(".") || entry.startsWith(".")) continue;
      const ext = entry.split(".").pop()?.toLowerCase();
      if (!ext || !["ogg", "mp3", "m4a", "wav", "webm", "flac", "opus"].includes(ext)) continue;

      const fullPath = join(MEDIA_INBOUND_DIR, entry);
      const s = await stat(fullPath);
      const age = refTime - s.mtimeMs;

      if (age >= 0 && age < maxAgeMs) {
        if (!best || age < best.age) {
          best = { path: fullPath, age };
        }
      }
    }

    return best?.path;
  } catch {
    return undefined;
  }
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

    api.on("before_dispatch", async (event, _ctx) => {
      // Only intercept audio messages (content is <media:audio> placeholder)
      if (!event.content?.includes("media:audio")) return;

      try {
        const now = Date.now();
        api.logger.info(`[voice-review] before_dispatch: audio detected, looking for recent file...`);

        // Find the audio file that was just received
        const mediaPath = await findRecentAudioFile(now);
        if (!mediaPath) {
          api.logger.warn("[voice-review] no recent audio file found, falling through");
          return;
        }

        api.logger.info(`[voice-review] found audio: ${mediaPath}`);

        // Read and base64-encode
        const fs = await import("node:fs/promises");
        const audioBuffer = await fs.readFile(mediaPath);
        const audioB64 = audioBuffer.toString("base64");
        const format = detectFormat(mediaPath);

        // Call OpenRouter transcriptions API
        const apiKey = process.env.OPENROUTER_API_KEY || (api.pluginConfig as any)?.apiKey;
        if (!apiKey) {
          api.logger.error(
            "[voice-review] OPENROUTER_API_KEY not set (env or plugin config) — falling through"
          );
          return;
        }

        const payload: Record<string, unknown> = {
          model,
          input_audio: { data: audioB64, format },
        };

        if (mode === "translate_to_en") {
          payload.task = "translate";
        }
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
            `[voice-review] OpenRouter failed: ${response.status} ${errorText}`
          );
          return;
        }

        const result = (await response.json()) as { text?: string };
        const text = result.text?.trim();

        if (!text) {
          api.logger.warn("[voice-review] empty transcription — falling through");
          return;
        }

        // Format preview and claim the message
        const modeLabel = mode === "translate_to_en" ? "Translation" : "Transcription";
        const preview = `*${modeLabel}:*\n\`\`\`\n${text}\n\`\`\`\n\n_${confirmHint}_`;

        api.logger.info(`[voice-review] transcription success, claiming message`);
        return { handled: true, text: preview };
      } catch (err) {
        api.logger.error(`[voice-review] error: ${err}`);
        return;
      }
    });
  },
});
