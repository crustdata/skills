// One definition for the hook and the command: two would drift, and they sync the same tree.

import { getAccessToken } from "./credential-store.mjs";

const DEFAULT_BASE_URL = "https://skills.crustdata.com";

// Codex writes ONE value into both PLUGIN_ROOT and CLAUDE_PLUGIN_ROOT, and runs hooks/hooks.json
// because our manifest cannot declare hooks (OpenAI's ingestion rejects the field by name). Hence
// equal, not merely present: a hook inherits the user's shell, and PLUGIN_ROOT is generic enough
// that a Claude user may have one exported for something unrelated.
function isForeignClient(env) {
  const grok = (env.GROK_PLUGIN_ROOT ?? "").trim();
  const agentPlugins = (env.PLUGIN_ROOT ?? "").trim();
  const claude = (env.CLAUDE_PLUGIN_ROOT ?? "").trim();
  if (grok !== "") return true;
  if (agentPlugins === "") return false;
  // No Claude root to mirror: a vendor on the Agent Plugins spec that mirrors nothing.
  return claude === "" || claude === agentPlugins;
}

/**
 * @returns {Promise<{client: "claude"|"other"|"none", pluginRoot: string, apiKey: string, baseUrl: string}>}
 */
export async function resolveSyncEnv(env = process.env, { assumeClient = null } = {}) {
  const foreign = isForeignClient(env);
  const claudeRoot = (env.CLAUDE_PLUGIN_ROOT ?? "").trim();
  // A command gets no root variable, so it names its own client rather than falling to "none".
  const client = foreign ? "other" : claudeRoot !== "" ? "claude" : (assumeClient ?? "none");
  const pluginRoot = client === "claude" ? claudeRoot : "";
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
