export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

import type { NextApiRequest, NextApiResponse } from "next";

let activeCall: {
  caller: string;
  called: string;
  lastAudioFromCaller?: string;   // audio envoyé par A
  lastAudioFromCalled?: string;   // audio envoyé par B
} | null = null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const caller = (body.callerNumber || body.caller || "").trim();
  const called = (body.calledNumber || body.called || "").trim();
  const status = (body.status || "INITIATED").toUpperCase();
  const incomingAudio = body.audioData || body.data?.audioData;

  console.log(`📥 Requête oracle → caller="${caller}" | called="${called}" | status="${status}"`);

  // === 1. Enregistrement d’un nouvel appel ===
  if (status === "INITIATED" && caller && called && caller !== called) {
    activeCall = {
      caller,
      called,
      lastAudioFromCaller: "",
      lastAudioFromCalled: "",
    };
    console.log(`📌 Nouvel appel enregistré : ${caller} → ${called}`);
  }

  // === 2. Stockage de l’audio reçu ===
  if (incomingAudio && typeof incomingAudio === "string" && incomingAudio.length > 30 && activeCall) {
    if (caller === activeCall.caller) {
      activeCall.lastAudioFromCaller = incomingAudio;
      console.log(`🎤 Audio stocké de ${caller} (A → B)`);
    } else if (caller === activeCall.called) {
      activeCall.lastAudioFromCalled = incomingAudio;
      console.log(`🎤 Audio stocké de ${caller} (B → A)`);
    }
  }

  // === 3. Polling : renvoi du bon flux audio ===
  if (status === "INITIATED" && activeCall) {
    const isCallerPolling = called === activeCall.called; // celui qui poll est l'appelé

    const audioToReturn = isCallerPolling 
      ? activeCall.lastAudioFromCaller   // A parle → B reçoit
      : activeCall.lastAudioFromCalled;  // B parle → A reçoit

    return res.status(200).json({
      success: true,
      data: {
        callId: `call-${Date.now()}`,
        call: {
          caller: activeCall.caller,
          called: activeCall.called,
          status: "ANSWERED",
        },
        audioData: audioToReturn || "",
      },
      message: "✅ Flux audio renvoyé via oracle (A ↔ B)",
    });
  }

  // === 4. Raccrochage → reset total ===
  if (status === "HUNGUP" || status === "COMPLETED") {
    console.log(`📴 Raccrochage → reset complet`);
    activeCall = null;
  }

  // Réponse par défaut
  return res.status(200).json({
    success: true,
    data: { call: { caller: "unknown", called: "unknown", status: "INITIATED" }, audioData: "" },
    message: "✅ Aucun appel actif",
  });
}
