import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(`
    <Response>
      <Start>
        <Stream url="${process.env.process.env.BASE_URL}/api/ss7-oracle" />
      </Start>
      <Say>Vous êtes connecté. Cet appel est enregistré.</Say>
      <!-- Ou <Pause length="60"/> pour laisser la ligne ouverte -->
    </Response>
  `);
}
