import { Server } from 'socket.io';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Server as HTTPServer } from 'http';
import type { Socket as NetSocket } from 'net';

// === Extensions de types pour éviter les erreurs TS ===
interface SocketServer extends HTTPServer {
  io?: Server | undefined;
}

interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO;
}

let io: Server | null = null;

export default function handler(
  req: NextApiRequest,
  res: NextApiResponseWithSocket
) {
  // Si Socket.io est déjà initialisé, on ne fait rien
  if (res.socket?.server?.io) {
    console.log('✅ Socket.io déjà initialisé');
    res.end();
    return;
  }

  console.log('🚀 Initialisation de Socket.io...');

  io = new Server(res.socket.server, {
    path: '/api/socket',
    addTrailingSlash: false,
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // On attache l'instance au serveur HTTP de Next.js
  res.socket.server.io = io;

  io.on('connection', (socket) => {
    console.log(`👤 Utilisateur connecté: ${socket.id}`);

    // Enregistrer le numéro de téléphone
    socket.on('register', (number: string) => {
      socket.data.number = number;
      socket.join(`user-${number}`);
      console.log(`📱 Numéro enregistré: ${number}`);
    });

    // Quelqu'un lance un appel
    socket.on('call', ({ caller, called, callId }: { caller: string; called: string; callId: string }) => {
      console.log(`📞 Appel de ${caller} vers ${called} (ID: ${callId})`);
      // Notifier uniquement le destinataire
      io?.to(`user-${called}`).emit('incoming-call', { caller, callId });
    });

    // Le destinataire décroche
    socket.on('answer', ({ callId, answerer }: { callId: string; answerer: string }) => {
      console.log(`✅ Appel ${callId} décroché par ${answerer}`);
      io?.emit('call-answered', { callId });
    });

    // Raccrocher
    socket.on('hangup', ({ callId }: { callId: string }) => {
      console.log(`📴 Appel ${callId} terminé`);
      io?.emit('call-hungup', { callId });
    });

    socket.on('disconnect', () => {
      console.log(`⛔ Utilisateur déconnecté: ${socket.id}`);
    });
  });

  res.end();
}