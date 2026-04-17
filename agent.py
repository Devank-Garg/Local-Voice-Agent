import os
import sys

# Ensure UTF-8 output for Windows console to handle emojis
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import time
import logging
import asyncio
import urllib.request
import json
import re
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from typing import Any, Callable, Coroutine

_script_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_script_dir, ".env"))

sys.path.insert(0, os.path.join(_script_dir, "src"))

from livekit import agents, rtc
from livekit.agents import AgentSession, Agent, RoomInputOptions, function_tool, RunContext
from livekit.agents.llm import LLM, ChatContext, ChatChunk, ChatMessage
from livekit.plugins import silero
from livekit.plugins import openai as lk_openai

from local_livekit_plugins import FasterWhisperSTT, PiperTTS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-20s | %(levelname)-8s | %(message)s"
)
logger = logging.getLogger("voice-agent")

# =============================================================================
# Core Pipeline Config
# =============================================================================
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "medium")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
PIPER_MODEL_PATH = os.path.join(_script_dir, os.getenv("PIPER_MODEL_PATH", "models/piper/en_US-ryan-high.onnx"))
PIPER_USE_CUDA = os.getenv("PIPER_USE_CUDA", "false").lower() == "true"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "ministral-3:3b")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "local")  # "local" | "cloud"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
CLOUD_LLM_MODEL = os.getenv("CLOUD_LLM_MODEL", "gemini-2.5-flash-lite")
CLOUD_LLM_MAX_TOKENS = int(os.getenv("CLOUD_LLM_MAX_TOKENS", "1000"))
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


# Type alias for the streaming callback
TextStreamCallback = Callable[[str, str, bool], Coroutine]


class _StreamingLLM(LLM):
    """LLM wrapper: optionally cleans output for TTS and streams text chunks to the UI."""

    def __init__(self, base_llm: LLM, *, clean_output: bool = False, on_text_stream: TextStreamCallback | None = None):
        super().__init__()
        self.base_llm = base_llm
        self._clean_output = clean_output
        self._on_text_stream = on_text_stream

    def _clean(self, text: str) -> str:
        return text.replace('*', '') if text else text

    @asynccontextmanager
    async def chat(self, *, chat_ctx: ChatContext, tools=None, tool_choice=None, **kwargs):
        async with self.base_llm.chat(chat_ctx=chat_ctx, tools=tools, tool_choice=tool_choice, **kwargs) as stream:
            stream_id = str(time.time())

            async def process_stream():
                async for chunk in stream:
                    if chunk is None:
                        continue

                    text = None
                    if hasattr(chunk, 'delta') and hasattr(chunk.delta, 'content') and chunk.delta.content:
                        if self._clean_output:
                            chunk.delta.content = self._clean(chunk.delta.content)
                        text = chunk.delta.content
                    elif hasattr(chunk, 'content') and chunk.content:
                        if self._clean_output:
                            chunk.content = self._clean(chunk.content)
                        text = chunk.content
                    elif isinstance(chunk, str):
                        if self._clean_output:
                            chunk = self._clean(chunk)
                        text = chunk

                    if text and self._on_text_stream:
                        asyncio.create_task(self._on_text_stream(stream_id, text, False))

                    yield chunk

                if self._on_text_stream:
                    asyncio.create_task(self._on_text_stream(stream_id, "", True))

            yield process_stream()


class VoiceAssistant(Agent):
    def __init__(self, send_tool_status=None) -> None:
        super().__init__(
            instructions="""You are a friendly, conversational AI assistant spoken through a voice interface.
            Chat naturally about anything — answer questions, share opinions, tell jokes, discuss ideas, help with tasks.
            Keep every response short and spoken-friendly: 1-2 sentences max, no bullet points, no markdown, no lists.
            Only use the weather tool when the user explicitly asks about weather. For everything else, just answer directly."""
        )
        self._send_tool_status = send_tool_status or (lambda s: asyncio.sleep(0))

    @function_tool()
    async def lookup_weather(
        self,
        context: RunContext,
        location: str,
    ) -> dict[str, Any]:
        """Look up weather information for a given location.

        Args:
            location: The location to look up weather information for.
        """
        try:
            await self._send_tool_status(f"Checking weather for {location}...")
            return {"weather": "sunny", "temperature_f": 70, "location": location}
        finally:
            await self._send_tool_status("")


def _warmup_ollama_sync():
    try:
        ollama_host = OLLAMA_BASE_URL.replace("/v1", "")
        req = urllib.request.Request(
            f"{ollama_host}/api/generate",
            data=json.dumps({"model": OLLAMA_MODEL, "prompt": "warmup", "options": {"num_predict": 1}, "stream": False}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=60):
            pass
    except Exception as e:
        logger.warning(f"Warmup ping failed: {e}")


async def warmup_ollama():
    logger.info("Warming up Ollama VRAM...")
    await asyncio.to_thread(_warmup_ollama_sync)
    logger.info("Ollama warmup complete!")


def _build_llm(on_text_stream: TextStreamCallback | None = None) -> LLM:
    if LLM_PROVIDER == "cloud":
        if not GEMINI_API_KEY:
            raise ValueError(
                "GEMINI_API_KEY is not set in .env. "
                "Get one from https://aistudio.google.com/apikey"
            )
        logger.info(f"  Gemini API key: {GEMINI_API_KEY[:6]}...{GEMINI_API_KEY[-4:]} (from env)")
        return _StreamingLLM(
            lk_openai.LLM(
                model=CLOUD_LLM_MODEL,
                base_url=GEMINI_BASE_URL,
                api_key=GEMINI_API_KEY,
                max_completion_tokens=CLOUD_LLM_MAX_TOKENS,
                _strict_tool_schema=False,
            ),
            clean_output=False,
            on_text_stream=on_text_stream,
        )
    return _StreamingLLM(
        lk_openai.LLM.with_ollama(model=OLLAMA_MODEL, base_url=OLLAMA_BASE_URL),
        clean_output=True,
        on_text_stream=on_text_stream,
    )


def create_local_session(on_text_stream: TextStreamCallback | None = None) -> AgentSession:
    logger.info("=" * 60)
    logger.info("STARTING PIPELINE")
    logger.info("=" * 60)
    logger.info(f"  STT: FasterWhisper ({WHISPER_MODEL} on {WHISPER_DEVICE})")
    llm_label = f"Cloud inference ({CLOUD_LLM_MODEL})" if LLM_PROVIDER == "cloud" else f"Ollama ({OLLAMA_MODEL})"
    logger.info(f"  LLM: {llm_label}")
    logger.info(f"  TTS: Piper (CUDA: {PIPER_USE_CUDA})")
    logger.info("=" * 60)

    if not os.path.exists(PIPER_MODEL_PATH):
        raise ValueError(f"Piper model not found at {PIPER_MODEL_PATH}")

    return AgentSession(
        stt=FasterWhisperSTT(
            model_size=WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type="float16" if WHISPER_DEVICE == "cuda" else "int8",
        ),
        llm=_build_llm(on_text_stream=on_text_stream),
        tts=PiperTTS(
            model_path=PIPER_MODEL_PATH,
            use_cuda=PIPER_USE_CUDA,
        ),
        vad=silero.VAD.load(),
    )


async def entrypoint(ctx: agents.JobContext) -> None:
    logger.info(f"Joining room: {ctx.room.name}")
    await ctx.connect()

    _transcription_time: float | None = None

    async def send_chat(msg: str, role: str = "agent"):
        payload = json.dumps({
            "type": "message",
            "id": str(time.time()),
            "role": role,
            "message": msg,
            "timestamp": int(time.time() * 1000)
        })
        await ctx.room.local_participant.publish_data(payload, topic="lk-chat")

    async def send_tool_status(status: str):
        payload = json.dumps({"type": "tool_status", "status": status})
        await ctx.room.local_participant.publish_data(payload, topic="lk-chat")

    async def send_stream_chunk(stream_id: str, text: str, is_final: bool):
        if is_final:
            payload = json.dumps({"type": "stream_end", "stream_id": stream_id})
        else:
            payload = json.dumps({"type": "stream_chunk", "stream_id": stream_id, "text": text})
        await ctx.room.local_participant.publish_data(payload, topic="lk-chat")

    # Build session with streaming callback wired in
    session = create_local_session(on_text_stream=send_stream_chunk)

    @session.on("user_input_transcribed")
    def on_user_input_transcribed(ev) -> None:
        nonlocal _transcription_time
        _transcription_time = time.perf_counter()
        logger.debug(f"User said: {ev.transcript[:80]}...")
        if ev.is_final:
            asyncio.create_task(send_chat(ev.transcript, role="user"))

    @session.on("agent_state_changed")
    def on_agent_state_changed(ev) -> None:
        nonlocal _transcription_time
        if ev.new_state == "speaking" and _transcription_time is not None:
            latency_ms = (time.perf_counter() - _transcription_time) * 1000
            logger.info(f"ROUND-TRIP LATENCY: {latency_ms:.0f}ms (LLM + TTS)")
            _transcription_time = None

    if LLM_PROVIDER == "local":
        await send_chat("Loading model into GPU... give me a moment to warm up!")
        await warmup_ollama()
        await send_chat("Ready! Start speaking whenever you like.")
    else:
        await send_chat("Connected. Start speaking whenever you like.")

    await session.start(
        room=ctx.room,
        agent=VoiceAssistant(send_tool_status=send_tool_status),
        room_input_options=RoomInputOptions(),
    )

    await session.generate_reply(
        user_input="Greet the user and let them know you're ready to help."
    )
    logger.info("Agent ready - listening for speech...")


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
        )
    )
