'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import PSTNDialer from '../lib/pstn-dialer';

interface CallSession {
  id: string;
  caller: string;
  called: string;
  direction: 'inbound' | 'outbound';
  status: 'initiating' | 'ringing' | 'answered' | 'completed' | 'hungup';
  duration: number;
  startTime: Date;
}

export default function PhoneDialer() {
  const router = useRouter();
  const { caller: urlCaller = '33612345678', called: urlCalled = '33987654321', type: callType = 'outbound' } = router.query;

  const [dialer] = useState(() => new PSTNDialer({
    baseUrl: process.env.NEXT_PUBLIC_ORACLE_BASE_URL! ,
    apiKey: process.env.NEXT_PUBLIC_ORACLE_API_KEY || 'test-key-default',
  }));

  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showManualPlay, setShowManualPlay] = useState(false);
  const [lastResponse, setLastResponse] = useState<any>(null); // Pour debug

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Timer durée
  useEffect(() => {
    if (!currentCall || currentCall.status !== 'answered') return;
    const id = setInterval(() => {
      setCurrentCall(p => p ? { ...p, duration: p.duration + 1 } : null);
    }, 1000);
    return () => clearInterval(id);
  }, [currentCall?.status]);

  const playAudioFromBase64 = useCallback((base64: string) => {
    if (!playbackAudioRef.current) return;

    try {
      if (playbackAudioRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(playbackAudioRef.current.src);
      }

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

      const blob = new Blob([bytes], { type: 'audio/webm;codecs=opus' });
      const url = URL.createObjectURL(blob);

      const audio = playbackAudioRef.current;
      audio.src = url;
      audio.volume = 1.0;
      audio.load();

      audio.play()
        .then(() => {
          console.log('✅ Son de retour joué !');
          setShowManualPlay(false);
        })
        .catch(err => {
          console.error('❌ Play bloqué:', err.name);
          if (err.name === 'NotAllowedError') setShowManualPlay(true);
        });
    } catch (err) {
      console.error('❌ Erreur playAudioFromBase64:', err);
    }
  }, []);

  const startAudioCapture = async (callId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 },
        video: false
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
            setLastResponse(response); // Pour debug

            console.log('📥 Réponse brute du serveur:', response);

            // Recherche du audio dans tous les endroits possibles
            let audioBase64 = null;
            if (response?.data?.audioData) audioBase64 = response.data.audioData;
            else if (response?.data?.audio) audioBase64 = response.data.audio;
            else if (response?.audioData) audioBase64 = response.audioData;
            else if (typeof response?.data === 'string') audioBase64 = response.data;

            if (audioBase64 && typeof audioBase64 === 'string' && audioBase64.length > 20) {
              console.log(`🔊 Audio détecté ! (${audioBase64.length} caractères)`);
              playAudioFromBase64(audioBase64);
            } else {
              console.log('⚠️ Réponse reçue mais pas d\'audio détecté');
            }
          } catch (err) {
            console.error('❌ Erreur sendAudioData:', err);
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
        setAudioLevel(Math.round(data.reduce((a,b)=>a+b,0)/data.length));
        animationFrameRef.current = requestAnimationFrame(analyze);
      };
      analyze();

    } catch (err) {
      console.error('❌ Microphone error:', err);
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
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration/1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration/1000);
    } catch (e) {}
  };

  // Lancement automatique
  useEffect(() => {
    if (!router.isReady) return;

    if (callType === 'outbound') {
      const initCall = async () => {
        try {
          const res = await dialer.initiateCall(urlCaller as string, urlCalled as string);
          const call: CallSession = {
            id: res.data.callId,
            caller: urlCaller as string,
            called: urlCalled as string,
            direction: 'outbound',
            status: 'ringing',
            duration: 0,
            startTime: new Date()
          };
          setCurrentCall(call);
          await startAudioCapture(call.id);
          playRingtone(440, 1000);
          setTimeout(() => playRingtone(480, 1000), 1500);
          setTimeout(() => answerCall(call.id), 3000);
        } catch (e: any) {
          alert(e.message);
        }
      };
      initCall();
    } else {
      // Appel entrant simulé
      const call: CallSession = {
        id: 'in-' + Date.now(),
        caller: '33687654321',
        called: urlCaller as string,
        direction: 'inbound',
        status: 'ringing',
        duration: 0,
        startTime: new Date()
      };
      setCurrentCall(call);
      playRingtone(400, 1000);
      setTimeout(() => playRingtone(450, 1000), 1500);
    }
  }, [router.isReady]);

  const answerCall = async (callId: string) => {
    try {
      await dialer.answerCall(callId, { callerNumber: urlCaller as string, calledNumber: urlCalled as string });
      setCurrentCall(p => p ? { ...p, status: 'answered' } : null);
    } catch (e) { console.error(e); }
  };

  const hangupCall = async () => {
    stopAudioCapture();
    if (currentCall) {
      try {
        await dialer.hangupCall(currentCall.id, currentCall.duration, {
          callerNumber: urlCaller as string,
          calledNumber: urlCalled as string
        });
      } catch (e) {}
    }
    router.push('/phoneentry');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 text-white">
      <audio ref={playbackAudioRef} className="hidden" playsInline />

      <div className="max-w-lg mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8">☎️ Appel en cours</h1>

        {currentCall && (
          <div className="bg-white/10 rounded-3xl p-8">
            <p className="text-center text-2xl mb-6 font-mono">
              {currentCall.caller} → {currentCall.called}
            </p>

            <p className="text-center text-3xl mb-8">
              {currentCall.status === 'answered' ? '✅ En communication' : '📳 Sonnerie...'}
            </p>

            {currentCall.status === 'answered' && (
              <p className="text-center text-5xl font-mono text-green-400 mb-8">
                {Math.floor(currentCall.duration/60)}:{(currentCall.duration%60).toString().padStart(2,'0')}
              </p>
            )}

            {isRecording && (
              <div className="mb-8">
                <p className="text-center text-sm text-gray-400 mb-2">Niveau micro</p>
                <div className="h-3 bg-gray-700 rounded-full">
                  <div className="bg-green-500 h-3 rounded-full transition-all" style={{width: `${Math.min(audioLevel/2.55, 100)}%`}} />
                </div>
              </div>
            )}

            <div className="space-y-4">
              {currentCall.status === 'ringing' && (
                <button onClick={() => answerCall(currentCall.id)} className="w-full bg-green-600 py-5 rounded-2xl text-xl font-bold">
                  ✅ Décrocher
                </button>
              )}

              <button onClick={hangupCall} className="w-full bg-red-600 py-5 rounded-2xl text-xl font-bold">
                📴 Raccrocher
              </button>

              <button onClick={() => playAudioFromBase64("UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=")} 
                className="w-full bg-purple-600 py-4 rounded-2xl text-sm">
                🧪 Tester son retour
              </button>
            </div>

            {showManualPlay && (
              <button onClick={manualPlayAudio} className="mt-4 w-full bg-amber-500 py-4 rounded-2xl font-bold">
                ▶️ Écouter le retour audio
              </button>
            )}
          </div>
        )}

        <button onClick={() => router.push('/phoneentry')} className="mt-10 text-gray-400 hover:text-white block mx-auto">
          ← Retour
        </button>
      </div>
    </div>
  );
}