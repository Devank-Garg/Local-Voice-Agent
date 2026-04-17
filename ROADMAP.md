# Feature Roadmap — Local Voice Agent

## Overview

| Group | Theme | Features |
|---|---|---|
| 1 | UI/UX | Transcript panel, tool indicator, richer status, error states, animations |
| 2 | Web Search | httpx, DuckDuckGo search tool |
| 3 | Knowledge Base | MD file reading, keyword search, topic injection |
| 4 | Customer Support Mode | Configurable prompt, customer context, session logging, handoff |
| 5 | Additional | DateTime/calculator, latency dashboard, TTS speed, conversation history, barge-in |

---

## Recommended Implementation Order

| # | Feature | Group | Complexity | Notes |
|---|---|---|---|---|
| 1 | Conversation transcript panel | 1.1 | Low | Biggest UX win — data pipeline already exists |
| 2 | Date/time + calculator tools | 5.1 | Low | Zero deps, immediate utility |
| 3 | Error state display | 1.4 | Low | Prevents stuck spinner on failures |
| 4 | Richer status text ("Thinking...") | 1.3 | Low | One new case in getStatusText() |
| 5 | Message slide-in animation | 1.5 | Low | Pure CSS, zero risk |
| 6 | Add httpx, migrate warmup | 2.1 | Low | Prerequisite for web search |
| 7 | Tool-call activity indicator | 1.2 | Low | Completes data channel pattern |
| 8 | Configurable system prompt file | 4.1 | Low | Unlocks all customer support work |
| 9 | Knowledge dir + list topics tool | 3.1 | Low | Foundation for KB features |
| 10 | Read knowledge file tool | 3.2 | Low | Core KB feature |
| 11 | System prompt topic injection | 3.4 | Low | Makes KB tools more reliable |
| 12 | Web search (DuckDuckGo) | 2.2 | Medium | Network calls, result truncation |
| 13 | Keyword search across KB | 3.3 | Low-Med | Builds on 3.1 + 3.2 |
| 14 | Latency dashboard (dev mode) | 5.2 | Low-Med | Toggle with ?debug=1 URL param |
| 15 | Session conversation logging | 4.3 | Medium | Needed before per-session context |
| 16 | Per-session customer context | 4.2 | Medium | Builds on session logging |
| 17 | TTS speed control via voice | 5.3 | Medium | Plugin internals modification |
| 18 | Conversation history persistence | 5.4 | Medium | ChatContext serialization |
| 19 | Barge-in / interrupt tuning | 5.5 | Medium | turn-detector already installed |
| 20 | Human handoff tool | 4.4 | Medium | Requires external webhook |
| 21 | Wake word activation | 5.6 | High | Browser-side WASM, do last |

---

## Group 1 — UI/UX

### 1.1 Conversation Transcript Panel
**User sees:** Scrollable chat history between the orb and the bottom control bar. "You:" and "Gemma:" turns appear as messages slide in. Auto-scrolls to newest message.

**Key insight:** `publish_data(topic="lk-chat")` already exists in `agent.py` — the frontend just ignores it. `useDataChannel` in `@livekit/components-react ^2.9.20` is all that's needed.

**`agent.py` changes:**
- Extend `send_chat(msg, role="agent")` — add `role` param and `"type": "message"` discriminator to JSON payload
- In `on_user_input_transcribed` event handler: `asyncio.create_task(send_chat(ev.transcript, role="user"))` so user turns also appear

**`frontend/src/components/VoiceAssistantUI.tsx` changes:**
- Add `useDataChannel("lk-chat", callback)` hook
- Decode: `JSON.parse(new TextDecoder().decode(msg.payload))`
- `useState<Message[]>` to accumulate; `useRef` + `useEffect` keyed on `messages.length` for auto-scroll
- Render a `max-h-48 overflow-y-auto` panel between orb (`flex-1`) and glass bottom bar

**New deps:** None

---

### 1.2 Tool-Call Activity Indicator
**User sees:** A small pill badge below the orb: "Searching the web...", "Reading knowledge base..." while a tool runs. Fades out when done.

**`agent.py` changes:**
- Add `send_tool_status(status: str)` helper — publishes `{"type": "tool_status", "status": status}` on `lk-chat`
- Call at start (`await send_tool_status("...")`) and end (`await send_tool_status("")`) of every `@function_tool` method, wrapped in `try/finally`

**`VoiceAssistantUI.tsx` changes:**
- `useDataChannel` from 1.1 already handles this — parse `type === "tool_status"` into separate `toolStatus` state
- Render conditionally below orb with `transition-opacity duration-150`

**New deps:** None

---

### 1.3 Richer Status Text
**User sees:** Status line shows `"Thinking..."` during LLM generation (currently shows "Warming up recipes..." for all non-speaking/listening states).

**`VoiceAssistantUI.tsx` changes:**
- Add `assistant.state === "thinking"` case to `getStatusText()`
- Show last data channel message (warmup status) when agent isn't yet connected

**New deps:** None

---

### 1.4 Error State Display
**User sees:** If token fetch fails or LiveKit room disconnects unexpectedly, a glass error card appears with the error message and a "Try Again" button — not a frozen spinner.

**`frontend/src/app/page.tsx` changes:**
- Add `error: string | null` state (4th app state)
- `.catch(err => setError(err.message))` instead of `console.error`
- `<LiveKitRoom onDisconnected={(reason) => { if (reason !== "client_initiated") setError("Disconnected unexpectedly") }}>` 
- Retry button resets both `error` and `started` to null/false
- Error card reuses existing `.glass` CSS class

**New deps:** None

---

### 1.5 Message Slide-In Animation
**User sees:** Each new transcript message slides up and fades in. Tool badge fades in/out smoothly.

**`frontend/src/app/globals.css` changes:**
```css
@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.msg-enter { animation: slideUp 0.2s ease-out; }
```
Apply `.msg-enter` to each message `<div>` — CSS animation fires on DOM mount automatically.

**New deps:** None

---

## Group 2 — Web Search Tool

### 2.1 Add httpx + Migrate Warmup (Prerequisite)
- Add `httpx>=0.27.0` to `pyproject.toml`
- Rewrite `_warmup_ollama_sync` as `async def _warmup_ollama()` using `httpx.AsyncClient` — eliminates `asyncio.to_thread` wrapper
- Import `httpx` in `agent.py`

**New deps:** `httpx>=0.27.0`

---

### 2.2 DuckDuckGo Web Search Tool
**User says:** "Search the web for the latest news on X" → agent fetches real results, LLM summarizes into 1-2 spoken sentences.

**`agent.py` — new `@function_tool` on `VoiceAssistant`:**
```python
@function_tool()
async def search_web(self, context: RunContext, query: str) -> dict:
    """Search the web for current information about a topic."""
```
- `DDGS().text(query, max_results=4)` via `asyncio.to_thread` (DDG is sync)
- Cap combined snippets at 2000 chars before returning
- `send_tool_status("Searching the web...")` at start, clear in `finally`
- Wrap in `try/except` — return `{"error": "Search unavailable"}` on failure (LLM handles gracefully)
- Extend `CleanOutputLLM._clean_text()` to also strip markdown links `[text](url)` and backticks (web summaries from LLM may include them)
- **Brave Search upgrade path:** check `os.getenv("BRAVE_SEARCH_API_KEY")` and use Brave API if present (2000 free req/month); fall back to DDG if absent

**New deps:** `duckduckgo-search>=6.0.0`

---

## Group 3 — Knowledge Base / Filesystem Tool

### 3.1 Directory Setup + List Topics Tool
- New `knowledge/` directory at project root containing `.md` files
- `KNOWLEDGE_DIR = os.path.join(_script_dir, "knowledge")` constant in `agent.py`
- Tool: `list_knowledge_topics()` → lists `.md` file stems as available topics

**New deps:** None

---

### 3.2 Read Knowledge File Tool
**User says:** "Tell me about pricing" → agent reads `knowledge/pricing.md` and summarizes it.

```python
@function_tool()
async def read_knowledge_file(self, context: RunContext, topic: str) -> dict:
    """Read a knowledge base file about a specific topic."""
```
- Sanitize: `re.sub(r'[^a-zA-Z0-9_\-]', '', topic)` (re already imported)
- Path traversal guard: `pathlib.Path.resolve().relative_to(KNOWLEDGE_DIR.resolve())`
- Read fresh every call — file edits take effect without agent restart
- Cap at 3000 chars returned

**New deps:** None (uses stdlib `pathlib`, `re`)

---

### 3.3 Keyword Search Across Knowledge Base
**User says:** "Do you have information about refunds?" → agent searches all `.md` files without knowing the exact filename.

```python
@function_tool()
async def search_knowledge(self, context: RunContext, query: str) -> dict:
    """Search the knowledge base for information matching a query."""
```
- Glob all `*.md` files, split by `\n\n`, score paragraphs with `difflib.SequenceMatcher`
- Return top 3 matching excerpts (500 chars each)
- **Upgrade path:** `rank_bm25>=0.2.2` for proper BM25 scoring (optional dep)

**New deps:** None for keyword version

---

### 3.4 Inject Available Topics into System Prompt
- In `entrypoint()`, read `knowledge/` dir before constructing `VoiceAssistant`
- Append to instructions: `"You have a knowledge base with these topics: X, Y, Z. Use read_knowledge_file() when asked about them."`
- Computed per session — agent always knows what's available

**New deps:** None

---

## Group 4 — Customer Support Agent Mode

### 4.1 Configurable System Prompt from File
- Load `prompts/system_prompt.md` at session start in `entrypoint()` if it exists
- Fall back to hardcoded default if file not found
- Edits take effect on next user connection — no restart needed

**New deps:** None

---

### 4.2 Per-Session Customer Context Injection
**Behavior:** CRM passes `?customerId=123` in the token request → agent greets customer by name and knows their history.

**`frontend/src/app/api/token/route.ts`:**
- Accept `?customerId` query param
- Embed in LiveKit `AccessToken` metadata field as JSON

**`agent.py`:**
- After `ctx.connect()`, read first remote participant's metadata
- Load `knowledge/customers/{id}.md` if it exists
- Inject customer data block into session's system prompt

**New deps:** None

---

### 4.3 Session Conversation Logging
- Accumulate `{role, text, timestamp}` entries per session in `session_log` list
- User turns: captured from `user_input_transcribed` event
- Agent turns: accumulate chunks in `CleanOutputLLM` stream, emit completed turn
- On room disconnect: write to `logs/session_{YYYYMMDD_HHMMSS}.json`

**New deps:** None

---

### 4.4 Human Handoff Tool
**User says:** "I'd like to speak to a human" → agent acknowledges and triggers handoff.

```python
@function_tool()
async def request_human_handoff(self, context: RunContext, reason: str) -> dict:
    """Transfer the user to a human agent."""
```
- POST to `HANDOFF_WEBHOOK_URL` env var (optional) via httpx
- Publish `{"type": "handoff", "reason": reason}` on `lk-chat` so frontend can show overlay
- Frontend `useDataChannel` listens for `type === "handoff"`

**New deps:** None (uses httpx from 2.1)

---

## Group 5 — Additional Features

### 5.1 Date/Time + Calculator Tools
**Zero deps. Zero risk. Implement first.**

```python
@function_tool()
async def get_current_time(self, context: RunContext) -> dict:
    """Get the current date and time."""
    # datetime.now().strftime(...)

@function_tool()
async def calculate(self, context: RunContext, expression: str) -> dict:
    """Evaluate a math expression like '15 * 4 + 7'."""
    # ast module safe eval — walk AST, allow only numeric ops
    # No raw eval()
```

---

### 5.2 Latency Dashboard (Developer Mode)
**Behavior:** URL param `?debug=1` reveals a semi-transparent overlay showing last measured STT/LLM/TTS latency in ms.

**`agent.py`:** Emit `{"type": "metrics", "stt_ms": ..., "llm_ms": ..., "tts_ms": ...}` on topic `"lk-metrics"` after each turn. STT/TTS latency already logged in plugins — extract the values.

**`VoiceAssistantUI.tsx`:** `useDataChannel("lk-metrics")` → separate metrics state → small overlay bottom-left. Toggle via `useSearchParams()` from `next/navigation`.

---

### 5.3 TTS Speed Control via Voice Command
**User says:** "Speak faster" / "Speak slower" / "Normal speed"

- Expose `set_speed(factor: float)` method on `PiperTTS` plugin — updates `length_scale` in `SynthesisConfig` for future calls
- Hold `piper_tts` reference in `entrypoint()` scope; tool accesses it via closure

```python
@function_tool()
async def set_speech_speed(self, context: RunContext, speed: str) -> dict:
    """Adjust speech rate. Options: slow, normal, fast."""
    # {"slow": 0.75, "normal": 1.0, "fast": 1.3}
```

---

### 5.4 Conversation History (Multi-Turn Memory)
- On session start: load `logs/history_{room_name}.json`, cap at last 20 turns (prevents context overflow for 3b models)
- Deserialize into `ChatContext` and pass to `AgentSession`
- On disconnect: serialize and save

---

### 5.5 Barge-In / Interrupt Tuning
- `[turn-detector]` is already installed in `pyproject.toml`
- Check `AgentSession.__init__` kwargs in livekit-agents 1.2 — likely `allow_interruptions=True` + `min_interruption_duration` params
- Basic barge-in may already work — this is about tuning the threshold

---

### 5.6 Wake Word Activation (Do Last — High Complexity)
- Best handled browser-side with WASM library (Picovoice Porcupine Web — free for open-source)
- Only activates WebRTC mic stream on detection
- Avoids always-on microphone permission prompt
- **Scope for a separate session**

---

## New Dependencies

**Python (`pyproject.toml`):**
```
httpx>=0.27.0
duckduckgo-search>=6.0.0
rank_bm25>=0.2.2    # optional — upgrade for KB search scoring
```

**Frontend (`package.json`):** No new packages needed.

---

## Files Changed Per Group

| File | Groups |
|---|---|
| `agent.py` | All groups |
| `frontend/src/components/VoiceAssistantUI.tsx` | 1, 4.4, 5.2 |
| `frontend/src/app/globals.css` | 1.5 |
| `frontend/src/app/page.tsx` | 1.4 |
| `frontend/src/app/api/token/route.ts` | 4.2 |
| `pyproject.toml` | 2.1, 2.2 |
| `src/local_livekit_plugins/piper_tts.py` | 5.3 |
| New: `knowledge/*.md` | 3.x |
| New: `prompts/system_prompt.md` | 4.1 |
| New: `logs/` directory | 4.3, 5.4 |
