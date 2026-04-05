export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

import type { NextApiRequest, NextApiResponse } from "next";

let activeCall: any = null; // Partagé avec ss7-oracle.ts (en prod utilise Redis)

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const side = req.query.side as string;

  if (!activeCall) return res.status(200).send("No active call");

  const audioBase64 = side === "caller" 
    ? activeCall.lastAudioFromCaller 
    : activeCall.lastAudioFromCalled;

  if (!audioBase64) return res.status(200).send("No audio yet");

  const binary = Buffer.from(audioBase64, 'base64');
  const wavBuffer = createWAV(binary);

  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Cache-Control", "no-cache");
  return res.status(200).send(wavBuffer);
}

function createWAV(rawAudioData: Buffer): Buffer {
  const buffer = Buffer.alloc(44 + rawAudioData.length);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + rawAudioData.length, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, rawAudioData.length, true);

  rawAudioData.copy(buffer, 44);
  return buffer;
}
