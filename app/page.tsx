// app/page.tsx
'use client';

import { ScenarioMap } from '@/components/ScenarioMap/ScenarioMap';
import Lobby from '@/components/Lobby';
import { useState } from 'react';

export default function Home() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);

  const handleJoin = (scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    localStorage.setItem('currentScenarioId', scenarioId);
  };

  const handleNewScenario = (scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    localStorage.setItem('currentScenarioId', scenarioId);
  };

  if (!selectedScenarioId) {
    return (
      <Lobby
        onJoinScenario={handleJoin}
        onNewScenario={handleNewScenario}
      />
    );
  }

  return (
    <main className="w-screen h-screen overflow-hidden">
      <ScenarioMap scenarioId={selectedScenarioId} />
    </main>
  );
}