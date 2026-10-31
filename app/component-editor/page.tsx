'use client';

// Component Workshop — author the ship component, weapon and mount catalogs.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import ComponentEditor from '@/components/ComponentEditor/ComponentEditor';

export default function ComponentEditorPage() {
  const router = useRouter();
  const { user, authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { access, accessLoading, loading } = useProfile(userId);

  const ready = !authLoading && !loading && !accessLoading && !!userId;
  const canAccess = !!access?.canViewComponentEditor || !!access?.canUseComponentEditor;
  const readOnly = !access?.canUseComponentEditor;

  useEffect(() => {
    if (!ready) return;
    if (!canAccess) router.replace('/');
  }, [ready, canAccess, router]);

  if (!ready) {
    return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading…</div>;
  }
  if (!canAccess) return null;

  return <ComponentEditor readOnly={readOnly} />;
}
