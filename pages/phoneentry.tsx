'use client';

import { useState } from 'react';
import { useRouter } from 'next/router';

export default function PhoneEntry() {
  const router = useRouter();
  const [callerNumber, setCallerNumber] = useState('33612345678');
  const [calledNumber, setCalledNumber] = useState('33987654321');

  const startOutboundCall = () => {
    if (!callerNumber || !calledNumber) {
      alert("Veuillez remplir les deux numéros");
      return;
    }
    router.push(
      `/phone?caller=${encodeURIComponent(callerNumber)}&called=${encodeURIComponent(calledNumber)}&type=outbound`
    );
  };

  const simulateInboundCall = () => {
    if (!callerNumber) {
      alert("Veuillez entrer votre numéro");
      return;
    }
    router.push(
      `/phone?caller=${encodeURIComponent('33687654321')}&called=${encodeURIComponent(callerNumber)}&type=inbound`
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6 flex items-center justify-center">
      <div className="max-w-md w-full">
        <div className="text-center mb-12">
          <h1 className="text-6xl font-bold text-white mb-3">☎️ PSTN Dialer</h1>
          <p className="text-gray-300 text-xl">Oracle SS7 - Téléphonie en Temps Réel</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-10 space-y-8">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Votre Numéro</label>
            <input
              type="tel"
              value={callerNumber}
              onChange={(e) => setCallerNumber(e.target.value)}
              className="w-full px-5 py-4 border-2 border-gray-300 rounded-2xl font-mono text-lg focus:border-blue-500 focus:ring-2"
              placeholder="33612345678"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Numéro à appeler</label>
            <input
              type="tel"
              value={calledNumber}
              onChange={(e) => setCalledNumber(e.target.value)}
              className="w-full px-5 py-4 border-2 border-gray-300 rounded-2xl font-mono text-lg focus:border-green-500 focus:ring-2"
              placeholder="33987654321"
            />
          </div>

          <div className="pt-6 space-y-4">
            <button
              onClick={startOutboundCall}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-5 rounded-2xl text-xl transition-all active:scale-[0.97]"
            >
              📤 Lancer un Appel Sortant
            </button>

            <button
              onClick={simulateInboundCall}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold py-5 rounded-2xl text-xl transition-all active:scale-[0.97]"
            >
              📥 Simuler un Appel Entrant
            </button>
          </div>
        </div>

        <p className="text-center mt-10 text-gray-400 text-sm">
          Powered by Oracle SS7 • 2026
        </p>
      </div>
    </div>
  );
}