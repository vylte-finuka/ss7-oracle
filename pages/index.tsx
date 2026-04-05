import { io, Socket } from "socket.io-client";
import Peer from "simple-peer";
import { useEffect, useRef, useState } from "react";

export default function PSTNPhone() {
  const [myNumber, setMyNumber] = useState("33612345678");
  const [targetNumber, setTargetNumber] = useState("33987654321");
  const [currentCall, setCurrentCall] = useState<any>(null);

  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<Peer.Instance | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // -----------------------------
  // 1. Connexion Socket.IO
  // -----------------------------
  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL!, {
      path: process.env.NEXT_PUBLIC_SOCKET_PATH!,
      transports: ["websocket"]
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("🟢 Socket.IO connecté :", socket.id);
      socket.emit("register", myNumber);
    });

    // Appel entrant
    socket.on("incoming-call", ({ caller, callId }) => {
      console.log("📞 Appel entrant :", caller);
      setCurrentCall({ id: callId, caller, called: myNumber, direction: "inbound" });
    });

    // Réponse
    socket.on("call-answered", ({ callId }) => {
      console.log("📞 Appel répondu :", callId);
    });

    // Signaling WebRTC
    socket.on("webrtc-signal", ({ signal }) => {
      console.log("📡 Signal WebRTC reçu");
      peerRef.current?.signal(signal);
    });

    return () => socket.disconnect();
  }, [myNumber]);

  // -----------------------------
  // 2. Lancer WebRTC
  // -----------------------------
  const startWebRTC = async (isInitiator: boolean, otherNumber: string) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;

    const peer = new Peer({
      initiator: isInitiator,
      trickle: false,
      stream
    });

    peerRef.current = peer;

    // Envoi du signal WebRTC via Socket.IO
    peer.on("signal", (signal) => {
      socketRef.current?.emit("webrtc-signal", {
        callId: currentCall?.id,
        signal,
        to: otherNumber
      });
    });

    // Réception du flux audio distant
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

    socketRef.current?.emit("call", {
      caller: myNumber,
      called: targetNumber,
      callId
    });

    startWebRTC(true, targetNumber);
  };

  // -----------------------------
  // 4. Répondre
  // -----------------------------
  const answer = () => {
    socketRef.current?.emit("answer", {
      callId: currentCall.id,
      answerer: myNumber
    });

    startWebRTC(false, currentCall.caller);
  };

  // -----------------------------
  // 5. Raccrocher
  // -----------------------------
  const hangup = () => {
    socketRef.current?.emit("hangup", { callId: currentCall.id });
    peerRef.current?.destroy();
    setCurrentCall(null);
  };

  return (
    <div>
      <h1>PSTN WebRTC Phone</h1>

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
          <button onClick={hangup}>❌ Refuser</button>
        </>
      ) : (
        <>
          <p>Appel vers {currentCall.called}</p>
          <button onClick={hangup}>❌ Raccrocher</button>
        </>
      )}
    </div>
  );
}
