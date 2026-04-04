export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

import type { NextApiRequest, NextApiResponse } from "next";

let activeCall: {
  caller: string;
  called: string;
  lastAudioFromCaller?: string;
  lastAudioFromCalled?: string;
} | null = null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const caller = (body.callerNumber || body.caller || "").trim();
  const called = (body.calledNumber || body.called || "").trim();
  const status = (body.status || "INITIATED").toUpperCase();
  const incomingAudio = body.audioData || body.data?.audioData;

  console.log(`📥 ORACLE → caller="${caller}" | called="${called}" | status="${status}" | audio=${!!incomingAudio}`);

  // === Nouvel appel ===
  if (status === "INITIATED" && caller && called && caller !== called) {
    activeCall = { caller, called, lastAudioFromCaller: "", lastAudioFromCalled: "" };
    console.log(`📌 Appel enregistré : ${caller} → ${called}`);
  }

  // === Stockage audio (uniquement si les numéros sont différents) ===
  if (incomingAudio && typeof incomingAudio === "string" && incomingAudio.length > 30 && activeCall) {
    if (caller === activeCall.caller && caller !== activeCall.called) {
      activeCall.lastAudioFromCaller = incomingAudio;
      console.log(`🎤 Audio stocké A→B (de ${caller})`);
    } else if (caller === activeCall.called && caller !== activeCall.caller) {
      activeCall.lastAudioFromCalled = incomingAudio;
      console.log(`🎤 Audio stocké B→A (de ${caller})`);
    }
  }

  // === Polling : renvoi du bon flux ===
  if (status === "INITIATED" && activeCall) {
    const isCalleePolling = called === activeCall.called;
    const audioToReturn = isCalleePolling 
      ? activeCall.lastAudioFromCaller 
      : activeCall.lastAudioFromCalled;

    console.log(`📤 Renvoi audio à ${called} → ${isCalleePolling ? "de A" : "de B"}`);

    return res.status(200).json({
      success: true,
      data: {
        callId: `call-${Date.now()}`,
        call: { caller: activeCall.caller, called: activeCall.called, status: "ANSWERED" },
        audioData: audioToReturn || "",
      },
      message: "✅ Flux audio via oracle (A ↔ B)",
    });
  }

  // === Raccrochage ===
  if (status === "HUNGUP" || status === "COMPLETED") {
    console.log("📴 Raccrochage → reset total");
    activeCall = null;
  }

  return res.status(200).json({
    success: true,
    data: { call: { caller: "unknown", called: "unknown", status: "INITIATED" }, audioData: "" },
    message: "✅ Aucun appel actif",
  });
}
