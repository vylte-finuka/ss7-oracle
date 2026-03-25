// app/api/telnyx-webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const TELNYX_API_KEY = process.env.TELNYX_API_KEY!;
const ORACLE_URL = process.env.ORACLE_URL!;

async function telnyxCommand(callControlId: string, action: string, body = {}) {
  return fetch(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
}

async function notifyOracle(data: unknown) {
  return fetch(ORACLE_URL, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ORACLE_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const data = body.data;

  if (data?.record_type !== "event") {
    return NextResponse.json({ ok: true });
  }

  const event = data.event_type;
  const payload = data.payload;
  const callControlId = payload.call_control_id;
  const callId = ethers.id(callControlId); // bytes32

  switch (event) {
    case "call.initiated":
      // Répondre à l'appel
      await telnyxCommand(callControlId, "answer");
      // Enregistrer on-chain
      await notifyOracle({
        callId,
        status: "INITIATED",
        opcode: 1, msgType: 1,
        callerHash: 0, calledHash: 0,
        timestamp: Math.floor(Date.now() / 1000),
        extra: 0,
      });
      break;

    case "call.answered":
      await notifyOracle({ callId, status: "ANSWERED" });
      break;

    case "call.hangup":
      await notifyOracle({ callId, status: "HANGUP" });
      break;
  }

  return NextResponse.json({ ok: true });
}