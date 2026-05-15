# openclaw-voice-review

OpenClaw plugin that intercepts incoming voice messages, transcribes (and optionally translates to English) them using OpenRouter's Whisper endpoint, then presents the text for user review before it reaches the LLM.

## How it works

1. Voice message arrives
2. Plugin intercepts via `before_dispatch` hook (before LLM sees it)
3. Audio is base64-encoded and sent to OpenRouter `/api/v1/audio/transcriptions`
4. Transcription/translation is shown as a monospaced preview with a confirmation hint
5. User replies "ok" to submit (or edits and sends manually)
6. The text flows to the LLM as a normal user message

## Configuration

Add to your `openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "voice-review": {
        enabled: true,
        config: {
          mode: "translate_to_en",  // "transcribe" or "translate_to_en"
          model: "openai/whisper-large-v3-turbo",
          confirmMessage: "Reply ok to submit, or edit and send.",
          promptText: ""  // optional Whisper prompt
        }
      }
    }
  }
}
```

### Settings

| Setting | Default | Description |
|---|---|---|
| `mode` | `translate_to_en` | `transcribe` = original language; `translate_to_en` = transcribe + translate to English |
| `model` | `openai/whisper-large-v3-turbo` | OpenRouter Whisper model |
| `confirmMessage` | `Reply ok to submit, or edit and send.` | Hint shown below preview |
| `promptText` | (empty) | Optional Whisper context prompt |

### Requirements

- `OPENROUTER_API_KEY` environment variable must be set
- OpenRouter account with access to Whisper models

### Audio scope

The plugin only intercepts audio that would normally be transcribed by OpenClaw's built-in audio processing. Make sure `tools.media.audio` scope allows the chat types where you want this to work.

## Voice-reviewed X/Twitter drafts with TweetClaw

Voice Review can sit in front of TweetClaw when a user dictates public
X/Twitter work. Let Voice Review transcribe or translate the spoken instruction,
then use TweetClaw for the structured X/Twitter step:

```bash
openclaw plugins install @xquik/tweetclaw
openclaw config set tools.alsoAllow '["explore", "tweetclaw"]'
```

Use this for search tweets, search tweet replies, follower export, user lookup,
media upload, media download, monitor tweets, webhooks, and draft post tweets or
post tweet replies for approval. Keep OpenRouter and Xquik API keys in local
OpenClaw config or environment variables, not in voice prompts or chat messages.
Review the transcribed text and the structured TweetClaw request before
approving any visible X/Twitter action.

## Installation

```bash
# From source
git clone https://github.com/BorClaw/openclaw-voice-review.git
# Add to openclaw.json plugins.entries with localPath
```

## Cost

Whisper Large V3 Turbo via OpenRouter: ~$0.0001 per second of audio. A 30-second voice message costs less than $0.01.

## License

MIT
