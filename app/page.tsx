'use client';

import { HexMap } from '@/components/HexMap';
import Lobby from '@/components/Lobby';
import { useState } from 'react';

export default function Home() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);

  // Called when user clicks "Join" in the lobby
  const handleJoin = (scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    // Store for optional resume (but we won't auto‑load)
    localStorage.setItem('currentScenarioId', scenarioId);
  };

  // If no scenario is selected, show the Lobby
  if (!selectedScenarioId) {
    return <Lobby onJoinScenario={handleJoin} />;
  }

  // Otherwise show the map for that scenario
  return (
    <main className="w-screen h-screen overflow-hidden">
      <HexMap scenarioId={selectedScenarioId} />
    </main>
  );
}