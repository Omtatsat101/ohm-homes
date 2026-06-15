/**
 * Supabase server-side client for ohm.homes.
 * Use in Server Components, Route Handlers, Server Actions.
 * Reads + sets auth cookies via Next.js cookies().
 *
 * ohm.homes/web gets its OWN Supabase project — values are read from env
 * (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Nothing is
 * hardcoded; set them in wrangler.jsonc vars (public) + `wrangler secret put`
 * for the service-role key.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Server Component context — ignored, middleware refreshes
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // ignored
          }
        },
      },
    }
  );
}

/**
 * Service-role client — ONLY for trusted server contexts.
 * Bypasses RLS. NEVER expose to the browser.
 */
export function createServiceRoleClient() {
  if (typeof window !== "undefined") {
    throw new Error("createServiceRoleClient called in browser — SECURITY VIOLATION");
  }
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { get: () => undefined, set: () => {}, remove: () => {} },
    }
  );
}
