'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/admin/client';

export type Member = { id: string; email: string; name: string };

/** The signed-in site member, `null` when signed out, `undefined` while checking. */
export function useMember() {
  const [me, setMe] = useState<Member | null | undefined>(undefined);
  useEffect(() => {
    const sb = supabase();
    const pick = (u: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null | undefined) =>
      setMe(u ? { id: u.id, email: u.email ?? '', name: String(u.user_metadata?.full_name ?? u.user_metadata?.name ?? '') } : null);
    sb.auth.getSession().then(({ data }) => pick(data.session?.user));
    const { data } = sb.auth.onAuthStateChange((_e, s) => pick(s?.user));
    return () => data.subscription.unsubscribe();
  }, []);
  return me;
}
