// One definition for the hook and the command: two would drift, and they sync the same tree.

import { getAccessToken } from "./credential-store.mjs";

const DEFAULT_BASE_URL = "https://skills.crustdata.com";

/**
 * @returns {Promise<{client: "claude"|"grok"|"none", pluginRoot: string, apiKey: string, baseUrl: string}>}
 */
export async function resolveSyncEnv(env = process.env, { assumeClient = null } = {}) {
  // First non-empty, not first defined: an exported-but-empty var must not mask the other.
  const roots = [
    ["grok", (env.GROK_PLUGIN_ROOT ?? "").trim()],
    ["claude", (env.CLAUDE_PLUGIN_ROOT ?? "").trim()],
  ];
  // A command gets no root variable, so it names its own client rather than falling to "none".
  const [client, pluginRoot] = roots.find(([, value]) => value !== "") ?? [assumeClient ?? "none", ""];
  const envKey = (env.CRUSTDATA_API_KEY ?? "").trim();
  const baseUrl = (env.CRUSTDATA_SKILLS_BASE_URL ?? "").trim() || DEFAULT_BASE_URL;

  // Claude only, since `/crustdata:login` is a Claude command; a corrupt file degrades to "no key".
  let apiKey = envKey;
  if (apiKey === "" && client === "claude") {
    try {
      apiKey = (await getAccessToken()) ?? "";
    } catch {
      apiKey = "";
    }
  }
  return { client, pluginRoot, apiKey, baseUrl };
}
