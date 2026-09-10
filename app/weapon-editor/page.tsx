'use client';

// Weapon Editor — author the reusable weapons library (DM/admin edit; everyone
// may view the catalog, which the unit editor and add-weapon modal read).
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import WeaponEditor from '@/components/WeaponEditor/WeaponEditor';

export default function WeaponEditorPage() {
  const router = useRouter();
  const { user, authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { access, accessLoading, loading } = useProfile(userId);

  const ready = !authLoading && !loading && !accessLoading && !!userId;
  const canAccess = !!access?.canViewWeaponEditor || !!access?.canUseWeaponEditor;
  const readOnly = !access?.canUseWeaponEditor;

  useEffect(() => {
    if (!ready) return;
    if (!canAccess) router.replace('/');
  }, [ready, canAccess, router]);

  if (!ready) {
    return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading…</div>;
  }
  if (!canAccess) return null;

  return <WeaponEditor readOnly={readOnly} />;
}
