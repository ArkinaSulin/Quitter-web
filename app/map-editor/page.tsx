'use client';

// Map Editor — author reusable maps (image + per-hex movement costs) that
// scenarios snapshot. View (read-only browse) for admins/DMs; authoring requires
// can_use_map_editor (same role set in v1).
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import MapEditor from '@/components/MapEditor/MapEditor';

export default function MapEditorPage() {
  const router = useRouter();
  const { user, authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { access, accessLoading, loading } = useProfile(userId);

  const ready = !authLoading && !loading && !accessLoading && !!userId;
  const canAccess = !!access?.canViewMapEditor || !!access?.canUseMapEditor;
  const readOnly = !access?.canUseMapEditor;

  useEffect(() => {
    if (!ready) return;
    if (!canAccess) router.replace('/');
  }, [ready, canAccess, router]);

  if (!ready) {
    return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading…</div>;
  }
  if (!canAccess) return null;

  return <MapEditor readOnly={readOnly} />;
}
