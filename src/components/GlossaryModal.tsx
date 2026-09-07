'use client';
// src/components/GlossaryModal.tsx
// Plain-language help for every abbreviation/term QuiTTER uses — opened from
// the TopBar "?" so newcomers never need to know wargame jargon to play.
import { useMemo, useState } from 'react';
import { TERMS, Term } from '@/lib/terms';

const btn = 'px-4 py-1.5 rounded text-sm font-semibold transition-colors';

export function GlossaryModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = TERMS;
    if (term) {
      out = out.filter(t => `${t.abbr ?? ''} ${t.name} ${t.explain}`.toLowerCase().includes(term));
    }
    return out;
  }, [q]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-700 flex items-center justify-between gap-3">
          <div>
            <p className="text-white font-semibold text-sm">Plain-language glossary</p>
            <p className="text-gray-400 text-[11px]">Every abbreviation and rule word QuiTTER uses, in one line each.</p>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search a term…"
            className="bg-gray-800 text-white text-sm rounded px-3 py-1.5 border border-gray-700 outline-none focus:border-amber-400 w-52"
          />
        </div>
        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {rows.length === 0 && <p className="text-sm text-gray-500">No matches for “{q}”.</p>}
          {rows.map((t: Term) => (
            <div key={t.abbr ?? t.name} className="rounded border border-gray-800 bg-gray-800/40 px-3 py-1.5">
              <p className="text-[13px] text-amber-200">
                {t.abbr ? <span className="font-bold text-white">{t.abbr} · </span> : null}
                <span className="font-semibold text-gray-100">{t.name}</span>
              </p>
              <p className="text-xs text-gray-300 mt-0.5">{t.explain}</p>
            </div>
          ))}
        </div>
        <div className="flex justify-end p-3 border-t border-gray-700">
          <button className={`${btn} bg-gray-700 hover:bg-gray-600 text-white`} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
