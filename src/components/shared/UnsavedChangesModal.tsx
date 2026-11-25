'use client';

// Shared "Unsaved Changes" dialog used by every saveable library editor.

export function UnsavedChangesModal({
  onSave,
  onDiscard,
  onCancel,
  busy = false,
  title = 'Unsaved Changes',
  message = 'You have unsaved changes. Save before leaving, discard them, or cancel.',
}: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  busy?: boolean;
  title?: string;
  message?: string;
}) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70">
      <div className="w-[420px] max-w-[95vw] rounded-lg border border-gray-700 bg-gray-800 p-6">
        <h2 className="mb-3 text-xl font-bold text-white">{title}</h2>
        <p className="mb-4 text-sm text-gray-300">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded border border-red-500 bg-red-800 px-4 py-2 text-sm text-white hover:bg-red-700"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="rounded border border-yellow-400 bg-green-800 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
