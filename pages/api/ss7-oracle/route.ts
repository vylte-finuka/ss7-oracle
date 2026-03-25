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
    } catch {}
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

    const body = await req.json();

    const callId: string = body.callId;
    const status: string = body.status ?? "QUEUED";

    // Données PSTN venant de l’UVM
    const opcode = body.opcode;
    const msgType = body.msgType;
    const callerHash = body.callerHash;
    const calledHash = body.calledHash;
    const timestamp = body.timestamp;
    const extra = body.extra;

    // Payload SS7 (base64 → bytes)
    const payloadBytes = body.payload
      ? Buffer.from(body.payload, "base64")
      : Buffer.from([]);

    const payloadHex = "0x" + payloadBytes.toString("hex");

    console.log("══════════════════════════════════════════════════════════════════════");
    console.log("🔵 CALLBACK UVM → ORACLE (B)");
    console.log("CallId reçu :", callId);
    console.log("Status reçu :", status);
    console.log("══════════════════════════════════════════════════════════════════════");

    // 1) Lecture AVANT
    let beforeRaw = await safeRead(callId);
    let before = clean(beforeRaw);

    console.log("📘 ÉTAT AVANT :", before);

    // 2) Si l’appel n’existe pas → initiateCall()
    if (!before?.exists) {
      console.log("🟦 Appel inconnu → initiateCall() automatique…");

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
      } catch (e: any) {
        console.log("⚠️ initiateCall() erreur ignorée :", e?.message || e);
      }

      // Relire après création
      beforeRaw = await safeRead(callId);
      before = clean(beforeRaw);

      console.log("📘 ÉTAT APRÈS initiateCall :", before);
    }

    // 3) responseData minimal
    const responseData = ethers.toUtf8Bytes(
      JSON.stringify({
        message: "Résultat d'appel traité on-chain",
        callId,
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
      console.log("⚠️ BUG Ethers ignoré :", e?.message || e);
      warning = e?.message || "ethers_bug_ignored";
    }

    // 5) Lecture APRÈS
    const afterRaw = await safeRead(callId);
    const after = clean(afterRaw);

    console.log("📗 ÉTAT APRÈS :", after);

    return NextResponse.json({
      success: true,
      callId,
      status,
      before,
      after,
      txHash,
      warning,
      message: "Appel traité (initiateCall + reportCallResult)"
    });

  } catch (err: any) {
    console.error("🔥 ERREUR ORACLE FATALE :", err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}