// Activity's two tabs and their places: "/activity" is Grabs and "/activity/jobs" Background Jobs.
// "/activity/running" (the top bar's indicator, older links) opens Background Jobs too, where Running now is.
// Health used to be a third tab; place.ts redirects "/activity/health" to the Health screen.
export type ActivityTab = 'grabs' | 'jobs'

export const activityTabs: { value: ActivityTab }[] = [{ value: 'grabs' }, { value: 'jobs' }]

/** The tab a place's section names; no section, or one Activity does not know, is Grabs. */
export function activityTabOf(section: string): ActivityTab {
  return section === 'jobs' || section === 'running' ? 'jobs' : 'grabs'
}

/** The place section of a tab: none for Grabs, which is "/activity" itself. */
export const activityTabSection = (tab: ActivityTab): string => (tab === 'grabs' ? '' : tab)
