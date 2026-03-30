/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { WebSocketServer } from "ws";

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

let wss: WebSocketServer | null = null;
const wsClients = new Map<string, Set<any>>();

function initWebSocketServer() {
  if (wss) return;
  wss = new WebSocketServer({ port: 4001 });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url!, "http://localhost");
    const callId = url.pathname.split("/").pop() || "";

    if (!wsClients.has(callId)) wsClients.set(callId, new Set());
    wsClients.get(callId)!.add(ws);

    console.log(`🔌 WebSocket connecté pour callId: ${callId}`);

    ws.on("close", () => {
      wsClients.get(callId)?.delete(ws);
    });
  });

  console.log("🟢 WebSocket Oracle actif sur ws://localhost:4001");
}

initWebSocketServer();

const ABI = [
  "function initiateCall(uint8 opcode,uint8 msgType,uint64 callerHash,uint64 calledHash,uint64 timestamp,uint64 extra,bytes payload) external returns (bytes32)",
  "function reportCallResult(bytes32 callId,string status,bytes responseData) external",
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

class SS7Encoder {
  static encodeIam(caller: string, called: string, timestamp: bigint): Buffer {
    return Buffer.concat([
      Buffer.from([0x01]),
      Buffer.from([caller.length]),
      Buffer.from(caller),
      Buffer.from([called.length]),
      Buffer.from(called),
      Buffer.from([
        Number(timestamp >> 32n) & 0xff,
        Number(timestamp >> 24n) & 0xff,
        Number(timestamp >> 16n) & 0xff,
        Number(timestamp >> 8n) & 0xff,
        Number(timestamp) & 0xff,
      ]),
    ]);
  }

  static encodeAnm(callId: string, timestamp: bigint): Buffer {
    const buf = Buffer.from(callId);
    return Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from([buf.length]),
      buf,
      Buffer.from([
        Number(timestamp >> 32n) & 0xff,
        Number(timestamp >> 24n) & 0xff,
        Number(timestamp >> 16n) & 0xff,
        Number(timestamp >> 8n) & 0xff,
        Number(timestamp) & 0xff,
      ]),
    ]);
  }

  static encodeVoiceData(callId: string, audioData: Buffer, seq: number): Buffer {
    const buf = Buffer.from(callId);
    return Buffer.concat([
      Buffer.from([0x08]),
      Buffer.from([buf.length]),
      buf,
      Buffer.from([seq >> 8, seq & 0xff]),
      audioData,
    ]);
  }
}

function safeString(value: any): string {
  if (value == null) return "";
  return String(value).trim();
}

function safeNumber(value: any, defaultValue = 0): number {
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-api-key"] as string;
  if (apiKey !== ORACLE_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = req.body || {};

    const callerNumber = safeString(body.callerNumber || body.caller);
    const calledNumber = safeString(body.calledNumber || body.called);
    const callId = safeString(body.callId);
    const status = safeString(body.status || "QUEUED");
    const callType = safeString(body.callType || "voice");
    const audioDataBase64 = safeString(body.audioData);
    const sequenceNumber = safeNumber(body.sequenceNumber);

    console.log("📥 Requête reçue :", {
      callType,
      status,
      callerNumber,
      calledNumber,
      callId,
      hasAudio: !!audioDataBase64,
    });

    // Si on a de l'audio, on le diffuse directement via WebSocket
    if (audioDataBase64 && callId) {
      const sockets = wsClients.get(callId);
      if (sockets && sockets.size > 0) {
        for (const ws of sockets) {
          ws.send(JSON.stringify({ audioData: audioDataBase64 }));
        }
        console.log(`📡 Audio diffusé via WebSocket vers ${sockets.size} client(s)`);
      }
    }

    // Construction du payload SS7
    let payloadSS7: Buffer;
    let msgType = 0x01;

    if (callType === "voice" && status === "INITIATED") {
      payloadSS7 = SS7Encoder.encodeIam(callerNumber, calledNumber, BigInt(Math.floor(Date.now() / 1000)));
    } else if (callType === "voice" && status === "ANSWERED") {
      payloadSS7 = SS7Encoder.encodeAnm(callId || "call", BigInt(Math.floor(Date.now() / 1000)));
      msgType = 0x04;
    } else if (audioDataBase64) {
      const audioBuf = Buffer.from(audioDataBase64, "base64");
      payloadSS7 = SS7Encoder.encodeVoiceData(callId || "call", audioBuf, sequenceNumber);
      msgType = 0x08;
    } else {
      payloadSS7 = Buffer.from([]);
    }

    const payloadHex = "0x" + payloadSS7.toString("hex");

    // Appel au contrat (on ne bloque plus jamais)
    let txHashInitiate: string | null = null;
    try {
      const tx = await contract.initiateCall(
        0xec,
        msgType,
        ethers.id(callerNumber).slice(0, 18),
        ethers.id(calledNumber).slice(0, 18),
        BigInt(Math.floor(Date.now() / 1000)),
        0n,
        payloadHex,
        { gasLimit: 500000 }
      );
      txHashInitiate = tx.hash;
      await tx.wait();
    } catch (e) {
      console.warn("⚠️ initiateCall a échoué (non bloquant):", e);
    }

    // Réponse propre
    return res.status(200).json({
      success: true,
      message: "Paquet SS7 traité",
      data: {
        callId: callId || "generated",
        audioData: audioDataBase64 ? audioDataBase64.slice(0, 100) + "..." : null,
        status,
        caller: callerNumber,
        called: calledNumber,
      },
    });

  } catch (err: any) {
    console.error("🔥 ERREUR ORACLE (catch global):", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}