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

  // Only roles granted can_use_unit_editor may edit units; everyone else is
  // redirected back to the lobby. `ready` waits for BOTH the auth session and the
  // access matrix to resolve, so an admin is never briefly misread as pending.
  useEffect(() => {
    if (!ready) return;
    if (!access?.canUseUnitEditor) {
      router.replace('/');
    }
  }, [ready, access, router]);

  if (!ready) {
    return (
      <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return <UnitEditor />;
}
