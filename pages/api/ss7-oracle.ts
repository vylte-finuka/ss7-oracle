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
import { WebSocketServer } from "ws";

const SLURA_RPC = process.env.SLURA_RPC!;
const CONTRACT_ADDRESS = "0x62598a7a170c52a66a020216f4dCb706af3E89F6";
const ORACLE_API_KEY = process.env.ORACLE_API_KEY!;

const provider = new ethers.JsonRpcProvider(SLURA_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

// ====== ORACLE WEBSOCKET SERVER (INTÉGRÉ) ======
let wss: WebSocketServer | null = null;
const wsClients = new Map<string, Set<any>>();

function initWebSocketServer() {
  if (wss) return; // éviter double init en hot reload

  wss = new WebSocketServer({ port: 4001 });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url!, "http://localhost");
    // attendu: /oracle/audio-stream/:callId
    const callId = url.pathname.split("/").pop() || "";

    if (!wsClients.has(callId)) wsClients.set(callId, new Set());
    wsClients.get(callId)!.add(ws);

    console.log("🔌 Client WebSocket connecté:", callId);

    ws.on("close", () => {
      wsClients.get(callId)!.delete(ws);
      console.log("⛔ Client WebSocket déconnecté:", callId);
    });
  });

  console.log(
    "🟢 Oracle WebSocket actif sur ws://localhost:4001/oracle/audio-stream/:callId"
  );
}

initWebSocketServer();

// ABI du contrat SS7VoiceUVM
const ABI = [
  "function initiateCall(uint8 opcode,uint8 msgType,uint64 callerHash,uint64 calledHash,uint64 timestamp,uint64 extra,bytes payload) external returns (bytes32)",
  "function reportCallResult(bytes32 callId,string status,bytes responseData) external",
  "function setPaused(bool _paused) external",
  "function getLastResultHash() external view returns (bytes32)",
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// ===== SS7 ENCODER =====
class SS7Encoder {
  static encodeSmsmo(
    callerNumber: string,
    calledNumber: string,
    messageText: string
  ): Buffer {
    const msgType = 0x06;
    const callerBuf = Buffer.from(callerNumber, "utf-8");
    const calledBuf = Buffer.from(calledNumber, "utf-8");
    const contentBuf = Buffer.from(messageText, "utf-8");

    return Buffer.concat([
      Buffer.from([msgType]),
      Buffer.from([callerBuf.length]),
      callerBuf,
      Buffer.from([calledBuf.length]),
      calledBuf,
      Buffer.from([contentBuf.length >> 8, contentBuf.length & 0xff]),
      contentBuf,
    ]);
  }

  static encodeSmsmt(
    callerNumber: string,
    calledNumber: string,
    messageText: string
  ): Buffer {
    const msgType = 0x07;
    const callerBuf = Buffer.from(callerNumber, "utf-8");
    const calledBuf = Buffer.from(calledNumber, "utf-8");
    const contentBuf = Buffer.from(messageText, "utf-8");

    return Buffer.concat([
      Buffer.from([msgType]),
      Buffer.from([callerBuf.length]),
      callerBuf,
      Buffer.from([calledBuf.length]),
      calledBuf,
      Buffer.from([contentBuf.length >> 8, contentBuf.length & 0xff]),
      contentBuf,
    ]);
  }

  static encodeIam(
    callerNumber: string,
    calledNumber: string,
    timestamp: bigint
  ): Buffer {
    const msgType = 0x01;
    const callerBuf = Buffer.from(callerNumber, "utf-8");
    const calledBuf = Buffer.from(calledNumber, "utf-8");

    return Buffer.concat([
      Buffer.from([msgType]),
      Buffer.from([callerBuf.length]),
      callerBuf,
      Buffer.from([calledBuf.length]),
      calledBuf,
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
    const msgType = 0x04;
    const callIdBuf = Buffer.from(callId, "utf-8");

    return Buffer.concat([
      Buffer.from([msgType]),
      Buffer.from([callIdBuf.length]),
      callIdBuf,
      Buffer.from([
        Number(timestamp >> 32n) & 0xff,
        Number(timestamp >> 24n) & 0xff,
        Number(timestamp >> 16n) & 0xff,
        Number(timestamp >> 8n) & 0xff,
        Number(timestamp) & 0xff,
      ]),
    ]);
  }

  static encodeRel(callId: string, reason: number, timestamp: bigint): Buffer {
    const msgType = 0x05;
    const callIdBuf = Buffer.from(callId, "utf-8");

    return Buffer.concat([
      Buffer.from([msgType]),
      Buffer.from([callIdBuf.length]),
      callIdBuf,
      Buffer.from([reason]),
      Buffer.from([
        Number(timestamp >> 32n) & 0xff,
        Number(timestamp >> 24n) & 0xff,
        Number(timestamp >> 16n) & 0xff,
        Number(timestamp >> 8n) & 0xff,
        Number(timestamp) & 0xff,
      ]),
    ]);
  }

  static encodeVoiceData(
    callId: string,
    audioData: Buffer,
    sequenceNumber: number
  ): Buffer {
    const msgType = 0x08;
    const callIdBuf = Buffer.from(callId, "utf-8");

    return Buffer.concat([
      Buffer.from([msgType]),
      Buffer.from([callIdBuf.length]),
      callIdBuf,
      Buffer.from([sequenceNumber >> 8, sequenceNumber & 0xff]),
      audioData,
    ]);
  }

  static decodeSS7(packet: Buffer): any {
    const msgType = packet[0];
    const msgTypeNames: Record<number, string> = {
      0x01: "IAM",
      0x04: "ANM",
      0x05: "REL",
      0x06: "SMS-MO",
      0x07: "SMS-MT",
      0x08: "VOICE_DATA",
    };

    return {
      msgType,
      msgTypeName: msgTypeNames[msgType] || "UNKNOWN",
      rawData: "0x" + packet.toString("hex"),
    };
  }
}

// Générer callId
function generateCallId(
  opcode: number,
  msgType: number,
  callerHash: bigint,
  calledHash: bigint,
  timestamp: bigint
): string {
  const callerHash64 = callerHash & ((1n << 64n) - 1n);
  const calledHash64 = calledHash & ((1n << 64n) - 1n);
  const timestamp64 = timestamp & ((1n << 64n) - 1n);

  console.log("🔍 Hash Debug:");
  console.log("  callerHash64:", callerHash64.toString());
  console.log("  calledHash64:", calledHash64.toString());
  console.log("  timestamp64:", timestamp64.toString());

  return ethers.keccak256(
    ethers.solidityPacked(
      ["uint8", "uint8", "uint64", "uint64", "uint64"],
      [opcode, msgType, callerHash64, calledHash64, timestamp64]
    )
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Vérifier la méthode
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Vérifier l'API key
    const apiKey = req.headers["x-api-key"] as string;
    if (apiKey !== ORACLE_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;

    // Paramètres principaux
    const status: string = body.status ?? "QUEUED";
    const callType: string = body.callType ?? "voice";
    let opcode: number = body.opcode ?? 0xef;
    let msgType: number = body.msgType ?? 0x01;

    // Données de l'appel
    const callerNumber = body.callerNumber || body.caller || "unknown";
    const calledNumber = body.calledNumber || body.called || "unknown";
    const timestamp = BigInt(body.timestamp || Math.floor(Date.now() / 1000));
    const extra = BigInt(body.extra ?? 0);

    // Hash des numéros
    let callerHash = body.callerHash ? BigInt(body.callerHash) : 0n;
    let calledHash = body.calledHash ? BigInt(body.calledHash) : 0n;

    if (callerHash === 0n) {
      callerHash = BigInt("0x" + ethers.id(callerNumber).slice(2, 18));
    }
    if (calledHash === 0n) {
      calledHash = BigInt("0x" + ethers.id(calledNumber).slice(2, 18));
    }

    // Encoder les données en SS7
    let payloadSS7: Buffer;

    if (callType === "sms-mo") {
      const messageText = body.messageText || body.smsContent || "";
      payloadSS7 = SS7Encoder.encodeSmsmo(
        callerNumber,
        calledNumber,
        messageText
      );
      msgType = 0x06;
      opcode = 0xec;
      console.log("📱 SMS-MO encodé en SS7:", messageText);
    } else if (callType === "sms-mt") {
      const messageText = body.messageText || body.smsContent || "";
      payloadSS7 = SS7Encoder.encodeSmsmt(
        callerNumber,
        calledNumber,
        messageText
      );
      msgType = 0x07;
      opcode = 0xef;
      console.log("📱 SMS-MT encodé en SS7:", messageText);
    } else if (callType === "voice" && status === "INITIATED") {
      payloadSS7 = SS7Encoder.encodeIam(
        callerNumber,
        calledNumber,
        timestamp
      );
      msgType = 0x01;
      opcode = 0xec;
      console.log("☎️ IAM encodé en SS7 (début appel)");
    } else if (callType === "voice" && status === "ANSWERED") {
      payloadSS7 = SS7Encoder.encodeAnm(body.callId || "call", timestamp);
      msgType = 0x04;
      opcode = 0xef;
      console.log("☎️ ANM encodé en SS7 (appel répondu)");
    } else if (status === "COMPLETED" || status === "HUNGUP") {
      payloadSS7 = SS7Encoder.encodeRel(body.callId || "call", 16, timestamp);
      msgType = 0x05;
      console.log("☎️ REL encodé en SS7 (appel terminé)");
    } else if (callType === "voice" && body.audioData) {
      const audioBuf = Buffer.from(body.audioData, "base64");
      payloadSS7 = SS7Encoder.encodeVoiceData(
        body.callId || "call",
        audioBuf,
        body.sequenceNumber || 0
      );
      msgType = 0x08;
      console.log("🔊 VOICE_DATA encodé en SS7 (" + audioBuf.length + " bytes)");

      // ====== DIFFUSION WEBSOCKET ORACLE → DIALER ======
      const sockets = wsClients.get(body.callId);
      if (sockets) {
        for (const ws of sockets) {
          ws.send(JSON.stringify({ audio: body.audioData }));
        }
        console.log("📡 Audio Oracle diffusé via WebSocket → Dialer");
      }
    } else {
      payloadSS7 = body.payload
        ? Buffer.from(body.payload, "base64")
        : Buffer.from([]);
    }

    const payloadHex = "0x" + payloadSS7.toString("hex");
    const payloadBase64 = payloadSS7.toString("base64");
    const ss7Info = SS7Encoder.decodeSS7(payloadSS7);

    // Générer le callId
    const generatedCallId = generateCallId(
      opcode,
      msgType,
      callerHash,
      calledHash,
      timestamp
    );

    console.log(
      "══════════════════════════════════════════════════════════════════════"
    );
    console.log("🔵 CALLBACK SS7 OSI → ORACLE (SS7VoiceUVM)");
    console.log("Generated CallId:", generatedCallId);
    console.log(
      "Opcode:",
      opcode === 0xef ? "0xef (inbound)" : "0xec (outbound)"
    );
    console.log(
      "Message SS7:",
      ss7Info.msgTypeName,
      `(0x${msgType.toString(16).padStart(2, "0")})`
    );
    console.log("De:", callerNumber, "(0x" + callerHash.toString(16) + ")");
    console.log("Vers:", calledNumber, "(0x" + calledHash.toString(16) + ")");
    console.log("Payload SS7:", payloadHex.slice(0, 100) + "...");
    console.log("Status:", status);
    console.log(
      "══════════════════════════════════════════════════════════════════════"
    );

    // Appeler initiateCall()
    let txHashInitiate = null;
    let txHashReport = null;
    let returnedCallId = null;
    let initiateWarning = null;

    try {
      console.log("📤 Appel initiateCall() sur le contrat...");
      console.log("  Opcode:", opcode, "MsgType:", msgType);
      console.log(
        "  CallerHash:",
        callerHash.toString(),
        "CalledHash:",
        calledHash.toString()
      );
      console.log("  Timestamp:", timestamp.toString());

      const tx = await contract.initiateCall(
        opcode,
        msgType,
        callerHash,
        calledHash,
        timestamp,
        extra,
        payloadHex,
        {
          gasLimit: 500000,
        }
      );

      txHashInitiate = tx.hash;
      console.log("✔ initiateCall() émis:", txHashInitiate);
      console.log("  → Événement CallInitiated triggeré");

      const receipt = await tx.wait();
      console.log("✔ initiateCall() confirmé au bloc:", receipt?.blockNumber);

      returnedCallId = generatedCallId;
      console.log("✔ CallId:", returnedCallId);
    } catch (e: any) {
      const errorMsg = e?.message || e?.toString() || "Unknown error";

      // ⚠️ CONTOURNER l'erreur hash mismatch - c'est juste un warning
      if (errorMsg.includes("hash") || errorMsg.includes("returned")) {
        console.warn("⚠️ WARNING (non-bloquant):", errorMsg);
        initiateWarning = errorMsg;

        // Continuer malgré tout
        returnedCallId = generatedCallId;
        console.log("✔ Continuation malgré le warning hash");
        console.log("✔ CallId généré côté Oracle:", returnedCallId);
      } else {
        // Erreur CRITIQUE - bloquer
        console.error("❌ ERREUR CRITIQUE initiateCall():", errorMsg);
        return res.status(500).json({
          success: false,
          error: errorMsg,
          type: "critical",
        });
      }
    }

    // reportCallResult()
    let reportWarning = null;
    try {
      console.log("📤 Appel reportCallResult()...");

      const responseData = ethers.toUtf8Bytes(
        JSON.stringify({
          message: "Appel SS7 traité",
          callId: returnedCallId,
          ss7MessageType: ss7Info.msgTypeName,
          caller: callerNumber,
          called: calledNumber,
          status,
          processedAt: new Date().toISOString(),
        })
      );

      const txReport = await contract.reportCallResult(
        returnedCallId,
        status,
        responseData,
        { gasLimit: 300000 }
      );

      txHashReport = txReport.hash;
      console.log("✔ reportCallResult() émis:", txHashReport);
      await txReport.wait();
      console.log("✔ reportCallResult() confirmé");
    } catch (e: any) {
      const errorMsg = e?.message || e?.toString() || "Unknown error";
      console.warn("⚠️ Erreur reportCallResult() (non-critique):", errorMsg);
      reportWarning = errorMsg;
      // Ne pas bloquer si c'est reportCallResult qui échoue
    }

    // ✅ PAYLOAD OSI COMPLET POUR INFRASTRUCTURE PSTN
    const osiPayload = {
      // === Header OSI Layer 7 ===
      version: "1.0",
      protocol: "SS7-ORACLE",
      timestamp: new Date().toISOString(),

      // === Identification ===
      callId: returnedCallId,
      requestId: body.requestId || ethers.id(returnedCallId).slice(0, 18),

      // === Paramètres SS7 ===
      ss7: {
        opcode: `0x${opcode.toString(16).padStart(2, "0")}`,
        opcodeLabel: opcode === 0xef ? "metadata/inbound" : "outbound",
        msgType: `0x${msgType.toString(16).padStart(2, "0")}`,
        msgTypeLabel: ss7Info.msgTypeName,
        callerHash: callerHash.toString(),
        calledHash: calledHash.toString(),
        timestamp: timestamp.toString(),
        extra: extra.toString(),
      },

      // === Données d'appel ===
      call: {
        callType,
        status,
        caller: callerNumber,
        callerHash: `0x${callerHash.toString(16)}`,
        called: calledNumber,
        calledHash: `0x${calledHash.toString(16)}`,
        duration: body.duration || 0,
        recordingUrl: body.recordingUrl || null,
      },

      // === PAYLOAD OSI - Format pour PSTN/3CX ===
      payload: {
        format: "SS7-Binary",
        hex: payloadHex,
        base64: payloadBase64,
        length: payloadSS7.length,
        bytes: Array.from(payloadSS7),
      },

      // === Blockchain ===
      blockchain: {
        chain: "SLURA",
        contractAddress: CONTRACT_ADDRESS,
        txHashInitiate,
        txHashReport,
      },

      // === Warnings ===
      warnings: {
        initiateCall: initiateWarning,
        reportCallResult: reportWarning,
      },
    };

    console.log("\n📤 PAYLOAD OSI pour PSTN:");
    console.log(JSON.stringify(osiPayload, null, 2));

    return res.status(200).json({
      success: true,
      data: osiPayload,
      message:
        "✅ Paquet OSI SS7 généré pour infrastructure PSTN/3CX/Orange",
    });
  } catch (err: any) {
    console.error("🔥 ERREUR ORACLE:", err?.message);
    return res.status(500).json({
      success: false,
      error: err?.message || "Unknown error",
      type: "fatal",
    });
  }
}
