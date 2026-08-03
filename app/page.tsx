// app/page.tsx
'use client';

import { ScenarioMap } from '@/components/ScenarioMap/ScenarioMap';
import Lobby from '@/components/Lobby';
import { useState } from 'react';

interface Session {
  scenarioId: string;
  replay: boolean;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);

  const handleJoin = (scenarioId: string) => {
    setSession({ scenarioId, replay: false });
    localStorage.setItem('currentScenarioId', scenarioId);
  };

  const handleNewScenario = (scenarioId: string) => {
    setSession({ scenarioId, replay: false });
    localStorage.setItem('currentScenarioId', scenarioId);
  };

  const handleReplay = (scenarioId: string) => {
    setSession({ scenarioId, replay: true });
  };

  if (!session) {
    return (
      <Lobby
        onJoinScenario={handleJoin}
        onNewScenario={handleNewScenario}
        onReplayScenario={handleReplay}
      />
    );
  }

  return (
    <main className="w-screen h-screen overflow-hidden">
      <ScenarioMap scenarioId={session.scenarioId} replayMode={session.replay} />
    </main>
  );
}