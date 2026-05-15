# Test Plan: voice-review plugin

## Pre-install checks

### 1. Telemetry compatibility ✅
- Telemetry plugin does NOT use the `before_dispatch` hook for audio claims
- Telemetry uses `message_received` after `before_dispatch` handlers run
- Our plugin only claims audio messages; all other messages pass through unaffected
- **Risk: LOW**

### 2. Hook priority
- `before_dispatch` handlers can return `{ handled: true }` for a message
- No other installed plugin uses this hook for audio claims
- If Telemetry ever adds a `before_dispatch` audio claim, set explicit priority

### 3. Event shape (verified from OpenClaw source)
```
event.content: string
event.body: string
event.bodyForAgent: string
event.transcript: string           // already-transcribed text (may be set)
event.channel: string
event.senderId: string
event.metadata.mediaPath: string   // local path to audio file
event.metadata.mediaType: string   // e.g. "audio/ogg"
event.metadata.mediaPaths: string[]
event.metadata.mediaTypes: string[]
```

Result shape used by this plugin:
```
{ handled: true, text: "..." }
```

## Test scenarios

### Test 1: Basic install + config validation
```bash
# Add to openclaw.json plugins.entries:
{
  "voice-review": {
    "enabled": true,
    "config": {
      "mode": "translate_to_en"
    }
  }
}
```
- [ ] Gateway starts without errors
- [ ] Plugin shows as loaded in `openclaw status`
- [ ] Telemetry still works (check dashboard)

### Test 2: Russian voice → English translation
1. Send a Russian voice message
2. Should receive monospaced English translation block
3. The LLM should NOT process the original audio transcript
4. Reply "ok" → LLM processes the text

### Test 3: Transcribe mode
1. Change config to `"mode": "transcribe"`
2. Send a Russian voice message
3. Should receive Russian transcript (not translated)

### Test 4: Error fallback
1. Temporarily set invalid OPENROUTER_API_KEY
2. Send voice message
3. Should fall through to built-in audio handling (whisper CLI)
4. No crash, no silent failure

### Test 5: Non-audio messages unaffected
1. Send text message → processes normally
2. Send image → processes normally
3. Send command → processes normally

### Test 6: Telemetry data integrity
1. Send voice message through plugin
2. Check Telemetry dashboard logs
3. Voice message should NOT appear as agent turn (plugin claimed it)
4. The "ok" reply should appear as normal user message → agent turn
5. Tool usage, model calls, costs tracked correctly

## Post-install optimization

### Optional: Disable built-in audio transcription
If we want to avoid wasting resources on double-transcription:
```json5
{
  tools: {
    media: {
      audio: {
        scope: {
          default: "deny"  // built-in won't transcribe
        }
      }
    }
  }
}
```
**WARNING:** This means if the plugin fails, audio messages will be silently dropped.
Test fallback behavior thoroughly before enabling this.
