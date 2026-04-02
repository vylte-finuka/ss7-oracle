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

// Stockage global des appels en cours (serverless-friendly)
const pendingCalls = new Map<string, { caller: string; called: string; timestamp: number }>();

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

    console.log(`📥 Requête reçue → caller="${callerNumber}" | called="${calledNumber}" | status="${status}"`);

    // ====================== POLLING checkIncomingCalls ======================
    if (status === "INITIATED" && !callerNumber && calledNumber) {
      const pending = pendingCalls.get(calledNumber);
      if (pending) {
        console.log(`✅ APPEL ENTRANT TROUVÉ → caller="${pending.caller}" | called="${calledNumber}"`);

        return res.status(200).json({
          success: true,
          data: {
            callId: callId,
            call: {
              caller: pending.caller,   // ← VRAI NUMÉRO
              called: calledNumber,
              status: "INITIATED",
            },
          },
          message: "✅ Appel entrant avec vrai caller",
        });
      } else {
        console.log(`⚠️ Aucun appel entrant trouvé pour ${calledNumber}`);
      }
    }

    // ====================== INITIATE CALL (appel sortant) ======================
    if (status === "INITIATED" && callerNumber && calledNumber) {
      pendingCalls.set(calledNumber, {
        caller: callerNumber,
        called: calledNumber,
        timestamp: Date.now(),
      });
      console.log(`📌 Appel enregistré en attente → ${callerNumber} → ${calledNumber}`);
    }

    // Nettoyage automatique après 30 secondes
    setTimeout(() => pendingCalls.delete(calledNumber), 30000);

    // ====================== Réponse SS7 simplifiée ======================
    const timestamp = BigInt(body.timestamp || Math.floor(Date.now() / 1000));
    const callerHash = BigInt("0x" + ethers.id(callerNumber || "unknown").slice(2, 18));
    const calledHash = BigInt("0x" + ethers.id(calledNumber || "unknown").slice(2, 18));

    const payloadHex = "0x010b" + Buffer.from(callerNumber + calledNumber).toString("hex");

    // Fire-and-forget (pas de .wait() pour éviter timeout Netlify)
    let txHash = null;
    try {
      const tx = await contract.initiateCall(
        0xec, 0x01, callerHash, calledHash, timestamp, 0n, payloadHex,
        { gasLimit: 400000 }
      );
      txHash = tx.hash;
    } catch (e: any) {
      console.warn("⚠️ initiateCall warning (non bloquant):", e.message);
    }

    return res.status(200).json({
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
    });
  } catch (err: any) {
    console.error("🔥 ERREUR ORACLE:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
