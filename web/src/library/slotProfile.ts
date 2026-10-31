import { useProfiles } from '../api/queries'
import { slotLabel, type SlotKey } from './bits'

/** Profile names by key, for `profileName`. */
export function useProfileNames(): Map<string, string> {
  return new Map((useProfiles().data ?? []).map((p) => [p.key, p.name]))
}

/** A Profile's name, falling back to its key while Profiles load or when the Profile is gone. */
export const profileName = (names: Map<string, string>, key: string) => names.get(key) ?? key

/**
 * A Slot and its Profile named side by side, "Standard · HD". The Profile is left out when its
 * name is the Slot's label, so a Profile named "4K" in the 4K Slot reads "4K", not "4K · 4K".
 */
export function slotProfile(slot: SlotKey, name: string): string {
  return name.toLowerCase() === slotLabel[slot].toLowerCase() ? slotLabel[slot] : `${slotLabel[slot]} · ${name}`
}
