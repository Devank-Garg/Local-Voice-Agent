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
from dotenv import load_dotenv

_script_dir = os.path.dirname(os.path.abspath(__file__))
# Load environment variables from .env
load_dotenv(os.path.join(_script_dir, ".env"))

# Add src to python path for local imports
sys.path.insert(0, os.path.join(_script_dir, "src"))

from livekit import agents, rtc
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import silero
from livekit.plugins import openai as lk_openai

# Local plugins
from local_livekit_plugins import FasterWhisperSTT, PiperTTS

# Configure logging
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


class VoiceAssistant(Agent):
    """A simple voice assistant that responds to user queries."""
    def __init__(self) -> None:
        super().__init__(
            instructions="""You are a helpful voice AI assistant.
            Keep your responses concise and conversational - aim for 1-2 sentences.
            Be friendly and natural in your speech patterns."""
        )

def _warmup_ollama_sync():
    """Blocking function to ping Ollama and load the model into VRAM."""
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
    """Async wrapper for the ollama warmup."""
    logger.info("Warming up Ollama VRAM...")
    await asyncio.to_thread(_warmup_ollama_sync)
    logger.info("Ollama warmup complete!")

def create_local_session() -> AgentSession:
    logger.info("=" * 60)
    logger.info("STARTING PIPELINE")
    logger.info("=" * 60)
    logger.info(f"  STT: FasterWhisper ({WHISPER_MODEL} on {WHISPER_DEVICE})")
    logger.info(f"  LLM: Ollama ({OLLAMA_MODEL})")
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
        llm=lk_openai.LLM.with_ollama(
            model=OLLAMA_MODEL,
            base_url=OLLAMA_BASE_URL,
        ),
        tts=PiperTTS(
            model_path=PIPER_MODEL_PATH,
            use_cuda=PIPER_USE_CUDA,
        ),
        vad=silero.VAD.load(),
    )


async def entrypoint(ctx: agents.JobContext) -> None:
    """Main entrypoint for the voice agent."""
    logger.info(f"Joining room: {ctx.room.name}")
    await ctx.connect()

    session = create_local_session()

    _transcription_time: float | None = None

    @session.on("user_input_transcribed")
    def on_user_input_transcribed(ev) -> None:
        nonlocal _transcription_time
        _transcription_time = time.perf_counter()
        logger.debug(f"User said: {ev.transcript[:80]}...")

    @session.on("agent_state_changed")
    def on_agent_state_changed(ev) -> None:
        nonlocal _transcription_time
        if ev.new_state == "speaking" and _transcription_time is not None:
            latency_ms = (time.perf_counter() - _transcription_time) * 1000
            logger.info(f"ROUND-TRIP LATENCY: {latency_ms:.0f}ms (LLM + TTS)")
            _transcription_time = None

    async def send_chat(msg: str):
        payload = json.dumps({
            "id": str(time.time()),
            "message": msg,
            "timestamp": int(time.time() * 1000)
        })
        await ctx.room.local_participant.publish_data(payload, topic="lk-chat")

    await send_chat("Loading recipe to GPU oven... please give me a moment to warm up! 🍳")

    # Force the model to load into GPU so the first real response is fast
    await warmup_ollama()
    
    await send_chat("Ding! Oven is hot. Start speaking when you're ready! 🗣️")

    await session.start(
        room=ctx.room,
        agent=VoiceAssistant(),
        room_input_options=RoomInputOptions(),
    )

    await session.generate_reply(
        instructions="Greet the user and let them know you're ready to help."
    )
    logger.info("Agent ready - listening for speech...")


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
        )
    )
