/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/ss7-oracle/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const SLURA_RPC = process.env.SLURA_RPC!;
const CONTRACT_ADDRESS = "0x62598a7a170c52a66a020216f4dCb706af3E89F6";
const ORACLE_API_KEY = process.env.ORACLE_API_KEY!;

const provider = new ethers.JsonRpcProvider(SLURA_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const ABI = [
  "function initiateCall(bytes32 callId,uint8 opcode,uint8 msgType,uint64 callerHash,uint64 calledHash,uint64 timestamp,uint64 extra,bytes payload) external",
  "function reportCallResult(bytes32 callId,string status,bytes responseData,bytes32 originalPayloadHash) external",
  "function calls(bytes32 callId) external view returns (uint8 opcode,uint8 msgType,uint64 callerHash,uint64 calledHash,uint64 timestamp,uint64 extra,bytes32 payloadHash,string finalStatus,bytes32 finalResultHash,bool exists)"
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clean(info: any) {
  if (!info) return null;
  return {
    opcode: Number(info[0]),
    msgType: Number(info[1]),
    callerHash: info[2].toString(),
    calledHash: info[3].toString(),
    timestamp: info[4].toString(),
    extra: info[5].toString(),
    payloadHash: info[6],
    finalStatus: info[7],
    finalResultHash: info[8],
    exists: info[9]
  };
}

async function safeRead(callId: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const info = await contract.calls(callId);
      if (info.exists) return info;
    } catch (e) {
      console.warn("safeRead retry error:", e);
    }
    await sleep(500);
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-api-key");
    if (apiKey !== ORACLE_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Support pour Twilio (form-urlencoded) et appels JSON directs (depuis /twilio-dial ou /twilio-dial-3cx)
    let body: any;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      body = await req.json();
    } else {
      // Twilio statusCallback
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
    }

    const rawCallSid = body.callSid || body.CallSid;
    if (!rawCallSid) {
      return NextResponse.json({ error: "Missing callSid or CallSid" }, { status: 400 });
    }

    const callId: string = ethers.id(rawCallSid);
    const twilioStatus: string = (body.status || body.CallStatus || "QUEUED").toLowerCase();

    // Mapping Twilio CallStatus → ton statut métier + opcode
    let status = "QUEUED";
    let opcode = Number(body.opcode ?? 1);
    const msgType = Number(body.msgType ?? 1);
    const callerHash = BigInt(body.callerHash ?? 0);
    const calledHash = BigInt(body.calledHash ?? 0);
    const timestamp = BigInt(body.timestamp ?? Math.floor(Date.now() / 1000));
    const extra = BigInt(body.extra ?? 0);

    switch (twilioStatus) {
      case "initiated":
      case "queued":
        status = "INITIATED";
        opcode = 1;
        break;
      case "ringing":
        status = "RINGING";
        break;
      case "in-progress":
      case "answered":
        status = "ANSWERED";
        opcode = 1;
        break;
      case "completed":
      case "busy":
      case "failed":
      case "no-answer":
      case "canceled":
        status = "HANGUP";
        opcode = 3;
        break;
      default:
        status = twilioStatus.toUpperCase();
    }

    // Données enrichies depuis Twilio
    const from = body.From || body.from;
    const to = body.To || body.to;
    const duration = body.CallDuration ? Number(body.CallDuration) : 0;
    const sipUri = body.sipUri || body.SipUri; // venant de twilio-dial-3cx

    console.log("══════════════════════════════════════════════════════════════════════");
    console.log("🔵 TWILIO → SS7 ORACLE");
    console.log("Raw CallSid :", rawCallSid);
    console.log("callId (hashed) :", callId);
    console.log("Twilio Status :", twilioStatus, "→ Mapped :", status);
    console.log("From :", from, "| To :", to);
    if (sipUri) console.log("SIP URI :", sipUri);
    console.log("══════════════════════════════════════════════════════════════════════");

    // 1) Lecture de l'état actuel
    let beforeRaw = await safeRead(callId);
    let before = clean(beforeRaw);

    console.log("📘 ÉTAT AVANT :", before);

    // 2) Si l'appel n'existe pas encore → initiateCall()
    const payloadBytes = Buffer.from([]); // Pas de payload SS7 classique avec Twilio
    const payloadHex = "0x" + payloadBytes.toString("hex");

    if (!before?.exists) {
      console.log("🟦 Appel inconnu → initiateCall() automatique...");

      try {
        const tx = await contract.initiateCall(
          callId,
          opcode,
          msgType,
          callerHash,
          calledHash,
          timestamp,
          extra,
          payloadHex
        );
        console.log("✔ initiateCall() envoyé :", tx.hash);
        await tx.wait(1); // Optionnel : attendre 1 confirmation
      } catch (e: any) {
        console.log("⚠️ initiateCall() erreur ignorée :", e?.message || e);
      }

      beforeRaw = await safeRead(callId);
      before = clean(beforeRaw);
      console.log("📘 ÉTAT APRÈS initiateCall :", before);
    }

    // 3) Préparation des données de résultat
    const responseData = ethers.toUtf8Bytes(
      JSON.stringify({
        message: "Twilio call processed on-chain",
        callId,
        rawCallSid,
        twilioStatus,
        mappedStatus: status,
        from,
        to,
        duration,
        sipUri,
        previousStatus: before?.finalStatus ?? null,
        processedAt: new Date().toISOString()
      })
    );

    const originalPayloadHash = before?.payloadHash ?? ethers.ZeroHash;

    // 4) reportCallResult()
    let txHash = null;
    let warning = null;

    try {
      const tx = await contract.reportCallResult(
        callId,
        status,
        responseData,
        originalPayloadHash
      );
      txHash = tx.hash;
      console.log("✔ reportCallResult() envoyé :", tx.hash);
    } catch (e: any) {
      console.log("⚠️ reportCallResult() erreur :", e?.message || e);
      warning = e?.message || "report_error";
    }

    // 5) Lecture finale
    const afterRaw = await safeRead(callId);
    const after = clean(afterRaw);

    console.log("📗 ÉTAT APRÈS :", after);

    return NextResponse.json({
      success: true,
      callId,
      rawCallSid,
      status,
      before,
      after,
      txHash,
      warning,
      message: "Appel Twilio traité avec succès"
    });

  } catch (err: any) {
    console.error("🔥 ERREUR ORACLE FATALE :", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}