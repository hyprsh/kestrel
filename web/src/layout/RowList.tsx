// chrome: layout
import { Entity } from '@hyprsh/design'
import type { ComponentProps } from 'react'

/**
 * An Entity list that rows can stack in. It is a container, so a row decides by the width of its list, not of the
 * window: a narrow column at desktop width stacks the way a phone does (VersionRows uses `@xl:` the same way).
 * Give each row `className={stackedRow}` and `rightClassName={stackedRight}`: in a narrow list its `right`
 * content sits under the row's content and wraps, from `@xl` up it is the usual row with `right` on the end.
 */
export function RowList(props: Omit<ComponentProps<typeof Entity.List>, 'className'>) {
  return <Entity.List {...props} className="@container" />
}

export const stackedRow = 'flex-col items-stretch @xl:flex-row @xl:items-center'
export const stackedRight = 'flex-wrap justify-start @xl:justify-end'
