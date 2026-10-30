import type { MatterFolderSpec } from "../types.js";

/** `1998 - Priestley, Toni - MVA`: the firm's matter folder name. */
export function matterFolderName(spec: MatterFolderSpec): string {
  return `${spec.number.trim()} - ${spec.clientSortName.trim()} - ${spec.schemeLabel.trim()}`;
}

/**
 * Whether a folder name is the matter folder for `number`: the part before the first
 * ` - ` must equal the number exactly (ignoring case), so "1998" never matches
 * "19980 - …" and a number such as "1998 - Priestley" never matches "1998 - Priestley, Toni - MVA".
 */
export function isMatterFolderFor(name: string, number: string): boolean {
  const n = number.trim().toLowerCase();
  const i = name.indexOf(" - ");
  return !!n && i > 0 && name.slice(0, i).trim().toLowerCase() === n;
}

/**
 * Names valid in both Box and common filesystems: no path separators or control
 * characters, no leading/trailing whitespace, not "." or "..", at most 255 characters.
 */
export function assertItemName(name: string): void {
  if (
    !name ||
    name.length > 255 ||
    name !== name.trim() ||
    name === "." ||
    name === ".." ||
    /[/\\\u0000-\u001f]/.test(name)
  ) {
    throw new Error(`Invalid document or folder name: ${JSON.stringify(name)}`);
  }
}
