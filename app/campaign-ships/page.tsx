'use client';

// Campaign Ship Manager — per-DM list of campaign ship versions.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { CampaignShipManager } from '@/components/CampaignShipManager/CampaignShipManager';

export default function CampaignShipsPage() {
  const router = useRouter();
  const { user, authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { loading } = useProfile(userId);
  const ready = !authLoading && !loading && !!userId;

  useEffect(() => {
    if (ready && !userId) router.replace('/');
  }, [ready, userId, router]);

  if (!ready || !userId) {
    return <div className="w-full h-screen bg-[#0d0d1a] text-white flex items-center justify-center">Loading…</div>;
  }

  return <CampaignShipManager ownerId={userId} />;
}
