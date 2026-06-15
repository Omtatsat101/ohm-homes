import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// First-deploy config: defaults (in-memory cache). Add R2 incremental cache later
// for ISR if needed. Mirrors the FlipWala+VibeFlippers web setup.
export default defineCloudflareConfig({});
