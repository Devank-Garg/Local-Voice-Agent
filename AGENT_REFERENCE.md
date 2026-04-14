# Gemma4 Voice Assistant — Agent Reference

> Fully local, offline voice conversational AI. No cloud dependencies.
> Built with LiveKit (WebRTC), Ollama (LLM), FasterWhisper (STT), and Piper TTS.

---

## Project Status

**Active development.** Core pipeline is functional end-to-end.

| Area | Status |
|---|---|
| LiveKit WebRTC connection | Working |
| FasterWhisper STT (GPU) | Working |
| Piper TTS (CPU) | Working |
| Ollama LLM integration | Working |
| LLM output cleaning | Working |
| Model warmup on startup | Working |
| Next.js frontend | Working |
| Custom tool framework | Working (mock weather tool) |
| Real weather API | Not implemented |
| Piper GPU acceleration | Disabled (CUDA onnxruntime mismatch) |

---

## Architecture Overview

```
User Browser
     │
     │  WebRTC (LiveKit)
     ▼
LiveKit Server (self-hosted)
     │
     │  WebRTC
     ▼
agent.py ──── FasterWhisper STT ──── Ollama LLM ──── Piper TTS
                  (CUDA)            (local HTTP)       (CPU)
```

**Data flow:**
1. User speaks → captured by browser mic
2. LiveKit streams audio to agent
3. Silero VAD detects speech boundaries
4. FasterWhisper transcribes audio → text
5. Text sent to Ollama LLM → response text
6. LLM output cleaned (strip asterisks) via `CleanOutputLLM`
7. Piper TTS synthesizes audio
8. Audio streamed back to user via LiveKit

---

## File Map

```
CleanAgent/
├── agent.py                          # Main entry point (223 lines)
├── pyproject.toml                    # Project metadata and dependencies
├── .env                              # Runtime configuration (gitignored)
├── uv.lock                           # Locked dependencies
│
├── src/local_livekit_plugins/
│   ├── __init__.py                   # Plugin exports
│   ├── faster_whisper_stt.py         # Custom STT plugin (175 lines)
│   └── piper_tts.py                  # Custom TTS plugin (222 lines)
│
├── models/piper/
│   ├── en_US-ryan-high.onnx          # Piper voice model (binary)
│   └── en_US-ryan-high.onnx.json     # Model metadata
│
└── frontend/
    ├── package.json
    ├── src/app/
    │   ├── page.tsx                  # Main page — fetches token, renders UI
    │   ├── layout.tsx                # Root layout
    │   ├── globals.css               # Tailwind + orb animations
    │   └── api/token/route.ts        # NextJS API — generates LiveKit token
    └── src/components/
        └── VoiceAssistantUI.tsx      # Main UI — visualizer, mic control
```

---

## Key Code Locations

### agent.py

| What | Where |
|---|---|
| `VoiceAssistant` class (tools, system prompt) | Lines 90–112 |
| `CleanOutputLLM` wrapper (strip asterisks from stream) | Lines 54–88 |
| `entrypoint()` — room connection, session init | Lines 115–190 |
| Ollama warmup (`_warmup_ollama_sync`) | Lines 30–52 |
| Latency measurement callbacks | Lines 160–185 |
| Weather tool (`lookup_weather`) | Lines 100–112 |

### Custom Plugins

| File | Purpose |
|---|---|
| `faster_whisper_stt.py` | Wraps `faster-whisper` as a LiveKit STT plugin. GPU/CPU auto-detect, VAD filtering, beam search. |
| `piper_tts.py` | Wraps `piper-tts` as a LiveKit TTS plugin. Runs synthesis in thread pool. Outputs 22050 Hz mono PCM. |

---

## Configuration (.env)

```dotenv
# LiveKit
LIVEKIT_URL=ws://192.168.29.185:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# STT
WHISPER_MODEL=medium
WHISPER_DEVICE=cuda

# TTS
PIPER_MODEL_PATH=models/piper/en_US-ryan-high.onnx
PIPER_USE_CUDA=false

# LLM
OLLAMA_MODEL=ministral-3:3b
OLLAMA_BASE_URL=http://localhost:11434/v1
```

Frontend reads the same values from `frontend/.env.local`.

**Note:** `LIVEKIT_URL` must be `ws://localhost:7880` for local development. Using the machine's LAN IP (e.g. `ws://192.168.x.x:7880`) breaks WebRTC in the browser because HTTP over a LAN IP is not a secure context — WebRTC peer connections are blocked. For remote/mobile access you need HTTPS (ngrok or self-signed cert).

---

## Dependencies

### Python (pyproject.toml)

```
livekit-agents[silero,turn-detector] ~= 1.2
livekit-plugins-openai              ~= 1.0
faster-whisper                      >= 1.0.0
piper-tts                           >= 1.2.0
numpy                               >= 1.24.0
torch                               >= 2.0.0
python-dotenv                       >= 1.0.0
```

Install with: `uv pip install -e .`

### Frontend (package.json)

```
next                          16.2.3
react                         19.2.4
@livekit/components-react     ^2.9.20
livekit-client                ^2.18.1
livekit-server-sdk            (token generation)
tailwindcss                   ^4
lucide-react                  ^1.8.0
```

Install with: `npm install` inside `frontend/`

---

## How to Run

### Prerequisites

- Python 3.10+
- Node.js 18+
- Ollama running: `ollama serve` + `ollama pull ministral-3:3b`
- LiveKit server running and accessible at the configured URL
- CUDA toolkit (optional, for GPU STT)

### Backend

```bash
cd CleanAgent
uv pip install -e .
python agent.py dev   # or: python agent.py start
```

### Frontend

```bash
cd CleanAgent/frontend
npm install
npm run dev
# Open http://localhost:3000
```

The agent connects to the LiveKit room named `"console"` (hardcoded in `frontend/src/app/api/token/route.ts`).

---

## LLM Integration

The agent uses Ollama via the OpenAI-compatible `/v1` API endpoint:

```python
lk_openai.LLM.with_ollama(model=OLLAMA_MODEL, base_url=OLLAMA_BASE_URL)
```

This is wrapped in `CleanOutputLLM` which strips `*` characters from streamed output to prevent Piper TTS from vocalizing markdown formatting.

**Model warmup:** On startup, the agent sends a minimal prompt to Ollama synchronously to preload the model into VRAM before the first user interaction.

---

## STT Details (FasterWhisper)

- Model sizes: `tiny`, `base`, `small`, `medium`, `large-v3` (configured via `WHISPER_MODEL`)
- GPU: float16 compute; CPU: int8 compute
- Beam search: beam_size=5, best_of=5
- VAD filtering enabled
- Temperature=0.0 (greedy/deterministic)
- Language: English (`"en"`)
- Logs latency: `STT latency: XXms for XXs audio`

---

## TTS Details (Piper)

- Voice: `en_US-ryan-high` (male, high quality)
- Sample rate: 22050 Hz mono
- Runs on CPU (GPU disabled — CUDA/onnxruntime version mismatch)
- Synthesis in thread pool for async safety
- Outputs WAV → PCM frames extracted for LiveKit streaming
- Logs latency: `TTS latency: XXms for XX chars`

---

## Custom Tools

Tools are defined as methods on `VoiceAssistant` with `@function_tool()`.

### `lookup_weather(location: str)` — **MOCK, not implemented**

Currently returns hardcoded data:
```python
{"weather": "sunny", "temperature_f": 70, "location": location}
```

**To add a new tool:** Add a new `@function_tool()` method to the `VoiceAssistant` class in `agent.py`.

---

## Known Issues & Limitations

1. **Piper GPU disabled** — `PIPER_USE_CUDA=false` required due to CUDA/onnxruntime incompatibility. CPU mode is fast enough for short utterances.

2. **Hardcoded network addresses** — `LIVEKIT_URL` in `.env` and LiveKit origin allowlist in `next.config.ts` must be updated when deploying on a different machine or network.

3. **Weather tool is mock** — Returns static data. Needs a real API (e.g., OpenWeatherMap) to be useful.

4. **Single voice model** — Only `en_US-ryan-high` is bundled. Additional Piper voices can be downloaded from HuggingFace.

5. **Room name hardcoded** — `"console"` is hardcoded in `frontend/src/app/api/token/route.ts`. Make configurable if multi-room support is needed.

---

## Extension Points

| What to build | Where to start |
|---|---|
| Add a new LLM tool | `VoiceAssistant` class in `agent.py`, use `@function_tool()` |
| Swap LLM model | Change `OLLAMA_MODEL` in `.env` |
| Change voice | Download new `.onnx` from HuggingFace, update `PIPER_MODEL_PATH` |
| Change STT model size | Update `WHISPER_MODEL` in `.env` |
| Add conversation history | Modify session config in `entrypoint()` |
| Support multiple rooms | Parameterize room name in token API and agent config |
| Add metrics/tracing | Extend the latency logging callbacks in `entrypoint()` |
| Dockerize | Need CUDA base image; Piper and Whisper models must be baked in or volume-mounted |
