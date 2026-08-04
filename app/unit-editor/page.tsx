// app/unit-editor/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import UnitEditor from '@/components/UnitEditor';
import { useProfile } from '@/hooks/useProfile';
import { getCurrentUser } from '@/lib/supabaseClient';

export default function UnitEditorPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const { access, loading } = useProfile(userId);

  useEffect(() => {
    getCurrentUser().then(({ data }) => {
      setUserId(data?.user?.id || null);
    });
  }, []);

  // Only roles granted can_use_unit_editor may edit units; everyone else is
  // redirected back to the lobby. Privileges come from the access_roles table.
  useEffect(() => {
    if (loading || !userId) return;
    if (!access?.canUseUnitEditor) {
      router.replace('/');
    }
  }, [loading, userId, access, router]);

  return <UnitEditor />;
}