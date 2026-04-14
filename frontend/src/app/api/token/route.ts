import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Agent python script default room is "console"
  const roomName = req.nextUrl.searchParams.get('room') || 'console'; 
  const participantName = `WebUser-${Math.floor(Math.random() * 10000)}`;

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) {
    return NextResponse.json(
      { error: 'Server misconfigured. LIVEKIT API credentials missing.' },
      { status: 500 }
    );
  }

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
      name: participantName,
    });
    
    at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
    
    const token = await at.toJwt();

    // The Python agent auto-dispatches when a participant joins the room (dev/worker mode).
    // No explicit dispatch needed here.

    return NextResponse.json({ accessToken: token, url: wsUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
