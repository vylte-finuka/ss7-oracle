import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

const SLURA_RPC = process.env.SLURA_RPC!;
const CONTRACT_ADDRESS = "0x765D11d5555dA25B8186093361a0b8Dd17116D4d";
const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8081/ss7/outbound";
const ORACLE_API_KEY = process.env.ORACLE_API_KEY!;

const provider = new ethers.JsonRpcProvider(SLURA_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const ABI = [
  "function reportCallResult(bytes32 callId, string status, bytes data) external"
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

export async function POST(request: Request) {
  try {
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== ORACLE_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { callId, opcode, msgType, callerHash, calledHash, timestamp, extra, payload } = body;

    console.log(`[ORACLE] Reçu → opcode=${opcode} | callId=${callId}`);

    // Appel au gateway Yate / 3CX
    const gatewayResponse = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId,
        opcode,
        msgType,
        callerHash: callerHash.toString(),
        calledHash: calledHash.toString(),
        timestamp,
        extra,
        payloadHex: payload ? Buffer.from(payload).toString("hex") : ""
      })
    });

    const gatewayData = await gatewayResponse.json();
    const status = gatewayData.status || "SENT";
    const responseData = ethers.toUtf8Bytes(JSON.stringify(gatewayData));

    // Callback on-chain
    const tx = await contract.reportCallResult(callId, status, responseData);
    await tx.wait();

    console.log(`[ORACLE SUCCESS] tx=${tx.hash}`);

    return NextResponse.json({ success: true, txHash: tx.hash, status });

  } catch (error: any) {
    console.error("[ORACLE ERROR]", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}