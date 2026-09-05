// src/components/Lobby.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useScenarios } from '@/hooks/useScenarios';
import { useProfile } from '@/hooks/useProfile';
import { Scenario } from '@/types/gameProtocol';
import { supabase, signInWithGoogle, signOut } from '@/lib/supabaseClient';
import Toast from '@/components/Toast';
import { SettingsModal } from '@/components/SettingsModal';

interface LobbyProps {
  onJoinScenario: (scenarioId: string) => void;
  onNewScenario: (scenarioId: string) => void;
  onReplayScenario: (scenarioId: string) => void;
}

export default function Lobby({ onJoinScenario, onNewScenario, onReplayScenario }: LobbyProps) {
  const router = useRouter();
  const {
    scenarios,
    loading,
    error,
    currentUser,
    dmOnlineByScenario,
    myScenarioIds,
    createScenario,
    deleteScenario,
    joinScenario,
    updateScenarioField,
    fetchScenarios,
    requestScenarioDeletion,
    clearScenarioDeletionRequest,
    deleteExpiredScenarios,
    setScenarioDeletionLock,
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
  const [showDisplayNameModal, setShowDisplayNameModal] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [accessRequest, setAccessRequest] = useState('');
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessSubmitted, setAccessSubmitted] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingProfiles, setPendingProfiles] = useState<{ id: string; display_name: string; request_note: string }[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<{
    id: string;
    display_name: string;
    role: string;
    last_active_at: string | null;
    last_changed_by_name: string | null;
    last_role_change_at: string | null;
  }[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);

  const [scenarioSearch, setScenarioSearch] = useState('');
  const [showMine, setShowMine] = useState(false);
  const [showAvailable, setShowAvailable] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  // creator id -> live profiles.display_name (resolved once, so renames are honored)
  const [creatorAliases, setCreatorAliases] = useState<Record<string, string>>({});

  const { displayName, role, requestNote, access, updateDisplayName, updateRequestNote, approvePlayer } = useProfile(currentUser?.id);

  useEffect(() => {
    if (requestNote && accessRequest === '') {
      setAccessRequest(requestNote);
    }
  }, [requestNote, accessRequest]);

  useEffect(() => {
    if (!currentUser) return;
    // Lazy cleanup: any flagged scenario past its 90-day grace period is deleted
    // server-side whenever the lobby is opened or refocused.
    deleteExpiredScenarios().then(deleted => {
      if (deleted > 0) fetchScenarios();
    });
    const t = setInterval(() => {
      deleteExpiredScenarios().then(deleted => {
        if (deleted > 0) fetchScenarios();
      });
    }, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [currentUser, deleteExpiredScenarios, fetchScenarios]);

  useEffect(() => {
    if (!currentUser) return;
  }, [currentUser]);

  // Resolve each scenario creator's live display name so the search bar can filter
  // by alias and renames are honored. RLS allows any signed-in user to read names.
  useEffect(() => {
    if (scenarios.length === 0) return;
    const creatorIds = Array.from(new Set(scenarios.map(s => s.creatorId).filter(Boolean)));
    if (creatorIds.length === 0) return;
    supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', creatorIds)
      .then(({ data, error }) => {
        if (error) return;
        const map: Record<string, string> = {};
        for (const row of (data || [])) {
          if (row.display_name) map[row.id] = row.display_name;
        }
        setCreatorAliases(map);
      });
  }, [scenarios]);

  const handleSignIn = async () => {
    try {
      setSignInError(null);
      await signInWithGoogle();
    } catch (err: any) {
      setSignInError(err.message || 'Google sign‑in failed.');
    }
  };

  const openDisplayNameModal = () => {
    if (!currentUser) return;
    setDisplayNameInput(displayName || currentUser.user_metadata?.full_name || currentUser.email || '');
    setDisplayNameError(null);
    setShowDisplayNameModal(true);
  };

  const handleChangeDisplayName = async () => {
    const ok = await updateDisplayName(displayNameInput);
    if (!ok) {
      setDisplayNameError('Please enter a non-empty display name.');
      return;
    }
    setShowDisplayNameModal(false);
  };

  const handleRequestAccess = async () => {
    if (!accessRequest.trim()) {
      setAccessError('Please tell us a little about yourself.');
      return;
    }
    const ok = await updateRequestNote(accessRequest.trim());
    if (!ok) {
      setAccessError('Failed to submit your request. Please try again.');
      return;
    }
    setAccessError(null);
    setAccessSubmitted(true);
  };

  const openAdminPanel = async () => {
    setShowAdminPanel(true);
    setAdminError(null);
    const [pendingRes, approvedRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, request_note')
        .is('role', null)
        .order('created_at', { ascending: true }),
      supabase
        .from('profile_access')
        .select('id, display_name, role, last_active_at, last_changed_by_name, last_role_change_at')
        .not('role', 'is', null)
        .order('last_active_at', { ascending: false }),
    ]);
    setPendingProfiles(pendingRes.data || []);
    setApprovedUsers(approvedRes.data || []);
  };

  const handleApprove = async (targetUserId: string, newRole: 'admin' | 'dm' | 'player') => {
    setAdminError(null);
    const { ok, error } = await approvePlayer(targetUserId, newRole);
    if (!ok) {
      setAdminError(error || 'Failed to change role.');
      return;
    }
    await openAdminPanel();
  };

  const handleRoleChange = async (
    user: { id: string; display_name: string; role: string },
    newRole: 'admin' | 'dm' | 'player',
  ) => {
    if (newRole === user.role) return;
    if (user.role === 'admin' && newRole !== 'admin') {
      if (!confirm(`Demote ${user.display_name} from admin? This action is audited.`)) return;
    }
    await handleApprove(user.id, newRole);
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
    } catch (err: any) {
      setJoinError(err.message);
      setToast(err.message);
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

  // Days left in the 90-day grace period before an unconfirmed deletion request
  // auto-deletes. Returns null when not flagged.
  const daysLeft = (scenario: Scenario): number | null => {
    if (!scenario.deleteRequestedAt) return null;
    const deadline = new Date(scenario.deleteRequestedAt).getTime() + 90 * 86400000;
    return Math.max(0, Math.ceil((deadline - Date.now()) / 86400000));
  };

  const handleRequestDeletion = async () => {
    if (!selectedScenarioId) return;
    const scenario = scenarios.find(s => s.id === selectedScenarioId);
    if (!scenario) return;
    if (!confirm(`Request deletion of "${scenario.name}"? The creator will be asked to confirm before it's removed.`)) return;
    try {
      const res = await requestScenarioDeletion(selectedScenarioId);
      if (!res.ok) alert('Failed to request deletion: ' + (res.error || 'unknown error'));
    } catch (err: any) {
      alert('Failed to request deletion: ' + err.message);
    }
  };

  const handleKeepScenario = async () => {
    if (!selectedScenarioId) return;
    try {
      const res = await clearScenarioDeletionRequest(selectedScenarioId);
      if (!res.ok) alert('Failed to keep scenario: ' + (res.error || 'unknown error'));
    } catch (err: any) {
      alert('Failed to keep scenario: ' + err.message);
    }
  };

  const handleToggleLock = async () => {
    if (!selectedScenarioId) return;
    const scenario = scenarios.find(s => s.id === selectedScenarioId);
    if (!scenario) return;
    const locked = !scenario.deletionLocked;
    if (locked && !confirm(`Lock "${scenario.name}"? Admins will no longer be able to mark it for deletion.`)) return;
    try {
      const res = await setScenarioDeletionLock(selectedScenarioId, locked);
      if (!res.ok) alert('Failed to update lock: ' + (res.error || 'unknown error'));
    } catch (err: any) {
      alert('Failed to update lock: ' + err.message);
    }
  };

  const openRenameModal = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) return;
    setSelectedScenarioId(scenarioId);
    setRenameInput(scenario.name);
    setRenameError(null);
    setShowRenameModal(true);
  };

  const handleRename = async () => {
    if (!selectedScenarioId) return;
    const name = renameInput.trim();
    if (!name) {
      setRenameError('Scenario name is required');
      return;
    }
    try {
      const ok = await updateScenarioField(selectedScenarioId, { name });
      if (!ok) throw new Error('Failed to update scenario');
      setShowRenameModal(false);
      setRenameInput('');
      await fetchScenarios();
    } catch (err: any) {
      setRenameError(err.message || 'Failed to rename scenario');
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

  const formatDateTime = (dateString?: string | null) => {
    if (!dateString) return 'Never';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Never';
      return date.toLocaleString();
    } catch {
      return 'Never';
    }
  };

  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);
  const isCreator = selectedScenario && currentUser && selectedScenario.creatorId === currentUser.id;

  const isPending = !!currentUser && role === null;
  const canCreateScenario = !!currentUser && !!access?.canCreateScenario;
  const canUseUnitEditor = !!currentUser && !!access?.canUseUnitEditor;
  const canViewUnitEditor = !!currentUser && (!!access?.canViewUnitEditor || !!access?.canUseUnitEditor);
  const canJoin = !!currentUser && !!access?.canJoinGame;
  const canReplay = !!currentUser && !!access?.canViewReplay; // pending users can watch replays but not play
  const canViewShipEditor = !!currentUser && !!access?.canViewShipEditor; // Archfar's Shipyard (admin-only)
  const canUseShipEditor = !!currentUser && !!access?.canUseShipEditor;
  const canViewMapEditor = !!currentUser && !!access?.canViewMapEditor; // Map editor (admin + dm)
  const canUseMapEditor = !!currentUser && !!access?.canUseMapEditor;

  const renderHeader = () => (
    <div className="flex flex-col items-center px-6 py-3 border-b border-gray-700 bg-[#0d0d1a]">
      <h1 className="text-3xl font-bold text-white tracking-wide text-center w-full">
        Welcome to Quick Terrestrial Tactical Encounter Rules (QuiTTER)
      </h1>
      <div className="flex items-center justify-center gap-3 mt-1">
        {currentUser ? (
          <>
            <button
              onClick={openDisplayNameModal}
              title="Change display name"
              className="text-sm text-gray-300 hover:text-white hover:underline"
            >
              {displayName || currentUser.user_metadata?.full_name || currentUser.email}
            </button>
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
    // A scenario flagged for deletion is closed to everyone except its creator —
    // grey out Join (the joinScenario gate also enforces this server-side).
    const selectedFlagged = !!selectedScenario && !!selectedScenario.deleteRequestedBy;
    const isJoinLockedOut = selectedFlagged && !isCreator;

    return (
      <div className="w-64 p-4 border-r border-gray-700 flex flex-col justify-between h-full bg-[#0d0d1a]">
        <div className="space-y-3">
          {role === 'admin' && (
            <button
              onClick={openAdminPanel}
              className="w-full py-2 bg-gray-700 border-2 border-yellow-400 text-white rounded hover:bg-gray-600 transition"
            >
              Admin Panel
            </button>
          )}
          {role === 'admin' && (
            <button
              onClick={() => setShowSettings(true)}
              className="w-full py-2 bg-gray-700 border-2 border-yellow-400 text-white rounded hover:bg-gray-600 transition"
            >
              Settings
            </button>
          )}
          {canViewShipEditor && (
            <button
              onClick={() => router.push('/ship-editor')}
              className="w-full py-2 bg-gray-700 border-2 border-yellow-400 text-white rounded hover:bg-gray-600 transition"
            >
              Archfar's Shipyard
            </button>
          )}
          {canViewUnitEditor && (
            <button
              onClick={() => router.push('/unit-editor')}
              className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
            >
              {canUseUnitEditor ? 'Unit Editor' : 'Unit Library'}
            </button>
          )}
          {canViewMapEditor && (
            <button
              onClick={() => router.push('/map-editor')}
              className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
            >
              {canUseMapEditor ? 'Map Editor' : 'Map Library'}
            </button>
          )}
          {canCreateScenario && (
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={!currentUser}
              className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              New Scenario
            </button>
          )}
          {canJoin && (
            <button
              onClick={() => {
                if (selectedScenarioId) {
                  const scenario = scenarios.find(s => s.id === selectedScenarioId);
                  if (scenario) {
                    handleJoinClick(scenario.id, !!scenario.passwordHash);
                  }
                }
              }}
              disabled={!isJoinEnabled || isJoinLockedOut}
              title={isJoinLockedOut ? 'This scenario is closed for deletion' : undefined}
              className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join Scenario
            </button>
          )}
          {canReplay && (
            <button
              onClick={() => {
                if (selectedScenarioId) onReplayScenario(selectedScenarioId);
              }}
              disabled={!isJoinEnabled}
              className="w-full py-2 bg-gray-700 border-2 border-yellow-400 text-white rounded hover:bg-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Replay Scenario
            </button>
          )}
          {/* Upload Screenshot button removed */}
        </div>
        <div className="space-y-3">
          {selectedScenario && selectedScenario.deleteRequestedBy && (() => {
            const dl = daysLeft(selectedScenario);
            const flagDate = selectedScenario.deleteRequestedAt
              ? formatDate(selectedScenario.deleteRequestedAt)
              : '';
            return (
              <div className={`p-3 rounded border space-y-2 ${(dl ?? 0) <= 7 ? 'border-red-700/60 bg-red-900/30 text-red-200' : 'border-amber-700/60 bg-amber-900/30 text-amber-200'}`}>
                <div>
                  <div className="font-bold text-sm">⚠ Scenario marked for deletion</div>
                  <div className="text-sm opacity-90 mt-1">
                    {selectedScenario.deleteRequestedByName || 'An admin'} requested deletion of this scenario{flagDate ? ` on ${flagDate}` : ''}. It will be automatically deleted {dl !== null ? `in ${dl} ${dl === 1 ? 'day' : 'days'}` : 'after the 90-day grace period'} unless you confirm the deletion or keep it.
                  </div>
                </div>
                {isCreator && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleDelete}
                      className="flex-1 py-2 bg-red-800 border-2 border-red-400 text-white rounded hover:bg-red-700 transition"
                    >
                      Confirm Delete
                    </button>
                    <button
                      onClick={handleKeepScenario}
                      className="flex-1 py-2 bg-gray-600 border-2 border-gray-400 text-white rounded hover:bg-gray-500 transition"
                    >
                      Keep
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          {role === 'admin' && selectedScenario && !isCreator && !selectedScenario.deleteRequestedBy && !selectedScenario.deletionLocked && (
            <button
              onClick={handleRequestDeletion}
              className="w-full py-2 bg-amber-700 border-2 border-amber-400 text-white rounded hover:bg-amber-600 transition"
            >
              Request Deletion
            </button>
          )}
          {isCreator && selectedScenario && (
            <button
              onClick={handleToggleLock}
              className="w-full py-2 bg-gray-700 border-2 border-yellow-400 text-white rounded hover:bg-gray-600 transition"
              title={selectedScenario.deletionLocked ? 'Admins cannot flag this scenario for deletion' : 'Prevent admins from flagging this scenario for deletion'}
            >
              {selectedScenario.deletionLocked ? '🔒 Unlock Scenario' : '🔓 Lock Scenario'}
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={!isDeleteEnabled}
            className="w-full py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete Scenario
          </button>
        </div>
      </div>
    );
  };

  const renderCards = () => {
    if (loading) return <p className="text-white">Loading scenarios...</p>;
    if (error) return <p className="text-red-500">Error: {error}</p>;

    // Independent toggles (union): Mine + Available shows both; neither shows all.
    // Both are OFF by default so a fresh join sees every scenario unfiltered.
    const mineActive = showMine && myScenarioIds.length > 0;
    const availableActive = showAvailable || (showMine && myScenarioIds.length === 0 && !showAvailable);

    const term = scenarioSearch.trim().toLowerCase();
    let filtered = scenarios;
    if (term) {
      filtered = filtered.filter(s => {
        const alias = creatorAliases[s.creatorId];
        const creatorName = alias || s.creatorName || '';
        return s.name.toLowerCase().includes(term) || creatorName.toLowerCase().includes(term);
      });
    }
    if (mineActive || availableActive) {
      filtered = filtered.filter(s =>
        (mineActive && myScenarioIds.includes(s.id)) || (availableActive && s.roomOpen)
      );
    }

    // Flagged-for-deletion scenarios float to the top; within each group the
    // original (updated_at desc) order is preserved.
    filtered = [...filtered].sort((a, b) => {
      const af = a.deleteRequestedBy ? 1 : 0;
      const bf = b.deleteRequestedBy ? 1 : 0;
      return bf - af;
    });

    return (
      <>
        <div className="mb-4 max-w-xl flex items-center gap-2">
          <div className="flex-none flex rounded border border-gray-600 overflow-hidden">
            <button
              onClick={() => setShowMine(v => !v)}
              className={`px-3 py-2 text-sm transition ${
                showMine
                  ? 'bg-emerald-800 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              My Scenarios
            </button>
            <button
              onClick={() => setShowAvailable(v => !v)}
              className={`px-3 py-2 text-sm transition ${
                showAvailable
                  ? 'bg-emerald-800 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Available scenarios
            </button>
          </div>
          <input
            type="text"
            placeholder="Search scenarios by name or creator..."
            value={scenarioSearch}
            onChange={(e) => setScenarioSearch(e.target.value)}
            className="flex-1 bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="text-gray-400">
            {scenarios.length === 0
              ? 'No scenarios yet. Create one!'
              : availableActive && !mineActive
                ? 'No open rooms right now.'
                : mineActive && !availableActive
                  ? 'No scenarios match your search.'
                  : 'No scenarios match your filters.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filtered.map((scenario) => {
              const isSelected = scenario.id === selectedScenarioId;
              const flagDays = daysLeft(scenario);
              return (
                <div
                  key={scenario.id}
                  onClick={() => setSelectedScenarioId(scenario.id)}
                  className={`bg-gray-800 rounded-lg overflow-hidden shadow-lg border-2 transition-all cursor-pointer w-full relative ${
                    isSelected
                      ? 'border-yellow-400 shadow-yellow-500/30 shadow-lg'
                      : 'border-gray-700 hover:border-gray-500'
                  }`}
                >
                  {scenario.deleteRequestedBy && flagDays !== null && (
                    <div
                      className={`absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rotate-45 w-[140%] whitespace-nowrap text-center text-xs font-bold py-1 pointer-events-none select-none shadow ${
                        flagDays <= 7 ? 'bg-red-700 text-white' : 'bg-amber-600 text-black'
                      }`}
                    >
                      ⚠ Marked for Deletion — {flagDays} {flagDays === 1 ? 'day' : 'days'} left
                    </div>
                  )}
                  {scenario.deletionLocked && (
                    <div className="absolute left-2 top-2 z-10 text-[11px] font-bold text-white pointer-events-none select-none">
                      <span className="inline-block bg-gray-800/90 border border-gray-500 rounded px-1.5 py-0.5">🔒 Locked</span>
                    </div>
                  )}
                  <div className="relative w-full aspect-video bg-gray-700 flex items-center justify-center">
                    {scenario.screenshotUrl ? (
                      <img
                        src={scenario.screenshotUrl}
                        alt={`Screenshot of ${scenario.name}`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-gray-500">[Screenshot]</span>
                    )}
                  </div>
                  <div className="p-3 text-white">
                    <div className="flex justify-between items-start gap-2">
                      <div className="font-bold text-lg truncate">{scenario.name}</div>
                      <div className="flex items-center gap-2 flex-none">
                        {currentUser && scenario.creatorId === currentUser.id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openRenameModal(scenario.id); }}
                            className="text-xs text-gray-300 hover:text-yellow-300 transition"
                            title="Rename scenario"
                          >
                            ✏️
                          </button>
                        )}
                        <div className="text-xs text-gray-400 whitespace-nowrap">Created: {formatDate(scenario.createdAt)}</div>
                      </div>
                    </div>
                    <div className="flex justify-between items-start mt-1">
                      <div className="text-sm text-gray-300 truncate">By {creatorAliases[scenario.creatorId] || scenario.creatorName || 'Unknown'}</div>
                      <div className="text-xs text-gray-400 whitespace-nowrap ml-2">Modified: {formatDate(scenario.updatedAt)}</div>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          dmOnlineByScenario[scenario.id]
                            ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50'
                            : 'bg-gray-800 text-gray-400 border-gray-700'
                        }`}
                        title="Whether the Game Master is currently logged into the scenario"
                      >
                        {dmOnlineByScenario[scenario.id] ? 'DM Online' : 'DM Offline'}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${
                          scenario.roomOpen
                            ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50'
                            : 'bg-red-900/60 text-red-300 border-red-700/50'
                        }`}
                        title="Whether the room accepts new players"
                      >
                        {scenario.roomOpen ? 'Room Open' : 'Room Closed'}
                      </span>
                      {scenario.passwordHash && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                          Password
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-[#0d0d1a] text-white">
      {toast && <Toast message={toast} duration={5000} onClose={() => setToast(null)} />}
      {renderHeader()}

      {currentUser && loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">Loading...</div>
      ) : (
        <>
          {isPending && (
            <div className="flex-none px-6 py-3 border-b border-amber-700/40 bg-amber-900/20">
              <div className="max-w-3xl">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-300">
                      Your account is awaiting approval
                    </p>
                    <p className="text-sm text-amber-200/80 mt-0.5">
                      You can browse scenarios and watch replays while your access is reviewed.
                      Tell the administrator a little about yourself to request access.
                    </p>
                    {accessError && <p className="text-red-400 text-sm mt-1">{accessError}</p>}
                  </div>
                  <div className="flex-none w-64">
                    <textarea
                      rows={3}
                      value={accessRequest}
                      onChange={(e) => { setAccessRequest(e.target.value); setAccessError(null); }}
                      placeholder="e.g. Your name and why you want to play"
                      className="w-full bg-gray-800 text-white p-2 rounded border border-amber-700/50 focus:outline-none focus:border-yellow-400 text-sm"
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition text-sm"
                        onClick={handleRequestAccess}
                      >
                        {accessSubmitted || requestNote ? 'Update Request' : 'Request Access'}
                      </button>
                    </div>
                    {(accessSubmitted || requestNote) && (
                      <p className="text-xs text-green-400 mt-1.5">
                        Request submitted — an administrator will review it soon.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-1 overflow-hidden">
            {renderLeftPanel()}

            <div className="flex-1 p-4 overflow-y-auto bg-[#0d0d1a]">
              {renderCards()}
            </div>
          </div>
        </>
      )}

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

      {showRenameModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">Rename Scenario</h2>
            <div>
              <label className="block text-sm text-gray-300">Scenario Name</label>
              <input
                type="text"
                className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                value={renameInput}
                onChange={(e) => { setRenameInput(e.target.value); setRenameError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
                autoFocus
              />
              {renameError && <p className="text-red-400 text-sm mt-1">{renameError}</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => setShowRenameModal(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={handleRename}
              >
                Save
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
      {showDisplayNameModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-gray-700">
            <h2 className="text-xl font-bold mb-4 text-white">Change Display Name</h2>
            <div>
              <label className="block text-sm text-gray-300">Display Name</label>
              <input
                type="text"
                autoFocus
                className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:outline-none focus:border-yellow-400"
                value={displayNameInput}
                onChange={(e) => {
                  setDisplayNameInput(e.target.value);
                  setDisplayNameError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleChangeDisplayName()}
              />
            </div>
            {displayNameError && <p className="text-red-400 text-sm mt-1">{displayNameError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => setShowDisplayNameModal(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition"
                onClick={handleChangeDisplayName}
              >
                Change
              </button>
            </div>
          </div>
        </div>
      )}
      {showAdminPanel && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-[640px] border border-gray-700 max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4 text-white">Admin Panel</h2>
            {adminError && (
              <p className="text-red-400 text-sm bg-red-900/30 border border-red-700 rounded p-2 mb-3">
                {adminError}
              </p>
            )}

            <h3 className="text-sm text-gray-300 mb-2 font-semibold">Approved Users</h3>
            {approvedUsers.length === 0 ? (
              <p className="text-gray-500 text-sm mb-4">No approved users yet.</p>
            ) : (
              <table className="w-full text-sm mb-5">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-600">
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2">Role</th>
                    <th className="py-1 pr-2">Last Access</th>
                    <th className="py-1">Last Changed By</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedUsers.map(u => (
                    <tr key={u.id} className="border-b border-gray-700">
                      <td className="py-1 pr-2 text-white">
                        {u.display_name}
                        {u.id === currentUser?.id && <span className="text-gray-500 text-xs ml-1">(you)</span>}
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          value={u.role}
                          disabled={u.id === currentUser?.id}
                          onChange={(e) => handleRoleChange(u, e.target.value as 'admin' | 'dm' | 'player')}
                          className="bg-gray-700 text-white p-1 rounded border border-gray-600 focus:outline-none focus:border-yellow-400 disabled:opacity-50"
                        >
                          <option value="admin">Admin</option>
                          <option value="dm">DM</option>
                          <option value="player">Player</option>
                        </select>
                      </td>
                      <td className="py-1 pr-2 text-gray-300">{formatDateTime(u.last_active_at)}</td>
                      <td className="py-1 text-gray-300">
                        {u.last_changed_by_name
                          ? `${u.last_changed_by_name} · ${formatDateTime(u.last_role_change_at)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 className="text-sm text-gray-300 mb-2 font-semibold">Pending Access Requests</h3>
            {pendingProfiles.length === 0 ? (
              <p className="text-gray-500 text-sm mb-4">No pending requests.</p>
            ) : (
              <div className="space-y-3 mb-4">
                {pendingProfiles.map(p => (
                  <div key={p.id} className="bg-gray-700 rounded p-3 border border-gray-600">
                    <div className="font-semibold text-white">{p.display_name}</div>
                    {p.request_note && <div className="text-sm text-gray-300 mt-1">"{p.request_note}"</div>}
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleApprove(p.id, 'player')}
                        className="px-3 py-1 bg-green-800 border-2 border-yellow-400 text-white rounded hover:bg-green-700 transition text-sm"
                      >
                        Player
                      </button>
                      <button
                        onClick={() => handleApprove(p.id, 'dm')}
                        className="px-3 py-1 bg-blue-800 border-2 border-yellow-400 text-white rounded hover:bg-blue-700 transition text-sm"
                      >
                        DM
                      </button>
                      <button
                        onClick={() => handleApprove(p.id, 'admin')}
                        className="px-3 py-1 bg-purple-800 border-2 border-yellow-400 text-white rounded hover:bg-purple-700 transition text-sm"
                      >
                        Admin
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
                onClick={() => setShowAdminPanel(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}