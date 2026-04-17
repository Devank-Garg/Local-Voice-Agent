"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { DisconnectReason } from "livekit-client";
import VoiceAssistantUI from "@/components/VoiceAssistantUI";

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!started) return;

    setError(null);
    setToken(null);
    setWsUrl(null);

    fetch("/api/token?room=console", {
      headers: { "ngrok-skip-browser-warning": "true" },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Token API error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (data.accessToken && data.url) {
          setToken(data.accessToken);
          setWsUrl(data.url);
        } else {
          throw new Error("Invalid token response from server");
        }
      })
      .catch((err) => setError(err.message));
  }, [started]);

  if (error) {
    return (
      <main className="flex h-[100dvh] w-full flex-col items-center justify-center bg-bg-dark overflow-hidden">
        <div className="glass rounded-xl p-8 max-w-sm w-[90%] text-center space-y-6 fade-in">
          <div className="w-10 h-10 mx-auto rounded-full border border-red-500/40 flex items-center justify-center">
            <span className="text-red-400 text-sm">!</span>
          </div>
          <div className="space-y-1">
            <h2 className="text-sm tracking-[0.2em] uppercase text-gray-300">Connection Error</h2>
            <p className="text-gray-500 text-xs">{error}</p>
          </div>
          <button
            onClick={() => { setError(null); setStarted(true); }}
            className="w-full border border-livekit-cyan/40 hover:border-livekit-cyan hover:bg-livekit-cyan/10 active:scale-95 text-livekit-cyan py-3 px-6 rounded-xl transition-all tracking-[0.2em] uppercase text-xs"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!started) {
    return (
      <main className="ambient-bg relative flex h-[100dvh] w-full flex-col items-center justify-center bg-bg-dark overflow-hidden">

        <div className="relative z-10 flex flex-col items-center text-center space-y-8 px-8 max-w-sm w-full">
          <div className="space-y-2">
            <p className="text-xs tracking-[0.4em] uppercase text-gray-600">Voice Interface</p>
            <h1 className="text-5xl font-thin tracking-[0.25em] text-white">
              {process.env.NEXT_PUBLIC_AGENT_NAME || "AI"}
            </h1>
            <p className="text-gray-500 text-sm tracking-wide">Local • Private • Always On</p>
          </div>

          <button
            onClick={() => setStarted(true)}
            className="w-full border border-livekit-cyan/40 hover:border-livekit-cyan hover:bg-livekit-cyan/10 active:scale-95 text-livekit-cyan py-4 px-6 rounded-xl transition-all tracking-[0.2em] uppercase text-sm"
          >
            Initialize
          </button>
        </div>
      </main>
    );
  }

  if (!token || !wsUrl) {
    return (
      <main className="flex h-[100dvh] w-full items-center justify-center bg-bg-dark">
        <div className="w-12 h-12 rounded-full border-t-2 border-livekit-cyan animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex h-[100dvh] w-full items-center justify-center bg-bg-dark overflow-hidden fixed inset-0">
      <LiveKitRoom
        token={token}
        serverUrl={wsUrl}
        connect={true}
        audio={true}
        video={false}
        onDisconnected={(reason) => {
          setToken(null);
          setWsUrl(null);
          setStarted(false);
          if (reason !== DisconnectReason.CLIENT_INITIATED) {
            setError("Disconnected unexpectedly. Please try again.");
          }
        }}
      >
        <VoiceAssistantUI />
      </LiveKitRoom>
    </main>
  );
}
