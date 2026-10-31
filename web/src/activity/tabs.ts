// Activity's three tabs and their places: "/activity" is Grabs, "/activity/health" Health and
// "/activity/jobs" Background Jobs. "/activity/running" (the top bar's indicator, older links) opens
// Background Jobs too, where Running now is.
export type ActivityTab = 'grabs' | 'health' | 'jobs'

export const activityTabs: { value: ActivityTab }[] = [{ value: 'grabs' }, { value: 'health' }, { value: 'jobs' }]

/** The tab a place's section names; no section, or one Activity does not know, is Grabs. */
export function activityTabOf(section: string): ActivityTab {
  return section === 'health' ? 'health' : section === 'jobs' || section === 'running' ? 'jobs' : 'grabs'
}

/** The place section of a tab: none for Grabs, which is "/activity" itself. */
export const activityTabSection = (tab: ActivityTab): string => (tab === 'grabs' ? '' : tab)
