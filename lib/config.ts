/**
 * Public Supabase connection used by the site.
 * The anon key is the same public key fahress.com already ships to every browser;
 * Row Level Security limits it to read-only access on published content.
 * Environment variables override these defaults.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vwprdpizbxjokwmnotgl.supabase.co';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3cHJkcGl6Ynhqb2t3bW5vdGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MTUyNDUsImV4cCI6MjA3MDQ5MTI0NX0.A-qu_7VcappUAtrZyR0JJNkk8HEAIzx7RJ-T6M9GMVk';
