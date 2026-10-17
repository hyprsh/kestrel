// PROTOTYPE, throwaway. Variant A · Dashboard.
// Vercel-dashboard idiom: fixed left sidebar, page header per screen, dense tables, full-page Title detail with tabs.
import { useParam } from '../../nav'
import { AboutScreen } from './About'
import { ActivityScreen } from './Activity'
import { AddDialog } from './AddDialog'
import { LibraryScreen } from './Library'
import { ManualSearchScreen } from './ManualSearch'
import { SettingsScreen } from './Settings'
import { Sidebar, Toast } from './shell'
import { StoreProvider } from './store'
import { TitleScreen } from './TitleDetail'
import { UpcomingScreen } from './Upcoming'
import { Wizard } from './Wizard'

export function VariantA() {
  return (
    <StoreProvider>
      <Routes />
      <Toast />
    </StoreProvider>
  )
}

function Routes() {
  const screen = useParam('screen', 'library')
  if (screen === 'wizard') return <Wizard />
  return (
    <div className="flex min-h-full text-[14px]">
      <Sidebar />
      <main className="min-w-0 flex-1 pb-20">
        {screen === 'title' ? (
          <TitleScreen />
        ) : screen === 'search' ? (
          <ManualSearchScreen />
        ) : screen === 'upcoming' ? (
          <UpcomingScreen />
        ) : screen === 'activity' ? (
          <ActivityScreen />
        ) : screen === 'settings' ? (
          <SettingsScreen />
        ) : screen === 'about' ? (
          <AboutScreen />
        ) : (
          <LibraryScreen />
        )}
      </main>
      <AddDialog />
    </div>
  )
}
