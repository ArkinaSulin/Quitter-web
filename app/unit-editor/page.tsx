// app/unit-editor/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import UnitEditor from '@/components/UnitEditor';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';

export default function UnitEditorPage() {
  const router = useRouter();
  const { user, authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { access, accessLoading, loading } = useProfile(userId);

  const ready = !authLoading && !loading && !accessLoading && !!userId;

  // Full editing requires can_use_unit_editor (admin/dm); anyone with
  // can_view_unit_editor (incl. players) may browse the unit library read-only.
  // `ready` waits for BOTH the auth session and the access matrix to resolve, so
  // an admin is never briefly misread as pending.
  const canAccess = !!access?.canViewUnitEditor || !!access?.canUseUnitEditor;
  const readOnly = !access?.canUseUnitEditor;
  useEffect(() => {
    if (!ready) return;
    if (!canAccess) {
      router.replace('/');
    }
  }, [ready, canAccess, router]);

  if (!ready) {
    return (
      <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return <UnitEditor readOnly={readOnly} />;
}
