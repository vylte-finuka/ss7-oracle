// app/api/telnyx-dial/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const TELNYX_API_KEY = process.env.TELNYX_API_KEY!;
const ORACLE_URL = process.env.ORACLE_URL!;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (apiKey !== process.env.ORACLE_API_KEY!) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { to, from, connection_id } = body;

  // 1. Passer l'appel via Telnyx
  const res = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connection_id,
      to,
      from,
    }),
  });

  const data = await res.json();
  const callControlId = data.data?.call_control_id;
  const callId = ethers.id(callControlId);

  // 2. Enregistrer on-chain via votre oracle
  await fetch(ORACLE_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ORACLE_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      callId,
      status: "OUTBOUND_INITIATED",
      opcode: 2, msgType: 1,
      callerHash: 0, calledHash: 0,
      timestamp: Math.floor(Date.now() / 1000),
      extra: 0,
    }),
  });

  return NextResponse.json({
    success: true,
    callControlId,
    callId,
  });
}