/**
 * Supabase browser-side client for ohm.homes.
 * Use in Client Components.
 *
 * Env-driven (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).
 * ohm.homes gets its OWN Supabase project — do not hardcode credentials.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
