'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import PSTNDialer from '../lib/pstn-dialer';

interface CallSession {
  id: string;
  caller: string;
  called: string;
  direction: 'inbound' | 'outbound';
  status: 'idle' | 'ringing' | 'answered' | 'completed' | 'hungup';
  duration: number;
  startTime: Date;
}

export default function PSTNPhone() {
  const [myNumber, setMyNumber] = useState('33612345678');           // Ton numéro personnel
  const [targetNumber, setTargetNumber] = useState('33987654321');   // Numéro à appeler

  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showManualPlay, setShowManualPlay] = useState(false);
  const [callHistory, setCallHistory] = useState<CallSession[]>([]);

  const [dialer] = useState(() => new PSTNDialer({
    baseUrl: process.env.NEXT_PUBLIC_ORACLE_BASE_URL!,
    apiKey: process.env.NEXT_PUBLIC_ORACLE_API_KEY || 'test-key-default',
  }));

  // Refs audio
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Timer durée
  useEffect(() => {
    if (!currentCall || currentCall.status !== 'answered') return;
    const interval = setInterval(() => {
      setCurrentCall(prev => prev ? { ...prev, duration: prev.duration + 1 } : null);
    }, 1000);
    return () => clearInterval(interval);
  }, [currentCall?.status]);

  // Lecture du son retour du serveur
  const playAudioFromBase64 = useCallback((base64: string) => {
    if (!playbackAudioRef.current) return;

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
        .then(() => {
          console.log('🔊 Son de retour joué avec succès');
          setShowManualPlay(false);
        })
        .catch(err => {
          if (err.name === 'NotAllowedError') setShowManualPlay(true);
        });
    } catch (err) {
      console.error('❌ Erreur lecture audio:', err);
    }
  }, []);

  // Capture micro + streaming vers serveur
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
            const response = await dialer.sendAudioData(callId, base64, Date.now());

            let audioBase64 =
              response?.data?.audioData ||
              response?.data?.audio ||
              response?.audioData ||
              (typeof response?.data === 'string' ? response.data : null);

            if (audioBase64 && typeof audioBase64 === 'string' && audioBase64.length > 30) {
              console.log(`🔊 Audio retour reçu (${audioBase64.length} chars)`);
              playAudioFromBase64(audioBase64);
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
      console.error('❌ Micro:', err);
      alert('Impossible d’accéder au microphone');
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

  const makeOutboundCall = async () => {
    try {
      const res = await dialer.initiateCall(myNumber, targetNumber);
      const call: CallSession = {
        id: res.data.callId,
        caller: myNumber,
        called: targetNumber,
        direction: 'outbound',
        status: 'ringing',
        duration: 0,
        startTime: new Date(),
      };
      setCurrentCall(call);
      await startAudioCapture(call.id);
      playRingtone(440, 1000);
      setTimeout(() => playRingtone(480, 1000), 1500);
      setTimeout(() => answerCall(call.id), 3000);
    } catch (e: any) {
      alert(`Erreur : ${e.message}`);
    }
  };

  const answerCall = async (callId: string) => {
    try {
      await dialer.answerCall(callId, { callerNumber: myNumber, calledNumber: currentCall?.called || targetNumber });
      setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);
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
        calledNumber: currentCall.called,
      });
      setCallHistory(prev => [...prev, { ...currentCall, status: 'completed' }]);
    } catch (e) {}
    setCurrentCall(null);
  };

  const simulateIncomingCall = () => {
    const incomingCall: CallSession = {
      id: 'in-' + Date.now(),
      caller: '33687654321',
      called: myNumber,
      direction: 'inbound',
      status: 'ringing',
      duration: 0,
      startTime: new Date(),
    };
    setCurrentCall(incomingCall);
    playRingtone(400, 1000);
    setTimeout(() => playRingtone(450, 1000), 1500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 text-white">
      <audio ref={playbackAudioRef} className="hidden" playsInline />

      <div className="max-w-lg mx-auto">
        <h1 className="text-5xl font-bold text-center mb-2">☎️ Mon Téléphone PSTN</h1>
        <p className="text-center text-gray-400 mb-10">Oracle SS7 - Opérateur Virtuel</p>

        {/* Mon Numéro */}
        <div className="bg-white/10 rounded-3xl p-6 mb-8">
          <label className="block text-sm text-gray-400 mb-2">Mon Numéro</label>
          <input
            type="tel"
            value={myNumber}
            onChange={(e) => setMyNumber(e.target.value)}
            className="w-full bg-white/10 border border-gray-600 rounded-2xl px-5 py-4 text-2xl font-mono text-center"
          />
        </div>

        {/* Zone d'appel */}
        {!currentCall ? (
          <div className="space-y-6">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Appeler ce numéro</label>
              <input
                type="tel"
                value={targetNumber}
                onChange={(e) => setTargetNumber(e.target.value)}
                className="w-full bg-white/10 border border-gray-600 rounded-2xl px-5 py-4 text-2xl font-mono text-center"
              />
            </div>

            <button
              onClick={makeOutboundCall}
              className="w-full bg-green-600 hover:bg-green-500 py-6 rounded-3xl text-2xl font-bold transition"
            >
              📞 Appeler
            </button>

            <button
              onClick={simulateIncomingCall}
              className="w-full bg-blue-600 hover:bg-blue-500 py-5 rounded-3xl text-xl font-bold transition"
            >
              📥 Simuler un appel entrant
            </button>
          </div>
        ) : (
          /* Interface pendant l'appel */
          <div className="bg-white/10 rounded-3xl p-8 border border-white/20">
            <div className="text-center mb-8">
              <p className="text-3xl font-mono">
                {currentCall.direction === 'outbound' ? 'Appel vers' : 'Appel de'} {currentCall.called || currentCall.caller}
              </p>
              <p className="text-2xl mt-4">
                {currentCall.status === 'answered' ? '✅ En communication' : '📳 Sonnerie...'}
              </p>
            </div>

            {currentCall.status === 'answered' && (
              <p className="text-center text-6xl font-mono text-green-400 mb-8">
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
                <button onClick={() => answerCall(currentCall.id)} className="w-full bg-green-600 py-6 rounded-3xl text-2xl font-bold">
                  ✅ Décrocher
                </button>
              )}

              <button onClick={hangupCall} className="w-full bg-red-600 py-6 rounded-3xl text-2xl font-bold">
                📴 Raccrocher
              </button>
            </div>
          </div>
        )}

        {/* Historique */}
        {callHistory.length > 0 && (
          <div className="mt-10">
            <h3 className="text-lg font-semibold mb-4">Historique</h3>
            <div className="space-y-2">
              {callHistory.map((call, i) => (
                <div key={i} className="bg-white/5 p-4 rounded-2xl text-sm">
                  {call.caller} → {call.called} • {call.direction} • {Math.floor(call.duration / 60)}:{(call.duration % 60).toString().padStart(2, '0')}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}