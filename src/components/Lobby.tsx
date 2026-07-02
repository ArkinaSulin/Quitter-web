// src/components/Lobby.tsx
'use client';

import { useState } from 'react';
import { useScenarios } from '@/hooks/useScenarios';
import { signInWithGoogle, signOut } from '@/lib/supabaseClient';

interface LobbyProps {
  onJoinScenario: (scenarioId: string) => void;
}

export default function Lobby({ onJoinScenario }: LobbyProps) {
  const { scenarios, loading, error, currentUser, createScenario, deleteScenario, joinScenario } = useScenarios();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState<{ [key: string]: string }>({});
  const [joinError, setJoinError] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

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
      await createScenario(newName.trim(), newPassword.trim() || undefined);
      setShowCreateModal(false);
      setNewName('');
      setNewPassword('');
    } catch (err: any) {
      alert('Failed to create: ' + err.message);
    }
  };

  const handleJoin = async (scenarioId: string) => {
    try {
      const password = passwordInput[scenarioId] || '';
      await joinScenario(scenarioId, password || undefined);
      onJoinScenario(scenarioId);
    } catch (err: any) {
      setJoinError(err.message);
    }
  };

  const handleDelete = async (scenarioId: string) => {
    if (!confirm('Delete this scenario?')) return;
    try {
      await deleteScenario(scenarioId);
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Header with centered title */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="w-48" /> {/* Spacer for centering */}
        <h1 className="text-2xl font-bold text-center">
          welcome to Quick Terrestrial Tactical Encounter Rules (QuiTTER)
        </h1>
        <div className="w-48 flex justify-end">
          {currentUser ? (
            <div className="flex items-center gap-4">
              <span>{currentUser.user_metadata?.full_name || currentUser.email}</span>
              <button
                onClick={signOut}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              {signInError && (
                <div className="text-sm text-red-400 bg-red-900/30 px-2 py-1 rounded">
                  {signInError}
                </div>
              )}
              <button
                onClick={handleSignIn}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                Sign in with Google
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main content: left panel + right grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-64 p-4 border-r border-gray-700 space-y-4">
          <button
            className="w-full bg-blue-600 hover:bg-blue-700 text-white p-2 rounded disabled:opacity-50"
            onClick={() => setShowCreateModal(true)}
            disabled={!currentUser}
          >
            Create Scenario
          </button>
          <button
            className="w-full bg-gray-700 hover:bg-gray-600 text-white p-2 rounded disabled:opacity-50"
            disabled
          >
            Select Scenario (click a card)
          </button>
          <p className="text-xs text-gray-400 mt-4">
            {!currentUser && 'Sign in to create or join scenarios.'}
          </p>
        </div>

        {/* Right panel: scenario cards (2 columns, scrollable) */}
        <div className="flex-1 p-4 overflow-y-auto">
          {loading && <p>Loading scenarios...</p>}
          {error && <p className="text-red-500">Error: {error}</p>}
          {joinError && <p className="text-yellow-500">Join error: {joinError}</p>}

          <div className="grid grid-cols-2 gap-4">
            {scenarios.map((scenario) => {
              const isCreator = currentUser && scenario.creatorId === currentUser.id;
              return (
                <div
                  key={scenario.id}
                  className="bg-gray-800 rounded-lg p-4 shadow-lg border border-gray-700"
                >
                  {/* Thumbnail placeholder */}
                  <div className="h-32 bg-gray-700 rounded mb-2 flex items-center justify-center text-gray-500">
                    [Screenshot Placeholder]
                  </div>
                  <div className="font-bold text-lg text-white">{scenario.name}</div>
                  <div className="text-sm text-gray-400">Creator: {scenario.creatorName}</div>
                  <div className="text-xs text-gray-500">
                    Created: {new Date(scenario.createdAt).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-gray-500">
                    Modified: {new Date(scenario.updatedAt).toLocaleDateString()}
                  </div>

                  <div className="mt-3 flex gap-2">
                    {isCreator && (
                      <button
                        onClick={() => handleDelete(scenario.id)}
                        className="text-xs bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-white"
                      >
                        Delete
                      </button>
                    )}
                    <button
                      onClick={() => handleJoin(scenario.id)}
                      className="text-xs bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-white"
                    >
                      Join
                    </button>
                  </div>

                  {scenario.passwordHash && (
                    <div className="mt-2">
                      <input
                        type="password"
                        placeholder="Password"
                        className="w-full bg-gray-700 text-white text-sm px-2 py-1 rounded"
                        value={passwordInput[scenario.id] || ''}
                        onChange={(e) =>
                          setPasswordInput({ ...passwordInput, [scenario.id]: e.target.value })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96">
            <h2 className="text-xl font-bold mb-4 text-white">Create Scenario</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-300">Scenario Name</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300">Password (optional)</label>
                <input
                  type="text"
                  className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600"
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
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                onClick={handleCreate}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}