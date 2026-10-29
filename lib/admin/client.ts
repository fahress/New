'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';

/** Demo mode runs the dashboard on the local snapshot with no login — used only for local testing. */
export const DEMO = process.env.NEXT_PUBLIC_DASHBOARD_DEMO === '1';

let client: SupabaseClient | null = null;

/** Browser Supabase client. Signs in with the editor's own account; the database's security rules decide what it may change. */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fahress-dashboard-auth' },
    });
  }
  return client;
}

export const BUCKET = 'studio';
