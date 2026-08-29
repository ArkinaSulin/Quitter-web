// src/components/ScenarioMap/TopBar.tsx
// Scenario header: role label, Undo, turn counter, End Turn, Free Move toggle,
// GM settings/replay buttons, and Exit to Lobby.
import { AllianceGroup } from '@/types/gameProtocol';

interface TopBarProps {
  roleLabel: string;
  myTeam: string | null;
  controlsLocked: boolean;
  undo: () => void;
  canUndo: () => boolean;
  peekUndoChainLength: () => number;
  displayTurnNumber: number;
  isGM: boolean;
  currentTurnAlliance: AllianceGroup | null;
  alliances: Record<string, AllianceGroup>;
  handleEndTurn: () => void;
  isEndingTurn: boolean;
  handleToggleFreeMove: () => void;
  freeMove: boolean;
  onOpenSettings: () => void;
  replayMode: boolean;
  inReplay: boolean;
  onEnterReplay: () => void;
  onBackToPlay: () => void;
  goToLobby: () => void;
}

export function TopBar(props: TopBarProps) {
  const {
    roleLabel,
    myTeam,
    controlsLocked,
    undo,
    canUndo,
    peekUndoChainLength,
    displayTurnNumber,
    isGM,
    currentTurnAlliance,
    alliances,
    handleEndTurn,
    isEndingTurn,
    handleToggleFreeMove,
    freeMove,
    onOpenSettings,
    replayMode,
    inReplay,
    onEnterReplay,
    onBackToPlay,
    goToLobby,
  } = props;

  return (
    <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2 bg-black/40 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="text-white text-lg font-semibold">
          Scenario Map - {roleLabel}{myTeam ? ` · ${myTeam}` : ''}
        </span>
        {!controlsLocked && (
          <button
            onClick={undo}
            disabled={!canUndo()}
            className={`px-3 py-1 rounded shadow-lg text-sm ${
              canUndo()
                ? 'bg-amber-700 hover:bg-amber-600 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {`Undo${peekUndoChainLength() > 1 ? ` (${peekUndoChainLength()})` : ''}`}
          </button>
        )}
        <span className="text-white text-sm font-mono">Turn {displayTurnNumber}</span>
        {!controlsLocked && (() => {
          // Alliance-wide End Turn: from turn 1 on, any player whose alliance holds
          // the turn may advance it; free play (null alliance) stays GM-only. A
          // player needs an assigned team — the server's END_TURN gate requires
          // sp.team IS NOT NULL, so don't show the button to teamless players.
          const canEndTurn = isGM || (!!myTeam && currentTurnAlliance !== null && (alliances[myTeam] || 'friendly') === currentTurnAlliance);
          return (
            <button
              onClick={canEndTurn ? handleEndTurn : undefined}
              disabled={!canEndTurn || isEndingTurn}
              title={canEndTurn ? 'Advance to the next group' : currentTurnAlliance === null ? 'Only the DM can end free play' : 'Only the current alliance can end the turn'}
              className={`px-3 py-1 rounded shadow-lg text-sm ${
                currentTurnAlliance === null
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : currentTurnAlliance === 'enemy'
                    ? 'bg-[#D55E00] hover:bg-[#c74f00] text-white'
                    : currentTurnAlliance === 'neutral'
                      ? 'bg-[#E0E0E0] hover:bg-[#d0d0d0] text-black'
                      : 'bg-[#0072B2] hover:bg-[#00619c] text-white'
              } ${!canEndTurn || isEndingTurn ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {`End Turn${isEndingTurn ? '…' : ''}${currentTurnAlliance === null ? ' (Free Play)' : ` (${currentTurnAlliance})`}`}
            </button>
          );
        })()}
        {!controlsLocked && (
          <button
            onClick={isGM ? handleToggleFreeMove : undefined}
            disabled={!isGM}
            title={isGM ? 'Toggle free movement (no MP/action cost for any player)' : 'Only the DM can toggle free movement'}
            className={`px-3 py-1 rounded shadow-lg text-sm ${
              freeMove
                ? isGM
                  ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                  : 'bg-emerald-900 text-emerald-300 cursor-not-allowed'
                : isGM
                  ? 'bg-gray-800 hover:bg-gray-700 text-white'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
          >
            {`Free Move: ${freeMove ? 'ON' : 'OFF'}`}
          </button>
        )}
        {isGM && !controlsLocked && (
          <button
            onClick={onOpenSettings}
            className="px-3 py-1 rounded shadow-lg text-sm bg-gray-800 hover:bg-gray-700 text-white"
            title="Scenario settings"
          >
            ⚙ Settings
          </button>
        )}
        {/* Mode 2 (join scenario): GM enters/leaves replay of the live session */}
        {!replayMode && isGM && !controlsLocked && (
          <button
            onClick={onEnterReplay}
            className="px-3 py-1 rounded shadow-lg text-sm bg-amber-700 hover:bg-amber-600 text-white"
          >
            Replay scenario
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Mode 2 in-session replay: Back to Play returns to live play */}
        {!replayMode && isGM && inReplay && (
          <button
            onClick={onBackToPlay}
            className="px-3 py-1 rounded shadow-lg text-sm bg-emerald-700 hover:bg-emerald-600 text-white"
          >
            Back to Play
          </button>
        )}
        <button onClick={goToLobby} className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded shadow-lg text-sm">
          Exit to Lobby
        </button>
      </div>
    </div>
  );
}
