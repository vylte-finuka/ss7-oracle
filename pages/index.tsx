'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
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

  const socketRef = useRef<Socket | null>(null);
  const durationInterval = useRef<NodeJS.Timeout | null>(null);

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

  // Socket
  useEffect(() => {
    const socket = io({ path: '/api/socket' });
    socketRef.current = socket;

    socket.on('connect', () => console.log('✅ Socket connecté'));

    socket.on('incoming-call', ({ caller, callId }) => {
      console.log(`📞 Appel entrant de ${caller}`);
      const call: CallSession = {
        id: callId,
        caller,
        called: myNumber,
        direction: 'inbound',
        status: 'ringing',
        duration: 0,
        startTime: new Date(),
      };
      setCurrentCall(call);
      playRingtone(400, 1000);
      setTimeout(() => playRingtone(450, 1000), 1500);
    });

    socket.on('call-answered', ({ callId }) => {
      console.log(`✅ Signal "call-answered" reçu pour callId ${callId}`);
      setCurrentCall(prev => {
        if (prev && prev.id === callId) {
          return { ...prev, status: 'answered' };
        }
        return prev;
      });
      startDurationTimer();
    });

    socket.on('call-hungup', ({ callId }) => {
      if (currentCall?.id === callId) {
        setCurrentCall(null);
        stopAudioCapture();
        stopDurationTimer();
      }
    });

    return () => {
      socket.disconnect();
      stopDurationTimer();
    };
  }, [myNumber, currentCall]);

  // Timer durée (local et fiable)
  const startDurationTimer = () => {
    stopDurationTimer();
    console.log('⏱️ Démarrage du timer de durée');
    durationInterval.current = setInterval(() => {
      setCurrentCall(prev => {
        if (!prev || prev.status !== 'answered') return prev;
        return { ...prev, duration: prev.duration + 1 };
      });
    }, 1000);
  };

  const stopDurationTimer = () => {
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
  };

  // Lecture audio sécurisée
  const playAudioFromBase64 = useCallback((input: any) => {
    if (!playbackAudioRef.current || !input) {
      console.log('ℹ️ Aucun audio reçu du serveur');
      return;
    }

    let base64 = String(input).trim();
    if (base64.startsWith('data:')) base64 = base64.split(',')[1] || base64;

    if (!base64 || base64.length < 20) {
      console.log('⚠️ Base64 invalide ou trop court');
      return;
    }

    try {
      if (playbackAudioRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(playbackAudioRef.current.src);
      }

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'audio/webm;codecs=opus' });
      const url = URL.createObjectURL(blob);

      const audio = playbackAudioRef.current;
      audio.src = url;
      audio.volume = 1.0;
      audio.load();

      audio.play()
        .then(() => setShowManualPlay(false))
        .catch(err => {
          if (err.name === 'NotAllowedError') setShowManualPlay(true);
        });
    } catch (err) {
      console.error('❌ Base64 invalide:', err.message);
    }
  }, []);

  const startAudioCapture = async (callId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 },
        video: false,
      });

      mediaStreamRef.current = stream;
      console.log('✅ Microphone activé');

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      analyzerRef.current = ctx.createAnalyser();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyzerRef.current);
      analyzerRef.current.fftSize = 256;

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

      mediaRecorderRef.current.ondataavailable = async (event) => {
        if (event.data.size === 0 || !callId) return;

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string)?.split(',')[1];
          if (!base64) return;

          try {
            const response = await dialer.sendAudioData(
              callId,
              base64,
              Date.now(),
              myNumber,
              currentCall?.called || targetNumber
            );

            const audioBase64 = response?.data?.audioData 
                             || response?.audioData 
                             || response?.data?.payload?.base64 
                             || response?.payload?.base64;

            if (audioBase64) {
              console.log('🔊 Audio retour reçu du serveur');
              playAudioFromBase64(audioBase64);
            } else {
              console.log('ℹ️ Pas d\'audioData dans la réponse');
            }
          } catch (err) {
            console.error('❌ Erreur envoi audio:', err);
          }
        };
        reader.readAsDataURL(event.data);
      };

      mediaRecorderRef.current.start(250);
      setIsRecording(true);

      const analyze = () => {
        if (!analyzerRef.current) return;
        const data = new Uint8Array(analyzerRef.current.frequencyBinCount);
        analyzerRef.current.getByteFrequencyData(data);
        setAudioLevel(Math.round(data.reduce((a, b) => a + b, 0) / data.length));
        animationFrameRef.current = requestAnimationFrame(analyze);
      };
      analyze();
    } catch (err) {
      console.error('❌ Erreur micro:', err);
    }
  };

  const stopAudioCapture = () => {
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setIsRecording(false);
  };

  const playRingtone = (freq: number, duration: number) => {
    try {
      const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.3;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {}
  };

  // ==================== ACTIONS ====================
  const login = () => {
    if (!myNumber) return alert("Entrez votre numéro");
    socketRef.current?.emit('register', myNumber);
    setStep('phone');
  };

  const makeOutboundCall = async () => {
    if (!targetNumber) return alert("Entrez un numéro à appeler");
    try {
      const res = await dialer.initiateCall(myNumber, targetNumber);
      const callId = res.data.callId;

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

      socketRef.current?.emit('call', { caller: myNumber, called: targetNumber, callId });

      await startAudioCapture(callId);
      playRingtone(440, 1000);
      setTimeout(() => playRingtone(480, 1000), 1500);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const answerCall = async () => {
    if (!currentCall) return;
    try {
      await dialer.answerCall(currentCall.id, { 
        callerNumber: myNumber, 
        calledNumber: currentCall.caller 
      });
      setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);
      socketRef.current?.emit('answer', { callId: currentCall.id, answerer: myNumber });
    } catch (e) {
      console.error(e);
    }
  };

  const hangupCall = async () => {
    if (!currentCall) return;
    stopAudioCapture();
    try {
      await dialer.hangupCall(currentCall.id, currentCall.duration, {
        callerNumber: myNumber,
        calledNumber: currentCall.called || targetNumber,
      });
      socketRef.current?.emit('hangup', { callId: currentCall.id });
    } catch (e) {}
    setCurrentCall(null);
  };

  const simulateIncomingCall = () => {
    const call: CallSession = {
      id: 'in-' + Date.now(),
      caller: targetNumber,
      called: myNumber,
      direction: 'inbound',
      status: 'ringing',
      duration: 0,
      startTime: new Date(),
    };
    setCurrentCall(call);
    playRingtone(400, 1000);
    setTimeout(() => playRingtone(450, 1000), 1500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 text-white">
      <audio ref={playbackAudioRef} className="hidden" playsInline />

      <div className="max-w-md mx-auto pt-8">
        {step === 'login' ? (
          <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-10 text-center">
            <div className="text-7xl mb-8">☎️</div>
            <h1 className="text-4xl font-bold mb-3">PSTN Dialer</h1>
            <p className="text-gray-300 mb-10">Entrez votre numéro</p>

            <input
              type="tel"
              value={myNumber}
              onChange={(e) => setMyNumber(e.target.value)}
              className="w-full bg-white/10 border border-gray-600 rounded-2xl px-6 py-5 text-2xl font-mono text-center mb-8"
              placeholder="Votre numéro"
            />

            <button
              onClick={login}
              className="w-full bg-green-600 hover:bg-green-500 py-5 rounded-2xl text-xl font-bold"
            >
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
              <button 
                onClick={() => {
                  setStep('login');
                  setCurrentCall(null);
                  stopAudioCapture();
                }} 
                className="text-red-400 hover:text-red-300"
              >
                Déconnexion
              </button>
            </div>

            {!currentCall ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Appeler ce numéro</label>
                  <input
                    type="tel"
                    value={targetNumber}
                    onChange={(e) => setTargetNumber(e.target.value)}
                    className="w-full bg-white/10 border border-gray-600 rounded-2xl px-6 py-5 text-2xl font-mono text-center"
                    placeholder="Numéro à appeler"
                  />
                </div>

                <button onClick={makeOutboundCall} className="w-full bg-green-600 py-6 rounded-3xl text-2xl font-bold">
                  📞 Appeler
                </button>

                <button onClick={simulateIncomingCall} className="w-full bg-blue-600 py-5 rounded-3xl text-xl font-bold">
                  📥 Simuler appel entrant
                </button>
              </div>
            ) : (
              <div className="bg-white/10 rounded-3xl p-8">
                <p className="text-center text-3xl font-mono mb-6">
                  {currentCall.direction === 'outbound' ? 'Vers' : 'De'} {currentCall.called || currentCall.caller}
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