'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Peer from 'simple-peer';
import PSTNDialer from '../lib/pstn-dialer';

interface CallSession {
  id: string;
  caller: string;
  called: string;
  direction: 'inbound' | 'outbound';
  status: 'ringing' | 'answered' | 'hungup' | 'completed';
  duration: number;
  startTime: Date;
}

export default function PSTNPhone() {
  const [step, setStep] = useState<'login' | 'phone'>('login');
  const [myNumber, setMyNumber] = useState('33612345678');
  const [targetNumber, setTargetNumber] = useState('33987654321');
  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [isInCall, setIsInCall] = useState(false);
  const [showSoundButton, setShowSoundButton] = useState(false);

  const [dialer] = useState(() => new PSTNDialer({
    baseUrl: process.env.NEXT_PUBLIC_ORACLE_BASE_URL || '',
    apiKey: process.env.NEXT_PUBLIC_ORACLE_API_KEY || 'test-key-default',
  }));

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<Peer.Instance | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const durationInterval = useRef<NodeJS.Timeout | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  // Polling oracle (signaling uniquement)
  useEffect(() => {
    if (step !== 'phone' || !myNumber) return;

    pollingInterval.current = setInterval(async () => {
      try {
        const res = await dialer.checkIncomingCalls(myNumber);
        if (!res?.success || !res?.data) return;

        const d = res.data;
        const oracleCaller = (d.call?.caller || d.caller || 'unknown').trim();
        const oracleStatus = (d.call?.status || d.status || 'INITIATED').toUpperCase();

        if (!currentCall && oracleCaller !== 'unknown' && oracleCaller !== myNumber) {
          console.log(`📥 VRAI APPEL ENTRANT de ${oracleCaller}`);
          setCurrentCall({
            id: d.callId || `in-${Date.now()}`,
            caller: oracleCaller,
            called: myNumber,
            direction: 'inbound',
            status: 'ringing',
            duration: 0,
            startTime: new Date(),
          });
        }

        if (currentCall && oracleStatus === 'ANSWERED' && currentCall.status !== 'answered') {
          setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);
          setIsInCall(true);
          startDurationTimer();
          startWebRTCCall();
        }
      } catch (e) {}
    }, 350);

    return () => {
      if (pollingInterval.current) clearInterval(pollingInterval.current);
    };
  }, [step, myNumber, currentCall]);

  const startDurationTimer = () => {
    if (durationInterval.current) clearInterval(durationInterval.current);
    durationInterval.current = setInterval(() => {
      setCurrentCall(prev => prev && prev.status === 'answered' 
        ? { ...prev, duration: prev.duration + 1 } 
        : prev);
    }, 1000);
  };

  const startWebRTCCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 }
      });
      localStreamRef.current = stream;

      const peer = new Peer({
        initiator: currentCall?.direction === 'outbound',
        trickle: false,
        stream: stream
      });

      peerRef.current = peer;

      peer.on('stream', (remoteStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(() => {
            console.log("Lecture bloquée → bouton manuel");
            setShowSoundButton(true);
          });
        }
        console.log("▶️ Flux WebRTC distant reçu - voix en direct");
      });

      peer.on('error', (err) => console.error("WebRTC error", err));
      peer.on('close', () => console.log("WebRTC fermé"));

    } catch (err) {
      console.error("Erreur démarrage WebRTC", err);
    }
  };

  const enableSound = () => {
    setShowSoundButton(false);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.play();
    }
  };

  const makeOutboundCall = async () => {
    const res = await dialer.initiateCall(myNumber, targetNumber);
    const callId = res.data?.callId || `call-${Date.now()}`;
    setCurrentCall({
      id: callId,
      caller: myNumber,
      called: targetNumber,
      direction: 'outbound',
      status: 'ringing',
      duration: 0,
      startTime: new Date(),
    });
    startWebRTCCall();
  };

  const answerCall = async () => {
    if (!currentCall) return;
    await dialer.answerCall(currentCall.id, { callerNumber: currentCall.caller, calledNumber: myNumber });
    setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);
    setIsInCall(true);
    startDurationTimer();
    startWebRTCCall();
  };

  const hangupCall = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peerRef.current?.destroy();
    peerRef.current = null;
    if (durationInterval.current) clearInterval(durationInterval.current);
    setCurrentCall(null);
    setIsInCall(false);
    setShowSoundButton(false);
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

            {!currentCall ? (
              <div className="space-y-6">
                <input
                  type="tel"
                  value={targetNumber}
                  onChange={e => setTargetNumber(e.target.value)}
                  className="w-full bg-white/10 border border-gray-500 rounded-2xl px-8 py-6 text-3xl font-mono text-center"
                  placeholder="Numéro à appeler"
                />
                <button onClick={makeOutboundCall} className="w-full bg-green-600 py-6 rounded-3xl text-2xl font-bold">
                  📞 Appeler (WebRTC)
                </button>
              </div>
            ) : (
              <div className="bg-white/10 rounded-3xl p-10 text-center">
                <p className="text-3xl font-mono mb-6">
                  {currentCall.direction === 'inbound' ? `De ${currentCall.caller}` : `Vers ${currentCall.called}`}
                </p>
                <p className="text-2xl mb-10 text-green-400">
                  ✅ En communication WebRTC • {Math.floor(currentCall.duration / 60)}:{(currentCall.duration % 60).toString().padStart(2, '0')}
                </p>
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
