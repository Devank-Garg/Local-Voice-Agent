# Local Voice Agent

A fully local, real-time voice AI assistant with zero cloud dependencies. Speak to it in your browser, get a spoken response back — all processing runs on your own hardware.

Built with **LiveKit** (WebRTC), **Ollama** (LLM), **FasterWhisper** (STT), and **Piper TTS**, connected by a custom LiveKit Agents pipeline. A **Next.js** frontend provides the browser interface.

---

## Demo

```
You:    "What's the capital of France?"
Gemma:  "The capital of France is Paris."

Round-trip latency: ~900ms  (STT: 180ms | LLM : 520ms | TTS: 95ms)
```

---

## System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                          User's Browser                             │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │              Next.js Frontend  (localhost:3000)              │  │
│   │                                                              │  │
│   │   ┌─────────────┐   ┌──────────────┐   ┌────────────────┐   │  │
│   │   │  Mic Input  │   │  Orb + Bars  │   │  ControlBar    │   │  │
│   │   │  (WebRTC)   │   │  Visualizer  │   │  (mute/unmute) │   │  │
│   │   └──────┬──────┘   └──────────────┘   └────────────────┘   │  │
│   └──────────┼───────────────────────────────────────────────────┘  │
└──────────────┼──────────────────────────────────────────────────────┘
               │  WebRTC audio (Opus codec)
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   LiveKit Server  (localhost:7880)                   │
│              WebSocket signaling + WebRTC media relay               │
└──────────────────────────┬───────────────────────────────────────────┘
                           │  WebRTC audio stream
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Python Agent  (agent.py)                       │
│                                                                      │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────────┐ │
│  │ Silero VAD  │───▶│ FasterWhisper    │───▶│  CleanOutputLLM     │ │
│  │  (CPU)      │    │ STT  (CUDA)      │    │  ↳ Ollama wrapper   │ │
│  │             │    │                  │    │                     │ │
│  │ detects     │    │  medium model    │    │  ministral-3b       │ │
│  │ speech end  │    │  float16 / GPU   │    │  OpenAI-compat API  │ │
│  └─────────────┘    └──────────────────┘    └──────────┬──────────┘ │
│                                                        │            │
│                     ┌──────────────────┐               │            │
│                     │   Piper TTS      │◀──────────────┘            │
│                     │   (CPU)          │                            │
│                     │                  │                            │
│                     │  en_US-ryan-high │                            │
│                     │  22050 Hz mono   │                            │
│                     └────────┬─────────┘                            │
└──────────────────────────────┼───────────────────────────────────────┘
                               │  PCM audio → WebRTC
                               ▼
                        Back to browser
```

### Request Data Flow

```
[User speaks into mic]
        │
        ▼  WebRTC Opus stream
[LiveKit Server] ──────────────────────────────────────────────────────
        │  raw PCM frames
        ▼
[Silero VAD]  detects speech / silence in real-time on CPU
        │  speech segment complete
        ▼
[FasterWhisper STT]  ~100–300ms
        │  "what's the capital of france?"
        ▼
[CleanOutputLLM]  strips markdown (* chars) from streamed output
        │
        ▼
[Ollama LLM]  ~300–800ms to first token, streams response
        │  "The capital of France is Paris."
        ▼
[Piper TTS]  ~50–150ms, runs in thread pool
        │  PCM audio bytes @ 22050 Hz
        ▼
[LiveKit Server]  streams audio back
        │  WebRTC
        ▼
[Browser plays response audio]
```

---

## Latency Breakdown

Measured on RTX 3060 (12GB VRAM), `ministral-3b` via Ollama, Whisper `medium`. All metrics are logged live by the agent — enable `DEBUG` logging to see per-request numbers.

| Stage | What's measured | Typical range | Notes |
|---|---|---|---|
| **Silero VAD** | End-of-speech detection | ~0 ms | Runs in real-time alongside incoming audio |
| **FasterWhisper STT** | Audio buffer → transcript text | 100–300 ms | `medium` on CUDA float16. Scales with audio length. |
| **Ollama LLM (TTFT)** | Transcript → first output token | 300–800 ms | After warmup. Cold-start adds 5–30s on first request. |
| **Ollama LLM (full)** | Complete response generation | 500 ms–2 s | ~25 tok/s for a 1–2 sentence reply |
| **Piper TTS** | Text → PCM audio bytes | 50–150 ms | CPU synthesis of a 1–2 sentence response |
| **Round-trip total** | Transcript ready → first audio out | 600 ms–1.5 s | Logged as `ROUND-TRIP LATENCY` in agent terminal |

### Whisper Model Size vs Latency

| Model | VRAM | STT Latency | WER (en) |
|---|---|---|---|
| `tiny` | ~400 MB | ~30–80 ms | Higher |
| `base` | ~600 MB | ~50–120 ms | Good |
| `small` | ~1.2 GB | ~80–180 ms | Better |
| `medium` | ~1.5 GB | ~100–300 ms | Best practical |
| `large-v3` | ~3 GB | ~200–500 ms | Best overall |

### Model Warmup

The agent pings Ollama with a dummy prompt on startup to preload the model weights into VRAM. Without warmup, the first real request incurs a 5–30s cold-start delay.

---

## Models Used

| Component | Model | Size on Disk | Runtime |
|---|---|---|---|
| **LLM** | `ministral-3b:3b` | ~2 GB | Ollama (OpenAI-compat API) |
| **STT** | Whisper `medium` | ~1.5 GB | FasterWhisper (CTranslate2, CUDA) |
| **TTS voice** | `en_US-ryan-high` | ~65 MB | Piper + ONNX Runtime (CPU) |
| **VAD** | Silero VAD | ~2 MB | PyTorch (CPU) |

### Swapping Models

**LLM:** Set `OLLAMA_MODEL` in `.env` to any Ollama model. Tested with `llama3.2:3b`, `gemma3:4b`, `qwen2.5:3b`.

**STT:** Set `WHISPER_MODEL` to `tiny` / `base` / `small` / `large-v3`. Trade accuracy for speed.

**TTS voice:** Download any voice from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) on Hugging Face. Place the `.onnx` and `.onnx.json` in `models/piper/` and update `PIPER_MODEL_PATH`.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Browser UI | Next.js + React | 16.2.3 / 19.2.4 |
| Styling | Tailwind CSS | v4 |
| WebRTC transport | LiveKit | `livekit-agents ~= 1.2` |
| VAD | Silero VAD | via livekit-plugins |
| STT | FasterWhisper (CTranslate2) | `>= 1.0.0` |
| LLM runtime | Ollama | any recent |
| TTS | Piper (ONNX Runtime) | `>= 1.2.0` |

---

## Project Structure

```
CleanAgent/
├── agent.py                          # Agent entrypoint and pipeline wiring
├── pyproject.toml                    # Python project + dependencies
├── .env                              # Runtime config (gitignored — create from table below)
│
├── src/local_livekit_plugins/
│   ├── __init__.py
│   ├── faster_whisper_stt.py         # Custom LiveKit STT plugin
│   └── piper_tts.py                  # Custom LiveKit TTS plugin
│
├── models/piper/                     # Voice model files (gitignored — download separately)
│   ├── en_US-ryan-high.onnx
│   └── en_US-ryan-high.onnx.json
│
└── frontend/
    ├── package.json
    ├── src/app/
    │   ├── page.tsx                  # Root page — token fetch, LiveKitRoom setup
    │   ├── layout.tsx                # Root layout — LiveKit CSS import
    │   └── api/token/route.ts        # API route — issues LiveKit access tokens
    └── src/components/
        └── VoiceAssistantUI.tsx      # Orb UI, BarVisualizer, mic ControlBar
```

### Key Code Locations

| What | File | Line |
|---|---|---|
| Agent system prompt | `agent.py` | 93 |
| Custom tool definition | `agent.py` | 99 |
| LLM output cleaner (strips `*`) | `agent.py` | 54 |
| Ollama model warmup | `agent.py` | 114 |
| Round-trip latency logging | `agent.py` | 183 |
| STT plugin (FasterWhisper) | `src/local_livekit_plugins/faster_whisper_stt.py` | 50 |
| TTS plugin (Piper) | `src/local_livekit_plugins/piper_tts.py` | 129 |

---

## Setup & Running

### Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.com) installed and running
- [LiveKit server](https://github.com/livekit/livekit/releases/latest) binary
- CUDA toolkit (optional, for GPU STT)

### 1. Download the Piper voice model

```bash
mkdir -p models/piper
curl -L -o models/piper/en_US-ryan-high.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx
curl -L -o models/piper/en_US-ryan-high.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high/en_US-ryan-high.onnx.json
```

### 2. Configure environment

Create `.env` in the project root and `frontend/.env.local` with identical values:

```dotenv
# LiveKit
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# STT
WHISPER_MODEL=medium          # tiny | base | small | medium | large-v3
WHISPER_DEVICE=cuda           # cuda | cpu

# TTS
PIPER_MODEL_PATH=models/piper/en_US-ryan-high.onnx
PIPER_USE_CUDA=false          # GPU has CUDA/onnxruntime version constraints

# LLM
OLLAMA_MODEL=ministral-3b:3b
OLLAMA_BASE_URL=http://localhost:11434/v1
```

### 3. Install dependencies

```bash
# Python backend (using uv — recommended)
pip install uv
uv pip install -e .

# OR with pip
pip install -e .

# Frontend
cd frontend && npm install
```

### 4. Run (4 terminals)

```bash
# Terminal 1 — LiveKit server (--dev uses devkey/secret, no config needed)
livekit-server --dev --bind 0.0.0.0

# Terminal 2 — Ollama
ollama serve
ollama pull ministral-3b:3b    # first time only

# Terminal 3 — Python agent
python agent.py dev

# Terminal 4 — Frontend
cd frontend && npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** and click **Tap to Connect**.

> **Use `localhost`, not your LAN IP.** Browsers require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS or localhost) for WebRTC mic access. Accessing via `http://192.168.x.x:3000` will fail with a peer connection error.

---

## Adding Custom Tools

Add methods to the `VoiceAssistant` class in `agent.py` decorated with `@function_tool()`. The LLM decides autonomously when to call them based on the conversation.

```python
@function_tool()
async def get_current_time(self, context: RunContext) -> dict:
    """Get the current local time."""
    from datetime import datetime
    return {"time": datetime.now().strftime("%I:%M %p")}

@function_tool()
async def calculate(self, context: RunContext, expression: str) -> dict:
    """Evaluate a simple math expression.

    Args:
        expression: A math expression like '15 * 4 + 7'
    """
    try:
        result = eval(expression, {"__builtins__": {}})
        return {"result": result}
    except Exception as e:
        return {"error": str(e)}
```

The included `lookup_weather` tool returns mock data — replace it with a real weather API call.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `could not establish pc connection` | Accessing via LAN IP | Use `http://localhost:3000` |
| `ClientConnectorError: Cannot connect to 7880` | LiveKit server not running | Start `livekit-server --dev` |
| Slow first response (5–30s) | Ollama model cold-start | Wait for "Oven is hot" in chat |
| No audio output | Wrong Piper model path | Check `PIPER_MODEL_PATH` in `.env` |
| Agent not joining room | `python agent.py` not running | Start the agent in dev mode |
| STT very inaccurate | Model too small or wrong language | Set `WHISPER_MODEL=medium` |
| Piper GPU crash | CUDA/onnxruntime version mismatch | Set `PIPER_USE_CUDA=false` |

---

## Known Limitations

- **Single user per room** — one participant at a time. Multi-user needs room management logic.
- **English only** — Whisper and Piper both default to English.
- **LAN / mobile access requires HTTPS** — use `ngrok http 3000` as a quick tunnel.
- **Piper GPU disabled** — CPU mode is fast enough for short responses; GPU requires a specific paired CUDA + onnxruntime build.
- **Weather tool is a stub** — returns hardcoded data; needs a real API integration.

---

## License

MIT
