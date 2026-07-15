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
  last_synced?: string;
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
  | { type: "collision"; skill: RemoteSkill }
  | { type: "postinstall_gated"; skill: RemoteSkill }
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

export type SyncResultState = "installed" | "updated" | "removed" | "failed" | "needs_permission" | "up_to_date";

export interface SyncResult {
  slug: string;
  version: string;
  state: SyncResultState;
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
}

export declare const MARKER_FILENAME: string;
export declare const TEMP_PREFIX: string;
export declare const OLD_PREFIX: string;
export declare const MAX_ZIP_BYTES: number;
export declare const MAX_TOTAL_UNCOMPRESSED_BYTES: number;
export declare const MAX_FILE_BYTES: number;

export declare class ZipFormatError extends Error {}

export declare function maskKey(key: string | undefined): string;
export declare function isSafeSlug(slug: unknown): boolean;
export declare function isSafeRelPath(p: unknown): boolean;
export declare function parseMarker(text: string): Marker | null;
export declare function isValidMarker(marker: Marker | null | undefined, dirName: string): boolean;
export declare function readLocalSkills(skillsRoot: string): LocalSkill[];
export declare function planSync(remoteSkills: unknown, locals: LocalSkill[]): PlanAction[];
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
export declare function hookOutput(changed: boolean): string | null;
export declare function runSync(options: RunSyncOptions): Promise<{ changed: boolean; results: SyncResult[] }>;
