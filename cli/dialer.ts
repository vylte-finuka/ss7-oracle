// ⭐ AJOUTER EN PREMIER
import "dotenv/config";
import WebSocket from "ws";
import PSTNDialer from "../lib/pstn-dialer";

const dialer = new PSTNDialer({
  baseUrl: "http://localhost:3000",
  apiKey: process.env.ORACLE_API_KEY || "test-key-default"
});

// ===== ECOUTE RETOUR ORACLE (AUDIO → PSTN) =====
function listenOracleAudio(callId: string) {
  const ws = new WebSocket(`ws://localhost:4001/oracle/audio-stream/${callId}`);

  ws.on("open", () => {
    console.log(`🔊 Flux Oracle connecté pour callId=${callId}`);
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const audioBase64 = msg.audio;

      if (!audioBase64) return;

      console.log("▶️ Oracle → PSTN (lecture audio)");
      await dialer.sendAudioData(callId, audioBase64, 2);

    } catch (e: any) {
      console.error("❌ Erreur audio Oracle:", e.message);
    }
  });

  ws.on("close", () => {
    console.log(`⛔ Flux Oracle fermé pour callId=${callId}`);
  });

  ws.on("error", (err) => {
    console.error("❌ Erreur WebSocket Oracle:", err);
  });
}

// ===== APPEL VOCAL LIVE =====
async function testLiveCall() {
  console.log("\n☎️ === APPEL VOCAL LIVE ===\n");

  try {
    // 1️⃣ Initier l'appel
    console.log("📞 Initiation appel...");
    const initiate = await dialer.initiateCall(
      "33612345678",
      "33987654321"
    );

    const callId = initiate.data.callId;
    console.log(`✅ Appel initié: ${callId}\n`);

    // 🔊 Démarrer l'écoute du retour Oracle
    listenOracleAudio(callId);

    // 2️⃣ Répondre après 2 secondes
    await new Promise(r => setTimeout(r, 2000));

    console.log("📞 Réponse à l'appel...");
    await dialer.answerCall(callId, {
      callerNumber: "33612345678",
      calledNumber: "33987654321"
    });

    console.log("✅ Appel en cours — flux audio live actif\n");
    console.log("🎧 Parlez dans votre téléphone — Oracle répondra en live.\n");

    // Laisser l'appel tourner 60 secondes
    await new Promise(r => setTimeout(r, 30000));

    // 3️⃣ Raccrocher
    console.log("📴 Raccroché...");
    await dialer.hangupCall(callId, 7, {
      callerNumber: "33612345678",
      calledNumber: "33987654321"
    });

    console.log("✅ Appel terminé\n");

  } catch (error: any) {
    console.error("❌ Erreur:", error.message);
  }
}

// ===== MENU =====
async function main() {
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║  PSTN DIALER - Oracle SS7 Client      ║");
  console.log("╚════════════════════════════════════════╝");

  await testLiveCall();
}

main().catch(console.error);
