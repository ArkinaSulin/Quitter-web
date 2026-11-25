'use client';

// Shared dirty-state guard for library/editor screens. The caller supplies
// `isDirty`; navigation/selection changes go through `requestAction`, which opens
// the unsaved-changes dialog instead of discarding edits. `takePending` is for
// the Save button: save first, then run the queued action on success.

import { useCallback, useEffect, useRef, useState } from 'react';

export function useUnsavedChanges(isDirty: boolean) {
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const requestAction = useCallback((action: () => void) => {
    if (isDirty) {
      pendingActionRef.current = action;
      setShowUnsavedModal(true);
    } else {
      action();
    }
  }, [isDirty]);

  const takePending = useCallback((): (() => void) | null => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setShowUnsavedModal(false);
    return action;
  }, []);

  const discardPending = useCallback(() => {
    const action = takePending();
    action?.();
  }, [takePending]);

  const cancelPending = useCallback(() => {
    pendingActionRef.current = null;
    setShowUnsavedModal(false);
  }, []);

  return {
    showUnsavedModal,
    requestAction,
    takePending,
    discardPending,
    cancelPending,
    setShowUnsavedModal,
  };
}
