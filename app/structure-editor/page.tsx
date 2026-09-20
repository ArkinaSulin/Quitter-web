'use client';

// Map Structure Library — author reusable map features (walls, spikes, gates,
// towers) (DM/admin edit; everyone may view the catalog).
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import StructureEditor from '@/components/StructureEditor/StructureEditor';

export default function StructureEditorPage() {
  const router = useRouter();
  const { user, authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { access, accessLoading, loading } = useProfile(userId);

  const ready = !authLoading && !loading && !accessLoading && !!userId;
  const canAccess = !!access?.canViewStructureEditor || !!access?.canUseStructureEditor;
  const readOnly = !access?.canUseStructureEditor;

  useEffect(() => {
    if (!ready) return;
    if (!canAccess) router.replace('/');
  }, [ready, canAccess, router]);

  if (!ready) {
    return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading…</div>;
  }
  if (!canAccess) return null;

  return <StructureEditor readOnly={readOnly} />;
}
