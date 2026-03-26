// app/api/twilio-voice-status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";

const ORACLE_URL = process.env.ORACLE_URL!;

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

export default async function POST(req: NextRequest) {
  const formData = await req.formData();
  const params = Object.fromEntries(formData.entries());

  const callSid = params.CallSid as string;
  const callStatus = (params.CallStatus as string)?.toLowerCase() || "";
  const callId = ethers.id(callSid);

  let status = "UNKNOWN";
  let opcode = 1;

  switch (callStatus) {
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
  }

  if (status !== "UNKNOWN") {
    await notifyOracle({
      callId,
      status,
      opcode,
      msgType: 1,
      callerHash: 0,
      calledHash: 0,
      timestamp: Math.floor(Date.now() / 1000),
      extra: 0,
      from: params.From,
      to: params.To,
      duration: params.CallDuration ? Number(params.CallDuration) : 0,
    });
  }

  return NextResponse.json({ ok: true });
}