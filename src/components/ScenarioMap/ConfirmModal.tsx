// src/components/ScenarioMap/ConfirmModal.tsx
// Overlay confirm dialog shared by all soft-enforcement prompts.
import type { ReactNode } from 'react';

type ModalButtonVariant = 'red' | 'amber' | 'green' | 'gray';
export interface ModalButton {
  label: string;
  onClick: () => void;
  variant?: ModalButtonVariant;
}

export interface ConfirmModalProps {
  title: string;
  children: ReactNode;
  buttons: ModalButton[];
  tone?: 'red' | 'amber' | 'gray';
  onCancel?: () => void;
}

const MODAL_BUTTON_STYLES: Record<ModalButtonVariant, string> = {
  red: 'bg-red-700 hover:bg-red-600 text-white',
  amber: 'bg-amber-700 hover:bg-amber-600 text-white',
  green: 'bg-green-800 hover:bg-green-700 text-white',
  gray: 'bg-gray-700 hover:bg-gray-600 text-white',
};

export function ConfirmModal({ title, children, buttons, tone = 'gray', onCancel }: ConfirmModalProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className={`bg-gray-900 border ${tone === 'red' ? 'border-red-800' : tone === 'amber' ? 'border-amber-700' : 'border-gray-700'} rounded-xl shadow-2xl p-6 min-w-[320px]`}>
        <p className="text-white text-sm mb-1 text-center font-semibold">{title}</p>
        <div className="text-gray-400 text-xs mb-4 text-center">{children}</div>
        <div className="flex flex-col gap-2">
          {buttons.map((b, i) => (
            <button key={i} className={`${MODAL_BUTTON_STYLES[b.variant ?? 'gray']} px-4 py-2 rounded-lg text-sm`} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
          {onCancel && (
            <button className={`${MODAL_BUTTON_STYLES.gray} px-4 py-2 rounded-lg text-sm`} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
