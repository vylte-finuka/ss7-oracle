/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import Ably from "ably";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

const SLURA_RPC = process.env.SLURA_RPC!;
const CONTRACT_ADDRESS = "0x62598a7a170c52a66a020216f4dCb706af3E89F6";
const ORACLE_API_KEY = process.env.ORACLE_API_KEY!;

const provider = new ethers.JsonRpcProvider(SLURA_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

// ==================== ABLY INITIALISATION ====================
const ably = new Ably.Realtime({ key: process.env.ABLY_API_KEY! });

const ABI = [
  "function initiateCall(uint8 opcode,uint8 msgType,uint64 callerHash,uint64 calledHash,uint64 timestamp,uint64 extra,bytes payload) external returns (bytes32)",
  "function reportCallResult(bytes32 callId,string status,bytes responseData) external",
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// Stockage des appels en cours
const pendingCalls = new Map<string, { caller: string; called: string }>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = req.headers["x-api-key"] as string;
    if (apiKey !== ORACLE_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;

    const callerNumber = (body.callerNumber || body.caller || "").toString().trim();
    const calledNumber = (body.calledNumber || body.called || "").toString().trim();
    const status = (body.status || "QUEUED").toString().toUpperCase();
    const callType = (body.callType || "voice").toString();
    const audioDataBase64 = body.audioData || "";

    console.log(`📥 Requête reçue → caller="${callerNumber}" | called="${calledNumber}" | status="${status}" | audio=${!!audioDataBase64}`);

    // ==================== NOUVEL APPEL ====================
    if (status === "INITIATED" && callerNumber && calledNumber) {
      pendingCalls.set(calledNumber, { caller: callerNumber, called: calledNumber });
      console.log(`📌 Appel enregistré → ${callerNumber} → ${calledNumber}`);
    }

    // ==================== CAPTURE CHUNK AUDIO + PUBLICATION ABLY ====================
    if (audioDataBase64 && audioDataBase64.length > 30 && pendingCalls.has(calledNumber)) {
      const call = pendingCalls.get(calledNumber)!;

      if (callerNumber === call.caller) {
        call.lastAudioFromCaller = audioDataBase64;   // A → B
      } else if (callerNumber === call.called) {
        call.lastAudioFromCalled = audioDataBase64;   // B → A
      }

      // Publication bidirectionnelle sur Ably
      const channelName = `call-${call.caller}-${call.called}`;
      const channel = ably.channels.get(channelName);

      await channel.publish("audio-chunk", {
        from: callerNumber,
        to: calledNumber,
        audioData: audioDataBase64,
        timestamp: Date.now()
      });

      console.log(`📡 Chunk audio publié sur Ably (${channelName})`);
    }

    // ==================== POLLING checkIncomingCalls ====================
    if (status === "INITIATED" && !callerNumber && calledNumber) {
      const pending = pendingCalls.get(calledNumber);
      if (pending) {
        console.log(`✅ APPEL ENTRANT TROUVÉ → caller="${pending.caller}"`);
        return res.status(200).json({
          success: true,
          data: {
            callId: body.callId || `in-${Date.now()}`,
            call: {
              caller: pending.caller,
              called: calledNumber,
              status: "INITIATED",
            },
          },
          message: "✅ Oracle a capturé le vrai caller",
        });
      }
    }

    // Nettoyage automatique
    setTimeout(() => pendingCalls.delete(calledNumber), 60000);

    // Réponse SS7
    const timestamp = BigInt(body.timestamp || Math.floor(Date.now() / 1000));
    const callerHash = BigInt("0x" + ethers.id(callerNumber || "unknown").slice(2, 18));
    const calledHash = BigInt("0x" + ethers.id(calledNumber || "unknown").slice(2, 18));

    const payloadHex = "0x010b" + Buffer.from(callerNumber + calledNumber).toString("hex");

    let txHash = null;
    try {
      const tx = await contract.initiateCall(
        0xec,
        0x01,
        callerHash,
        calledHash,
        timestamp,
        0n,
        payloadHex,
        { gasLimit: 400000 }
      );
      txHash = tx.hash;
    } catch (e) {
      console.warn("⚠️ initiateCall warning:", e.message);
    }

    return res.status(200).json({
      success: true,
      data: {
        callId: `call-${Date.now()}`,
        call: {
          caller: callerNumber || "unknown",
          called: calledNumber || "unknown",
          status: status,
        },
        payload: { hex: payloadHex },
      },
      message: "✅ Oracle SS7 + Ably prêt",
    });
  } catch (err: any) {
    console.error("🔥 ERREUR ORACLE:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
