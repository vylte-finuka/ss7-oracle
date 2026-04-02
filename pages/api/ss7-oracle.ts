export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";

const SLURA_RPC = process.env.SLURA_RPC!;
const CONTRACT_ADDRESS = "0x62598a7a170c52a66a020216f4dCb706af3E89F6";

const provider = new ethers.JsonRpcProvider(SLURA_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const ABI = [
  "function initiateCall(uint8 opcode,uint8 msgType,uint64 callerHash,uint64 calledHash,uint64 timestamp,uint64 extra,bytes payload) external returns (bytes32)",
  "function reportCallResult(bytes32 callId,string status,bytes responseData) external",
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// Stockage temporaire des appels en cours (serverless-friendly)
const pendingCalls = new Map<string, { caller: string; called: string }>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = req.headers["x-api-key"] as string;
    if (apiKey !== process.env.ORACLE_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;

    const callerNumber = (body.callerNumber || body.caller || "").toString().trim();
    const calledNumber = (body.calledNumber || body.called || "").toString().trim();
    const status = (body.status || "QUEUED").toString().toUpperCase();
    const callType = (body.callType || "voice").toString();
    const callId = body.callId || `call-${Date.now()}`;

    console.log(`📥 Requête reçue : caller=${callerNumber} | called=${calledNumber} | status=${status}`);

    // === POLLING DES APPELS ENTRANTS ===
    if (status === "INITIATED" && !callerNumber) {
      // C’est un polling checkIncomingCalls
      const pending = pendingCalls.get(calledNumber);
      if (pending) {
        console.log(`✅ Appel entrant trouvé pour ${calledNumber} → caller réel = ${pending.caller}`);
        return res.status(200).json({
          success: true,
          data: {
            callId: callId,
            call: {
              caller: pending.caller,
              called: calledNumber,
              status: "INITIATED",
            },
          },
          message: "✅ Appel entrant détecté avec vrai caller",
        });
      }
    }

    // === INITIATION D'UN NOUVEL APPEL ===
    if (status === "INITIATED" && callerNumber && calledNumber) {
      // On enregistre l’appel pour que le polling le retrouve
      pendingCalls.set(calledNumber, { caller: callerNumber, called: calledNumber });
      console.log(`📌 Appel enregistré : ${callerNumber} → ${calledNumber}`);
    }

    // Nettoyage après 30 secondes (optionnel)
    setTimeout(() => pendingCalls.delete(calledNumber), 30000);

    // === GÉNÉRATION SS7 (simplifiée) ===
    const timestamp = BigInt(body.timestamp || Math.floor(Date.now() / 1000));
    const callerHash = BigInt("0x" + ethers.id(callerNumber || "unknown").slice(2, 18));
    const calledHash = BigInt("0x" + ethers.id(calledNumber || "unknown").slice(2, 18));

    const payloadHex = "0x010b" + Buffer.from(callerNumber + calledNumber).toString("hex");

    // Fire-and-forget (pas de .wait() pour éviter timeout)
    let txHash = null;
    try {
      const tx = await contract.initiateCall(
        0xec, 0x01, callerHash, calledHash, timestamp, 0n, payloadHex,
        { gasLimit: 400000 }
      );
      txHash = tx.hash;
    } catch (e) {
      console.warn("⚠️ initiateCall warning:", e.message);
    }

    const response = {
      success: true,
      data: {
        version: "1.0",
        callId: callId,
        call: {
          caller: callerNumber || "unknown",
          called: calledNumber || "unknown",
          status: status,
        },
        payload: {
          hex: payloadHex,
          base64: Buffer.from(payloadHex.slice(2), "hex").toString("base64"),
        },
        blockchain: { txHashInitiate: txHash },
      },
      message: "✅ Oracle a capturé les vrais numéros",
    };

    console.log(`✅ Réponse Oracle → caller: ${callerNumber} | called: ${calledNumber}`);

    return res.status(200).json(response);
  } catch (err: any) {
    console.error("🔥 ERREUR ORACLE:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
