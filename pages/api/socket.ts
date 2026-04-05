// pages/api/socket.ts
import { Server } from "socket.io";
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: false }
};

let io: Server | undefined;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!res.socket.server.io) {
    console.log("🔌 Initialisation Socket.IO...");

    io = new Server(res.socket.server, {
      path: "/api/socket",
      cors: { origin: "*" },
      transports: ["websocket"]
    });

    res.socket.server.io = io;

    io.on("connection", (socket) => {
      console.log("🟢 Client connecté :", socket.id);

      // Enregistrer le numéro
      socket.on("register", (number: string) => {
        socket.data.number = number;
        socket.join(`user-${number}`);
        console.log(`📌 Numéro enregistré : ${number}`);
      });

      // Appel sortant
      socket.on("call", ({ caller, called, callId }) => {
        console.log(`📞 Appel de ${caller} vers ${called}`);
        io?.to(`user-${called}`).emit("incoming-call", { caller, callId });
      });

      // Réponse
      socket.on("answer", ({ callId, answerer }) => {
        io?.emit("call-answered", { callId, answerer });
      });

      // Raccrocher
      socket.on("hangup", ({ callId }) => {
        io?.emit("call-hungup", { callId });
      });

      // Signaling WebRTC
      socket.on("webrtc-signal", ({ callId, signal, to }) => {
        io?.to(`user-${to}`).emit("webrtc-signal", { callId, signal });
      });

      socket.on("disconnect", () => {
        console.log("🔴 Client déconnecté :", socket.id);
      });
    });
  }

  res.end();
}
