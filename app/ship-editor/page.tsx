// app/ship-editor/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ShipEditor from '@/components/ShipEditor/ShipEditor';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';

export default function ShipEditorPage() {
  const router = useRouter();
  const { user, authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { access, accessLoading, loading } = useProfile(userId);

  const ready = !authLoading && !loading && !accessLoading && !!userId;

  // Full building requires can_use_ship_editor (admin); anyone with
  // can_view_ship_editor may browse the ship library read-only.
  const canAccess = !!access?.canViewShipEditor || !!access?.canUseShipEditor;
  const readOnly = !access?.canUseShipEditor;
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

  return <ShipEditor readOnly={readOnly} />;
}
