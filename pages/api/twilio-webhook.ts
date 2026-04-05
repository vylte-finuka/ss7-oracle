export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body || {};
  console.log("📨 Twilio Webhook :", body);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Appel connecté via Oracle.</Say>
  <Play>https://${req.headers.host}/api/serve-audio?side=caller</Play>
  <Record maxLength="120" action="/api/ss7-oracle" trim="trim-silence" />
</Response>`;

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml);
}
