import { useEffect, useRef, useState } from "react";
import Peer from "simple-peer";
import Ably from "ably/promises";

const ably = new Ably.Realtime.Promise({
  key: process.env.NEXT_PUBLIC_ABLY_KEY!,
});

export default function PSTNPhone() {
  const [myNumber, setMyNumber] = useState("33612345678");
  const [targetNumber, setTargetNumber] = useState("33987654321");
  const [currentCall, setCurrentCall] = useState<any>(null);

  const peerRef = useRef<Peer.Instance | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // -----------------------------
  // 1. Ably : abonnement à mon channel
  // -----------------------------
  useEffect(() => {
    const channel = ably.channels.get(`calls:${myNumber}`);

    channel.subscribe("incoming-call", ({ data }) => {
      setCurrentCall({
        id: data.callId,
        caller: data.caller,
        called: myNumber,
        direction: "inbound"
      });
    });

    channel.subscribe("webrtc-signal", ({ data }) => {
      peerRef.current?.signal(data.signal);
    });

    return () => channel.detach();
  }, [myNumber]);

  // -----------------------------
  // 2. Lancer WebRTC
  // -----------------------------
  const startWebRTC = async (isInitiator: boolean, otherNumber: string) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const peer = new Peer({
      initiator: isInitiator,
      trickle: false,
      stream
    });

    peerRef.current = peer;

    // Envoi du signal via Ably
    peer.on("signal", (signal) => {
      ably.channels.get(`calls:${otherNumber}`).publish("webrtc-signal", {
        callId: currentCall?.id,
        signal
      });
    });

    // Flux audio distant
    peer.on("stream", (remoteStream) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play();
      }
    });
  };

  // -----------------------------
  // 3. Appel sortant
  // -----------------------------
  const call = () => {
    const callId = "call-" + Date.now();

    setCurrentCall({
      id: callId,
      caller: myNumber,
      called: targetNumber,
      direction: "outbound"
    });

    ably.channels.get(`calls:${targetNumber}`).publish("incoming-call", {
      caller: myNumber,
      callId
    });

    startWebRTC(true, targetNumber);
  };

  // -----------------------------
  // 4. Répondre
  // -----------------------------
  const answer = () => {
    startWebRTC(false, currentCall.caller);
  };

  return (
    <div>
      <h1>📡 WebRTC + Ably + Netlify</h1>

      <audio ref={remoteAudioRef} autoPlay />

      {!currentCall ? (
        <>
          <input value={targetNumber} onChange={e => setTargetNumber(e.target.value)} />
          <button onClick={call}>📞 Appeler</button>
        </>
      ) : currentCall.direction === "inbound" ? (
        <>
          <p>Appel entrant de {currentCall.caller}</p>
          <button onClick={answer}>📞 Décrocher</button>
        </>
      ) : (
        <>
          <p>Appel vers {currentCall.called}</p>
        </>
      )}
    </div>
  );
}
