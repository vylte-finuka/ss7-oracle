// app/api/ss7-oracle/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

// ====================== CONFIG ======================
const SLURA_RPC = process.env.SLURA_RPC!;
const CONTRACT_ADDRESS = "0x765D11d5555dA25B8186093361a0b8Dd17116D4d";
const ORACLE_API_KEY = process.env.ORACLE_API_KEY!;

const provider = new ethers.JsonRpcProvider(SLURA_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const ABI = [
  "function reportCallResult(bytes32 callId, string status, bytes data) external"
];

const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// ====================== ÉTAT SIMULÉ ======================
type CallState = {
  callId: string;
  opcode: number;
  msgType: number;
  callerHash: string;
  calledHash: string;
  timestamp: number;
  extra?: string;
  payloadHex?: string;
  status: 'QUEUED' | 'RINGING' | 'ANSWERED' | 'ENDED' | 'FAILED';
  createdAt: number;
  duration: number;
  simulationStep: number;
};

const calls = new Map<string, CallState>();

// ====================== SIMULATION OUTBOUND ======================
function simulateOutboundProgress(callId: string) {
  const call = calls.get(callId);
  if (!call) return;

  if (call.simulationStep === 0) {
    call.status = 'RINGING';
    call.simulationStep = 1;
    reportStatus(callId, call.status, "Sonnerie lancée");
    setTimeout(() => simulateOutboundProgress(callId), 5000);
  } else if (call.simulationStep === 1) {
    call.status = 'ANSWERED';
    call.simulationStep = 2;
    call.duration = 0;
    reportStatus(callId, call.status, "Appel décroché");
    const interval = setInterval(() => {
      const c = calls.get(callId);
      if (!c || c.status !== 'ANSWERED') {
        clearInterval(interval);
        return;
      }
      c.duration += 5;
      calls.set(callId, c);
    }, 5000);
    setTimeout(() => simulateOutboundProgress(callId), 20000);
  } else if (call.simulationStep === 2) {
    call.status = 'ENDED';
    call.simulationStep = 3;
    calls.set(callId, call);
    reportStatus(callId, call.status, `Appel terminé - durée: ${call.duration}s`);
  }
}

// ====================== REPORT STATUS (CORRECTION ICI) ======================
async function reportStatus(callId: string, status: string, message: string) {
  const data = ethers.toUtf8Bytes(JSON.stringify({ message, duration: calls.get(callId)?.duration || 0 }));

  try {
    // Debug complet
    const balance = await provider.getBalance(wallet.address);
    const nonceLatest = await provider.getTransactionCount(wallet.address, "latest");
    const noncePending = await provider.getTransactionCount(wallet.address, "pending");
    const nonce = noncePending > nonceLatest ? noncePending : nonceLatest;

    console.log(`[REPORT] Wallet: ${wallet.address}`);
    console.log(`[REPORT] Balance: ${ethers.formatEther(balance)}`);
    console.log(`[REPORT] Nonce → latest: ${nonceLatest} | pending: ${noncePending} → utilisé: ${nonce}`);

    if (balance === 0n) throw new Error("Balance insuffisante");

    const tx = await contract.reportCallResult(callId, status, data, {
      nonce,
      gasLimit: 500_000,  // Très large pour éviter gas out
      maxPriorityFeePerGas: ethers.parseUnits("5", "gwei"),
      maxFeePerGas: ethers.parseUnits("100", "gwei")
    });

    console.log(`[REPORT] Tx hash: ${tx.hash}`);

    const receipt = await tx.wait(1);
    console.log(`[REPORT] Confirmé → ${status} | block=${receipt.blockNumber}`);

  } catch (err: any) {
    console.error("[REPORT ERROR]", err.shortMessage || err.message || err);
    if (err.message.includes("@TODO")) {
      console.error("Hash mismatch → probable bug RPC. Nonce latest:", await provider.getTransactionCount(wallet.address, "latest"));
    }
  }
}

// ====================== ROUTE PRINCIPALE ======================
export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-api-key");
    if (apiKey !== ORACLE_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { callId, opcode, msgType, callerHash, calledHash, timestamp, extra, payload } = body;

    console.log(`[SS7 ORACLE] Reçu → opcode=${opcode} | callId=${callId}`);

    let status: CallState['status'] = 'FAILED';
    let result: any = { message: "No action" };

    if (opcode === 0xec || opcode === 236) {
      const call: CallState = {
        callId,
        opcode,
        msgType,
        callerHash: callerHash.toString(),
        calledHash: calledHash.toString(),
        timestamp,
        extra,
        payloadHex: payload ? Buffer.from(payload).toString('hex') : undefined,
        status: 'QUEUED',
        createdAt: Date.now(),
        duration: 0,
        simulationStep: 0
      };

      calls.set(callId, call);
      status = 'QUEUED';
      result = { message: "Simulation outbound lancée" };

      setTimeout(() => simulateOutboundProgress(callId), 1000);

    } else if (opcode === 0xef || opcode === 239) {
      const call = calls.get(callId);
      if (!call) throw new Error("Call not found");

      status = call.status;
      result = { ...call, currentDuration: Math.floor((Date.now() - call.createdAt) / 1000) };
    } else {
      throw new Error(`Opcode non supporté: ${opcode}`);
    }

    // Callback immédiat
    await reportStatus(callId, status, JSON.stringify(result));

    return NextResponse.json({ success: true, callId, status, result });

  } catch (error: any) {
    console.error("[SS7 ORACLE ERROR]", error.shortMessage || error.message || error);

    try {
      await reportStatus(body?.callId || "unknown", "FAILED", error.message || "Unknown error");
    } catch {}

    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}