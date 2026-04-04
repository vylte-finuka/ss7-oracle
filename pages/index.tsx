'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
  const [showSoundButton, setShowSoundButton] = useState(false);

  const [dialer] = useState(() => new PSTNDialer({
    baseUrl: process.env.NEXT_PUBLIC_ORACLE_BASE_URL || '',
    apiKey: process.env.NEXT_PUBLIC_ORACLE_API_KEY || 'test-key-default',
  }));

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const durationInterval = useRef<NodeJS.Timeout | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  // Polling équilibré (350ms) - suffisant pour voix fluide sans spam
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
          startDurationTimer();
          startAudioCapture(currentCall.id);
        }

        const receivedAudio = d.audioData || d.data?.audioData;
        if (receivedAudio && receivedAudio.length > 40) {
          console.log(`🎵 AUDIO REÇU via oracle (${receivedAudio.length} chars)`);
          playReceivedAudio(receivedAudio);
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

  // Capture micro optimisée
  const startAudioCapture = async (callId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 }
      });
      mediaStreamRef.current = stream;

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current.ondataavailable = async (event) => {
        if (event.data.size < 80) return;

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string)?.split(',')[1] || '';
          if (base64) {
            const remote = currentCall?.called || targetNumber;
            console.log(`📤 Audio chunk #${Date.now()} → caller: ${myNumber} | called: ${remote}`);
            await dialer.sendAudioData(callId, base64, Date.now(), myNumber, remote);
          }
        };
        reader.readAsDataURL(event.data);
      };
      mediaRecorderRef.current.start(100);
      console.log("🎤 Micro démarré");
    } catch (err) {
      console.error("Erreur micro", err);
    }
  };

  const playReceivedAudio = useCallback(async (base64Input: string) => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();

      let clean = base64Input.trim().replace(/[^A-Za-z0-9+/=]/g, '');
      const binaryString = atob(clean);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

      const wavBuffer = createWAV(bytes.buffer);

      const audioBuffer = await ctx.decodeAudioData(wavBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start(0);

      console.log("▶️ VOIX REÇUE ET JOUÉE");
    } catch (err: any) {
      console.error("Lecture audio échouée :", err.message);
      setShowSoundButton(true);
    }
  }, [getAudioContext]);

  const createWAV = (rawAudioData: ArrayBuffer): ArrayBuffer => {
    const buffer = new ArrayBuffer(44 + rawAudioData.byteLength);
    const view = new DataView(buffer);

    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + rawAudioData.byteLength, true);
    view.setUint32(8, 0x57415645, false);
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 48000, true);
    view.setUint32(28, 96000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, rawAudioData.byteLength, true);

    new Uint8Array(buffer, 44).set(new Uint8Array(rawAudioData));
    return buffer;
  };

  const enableSound = async () => {
    setShowSoundButton(false);
    await getAudioContext().resume();
    console.log("🔊 AudioContext activé");
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
    startAudioCapture(callId);
  };

  const answerCall = async () => {
    if (!currentCall) return;
    await dialer.answerCall(currentCall.id, { callerNumber: currentCall.caller, calledNumber: myNumber });
    setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);
    startDurationTimer();
    startAudioCapture(currentCall.id);
  };

  const hangupCall = () => {
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    if (durationInterval.current) clearInterval(durationInterval.current);
    setCurrentCall(null);
    setShowSoundButton(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 text-white">
      <div className="max-w-md mx-auto pt-12">
        {step === 'login' ? (
          <div className="text-center">
            <h1 className="text-5xl mb-8">☎️ PSTN Dialer</h1>
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
                  📞 Appeler
                </button>
              </div>
            ) : (
              <div className="bg-white/10 rounded-3xl p-10 text-center">
                <p className="text-3xl font-mono mb-6">
                  {currentCall.direction === 'inbound' ? `De ${currentCall.caller}` : `Vers ${currentCall.called}`}
                </p>
                <p className="text-2xl mb-10">
                  {currentCall.status === 'answered' ? '✅ En communication' : '📳 Sonnerie...'}
                </p>
                {currentCall.status === 'answered' && (
                  <p className="text-6xl font-mono text-green-400 mb-12">
                    {Math.floor(currentCall.duration / 60)}:{(currentCall.duration % 60).toString().padStart(2, '0')}
                  </p>
                )}
                <div className="space-y-4">
                  {currentCall.status === 'ringing' && currentCall.direction === 'inbound' && (
                    <button onClick={answerCall} className="w-full bg-green-600 py-6 rounded-3xl text-2xl font-bold">
                      ✅ Décrocher
                    </button>
                  )}
                  <button onClick={hangupCall} className="w-full bg-red-600 py-6 rounded-3xl text-2xl font-bold">
                    📴 Raccrocher
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
