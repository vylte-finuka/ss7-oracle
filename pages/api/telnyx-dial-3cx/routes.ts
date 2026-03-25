// app/api/telnyx-dial-3cx/route.ts
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
  const { extension, from, connection_id, sip_uri } = body;

  // Appeler une extension 3CX via SIP URI
  const res = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connection_id,
      to: sip_uri,  // ex: "sip:100@votre-3cx-ip"
      from,
      to_display: extension,
    }),
  });

  const data = await res.json();
  const callControlId = data.data?.call_control_id;
  const callId = ethers.id(callControlId);

  // Enregistrer on-chain
  await fetch(ORACLE_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ORACLE_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      callId,
      status: "3CX_CALL_INITIATED",
      opcode: 3, msgType: 1,
      callerHash: 0, calledHash: 0,
      timestamp: Math.floor(Date.now() / 1000),
      extra: 0,
    }),
  });

  return NextResponse.json({
    success: true,
    callControlId,
    callId,
    destination: sip_uri,
  });
}