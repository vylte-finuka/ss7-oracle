import { NextRequest, NextResponse } from "next/server";

const XIVO_HOST = process.env.XIVO_HOST!;
const XIVO_ARI_USER = process.env.XIVO_ARI_USER!;
const XIVO_ARI_PASSWORD = process.env.XIVO_ARI_PASSWORD!;

type CallState = {
  callId: string;
  from: string;
  to: string;
  status: string;
  msgType: string;
  timestamp: number;
  ariChannelId?: string;
  extra?: string;
  payloadHex?: string;
};

const calls = new Map<string, CallState>();

async function xivoARI(path: string, method = "GET", body?: any) {
  const url = `${XIVO_HOST}/ari${path}`;
  const auth = Buffer.from(`${XIVO_ARI_USER}:${XIVO_ARI_PASSWORD}`).toString("base64");

  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { raw: text }; }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      callId,
      opcode,
      msgType,
      callerHash,
      calledHash,
      timestamp,
      extra,
      payloadHex,
    } = body;

    console.log("[SS7→XiVO] Reçu :", body);

    let status = "UNKNOWN";
    let result: any = {};

    switch (opcode) {

      // -----------------------------
      // CALL_SETUP → Originate ARI
      // -----------------------------
      case "CALL_SETUP": {
        const originate = await xivoARI(
          `/channels?endpoint=PJSIP/${calledHash}&extension=${calledHash}&context=default&priority=1`,
          "POST"
        );

        const call: CallState = {
          callId,
          from: callerHash,
          to: calledHash,
          status: "RINGING",
          msgType,
          timestamp,
          ariChannelId: originate?.id,
          extra,
          payloadHex,
        };

        calls.set(callId, call);
        status = "RINGING";
        result = call;
        break;
      }

      // -----------------------------
      // CALL_END → Hangup ARI
      // -----------------------------
      case "CALL_END": {
        const call = calls.get(callId);
        if (!call) throw new Error("Call not found");

        if (call.ariChannelId) {
          await xivoARI(`/channels/${call.ariChannelId}`, "DELETE");
        }

        call.status = "ENDED";
        status = "ENDED";
        result = call;
        break;
      }

      // -----------------------------
      // CALL_QUERY → XiVO channel state
      // -----------------------------
      case "CALL_QUERY": {
        const call = calls.get(callId);
        if (!call) throw new Error("Call not found");

        if (call.ariChannelId) {
          const info = await xivoARI(`/channels/${call.ariChannelId}`);
          call.status = info?.state || call.status;
        }

        status = call.status;
        result = call;
        break;
      }

      default:
        status = "UNSUPPORTED_OPCODE";
        result = { message: "Opcode non géré", opcode };
    }

    return NextResponse.json({
      status,
      gateway: "XiVO-SS7",
      callId,
      opcode,
      msgType,
      timestamp,
      extra,
      result,
    });

  } catch (error: any) {
    console.error("[SS7→XiVO ERROR]", error);
    return NextResponse.json(
      { status: "ERROR", error: error.message },
      { status: 500 }
    );
  }
}