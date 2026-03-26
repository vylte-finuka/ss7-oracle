// app/api/twilio-dial-3cx/route.ts
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { ethers } from "ethers";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

const ORACLE_URL = process.env.ORACLE_URL!;

export async function POST(req: NextRequest) {
  try {
    // Twilio envoie les données en form-urlencoded pour les webhooks
    const formData = await req.formData();
    const params = Object.fromEntries(formData.entries());

    const callSid = params.CallSid as string;
    const from = params.From as string;
    const to = params.To as string;           // Numéro appelé (DID)

    if (!callSid) {
      return NextResponse.json({ error: "Missing CallSid" }, { status: 400 });
    }

    const callId = ethers.id(callSid);

    console.log("📥 [twilio-dial-3cx] Inbound call received");
    console.log("CallSid:", callSid);
    console.log("From:", from);
    console.log("To (DID):", to);

    // === CONFIGURATION SIP VERS 3CX ===
    // Change cette ligne selon ton 3CX
    const sipUri = `sip:100@3cx.monentreprise.com:5060`;   
    // Exemples :
    // const sipUri = `sip:101@pbx.monentreprise.com:5060`;
    // const sipUri = `sip:${to.replace('+', '')}@3cx.monentreprise.com:5060`; // routage dynamique

    // Notification initiale à l'oracle
    await fetch(ORACLE_URL, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ORACLE_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        callId,
        status: "3CX_INBOUND_INITIATED",
        opcode: 4,
        msgType: 1,
        callerHash: 0,
        calledHash: 0,
        timestamp: Math.floor(Date.now() / 1000),
        extra: 0,
        from: from,
        to: to,
        sipUri: sipUri,
        direction: "inbound-to-3cx"
      }),
    });

    // TwiML : Redirige l'appel vers l'extension 3CX via SIP
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial>
        <Sip>${sipUri}</Sip>
    </Dial>
</Response>`;

    return new NextResponse(twiml, {
      headers: { "Content-Type": "text/xml" },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("❌ Erreur dans twilio-dial-3cx (webhook primaire):", error);

    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Sorry, we are unable to connect your call at the moment.</Say>
    <Hangup/>
</Response>`;

    return new NextResponse(fallbackTwiml, {
      headers: { "Content-Type": "text/xml" },
    });
  }
}