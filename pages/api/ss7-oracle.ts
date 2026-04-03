export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

import type { NextApiRequest, NextApiResponse } from "next";

let activeCall: { 
  caller: string; 
  called: string; 
  lastAudioFromCaller: string; 
  lastAudioFromCalled: string; 
} | null = null;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const caller = (body.callerNumber || body.caller || "").trim();
  const called = (body.calledNumber || body.called || "").trim();
  const status = (body.status || "INITIATED").toUpperCase();
  const incomingAudio = body.audioData || body.data?.audioData;

  console.log(`📥 Requête → caller="${caller}" | called="${called}" | status="${status}" | audio=${!!incomingAudio}`);

  // Sauvegarde l'audio réel reçu
  if (incomingAudio && typeof incomingAudio === 'string' && incomingAudio.length > 30) {
    if (activeCall) {
      if (caller === activeCall.caller) {
        activeCall.lastAudioFromCaller = incomingAudio;
        console.log(`🎵 Audio réel de l'appelant (${caller}) mis à jour`);
      } else if (caller === activeCall.called) {
        activeCall.lastAudioFromCalled = incomingAudio;
        console.log(`🎵 Audio réel de l'appelé (${caller}) mis à jour`);
      }
    }
  }

  // Initiation d'un nouvel appel
  if (status === "INITIATED" && caller && called) {
    activeCall = { 
      caller, 
      called, 
      lastAudioFromCaller: "", 
      lastAudioFromCalled: "" 
    };
    console.log(`📌 Nouvel appel réel : ${caller} → ${called}`);
  }

  // Polling → renvoie l'audio de l'autre partie
  if (status === "INITIATED") {
    if (activeCall) {
      const audioToSend = (called === activeCall.called) 
        ? activeCall.lastAudioFromCaller 
        : activeCall.lastAudioFromCalled;

      console.log(`✅ Polling → ANSWERED + audio réel de l'autre (${audioToSend.length || 0} chars)`);
      return res.status(200).json({
        success: true,
        data: {
          callId: `call-${Date.now()}`,
          call: {
            caller: activeCall.caller,
            called: activeCall.called,
            status: "ANSWERED",
          },
          audioData: audioToSend || "",
        },
        message: "✅ Appel actif avec audio réel",
      });
    }
  }

  // Raccrochage → reset
  if (status === "HUNGUP" || status === "COMPLETED") {
    console.log(`📴 Raccrochage → reset`);
    activeCall = null;
  }

  // Réponse par défaut
  return res.status(200).json({
    success: true,
    data: {
      callId: `call-${Date.now()}`,
      call: {
        caller: "unknown",
        called: "unknown",
        status: "INITIATED",
      },
      audioData: "",
    },
    message: "✅ Aucun appel actif",
  });
}