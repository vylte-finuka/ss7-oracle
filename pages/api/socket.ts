// pages/api/socket.ts
import { Server } from 'socket.io';
import type { NextApiRequest, NextApiResponse } from 'next';

let io: Server | null = null;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (res.socket.server.io) {
    console.log('Socket.io déjà initialisé');
    res.end();
    return;
  }

  console.log('Initialisation Socket.io...');
  io = new Server(res.socket.server, {
    path: '/api/socket',
    addTrailingSlash: false,
    cors: { origin: '*' }
  });

  res.socket.server.io = io;

  io.on('connection', (socket) => {
    console.log('Utilisateur connecté:', socket.id);

    // Enregistrer le numéro de l'utilisateur
    socket.on('register', (number: string) => {
      socket.data.number = number;
      socket.join(`user-${number}`);
      console.log(`Numéro enregistré: ${number}`);
    });

    // Quand quelqu'un appelle
    socket.on('call', ({ caller, called, callId }) => {
      console.log(`Appel de ${caller} vers ${called}`);
      // Notifier le destinataire
      io?.to(`user-${called}`).emit('incoming-call', { caller, callId });
    });

    // Quand le destinataire décroche
    socket.on('answer', ({ callId, answerer }) => {
      io?.emit('call-answered', { callId, answerer });
    });

    // Raccrocher
    socket.on('hangup', ({ callId }) => {
      io?.emit('call-hungup', { callId });
    });

    socket.on('disconnect', () => {
      console.log('Utilisateur déconnecté:', socket.id);
    });
  });

  res.end();
}
