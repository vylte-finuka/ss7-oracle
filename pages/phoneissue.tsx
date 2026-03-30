'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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

export default function PhoneIssue() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const callerParam = searchParams.get('caller');
  const calledParam = searchParams.get('called');
  const typeParam = (searchParams.get('type') || 'outbound') as 'outbound' | 'inbound';

  // ===== CONFIG =====
  const [dialer] = useState(() => new PSTNDialer({
    baseUrl: process.env.NEXT_PUBLIC_ORACLE_BASE_URL !,
    apiKey: process.env.NEXT_PUBLIC_ORACLE_API_KEY || 'test-key-default'
  }));

  // ===== STATE =====
  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  // ===== REFS =====
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const animationFrameRef = useRef<number>();

  // ===== TIMER =====
  useEffect(() => {
    if (!currentCall || currentCall.status !== 'answered') return;

    const interval = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [currentCall?.status]);

  // ===== AUDIO SETUP =====
  const initAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const playRingtone = (frequency: number = 440, duration: number = 1000) => {
    try {
      const ctx = initAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.frequency.value = frequency;
      osc.type = 'sine';

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration / 1000);

      console.log(`📳 Sonnerie ${frequency}Hz...`);
    } catch (error) {
      console.error('❌ Erreur sonnerie:', error);
    }
  };

  const playDTMFTone = (digit: string) => {
    try {
      const ctx = initAudioContext();
      const frequencies: Record<string, [number, number]> = {
        '1': [697, 1209],
        '2': [697, 1336],
        '3': [697, 1477],
        '4': [770, 1209],
        '5': [770, 1336],
        '6': [770, 1477],
        '7': [852, 1209],
        '8': [852, 1336],
        '9': [852, 1477],
        '0': [941, 1336],
      };

      if (!frequencies[digit]) return;

      const [f1, f2] = frequencies[digit];
      const duration = 0.2;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.value = f1;
      osc2.frequency.value = f2;

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + duration);
      osc2.stop(ctx.currentTime + duration);

      console.log(`🔔 Tone ${digit}`);
    } catch (error) {
      console.error('❌ Erreur tone:', error);
    }
  };

  // ===== MICROPHONE =====
  const startMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      console.log('✅ Microphone activé');

      // Analyser
      const ctx = initAudioContext();
      analyzerRef.current = ctx.createAnalyser();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyzerRef.current);
      analyzerRef.current.fftSize = 256;

      // Recorder
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);

      // Analyser loop
      const analyzeAudio = () => {
        if (!analyzerRef.current) return;
        
        const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
        analyzerRef.current.getByteFrequencyData(dataArray);
        
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(Math.round(average));

        animationFrameRef.current = requestAnimationFrame(analyzeAudio);
      };

      analyzeAudio();
    } catch (error) {
      console.error('❌ Erreur microphone:', error);
      alert('Impossible d\'accéder au microphone. Vérifiez les permissions.');
    }
  };

  const stopMicrophone = async () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      console.log('✅ Microphone arrêté');
    }
  };

  // ===== CALL ACTIONS =====
  const handleStartCall = async () => {
    try {
      console.log('📞 Appel sortant en cours...');
      
      const response = await dialer.initiateCall(callerParam, calledParam);
      
      const call: CallSession = {
        id: response.data.callId,
        caller: callerParam,
        called: calledParam,
        direction: 'outbound',
        status: 'ringing',
        duration: 0,
        startTime: new Date()
      };

      setCurrentCall(call);
      setCallDuration(0);
      await startMicrophone();

      // Sonneries
      playRingtone(440, 1000);
      setTimeout(() => playRingtone(480, 1000), 1500);

      // Auto-répondre après 3 sec
      setTimeout(async () => {
        await handleAnswer(call.id);
      }, 3000);

    } catch (error: any) {
      alert(`❌ Erreur: ${error.message}`);
    }
  };

  const handleSimulateIncoming = async () => {
    try {
      console.log('📥 Appel entrant simulé...');
      
      const call: CallSession = {
        id: Math.random().toString(36).slice(2),
        caller: callerParam,
        called: calledParam,
        direction: 'inbound',
        status: 'ringing',
        duration: 0,
        startTime: new Date()
      };

      setCurrentCall(call);
      setCallDuration(0);

      // Sonneries entrantes
      playRingtone(400, 1000);
      setTimeout(() => playRingtone(450, 1000), 1500);

    } catch (error: any) {
      alert(`❌ Erreur: ${error.message}`);
    }
  };

  const handleAnswer = async (callId: string) => {
    try {
      console.log('✅ Réponse...');
      
      await dialer.answerCall(callId, {
        callerNumber: callerParam,
        calledNumber: calledParam
      });

      setCurrentCall(prev => prev ? { ...prev, status: 'answered' } : null);

      // Ton de confirmation
      playDTMFTone('5');

    } catch (error) {
      console.error('❌ Erreur réponse:', error);
    }
  };

  const handleReject = () => {
    console.log('🚫 Rejet');
    playDTMFTone('0');
    setTimeout(() => {
      setCurrentCall(null);
      setCallDuration(0);
    }, 500);
  };

  const handleHangup = async () => {
    if (!currentCall) return;

    try {
      console.log('📴 Raccroché');
      await stopMicrophone();

      await dialer.hangupCall(currentCall.id, callDuration, {
        callerNumber: callerParam,
        calledNumber: calledParam
      });

      setTimeout(() => {
        router.push('/phoneentry');
      }, 500);

    } catch (error) {
      console.error('❌ Erreur raccourcissement:', error);
    }
  };

  // ===== FORMAT =====
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'initiating': '📞 Initiation...',
      'ringing': '📳 Sonnerie...',
      'answered': '✅ En appel',
      'completed': '✔️ Terminé',
      'hungup': '❌ Raccroché'
    };
    return labels[status] || status;
  };

  // ===== INITIAL CALL =====
  useEffect(() => {
    if (typeParam === 'outbound') {
      handleStartCall();
    } else {
      handleSimulateIncoming();
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 flex items-center justify-center">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">☎️</h1>
          <p className="text-gray-300">Appel en cours...</p>
        </div>

        {/* Call Card */}
        {currentCall && (
          <div className={`rounded-2xl shadow-2xl p-8 space-y-6 ${
            currentCall.status === 'answered' ? 'bg-green-50' :
            currentCall.status === 'ringing' ? 'bg-orange-50 animate-pulse' :
            'bg-white'
          }`}>
            
            {/* Numbers */}
            <div className="space-y-4">
              <div className="bg-white/80 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600 mb-1">De</p>
                <p className="text-3xl font-mono font-bold text-gray-800">{currentCall.caller}</p>
              </div>

              <div className="flex justify-center">
                <div className={`text-3xl ${
                  currentCall.direction === 'outbound' ? 'text-green-600' : 'text-blue-600'
                }`}>
                  {currentCall.direction === 'outbound' ? '📤' : '📥'}
                </div>
              </div>

              <div className="bg-white/80 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600 mb-1">Vers</p>
                <p className="text-3xl font-mono font-bold text-gray-800">{currentCall.called}</p>
              </div>
            </div>

            {/* Status */}
            <div className="text-center">
              <p className="text-xl font-bold text-gray-800">{getStatusLabel(currentCall.status)}</p>
            </div>

            {/* Duration */}
            {currentCall.status === 'answered' && (
              <div className="text-center bg-white/80 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">Durée</p>
                <p className="text-5xl font-mono font-bold text-green-600">
                  {formatDuration(callDuration)}
                </p>
              </div>
            )}

            {/* Audio Level */}
            {isRecording && currentCall.status === 'answered' && (
              <div className="bg-white/80 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">🎤 Niveau Audio</p>
                <div className="w-full bg-gray-300 rounded-full h-4 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 h-4 transition-all"
                    style={{ width: `${Math.min(audioLevel / 2.55, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600 mt-2 text-center">{audioLevel}dB</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              {currentCall.status === 'ringing' && (
                <>
                  <button
                    onClick={() => handleAnswer(currentCall.id)}
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-lg text-lg transition-all shadow-lg hover:shadow-xl"
                  >
                    ✅ Répondre
                  </button>
                  {currentCall.direction === 'inbound' && (
                    <button
                      onClick={handleReject}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 rounded-lg text-lg transition-all shadow-lg hover:shadow-xl"
                    >
                      🚫 Rejeter
                    </button>
                  )}
                </>
              )}

              {currentCall.status === 'answered' && (
                <button
                  onClick={handleHangup}
                  className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-lg text-lg transition-all shadow-lg hover:shadow-xl"
                >
                  📴 Raccrocher
                </button>
              )}
            </div>

            {/* CallId */}
            <div className="text-xs text-gray-600 break-all bg-white/50 p-2 rounded text-center">
              <strong>CallId:</strong> {currentCall.id.slice(0, 20)}...
            </div>
          </div>
        )}

        {/* Back Button */}
        <button
          onClick={() => router.push('/phoneentry')}
          className="mt-8 w-full bg-gray-700 hover:bg-gray-800 text-white font-bold py-2 rounded-lg transition-colors"
        >
          ← Retour
        </button>
      </div>
    </div>
  );
}