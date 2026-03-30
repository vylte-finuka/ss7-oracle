/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ callId: string }> }
) {
  try {
    // Next.js 15+ : params est maintenant un Promise
    const { callId } = await context.params;

    const body = await request.json();

    console.log(`📥 Audio reçu pour callId: ${callId}`, {
      size: body.audioData ? Math.round(body.audioData.length / 1.33) + ' chars' : 'no audio',
    });

    // Ici tu peux traiter l'audio si tu veux (enregistrer, diffuser, etc.)
    // Pour l'instant on renvoie simplement un succès

    return NextResponse.json({
      success: true,
      message: 'Audio reçu avec succès',
      callId,
      receivedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('❌ Erreur dans route audio:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}