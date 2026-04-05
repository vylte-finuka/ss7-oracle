/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";

export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

const SLURA_RPC = process.env.SLURA_RPC!;
const CONTRACT_ADDRESS = "0x62598a7a170c52a66a020216f4dCb706af3E89F6";
const ORACLE_API_KEY = process.env.ORACLE_API_KEY!;

const provider = new ethers.JsonRpcProvider(SLURA_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

let activeCall: {
  caller: string;
  called: string;
  callId: string;
  lastAudioFromCaller?: string;
  lastAudioFromCalled?: string;
} | null = null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = req.headers["x-api-key"] as string;
  if (apiKey !== ORACLE_API_KEY) return res.status(401).json({ error: "Unauthorized" });

  const body = req.body || {};
  const caller = (body.callerNumber || body.caller || body.From || "").trim();
  const called = (body.calledNumber || body.called || body.To || "").trim();
  const status = (body.status || body.CallStatus || "INITIATED").toUpperCase();
  const audioDataBase64 = body.audioData || "";

  console.log(`📥 ORACLE → caller="${caller}" | called="${called}" | status="${status}" | audio=${!!audioDataBase64}`);

  if (status === "INITIATED" && caller && called && caller !== called) {
    const callId = `tw-${Date.now()}`;
    activeCall = { caller, called, callId, lastAudioFromCaller: "", lastAudioFromCalled: "" };
    console.log(`📌 Appel Twilio enregistré : ${caller} → ${called}`);
  }

  if (audioDataBase64 && audioDataBase64.length > 30 && activeCall) {
    if (caller === activeCall.caller) {
      activeCall.lastAudioFromCaller = audioDataBase64;
      console.log(`🎤 Chunk A→B stocké`);
    } else if (caller === activeCall.called) {
      activeCall.lastAudioFromCalled = audioDataBase64;
      console.log(`🎤 Chunk B→A stocké`);
    }
  }

  if (activeCall) {
    const isCallee = called === activeCall.called;
    const audioToReturn = isCallee ? activeCall.lastAudioFromCaller : activeCall.lastAudioFromCalled;

    return res.status(200).json({
      success: true,
      data: {
        callId: activeCall.callId,
        call: { caller: activeCall.caller, called: activeCall.called, status: "ANSWERED" },
        audioData: audioToReturn || "",
      },
      message: "✅ Chunk audio capturé",
    });
  }/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";

// Configuration du body parser pour accepter de gros fichiers (audio, etc.)
export const config = {
  api: { bodyParser: { sizeLimit: "50mb" } },
};

// Adresse RPC pour accéder à la blockchain (SLURA)
const SLURA_RPC = process.env.SLURA_RPC!;

// Adresse du smart contract Oracle
const CONTRACT_ADDRESS = "0x62598a7a170c52a66a020216f4dCb706af3E89F6";

// Clé API pour sécuriser l'accès à l'oracle
const ORACLE_API_KEY = process.env.ORACLE_API_KEY!;

// Initialisation du provider et du wallet pour interagir avec le smart contract
const provider = new ethers.JsonRpcProvider(SLURA_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

// Stockage de l'appel actif (en mémoire)
let activeCall: {
  caller: string;
  called: string;
  callId: string;
} | null = null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Autoriser uniquement les requêtes POST
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Vérification de la clé API
  const apiKey = req.headers["x-api-key"] as string;
  if (apiKey !== ORACLE_API_KEY) return res.status(401).json({ error: "Unauthorized" });

  // Extraction des données d'appel
  const body = req.body || {};
  const caller = (body.callerNumber || body.caller || body.From || "").trim();
  const called = (body.calledNumber || body.called || body.To || "").trim();
  const status = (body.status || body.CallStatus || "INITIATED").toUpperCase();

  // Log de l'appel reçu
  console.log(`📥 ORACLE → caller="${caller}" | called="${called}" | status="${status}"`);

  // Enregistrement de l'appel Twilio lors de l'initiation
  if (status === "INITIATED" && caller && called && caller !== called) {
    const callId = `tw-${Date.now()}`;
    activeCall = { caller, called, callId };
    console.log(`📌 Appel Twilio enregistré : ${caller} → ${called}`);
  }

  // Ici tu pourrais interagir avec le smart contract Oracle à l'adresse CONTRACT_ADDRESS
  // Par exemple, enregistrer l'appel sur la blockchain via ethers.js :
  // await wallet.sendTransaction({ ... });

  // Réponse avec l'adresse du contrat et les infos d'appel
  if (activeCall) {
    return res.status(200).json({
      success: true,
      contractAddress: CONTRACT_ADDRESS,
      data: {
        callId: activeCall.callId,
        call: { caller: activeCall.caller, called: activeCall.called, status: "ANSWERED" },
      },
      message: "Appel enregistré (logique blockchain à implémenter ici)."
    });
  }

  // Réponse par défaut si aucun appel actif
  return res.status(200).json({ success: true, contractAddress: CONTRACT_ADDRESS, message: "OK" });
}
