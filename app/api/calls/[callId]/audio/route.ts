import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { callId: string } }
) {
  try {
    const { audioData, sequenceNumber, timestamp } = await request.json();
    const callId = params.callId;

    console.log(`📞 Audio reçu pour l'appel: ${callId}`);
    console.log(`📊 Séquence: ${sequenceNumber}`);
    console.log(`📏 Taille: ${audioData.length} caractères base64`);
    console.log(`⏰ Timestamp: ${timestamp}`);

    // ✅ ECHO : Retourner le même audio pour entendre votre voix
    // (Ou vous pouvez générer un ton différent ici)
    const echoAudioData = audioData;

    return NextResponse.json({
      data: {
        success: true,
        callId,
        sequenceNumber,
        audioData: echoAudioData, // 🔊 RETOURNER L'AUDIO AU CLIENT
        blockchain: {
          txHashAudio: `0x${Math.random().toString(16).slice(2)}`
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur audio:', error);
    return NextResponse.json(
      { error: 'Erreur traitement audio' },
      { status: 500 }
    );
  }
}
