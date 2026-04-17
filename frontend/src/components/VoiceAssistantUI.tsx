"use client";

import { useState } from "react";
import {
  useVoiceAssistant,
  BarVisualizer,
  RoomAudioRenderer,
  ControlBar,
  useConnectionState,
  useDataChannel,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";

const AGENT_NAME = process.env.NEXT_PUBLIC_AGENT_NAME || "AI Assistant";

export default function VoiceAssistantUI() {
  const assistant = useVoiceAssistant();
  const connectionState = useConnectionState();

  const [toolStatus, setToolStatus] = useState<string>("");
  const [warmupStatus, setWarmupStatus] = useState<string>("");

  useDataChannel("lk-chat", (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload));
      if (data.type === "tool_status") {
        setToolStatus(data.status ?? "");
      } else if (data.type === "message" && data.role === "agent" && data.message) {
        setWarmupStatus(data.message);
      }
    } catch {
      // ignore
    }
  });

  const isConnected = connectionState === ConnectionState.Connected;
  const isListening = isConnected && assistant.state === "listening";
  const isSpeaking = isConnected && assistant.state === "speaking";
  const isThinking = isConnected && assistant.state === "thinking";

  const getStatusText = () => {
    if (connectionState === ConnectionState.Connecting) return "Connecting...";
    if (connectionState === ConnectionState.Disconnected) return "Disconnected";
    if (toolStatus) return toolStatus;
    if (isSpeaking) return "Speaking";
    if (isListening) return "Listening";
    if (isThinking) return "Processing";
    if (isConnected) return warmupStatus || "Standby";
    return "Initializing";
  };

  const getStateColor = () => {
    if (isSpeaking) return "text-purple-400";
    if (isListening) return "text-livekit-cyan";
    if (isThinking) return "text-livekit-cyan";
    return "text-gray-500";
  };

  const getOrbClass = () => {
    if (!isConnected) return "orb-breathe opacity-40";
    if (isSpeaking) return "orb-speaking";
    if (isListening) return "orb-listening";
    if (isThinking) return "orb-thinking";
    return "orb-breathe";
  };

  return (
    <div className="relative flex flex-col items-center justify-between h-full w-full overflow-hidden">

      {/* Ambient background blobs */}
      <div className="ambient-blob w-96 h-96 bg-blue-900/20 top-[-10%] left-[-10%]" style={{ animationDelay: "0s" }} />
      <div className="ambient-blob w-80 h-80 bg-cyan-900/15 bottom-[10%] right-[-5%]" style={{ animationDelay: "4s" }} />
      <div className="ambient-blob w-64 h-64 bg-purple-900/15 bottom-[20%] left-[5%]" style={{ animationDelay: "8s" }} />

      {/* Top — Agent name */}
      <div className="relative z-10 pt-16 text-center">
        <p className="text-xs tracking-[0.4em] uppercase text-gray-600 mb-1">Voice Interface</p>
        <h1 className="text-4xl font-thin tracking-[0.2em] text-white">
          {AGENT_NAME}
        </h1>
        <div className="mt-2 flex items-center justify-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
            isListening ? "bg-livekit-cyan shadow-[0_0_6px_rgba(0,210,254,0.8)]" :
            isSpeaking  ? "bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.8)]" :
            isThinking  ? "bg-livekit-cyan animate-pulse" :
            isConnected ? "bg-gray-600" : "bg-gray-700"
          }`} />
          <span className={`text-xs tracking-widest uppercase status-text ${getStateColor()}`}>
            {getStatusText()}
          </span>
        </div>
      </div>

      {/* Center — Orb */}
      <div className="relative z-10 flex items-center justify-center">

        {/* Ripple rings — only when listening */}
        {isListening && (
          <>
            <div className="ripple-ring" />
            <div className="ripple-ring ripple-ring-2" />
            <div className="ripple-ring ripple-ring-3" />
          </>
        )}

        {/* Thinking arc ring */}
        {isThinking && <div className="orb-thinking-ring" />}

        {/* The orb itself */}
        <div
          className={`relative w-56 h-56 rounded-full border border-white/8 flex items-center justify-center transition-all duration-500 ${getOrbClass()}`}
          style={{
            background: isListening
              ? "radial-gradient(circle, rgba(0,210,254,0.1) 0%, rgba(0,69,250,0.06) 60%, transparent 100%)"
              : isSpeaking
              ? "radial-gradient(circle, rgba(100,80,255,0.12) 0%, rgba(0,210,254,0.06) 60%, transparent 100%)"
              : "radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)",
          }}
        >
          {/* Inner ring */}
          <div className={`absolute inset-4 rounded-full border transition-all duration-500 ${
            isListening ? "border-livekit-cyan/20" :
            isSpeaking  ? "border-purple-500/20" :
            "border-white/5"
          }`} />

          {/* Bar visualizer */}
          {assistant.audioTrack && isConnected && (
            <div className={`absolute inset-x-10 h-16 drop-shadow-[0_0_8px_rgba(0,210,254,0.9)] ${
              isSpeaking ? "text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.9)]" : "text-livekit-cyan"
            }`}>
              <BarVisualizer
                track={assistant.audioTrack}
                state={assistant.state}
                barCount={9}
                options={{ minHeight: 3 }}
              />
            </div>
          )}

          {/* Center dot when idle */}
          {!assistant.audioTrack && isConnected && (
            <div className={`w-3 h-3 rounded-full transition-all duration-500 ${
              isListening ? "bg-livekit-cyan shadow-[0_0_12px_rgba(0,210,254,1)]" :
              isThinking  ? "bg-livekit-cyan/60 animate-pulse" :
              "bg-white/20"
            }`} />
          )}
        </div>
      </div>

      {/* Bottom — Controls */}
      <div className="relative z-10 w-full max-w-xs pb-14 px-6">

        {/* Tool status pill */}
        {toolStatus && (
          <div className="flex justify-center mb-4 fade-in">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs text-livekit-cyan border border-livekit-cyan/25 bg-livekit-cyan/8 tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-livekit-cyan animate-pulse" />
              {toolStatus}
            </span>
          </div>
        )}

        <div className="glass rounded-2xl px-6 py-4">
          <RoomAudioRenderer />
          <div className="flex items-center justify-center [&>div]:w-full [&>div]:flex [&>div]:justify-center">
            <ControlBar controls={{ microphone: true, camera: false, screenShare: false }} />
          </div>
        </div>

        <p className="text-center text-[10px] text-gray-700 mt-3 tracking-widest uppercase">
          {isConnected ? "All processing runs locally" : ""}
        </p>
      </div>

    </div>
  );
}
