/**
 * Persona / role model for ohm.homes — the real-estate login personas.
 *
 * Single source of truth for where each persona lands after login. Used by the
 * (future) /dashboard router, onboarding, and signup so destinations never
 * drift. Mirrors the FlipWala+VibeFlippers `lib/roles.ts` shape, retargeted to
 * real-estate roles.
 */

export interface Role {
  id: string;
  label: string;
  dest: string;
  blurb: string;
}

export const ROLES: Role[] = [
  { id: "buyer",    label: "Buyer",    dest: "/listings",            blurb: "Search homes and save the ones you love" },
  { id: "seller",   label: "Seller",   dest: "/sell",                blurb: "List your property and reach qualified buyers" },
  { id: "agent",    label: "Agent",    dest: "/agent/dashboard",     blurb: "Manage listings, leads, and client tours" },
  { id: "investor", label: "Investor", dest: "/investor/dashboard",  blurb: "Analyze deals, cap rates, and rental comps" },
  { id: "admin",    label: "Admin",    dest: "/admin",               blurb: "Ops, moderation, and platform settings" },
];

const BY_ID = new Map(ROLES.map((r) => [r.id, r]));

/** Where a role lands after login. Falls back to the buyer listings view. */
export function roleDestination(role?: string | null): string {
  return (role && BY_ID.get(role)?.dest) || "/listings";
}

export function role(roleId?: string | null): Role | undefined {
  return roleId ? BY_ID.get(roleId) : undefined;
}
