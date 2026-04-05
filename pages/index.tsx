'use client';

import 'webrtc-adapter';
import { useState, useRef, useEffect } from 'react';
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
  const [statusMessage, setStatusMessage] = useState('');

  const [dialer] = useState(() => new PSTNDialer({
    baseUrl: process.env.NEXT_PUBLIC_ORACLE_BASE_URL || '',
    apiKey: process.env.NEXT_PUBLIC_ORACLE_API_KEY || 'test-key-default',
  }));

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<Peer.Instance | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const durationInterval = useRef<NodeJS.Timeout | null>(null);

  // ---------------------------
  // TIMER D’APPEL
  // ---------------------------
  const startDurationTimer = () => {
    if (durationInterval.current) clearInterval(durationInterval.current);
    durationInterval.current = setInterval(() => {
      setCurrentCall(prev => prev && prev.status === 'answered'
        ? { ...prev, duration: prev.duration + 1 }
        : prev);
    }, 1000);
  };

  // ---------------------------
  // WEBSOCKET ORACLE
  // ---------------------------
  useEffect(() => {
    const ws = new WebSocket(
      `${process.env.NEXT_PUBLIC_ORACLE_WS_URL}?apiKey=${process.env.NEXT_PUBLIC_ORACLE_API_KEY}`
    );

    ws.onmessage = (msg) => {
      const event = JSON.parse(msg.data);

      // SDP distante
      if (event.type === 'webrtc.sdp' && peerRef.current) {
        peerRef.current.signal(event.sdp);
      }

      // Appel réellement répondu côté PSTN
      if (event.type === 'call.answered') {
        setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);
        setIsInCall(true);
        startDurationTimer();
      }

      // Raccroché côté PSTN
      if (event.type === 'call.hangup') {
        hangupCall();
      }
    };

    return () => ws.close();
  }, []);

  // ---------------------------
  // LANCER WEBRTC
  // ---------------------------
  const startWebRTCCall = async (isOutbound: boolean) => {
    try {
      setStatusMessage('Demande d’accès au micro...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000
        }
      });

      localStreamRef.current = stream;
      setStatusMessage('Micro activé');

      const peer = new Peer({
        initiator: isOutbound,
        trickle: false,
        stream
      });

      peerRef.current = peer;

      // Envoi de l’offer/answer locale vers Oracle
      peer.on('signal', async (data) => {
        if (!currentCall) return;
        await dialer.sendWebRTCSignal(currentCall.id, data);
      });

      // Réception du flux audio distant
      peer.on('stream', (remoteStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play()
            .then(() => setStatusMessage('Audio distant OK'))
            .catch(() => {
              setShowSoundButton(true);
              setStatusMessage('Lecture audio bloquée');
            });
        }
      });

      peer.on('error', (err) => {
        console.error('WebRTC error', err);
        setStatusMessage('Erreur WebRTC : ' + err.message);
      });

    } catch (err: any) {
      console.error('Erreur micro', err);
      setStatusMessage('Permission micro refusée.');
    }
  };

  // ---------------------------
  // APPEL SORTANT
  // ---------------------------
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

    startWebRTCCall(true);
  };

  // ---------------------------
  // RÉPONDRE À UN APPEL
  // ---------------------------
  const answerCall = async () => {
    if (!currentCall) return;
    await dialer.answerCall(currentCall.id, {
      callerNumber: currentCall.caller,
      calledNumber: myNumber
    });

    setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);
    setIsInCall(true);
    startDurationTimer();
    startWebRTCCall(false);
  };

  // ---------------------------
  // RACROCHER
  // ---------------------------
  const hangupCall = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peerRef.current?.destroy();
    if (durationInterval.current) clearInterval(durationInterval.current);

    setCurrentCall(null);
    setIsInCall(false);
    setShowSoundButton(false);
    setStatusMessage('');
  };

  const enableSound = () => {
    setShowSoundButton(false);
    remoteAudioRef.current?.play();
  };

  // ---------------------------
  // UI
  // ---------------------------
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
            <button
              onClick={() => setStep('phone')}
              className="w-full bg-green-600 py-5 rounded-2xl text-xl font-bold"
            >
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
              <button onClick={() => { setStep('login'); hangupCall(); }} className="text-red-400">
                Déconnexion
              </button>
            </div>

            <audio ref={remoteAudioRef} autoPlay playsInline />

            {showSoundButton && (
              <button
                onClick={enableSound}
                className="w-full bg-yellow-600 py-5 rounded-2xl text-lg font-bold mb-6"
              >
                🔊 FORCER LA LECTURE AUDIO
              </button>
            )}

            {statusMessage && (
              <div className="bg-blue-600/80 p-4 rounded-2xl mb-6 text-center text-sm">
                {statusMessage}
              </div>
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
                <button
                  onClick={makeOutboundCall}
                  className="w-full bg-green-600 py-6 rounded-3xl text-2xl font-bold"
                >
                  📞 Appeler (WebRTC)
                </button>
              </div>
            ) : (
              <div className="bg-white/10 rounded-3xl p-10 text-center">
                <p className="text-3xl font-mono mb-6">
                  {currentCall.direction === 'inbound'
                    ? `De ${currentCall.caller}`
                    : `Vers ${currentCall.called}`}
                </p>

                <p className="text-2xl mb-10 text-green-400">
                  {currentCall.status === 'answered'
                    ? `En communication • ${Math.floor(currentCall.duration / 60)}:${(currentCall.duration % 60).toString().padStart(2, '0')}`
                    : '📞 Sonnerie...'}
                </p>

                <button
                  onClick={hangupCall}
                  className="w-full bg-red-600 py-6 rounded-3xl text-2xl font-bold"
                >
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
