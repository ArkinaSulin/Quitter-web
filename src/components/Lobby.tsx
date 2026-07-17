// src/components/Lobby.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useScenarios } from '@/hooks/useScenarios';
import { signInWithGoogle, signOut } from '@/lib/supabaseClient';
import Toast from '@/components/Toast';

interface LobbyProps {
  onJoinScenario: (scenarioId: string) => void;
  onNewScenario: (scenarioId: string) => void;
}

export default function Lobby({ onJoinScenario, onNewScenario }: LobbyProps) {
  const router = useRouter();
  const {
    scenarios,
    loading,
    error,
    currentUser,
    createScenario,
    deleteScenario,
    joinScenario,
    subscribeToPresence,
    unsubscribeFromPresence,
  } = useScenarios();

  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState<{ scenarioId: string; password: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeScenarioId) return;
    const channel = subscribeToPresence(activeScenarioId, () => {
      setToast('The Game Master has left the session. Returning to Lobby...');
      setTimeout(() => {
        setActiveScenarioId(null);
        localStorage.removeItem('currentScenarioId');
        window.location.reload();
      }, 3000);
    });
    return () => {
      if (channel) unsubscribeFromPresence(activeScenarioId);
    };
  }, [activeScenarioId, subscribeToPresence, unsubscribeFromPresence]);

  const handleSignIn = async () => {
    try {
      setSignInError(null);
      await signInWithGoogle();
    } catch (err: any) {
      setSignInError(err.message || 'Google sign‑in failed.');
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const created = await createScenario(newName.trim(), newPassword.trim() || undefined);
      setShowCreateModal(false);
      setNewName('');
      setNewPassword('');
      if (created) {
        onNewScenario(created.id);
        setActiveScenarioId(created.id);
      }
    } catch (err: any) {
      alert('Failed to create: ' + err.message);
    }
  };

  const handleJoinClick = async (scenarioId: string, hasPassword: boolean) => {
    if (hasPassword) {
      setShowJoinModal({ scenarioId, password: '' });
    } else {
      try {
        await performJoin(scenarioId, '');
      } catch (err: any) {
        setJoinError(err.message);
      }
    }
  };

  const performJoin = async (scenarioId: string, password: string) => {
    try {
      setJoinError(null);
      const scenario = await joinScenario(scenarioId, password || undefined);
      setShowJoinModal(null);
      setJoinPassword('');
      onJoinScenario(scenarioId);
      setActiveScenarioId(scenarioId);
    } catch (err: any) {
      setJoinError(err.message);
      if (err.message.includes('Game Master')) {
        setToast(err.message);
      }
    }
  };

  const handleDelete = async () => {
    if (!selectedScenarioId) return;
    const scenario = scenarios.find(s => s.id === selectedScenarioId);
    if (!scenario) return;
    if (!confirm(`Delete scenario "${scenario.name}"?`)) return;
    try {
      await deleteScenario(selectedScenarioId);
      setSelectedScenarioId(null);
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleDateString();
    } catch {
      return 'N/A';
    }
  };

  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);
  const isCreator = selectedScenario && currentUser && selectedScenario.creatorId === currentUser.id;

  const renderHeader = () => (
    <div className="flex flex-col items-center px-6 py-3 border-b border-gray-700 bg-[#0d0d1a]">
      <h1 className="text-3xl font-bold text-white tracking-wide text-center w-full">
        Welcome to Quick Terrestrial Tactical Encounter Rules (QuiTTER)
      </h1>
      <div className="flex items-center justify-center gap-3 mt-1">
        {currentUser ? (
          <>
            <span className="text-sm text-gray-300">
              {currentUser.user_metadata?.full_name || currentUser.email}
            </span>
            <button
              onClick={signOut}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Logout
            </button>
          </>
        ) : (
          <>
            {signInError && (
              <span className="text-sm text-red-400 bg-red-900/30 px-2 py-1 rounded mr-2">
                {signInError}
              </span>
            )}
            <button
              onClick={handleSignIn}
              className="px-4 py-1 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
            >
              Sign in with Google
            </button>
          </>
        )}
      </div>
    </div>
  );

  const renderLeftPanel = () => {
    const isJoinEnabled = !!selectedScenarioId;
    const isDeleteEnabled = isJoinEnabled && isCreator;

    return (
      <div className="w-64 p-4 border-r border-gray-700 flex flex-col justify-between h-full bg-[#0d0d1a]">
        <div className="space-y-3">
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!currentUser}
            className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            New Scenario
          </button>
          <button
            onClick={() => {
              if (selectedScenarioId) {
                const scenario = scenarios.find(s => s.id === selectedScenarioId);
                if (scenario) {
                  handleJoinClick(scenario.id, !!scenario.passwordHash);
                }
              }
            }}
            disabled={!isJoinEnabled}
            className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Join Scenario
          </button>
          <button
            onClick={handleDelete}
            disabled={!isDeleteEnabled}
            className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete Scenario
          </button>
          {/* Upload Screenshot button removed */}
        </div>
        <div className="space-y-3">
          <button
            onClick={() => router.push('/unit-editor')}
            className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
          >
            Unit Editor
          </button>
          <button
            onClick={() => alert('Map Editor – not yet implemented')}
            disabled={!currentUser}
            className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Map Editor
          </button>
        </div>
      </div>
    );
  };

  const renderCards = () => {
    if (loading) return <p className="text-white">Loading scenarios...</p>;
    if (error) return <p className="text-red-500">Error: {error}</p>;
    if (scenarios.length === 0) return <p className="text-gray-400">No scenarios yet. Create one!</p>;

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {scenarios.map((scenario) => {
          const isSelected = scenario.id === selectedScenarioId;
          return (
            <div
              key={scenario.id}
              onClick={() => setSelectedScenarioId(scenario.id)}
              className={`bg-gray-800 rounded-lg overflow-hidden shadow-lg border-2 transition-all cursor-pointer w-full max-w-sm mx-auto ${
                isSelected
                  ? 'border-yellow-400 shadow-yellow-500/30 shadow-lg'
                  : 'border-gray-700 hover:border-gray-500'
              }`}
            >
              <div className="relative w-full aspect-video bg-gray-700 flex items-center justify-center">
                {scenario.screenshotUrl ? (
                  <img
                    src={scenario.screenshotUrl}
                    alt={`Screenshot of ${scenario.name}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-gray-500">[Screenshot]</span>
                )}
              </div>
              <div className="p-3 text-white">
                <div className="flex justify-between items-start">
                  <div className="font-bold text-lg truncate">{scenario.name}</div>
                  <div className="text-xs text-gray-400 whitespace-nowrap ml-2">Created: {formatDate(scenario.createdAt)}</div>
                </div>
                <div className="flex justify-between items-start mt-1">
                  <div className="text-sm text-gray-300 truncate">By {scenario.creatorName || 'Unknown'}</div>
                  <div className="text-xs text-gray-400 whitespace-nowrap ml-2">Modified: {formatDate(scenario.updatedAt)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-[#0d0d1a] text-white">
      {toast && <Toast message={toast} duration={5000} onClose={() => setToast(null)} />}
      {renderHeader()}

      <div className="flex flex-1 overflow-hidden">
        {renderLeftPanel()}

        <div className="flex-1 p-4 overflow-y-auto bg-[#0d0d1a]">
          {renderCards()}
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">Create Scenario</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-300">Scenario Name</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300">Password (optional)</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                  placeholder="Leave blank for no password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={handleCreate}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showJoinModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">Enter Password</h2>
            <div>
              <label className="block text-sm text-gray-300">Password</label>
              <input
                type="password"
                className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && performJoin(showJoinModal.scenarioId, joinPassword)}
              />
            </div>
            {joinError && <p className="text-red-400 text-sm mt-1">{joinError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => {
                  setShowJoinModal(null);
                  setJoinPassword('');
                  setJoinError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={() => performJoin(showJoinModal.scenarioId, joinPassword)}
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}