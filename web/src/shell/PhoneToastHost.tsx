// chrome: waiting hyprsh/design#33
// The one Toast host. On a phone it lifts the stack above the floating tab bar; the library's Toast does not
// read --tab-bar-height yet. Drop the override (and this file's marker) when Toast adds it to its bottom offset.
import { Toast } from '@hyprsh/design'

export function PhoneToastHost() {
  return <Toast className="max-sm:!bottom-[calc(var(--tab-bar-height)+16px)]" />
}
