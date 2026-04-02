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
  const [myNumber, setMyNumber] = useState<string>('33612345678');
  const [targetNumber, setTargetNumber] = useState<string>('33987654321');
  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showManualPlay, setShowManualPlay] = useState(false);

  const [dialer] = useState(() => new PSTNDialer({
    baseUrl: process.env.NEXT_PUBLIC_ORACLE_BASE_URL || 'http://localhost:3000',
    apiKey: process.env.NEXT_PUBLIC_ORACLE_API_KEY || 'test-key-default',
  }));

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const durationInterval = useRef<NodeJS.Timeout | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  // ==================== POLLING ====================
  useEffect(() => {
    if (step !== 'phone' || !myNumber) return;

    pollingInterval.current = setInterval(async () => {
      try {
        const res = await dialer.checkIncomingCalls(myNumber);

        if (res?.success && res?.data) {
          const d = res.data;
          let oracleCaller = d.call?.caller || d.caller || 'unknown';

          console.log(`📊 Extrait brut Oracle → Caller: "${oracleCaller}" | Called: "${d.call?.called || myNumber}"`);

          // Protection importante : on ignore si l'appelant est nous-même ou unknown
          if (!currentCall && oracleCaller !== 'unknown' && oracleCaller !== myNumber) {
            const realCaller = oracleCaller;   // On prend ce que l'Oracle donne (si ce n'est plus unknown)

            console.log(`✅ VRAI APPEL ENTRANT → De ${realCaller}`);

            const incomingCall: CallSession = {
              id: d.callId || `in-${Date.now()}`,
              caller: realCaller,
              called: myNumber,
              direction: 'inbound',
              status: 'ringing',
              duration: 0,
              startTime: new Date(),
            };

            setCurrentCall(incomingCall);
            playRingtone(400, 800);
            setTimeout(() => playRingtone(480, 1000), 1200);
          }
        }
      } catch (err) {}
    }, 8000);

    return () => {
      if (pollingInterval.current) clearInterval(pollingInterval.current);
      stopDurationTimer();
    };
  }, [step, myNumber, currentCall]);

  // Le reste du code (audio, ringtone, answer, hangup, etc.) reste identique
  // ... (copie le reste du code de la version précédente pour startAudioCapture, playAudioFromBase64, makeOutboundCall, answerCall, hangupCall, etc.)

  // Pour ne pas tout recopier, je te donne seulement les parties modifiées. 
  // Garde tout le reste du fichier précédent (les fonctions audio, timers, UI, etc.)

  const makeOutboundCall = async () => {
    if (!targetNumber) return alert("Entrez un numéro à appeler");
    try {
      const res = await dialer.initiateCall(myNumber, targetNumber);
      const callId = res.data?.callId || `call-${Date.now()}`;

      const call: CallSession = {
        id: callId,
        caller: myNumber,
        called: targetNumber,
        direction: 'outbound',
        status: 'ringing',
        duration: 0,
        startTime: new Date(),
      };
      setCurrentCall(call);

      await startAudioCapture(callId);
      playRingtone(440, 1000);
      setTimeout(() => playRingtone(480, 1000), 1500);
    } catch (e: any) {
      alert(e.message || "Erreur lors de l'appel");
    }
  };

  const answerCall = async () => {
    if (!currentCall) return;
    try {
      await dialer.answerCall(currentCall.id, { callerNumber: myNumber, calledNumber: currentCall.caller });
      setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);
      startDurationTimer();
    } catch (e) {
      console.error(e);
    }
  };

  const hangupCall = () => {
    stopAudioCapture();
    stopDurationTimer();
    setCurrentCall(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 text-white">
      <audio ref={playbackAudioRef} className="hidden" playsInline />

      <div className="max-w-md mx-auto pt-8">
        {step === 'login' ? (
          <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-10 text-center">
            <div className="text-7xl mb-8">☎️</div>
            <h1 className="text-4xl font-bold mb-3">PSTN Dialer</h1>
            <input
              type="tel"
              value={myNumber}
              onChange={(e) => setMyNumber(e.target.value)}
              className="w-full bg-white/10 border border-gray-600 rounded-2xl px-6 py-5 text-2xl font-mono text-center mb-8"
              placeholder="Votre numéro"
            />
            <button onClick={login} className="w-full bg-green-600 py-5 rounded-2xl text-xl font-bold">
              Se connecter
            </button>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-8 bg-white/10 p-4 rounded-2xl">
              <div>
                <p className="text-sm text-gray-400">Connecté en tant que</p>
                <p className="font-mono text-xl">{myNumber}</p>
              </div>
              <button onClick={() => { setStep('login'); setCurrentCall(null); stopAudioCapture(); }} className="text-red-400">Déconnexion</button>
            </div>

            {!currentCall ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Numéro à appeler</label>
                  <input
                    type="tel"
                    value={targetNumber}
                    onChange={(e) => setTargetNumber(e.target.value)}
                    className="w-full bg-white/10 border border-gray-600 rounded-2xl px-6 py-5 text-2xl font-mono text-center"
                    placeholder="33612345678"
                  />
                </div>
                <button onClick={makeOutboundCall} className="w-full bg-green-600 py-6 rounded-3xl text-2xl font-bold">
                  📞 Appeler
                </button>
              </div>
            ) : (
              <div className="bg-white/10 rounded-3xl p-8">
                <p className="text-center text-3xl font-mono mb-6">
                  {currentCall.direction === 'inbound' 
                    ? `De ${currentCall.caller}` 
                    : `Vers ${currentCall.called}`}
                </p>

                <p className="text-center text-2xl mb-8 font-semibold">
                  {currentCall.status === 'answered' ? '✅ En communication' : '📳 Sonnerie...'}
                </p>

                {currentCall.status === 'answered' && (
                  <p className="text-center text-5xl font-mono text-green-400 mb-10">
                    {Math.floor(currentCall.duration / 60)}:{(currentCall.duration % 60).toString().padStart(2, '0')}
                  </p>
                )}

                {isRecording && (
                  <div className="mb-8">
                    <p className="text-center text-gray-400 mb-2">Niveau micro</p>
                    <div className="h-4 bg-gray-700 rounded-full overflow-hidden">
                      <div className="bg-green-500 h-full transition-all" style={{ width: `${Math.min(audioLevel / 2.55, 100)}%` }} />
                    </div>
                  </div>
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
          </div>
        )}
      </div>
    </div>
  );
}
