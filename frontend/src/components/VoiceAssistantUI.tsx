"use client";

import { useVoiceAssistant, BarVisualizer, RoomAudioRenderer, ControlBar, useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { Sparkles } from "lucide-react";

export default function VoiceAssistantUI() {
  const assistant = useVoiceAssistant();
  const connectionState = useConnectionState();

  const getOrbStateClass = () => {
    if (connectionState !== ConnectionState.Connected) return "orb-breathe opacity-50";
    if (assistant.state === "speaking") return "orb-speaking";
    if (assistant.state === "listening") return "orb-listening";
    return "orb-breathe";
  };

  const getStatusText = () => {
    if (connectionState === ConnectionState.Connecting) return "Connecting securely...";
    if (connectionState === ConnectionState.Disconnected) return "Disconnected.";
    if (assistant.state === "speaking") return "Agent is speaking...";
    if (assistant.state === "listening") return "I'm listening...";
    return "Warming up recipes...";
  };

  return (
    <div className="flex flex-col items-center justify-between h-full w-full max-w-md mx-auto py-12 px-6">
      <div className="text-center space-y-2 mt-8">
        <h1 className="text-3xl font-light tracking-wide flex items-center justify-center gap-2">
          Gemma <span className="font-semibold text-livekit-cyan">AI</span> <Sparkles className="w-5 h-5 text-livekit-cyan" />
        </h1>
        <p className="text-sm text-gray-400 font-light">{getStatusText()}</p>
      </div>

      {/* Dynamic Center Orb */}
      <div className="flex-1 flex items-center justify-center relative w-full">
        <div className={`w-56 h-56 rounded-full border border-white/10 flex items-center justify-center transition-all duration-300 ${getOrbStateClass()} bg-gradient-to-br from-white/5 to-white/0`}>
          {assistant.audioTrack && connectionState === ConnectionState.Connected && (
            <div className="absolute inset-x-12 h-24 text-livekit-cyan drop-shadow-[0_0_8px_rgba(0,210,254,0.8)]">
              <BarVisualizer
                track={assistant.audioTrack}
                state={assistant.state}
                barCount={7}
                options={{ minHeight: 4 }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Glassmorphism Control Bar */}
      <div className="w-full glass rounded-3xl p-6 flex flex-col gap-6 mb-8 mt-auto backdrop-blur-xl">
        <RoomAudioRenderer />
        <div className="flex items-center justify-center gap-6 [&>div]:w-full [&>div]:flex [&>div]:justify-center">
            <ControlBar controls={{ microphone: true, camera: false, screenShare: false }} />
        </div>
      </div>
    </div>
  );
}
