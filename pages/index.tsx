'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export default function PSTNPhone() {
  const [step, setStep] = useState<'login' | 'phone'>('login');
  const [myNumber, setMyNumber] = useState('33612345678');
  const [targetNumber, setTargetNumber] = useState('33987654321');
  const [currentCall, setCurrentCall] = useState<any>(null);
  const [isInCall, setIsInCall] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const [showSoundButton, setShowSoundButton] = useState(false);

  // Création de la connexion WebRTC
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play().catch(() => setShowSoundButton(true));
      }
      console.log("▶️ Flux audio distant reçu (WebRTC)");
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE state:", pc.iceConnectionState);
    };

    return pc;
  }, []);

  const startCall = async (isOutgoing: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 } 
      });
      localStreamRef.current = stream;

      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      if (isOutgoing) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log("📤 Offer envoyée (simulation WebRTC)");
        // Ici on simule l'échange SDP via polling ou signaling (pour l'instant on force answer)
        setTimeout(() => simulateAnswer(pc), 800);
      } else {
        // Incoming - on simule offer reçue
        const offer = await pc.createOffer(); // simulation
        await pc.setLocalDescription(offer);
      }

      setIsInCall(true);
      setCurrentCall({ direction: isOutgoing ? 'outbound' : 'inbound' });
      console.log(`🎥 Appel ${isOutgoing ? 'sortant' : 'entrant'} démarré avec WebRTC`);
    } catch (err) {
      console.error("Erreur WebRTC", err);
    }
  };

  const simulateAnswer = async (pc: RTCPeerConnection) => {
    const answer = await pc.createAnswer();
    await pc.setRemoteDescription(answer);
    console.log("✅ Answer simulée - connexion WebRTC établie");
  };

  const hangupCall = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    setIsInCall(false);
    setCurrentCall(null);
  };

  const enableSound = async () => {
    setShowSoundButton(false);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.play();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 text-white">
      <div className="max-w-md mx-auto pt-12">
        {step === 'login' ? (
          <div className="text-center">
            <h1 className="text-5xl mb-8">☎️ PSTN Dialer WebRTC</h1>
            <input
              type="tel"
              value={myNumber}
              onChange={e => setMyNumber(e.target.value)}
              className="w-full bg-white/10 border border-gray-500 rounded-2xl px-8 py-6 text-3xl font-mono text-center mb-8"
            />
            <button onClick={() => setStep('phone')} className="w-full bg-green-600 py-5 rounded-2xl text-xl font-bold">
              Se connecter
            </button>
          </div>
        ) : (
          <>
            <div className="flex justify-between mb-10 bg-white/10 p-5 rounded-2xl">
              <div>
                <div className="text-gray-400 text-sm">Connecté en tant que</div>
                <div className="font-mono text-2xl">{myNumber}</div>
              </div>
              <button onClick={() => { setStep('login'); hangupCall(); }} className="text-red-400">Déconnexion</button>
            </div>

            <audio ref={remoteAudioRef} autoPlay playsInline />

            {showSoundButton && (
              <button onClick={enableSound} className="w-full bg-yellow-600 py-5 rounded-2xl text-lg font-bold mb-8">
                🔊 ACTIVER LE SON
              </button>
            )}

            {!isInCall ? (
              <div className="space-y-6">
                <input
                  type="tel"
                  value={targetNumber}
                  onChange={e => setTargetNumber(e.target.value)}
                  className="w-full bg-white/10 border border-gray-500 rounded-2xl px-8 py-6 text-3xl font-mono text-center"
                  placeholder="Numéro à appeler"
                />
                <button onClick={() => startCall(true)} className="w-full bg-green-600 py-6 rounded-3xl text-2xl font-bold">
                  📞 Appeler (WebRTC)
                </button>
                <button onClick={() => startCall(false)} className="w-full bg-blue-600 py-6 rounded-3xl text-2xl font-bold">
                  📥 Simuler Appel Entrant
                </button>
              </div>
            ) : (
              <div className="bg-white/10 rounded-3xl p-10 text-center">
                <p className="text-3xl font-mono mb-6">
                  {currentCall?.direction === 'outbound' ? `Vers ${targetNumber}` : `De ${targetNumber}`}
                </p>
                <p className="text-2xl mb-10 text-green-400">✅ En communication WebRTC (basse latence)</p>
                <button onClick={hangupCall} className="w-full bg-red-600 py-6 rounded-3xl text-2xl font-bold">
                  📴 Raccrocher
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
