'use client';

import { HexMap } from '@/components/HexMap';
import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    // This will run on the client only
    const worker = new Worker(new URL('@/workers/gameWorker.ts', import.meta.url));
    worker.postMessage({ type: 'GET_STATE', payload: {} });
    worker.onmessage = (e) => {
      console.log('[Main] Worker replied:', e.data);
    };
    return () => worker.terminate();
  }, []);

  return (
    <main className="w-screen h-screen overflow-hidden">
      <HexMap />
    </main>
  );
}