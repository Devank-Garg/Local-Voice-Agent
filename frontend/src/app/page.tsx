"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import VoiceAssistantUI from "@/components/VoiceAssistantUI";

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    // Only fetch token if user pressed start to delay mic permissions popup
    if (!started) return;

    fetch("/api/token?room=console", {
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("API responded with an error");
        return res.json();
      })
      .then((data) => {
        if (data.accessToken && data.url) {
          setToken(data.accessToken);
          setWsUrl(data.url);
        } else {
          console.error("Failed to fetch token", data);
        }
      })
      .catch((err) => console.error(err));
  }, [started]);

  if (!started) {
    return (
      <main className="flex h-[100dvh] w-full flex-col items-center justify-center bg-bg-dark">
        <div className="glass rounded-3xl p-8 max-w-sm w-[90%] text-center space-y-6">
          <h2 className="text-2xl font-light tracking-wide">Welcome to <span className="font-semibold text-livekit-cyan">Gemma</span></h2>
          <p className="text-gray-400 text-sm">Your personal voice assistant running entirely locally.</p>
          <button 
            onClick={() => setStarted(true)}
            className="w-full bg-livekit-cyan hover:brightness-110 active:scale-95 text-black font-semibold py-4 px-6 rounded-full transition-all tracking-wide"
          >
            Tap to Connect
          </button>
        </div>
      </main>
    )
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
      >
        <VoiceAssistantUI />
      </LiveKitRoom>
    </main>
  );
}
