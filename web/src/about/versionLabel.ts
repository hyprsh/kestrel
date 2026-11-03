/** The version as shown to people: an edge build adds the short commit it was made from, "edge (34e3846)". */
export function versionLabel(version: string, commit: string): string {
  return commit ? `${version} (${commit})` : version
}
