/**
 * Type surface of skills-sync-core.mjs for the repo's TypeScript tests.
 *
 * The hook itself is plain JavaScript (it must run on client machines with no
 * build step), but the vitest suite is TypeScript under NodeNext — this
 * declaration file lets tests import the real module without enabling allowJs
 * repo-wide. Keep it in lockstep with the .mjs exports; drift shows up as a
 * test-time runtime failure, not a silent lie.
 */

/**
 * One entry of the GET /skills/sync response (contract §2), narrowed to the
 * fields the hook actually consumes. The server also sends manifest metadata and
 * a delivered_via tag on each entry; the hook ignores them, so they are not typed.
 */
export interface RemoteSkill {
  slug: string;
  version: string;
  has_postinstall?: boolean;
}

/** The .crustdata-lock document written per managed skill (contract §4). */
export interface Marker {
  slug: string;
  version: string;
  managed_by: "crustdata";
  /** How the folder got here: a grant (sync) or a pull (`/crustdata:skills get`). Absent = grant. */
  via?: "grant" | "pull";
  last_synced?: string;
}

/** One entry of GET /skills/catalog, reduced to what the hook may act on. */
export interface CatalogSkill {
  slug: string;
  version: string;
  access: "granted" | "available";
}

export interface LocalSkill {
  dirName: string;
  /** Parsed + slug-matched marker, or null when the folder is not ours. */
  marker: Marker | null;
}

export type PlanAction =
  | { type: "install"; skill: RemoteSkill }
  | { type: "update"; skill: RemoteSkill }
  | { type: "up_to_date"; skill: RemoteSkill }
  | { type: "adopt"; skill: RemoteSkill; marker: Marker }
  | { type: "collision"; skill: RemoteSkill }
  | { type: "postinstall_permission"; skill: RemoteSkill }
  | { type: "remove"; slug: string; marker: Marker }
  | { type: "invalid_entry"; slug: string };

/** One parsed entry of a downloaded skill zip (the hook's own reader). */
export interface ZipEntry {
  /** Raw entry name as stored (forward-slash separated by convention). */
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  /** Unix owner-executable bit from the stored mode (false for non-Unix zips). */
  executable: boolean;
  compressedSize: number;
  uncompressedSize: number;
  /** Inflate and integrity-check the entry (bounded by maxEntryBytes). */
  read(): Buffer;
}

export interface VerifiedFile {
  path: string;
  data: Buffer;
  executable: boolean;
}

export type SyncResultState =
  | "installed"
  | "updated"
  | "removed"
  | "failed"
  | "needs_permission"
  | "up_to_date"
  | "deferred";

export interface SyncResult {
  slug: string;
  version: string;
  state: SyncResultState;
  error?: string;
  /** Relative path of a setup script the bundle ships; named for the person, never run. */
  setup?: string;
  /** Set on results from the pulled-folder pass; absent on the granted set. */
  via?: "pull";
  /** On an `updated` result: the version the folder held before this run. */
  previous?: string;
  /** On an `updated` result whose bundle ships a changelog: its absolute path on disk. */
  changelog?: string;
}

export type PullState =
  | "invalid"
  | "no_key"
  | "bundled"
  | "granted"
  | "up_to_date"
  | "installed"
  | "updated"
  | "unavailable"
  | "failed";

export interface PullResult {
  state: PullState;
  slug: string;
  version?: string;
  setup?: string;
  error?: string;
}

export type DropState = "invalid" | "absent" | "bundled" | "granted" | "removed" | "failed";

export interface DropResult {
  state: DropState;
  slug: string;
  version?: string;
  error?: string;
}

export interface RunSyncOptions {
  apiKey: string | undefined;
  baseUrl: string;
  pluginRoot: string;
  fetchImpl: typeof fetch;
  log?: (message: string) => void;
  now?: () => Date;
  timeoutMs?: number;
  /** Aggregate wall-clock budget for the pass; skills past it are deferred. */
  runBudgetMs?: number;
  /** Monotonic clock (ms) for the budget — injectable for tests. */
  clock?: () => number;
}

export declare const MARKER_FILENAME: string;
export declare const TEMP_PREFIX: string;
export declare const OLD_PREFIX: string;
export declare const MAX_ZIP_BYTES: number;
export declare const MAX_TOTAL_UNCOMPRESSED_BYTES: number;
export declare const MAX_FILE_BYTES: number;
export declare const RUN_BUDGET_MS: number;
export declare const POSTINSTALL_PATH: string;

export declare class ZipFormatError extends Error {}

export declare function maskKey(key: string | undefined): string;
export declare function isSecureBaseUrl(s: unknown): boolean;
export declare function isSafeSlug(slug: unknown): boolean;
export declare function isSafeRelPath(p: unknown): boolean;
export declare function parseMarker(text: string): Marker | null;
export declare function isValidMarker(marker: Marker | null | undefined, dirName: string): boolean;
export declare function isPulled(marker: Marker | null | undefined): boolean;
export declare function readLocalSkills(skillsRoot: string): LocalSkill[];
export declare function planSync(remoteSkills: unknown, locals: LocalSkill[]): PlanAction[];
export declare function planPullRefresh(catalogSkills: unknown, pulled: LocalSkill[]): PlanAction[];
export declare function readCatalog(args: {
  fetchImpl: typeof fetch;
  base: string;
  apiKey: string;
  timeoutMs: number;
  log?: (message: string) => void;
}): Promise<{ ok: true; skills: CatalogSkill[] } | { ok: false; error: string }>;
export declare function pullSkill(args: {
  apiKey: string | undefined;
  baseUrl: string;
  pluginRoot: string;
  slug: unknown;
  fetchImpl: typeof fetch;
  log?: (message: string) => void;
  now?: () => Date;
  timeoutMs?: number;
}): Promise<PullResult>;
export declare function dropSkill(args: { pluginRoot: string; slug: unknown }): DropResult;
export declare function readZipEntries(zip: Buffer, maxEntryBytes: number): ZipEntry[];
export declare function extractSkillFiles(
  zip: Buffer,
): { ok: true; files: VerifiedFile[] } | { ok: false; error: string };
export declare function writeSkillTree(destDir: string, files: VerifiedFile[]): void;
export declare function installSkillAtomically(args: {
  skillsRoot: string;
  slug: string;
  files: VerifiedFile[];
  marker: Marker;
}): void;
export declare function removeSkillDir(skillsRoot: string, slug: string): boolean;
export declare function cleanupStaleDirs(skillsRoot: string): void;
export declare const CONTEXT_MAX_NAMED: number;
export declare function versionDate(version: unknown): string | null;
export declare function sessionStartContext(results: SyncResult[]): string | null;
export declare function hookOutput(changed: boolean, results?: SyncResult[]): string | null;
export declare function runSync(options: RunSyncOptions): Promise<{ changed: boolean; results: SyncResult[] }>;
