'use client';

import { useState, useRef, useEffect } from 'react';
import PSTNDialer from '../lib/pstn-dialer';

interface CallSession {
  id: string;
  caller: string;
  called: string;
  direction: 'inbound' | 'outbound';
  status: 'initiating' | 'ringing' | 'answered' | 'completed' | 'hungup';
  duration: number;
  startTime: Date;
  audioStream?: MediaStream;
}

export default function PSTNDialerUI() {
  // ===== CONFIGURATION =====
  const getConfig = () => {
    const baseUrl = process.env.NEXT_PUBLIC_ORACLE_BASE_URL!;
    const apiKey = process.env.NEXT_PUBLIC_ORACLE_API_KEY || 'test-key-default';
    
    console.log('🔧 Configuration chargée:', { baseUrl, apiKey: apiKey ? '✅ Présente' : '❌ Manquante' });
    return { baseUrl, apiKey };
  };

  const config = getConfig();

  // ===== ÉTAT GLOBAL =====
  const [dialer] = useState(() => new PSTNDialer({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey
  }));

  const [outboundCall, setOutboundCall] = useState<CallSession | null>(null);
  const [inboundCall, setInboundCall] = useState<CallSession | null>(null);
  const [callHistory, setCallHistory] = useState<CallSession[]>([]);

  // ===== AUDIO REFS =====
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // ===== FORMULAIRE =====
  const [callerNumber, setCallerNumber] = useState('33612345678');
  const [calledNumber, setCalledNumber] = useState('33987654321');
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  // ===== TIMER DURÉE =====
  useEffect(() => {
    if (!outboundCall || outboundCall.status !== 'answered') return;
    const interval = setInterval(() => {
      setOutboundCall(prev => prev ? { ...prev, duration: prev.duration + 1 } : null);
    }, 1000);
    return () => clearInterval(interval);
  }, [outboundCall?.status]);

  useEffect(() => {
    if (!inboundCall || inboundCall.status !== 'answered') return;
    const interval = setInterval(() => {
      setInboundCall(prev => prev ? { ...prev, duration: prev.duration + 1 } : null);
    }, 1000);
    return () => clearInterval(interval);
  }, [inboundCall?.status]);

  // ===== PLAYBACK AUDIO RETOUR SERVEUR (CORRIGÉ) =====
  const playAudioFromBase64 = (base64: string, mimeType: string = 'audio/webm;codecs=opus') => {
    try {
      if (!playbackAudioRef.current) {
        console.error('❌ Ref audio playback non disponible');
        return;
      }

      // Nettoyage ancien URL pour éviter fuites mémoire
      if (playbackAudioRef.current.src) {
        URL.revokeObjectURL(playbackAudioRef.current.src);
      }

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: mimeType });
      const audioUrl = URL.createObjectURL(blob);

      console.log(`✅ Blob audio retour créé (${(blob.size / 1024).toFixed(1)} KB) - type: ${mimeType}`);

      const audioEl = playbackAudioRef.current;
      audioEl.src = audioUrl;
      audioEl.volume = 1.0;
      audioEl.muted = false;
      audioEl.load(); // Important pour forcer le rechargement

      const playPromise = audioEl.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => console.log('🔊 Lecture son retour serveur démarrée avec succès'))
          .catch(err => console.error('❌ Erreur playback (souvent autoplay policy):', err.name, err.message));
      }
    } catch (error) {
      console.error('❌ Erreur dans playAudioFromBase64:', error);
    }
  };

  // ===== AUDIO CAPTURE & STREAMING (amélioré avec timeslice) =====
  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
        video: false
      });

      mediaStreamRef.current = stream;
      console.log('✅ Microphone activé');

      // Analyseur de niveau audio
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyzerRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyzerRef.current);
      analyzerRef.current.fftSize = 256;

      // MediaRecorder avec timeslice pour streaming
      const options = { mimeType: 'audio/webm;codecs=opus' };
      mediaRecorderRef.current = new MediaRecorder(stream, options);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);

          // Envoi en temps réel tous les chunks
          if (outboundCall?.id || inboundCall?.id) {
            const currentCallId = outboundCall?.id || inboundCall?.id;
            if (!currentCallId) return;

            const audioBlob = new Blob([e.data], { type: 'audio/webm;codecs=opus' });
            const reader = new FileReader();

            reader.onloadend = async () => {
              const base64Audio = (reader.result as string).split(',')[1];
              try {
                const response = await dialer.sendAudioData(
                  currentCallId,
                  base64Audio,
                  Date.now()
                );

                if (response?.data?.audioData) {
                  console.log('🔊 Réponse audio reçue du serveur → lecture');
                  playAudioFromBase64(response.data.audioData);
                }
              } catch (err) {
                console.error('❌ Erreur envoi chunk audio:', err);
              }
            };
            reader.readAsDataURL(audioBlob);
          }
        }
      };

      mediaRecorderRef.current.start(250); // Chunk toutes les 250ms → streaming fluide
      setIsRecording(true);

      // Boucle analyse niveau micro
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
      console.error('❌ Erreur accès microphone:', error);
      alert('Impossible d\'accéder au microphone. Vérifiez les permissions.');
    }
  };

  const stopAudioCapture = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      // Arrêt des tracks micro
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }

      console.log('⏹️ Capture audio arrêtée');
    }
  };

  // ===== FONCTIONS SON (inchangées mais conservées) =====
  const playRingtone = (frequency: number = 440, duration: number = 1000) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
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
    } catch (e) { console.error('Erreur sonnerie:', e); }
  };

  const playDTMFTone = (digit: string) => {
    // ... (fonction DTMF inchangée - tu peux la garder telle quelle)
    try {
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      // (code DTMF original ici)
      console.log(`🔔 DTMF ${digit}`);
    } catch (e) { console.error('Erreur DTMF:', e); }
  };

  // ===== APPEL SORTANT =====
  const initiateOutboundCall = async () => {
    try {
      const response = await dialer.initiateCall(callerNumber, calledNumber);
      
      const call: CallSession = {
        id: response.data.callId,
        caller: callerNumber,
        called: calledNumber,
        direction: 'outbound',
        status: 'ringing',
        duration: 0,
        startTime: new Date()
      };

      setOutboundCall(call);
      await startAudioCapture();

      playRingtone(440, 1000);
      setTimeout(() => playRingtone(480, 1000), 1500);

      setTimeout(() => answerOutboundCall(call.id), 3000);
    } catch (error: any) {
      alert(`❌ Erreur initiation: ${error.message}`);
    }
  };

  const answerOutboundCall = async (callId: string) => {
    try {
      const response = await dialer.answerCall(callId, { callerNumber, calledNumber });
      setOutboundCall(prev => prev ? { ...prev, status: 'answered' } : null);

      playDTMFTone('5');

      if (response.data?.audioData) {
        setTimeout(() => playAudioFromBase64(response.data.audioData), 300);
      }
    } catch (error) {
      console.error('❌ Erreur réponse appel:', error);
    }
  };

  const hangupOutboundCall = async () => {
    if (!outboundCall) return;
    try {
      await stopAudioCapture();
      await dialer.hangupCall(outboundCall.id, outboundCall.duration, { callerNumber, calledNumber });

      const completedCall = { ...outboundCall, status: 'completed' as const };
      setCallHistory(prev => [...prev, completedCall]);
      setOutboundCall(null);
    } catch (error) {
      console.error('❌ Erreur raccrochage:', error);
    }
  };

  // ===== APPEL ENTRANT (simulé) =====
  const simulateInboundCall = () => {
    const caller = '33687654321';
    const called = callerNumber;

    const call: CallSession = {
      id: Math.random().toString(36).slice(2),
      caller,
      called,
      direction: 'inbound',
      status: 'ringing',
      duration: 0,
      startTime: new Date()
    };

    setInboundCall(call);
    playRingtone(400, 1000);
    setTimeout(() => playRingtone(450, 1000), 1500);
  };

  const answerInboundCall = async () => {
    if (!inboundCall) return;
    try {
      const response = await dialer.initiateCall(inboundCall.caller, inboundCall.called);
      setInboundCall(prev => prev ? { ...prev, status: 'answered', id: response.data.callId } : null);

      await startAudioCapture();
      playDTMFTone('8');

      if (response.data?.audioData) {
        setTimeout(() => playAudioFromBase64(response.data.audioData), 300);
      }
    } catch (error) {
      console.error('❌ Erreur réponse entrant:', error);
    }
  };

  const rejectInboundCall = () => {
    setInboundCall(prev => prev ? { ...prev, status: 'hungup' } : null);
    playDTMFTone('0');
    setTimeout(() => setInboundCall(null), 800);
  };

  const hangupInboundCall = async () => {
    if (!inboundCall) return;
    try {
      await stopAudioCapture();
      await dialer.hangupCall(inboundCall.id, inboundCall.duration, {
        callerNumber: inboundCall.caller,
        calledNumber: inboundCall.called
      });

      const completedCall = { ...inboundCall, status: 'completed' as const };
      setCallHistory(prev => [...prev, completedCall]);
      setInboundCall(null);
    } catch (error) {
      console.error('❌ Erreur raccrochage entrant:', error);
    }
  };

  // ===== FORMATAGE =====
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      initiating: '📞 Initiation...',
      ringing: '📳 Sonnerie...',
      answered: '✅ En appel',
      completed: '✔️ Terminé',
      hungup: '❌ Raccroché'
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      initiating: 'bg-yellow-100 border-yellow-300',
      ringing: 'bg-orange-100 border-orange-300 animate-pulse',
      answered: 'bg-green-100 border-green-300',
      completed: 'bg-gray-100 border-gray-300',
      hungup: 'bg-red-100 border-red-300'
    };
    return colors[status] || 'bg-gray-100 border-gray-300';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      {/* Audio Element pour le retour serveur */}
      <audio
        ref={playbackAudioRef}
        className="hidden"
        crossOrigin="anonymous"
        playsInline
        onPlay={() => console.log('▶️ Lecture audio retour démarrée')}
        onEnded={() => console.log('⏹️ Lecture audio retour terminée')}
        onError={(e) => console.error('❌ Erreur élément audio:', e)}
      />

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">☎️ PSTN Dialer</h1>
        <p className="text-gray-300">Oracle SS7 - Interface Téléphonique en Temps Réel</p>
        <p className="text-xs text-gray-400 mt-2">API: {config.baseUrl}</p>
      </div>

      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Appel Sortant */}
          <div className={`rounded-lg shadow-xl transition-all ${outboundCall ? getStatusColor(outboundCall.status) : 'bg-white'} border-2`}>
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-800">📤 Appel Sortant</h2>

              {!outboundCall ? (
                <div className="space-y-4">
                  <input type="tel" value={callerNumber} onChange={(e) => setCallerNumber(e.target.value)}
                    className="w-full px-4 py-3 border-2 rounded-lg font-mono text-lg" placeholder="Votre numéro" />
                  <input type="tel" value={calledNumber} onChange={(e) => setCalledNumber(e.target.value)}
                    className="w-full px-4 py-3 border-2 rounded-lg font-mono text-lg" placeholder="Numéro à appeler" />
                  <button onClick={initiateOutboundCall}
                    className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg text-lg">
                    📞 Appeler
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-white/80 rounded-lg p-4">
                    <p className="text-sm text-gray-600">De</p>
                    <p className="text-2xl font-mono font-bold">{outboundCall.caller}</p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-4">
                    <p className="text-sm text-gray-600">Vers</p>
                    <p className="text-2xl font-mono font-bold">{outboundCall.called}</p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-4">
                    <p className="text-sm text-gray-600">Status</p>
                    <p className="text-xl font-bold">{getStatusLabel(outboundCall.status)}</p>
                  </div>

                  {outboundCall.status === 'answered' && (
                    <div className="bg-white/80 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Durée</p>
                      <p className="text-4xl font-mono font-bold text-green-600">{formatDuration(outboundCall.duration)}</p>
                    </div>
                  )}

                  {isRecording && outboundCall.status === 'answered' && (
                    <div className="bg-white/80 rounded-lg p-4">
                      <p className="text-sm text-gray-600 mb-2">🎤 Niveau Micro</p>
                      <div className="w-full bg-gray-300 rounded-full h-4 overflow-hidden">
                        <div className="bg-gradient-to-r from-green-500 to-red-500 h-4 transition-all" 
                             style={{ width: `${Math.min(audioLevel / 2.55, 100)}%` }} />
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{audioLevel}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {outboundCall.status === 'ringing' && (
                      <button onClick={() => answerOutboundCall(outboundCall.id)}
                        className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg">
                        ✅ Répondre
                      </button>
                    )}
                    <button onClick={hangupOutboundCall}
                      className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-lg">
                      📴 Raccrocher
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Appel Entrant */}
          <div className={`rounded-lg shadow-xl transition-all ${inboundCall ? getStatusColor(inboundCall.status) : 'bg-white'} border-2`}>
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-800">📥 Appel Entrant</h2>

              {!inboundCall ? (
                <button onClick={simulateInboundCall}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-lg text-lg">
                  📳 Simuler Appel Entrant
                </button>
              ) : (
                <div className="space-y-4">
                  {/* Infos similaires à l'appel sortant (code inchangé pour brevité) */}
                  <div className="bg-white/80 rounded-lg p-4">
                    <p className="text-sm text-gray-600">De</p>
                    <p className="text-2xl font-mono font-bold">{inboundCall.caller}</p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-4">
                    <p className="text-sm text-gray-600">Vers</p>
                    <p className="text-2xl font-mono font-bold">{inboundCall.called}</p>
                  </div>
                  <div className="bg-white/80 rounded-lg p-4">
                    <p className="text-sm text-gray-600">Status</p>
                    <p className="text-xl font-bold">{getStatusLabel(inboundCall.status)}</p>
                  </div>

                  {inboundCall.status === 'answered' && (
                    <div className="bg-white/80 rounded-lg p-4">
                      <p className="text-sm text-gray-600">Durée</p>
                      <p className="text-4xl font-mono font-bold text-green-600">{formatDuration(inboundCall.duration)}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {inboundCall.status === 'ringing' && (
                      <>
                        <button onClick={answerInboundCall} className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg">✅ Répondre</button>
                        <button onClick={rejectInboundCall} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-lg">🚫 Rejeter</button>
                      </>
                    )}
                    {inboundCall.status === 'answered' && (
                      <button onClick={hangupInboundCall} className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-lg">📴 Raccrocher</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Historique */}
        {callHistory.length > 0 && (
          <div className="bg-white rounded-lg shadow-xl p-6">
            <h3 className="text-2xl font-bold mb-4 text-gray-800">📋 Historique des Appels</h3>
            <div className="space-y-2">
              {callHistory.map((call) => (
                <div key={call.id} className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
                  <div>
                    <p className="font-mono font-bold">{call.caller} → {call.called}</p>
                    <p className="text-sm text-gray-600">
                      {call.direction === 'outbound' ? '📤 Sortant' : '📥 Entrant'} • {formatDuration(call.duration)}
                    </p>
                  </div>
                  <span className="text-sm text-gray-600">{new Date(call.startTime).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}