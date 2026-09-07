'use client';

// Effects Library — author reusable effect templates (DM/admin edit; everyone
// may view the catalog and apply effects in scenarios).
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import EffectEditor from '@/components/EffectEditor/EffectEditor';

export default function EffectEditorPage() {
  const router = useRouter();
  const { user, authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { access, accessLoading, loading } = useProfile(userId);

  const ready = !authLoading && !loading && !accessLoading && !!userId;
  const canAccess = !!access?.canViewEffectEditor || !!access?.canUseEffectEditor;
  const readOnly = !access?.canUseEffectEditor;

  useEffect(() => {
    if (!ready) return;
    if (!canAccess) router.replace('/');
  }, [ready, canAccess, router]);

  if (!ready) {
    return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading…</div>;
  }
  if (!canAccess) return null;

  return <EffectEditor readOnly={readOnly} />;
}
