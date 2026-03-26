// app/api/twilio-dial/route.ts
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { ethers } from "ethers";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

const ORACLE_URL = process.env.ORACLE_URL!;

export default async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (apiKey !== process.env.ORACLE_API_KEY!) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { to, from } = body;

  const fromNumber = from || process.env.TWILIO_PHONE_NUMBER;
  if (!fromNumber) {
    return NextResponse.json({ error: "Missing from number" }, { status: 400 });
  }

  const call = await client.calls.create({
    from: fromNumber,
    to: to,
    twiml: `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say voice="alice">Connecting your call...</Say>
      </Response>`,
    statusCallback: `${process.env.BASE_URL}/api/twilio-voice-status`,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  const callSid = call.sid;
  const callId = ethers.id(callSid);

  await fetch(ORACLE_URL, {
    method: "POST",
    headers: { "x-api-key": process.env.ORACLE_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      callId,
      status: "OUTBOUND_INITIATED",
      opcode: 2,
      msgType: 1,
      callerHash: 0,
      calledHash: 0,
      timestamp: Math.floor(Date.now() / 1000),
      extra: 0,
    }),
  });

  return NextResponse.json({
    success: true,
    callSid,
    callId,
  });
}