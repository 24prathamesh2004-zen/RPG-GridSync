import { NavLink, useLocation } from 'react-router-dom'
import { Activity, CalendarClock, Factory, Gauge, LayoutGrid, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import GridSyncAgent from './GridSyncAgent'

const NAV = [
  { section: 'Monitor', to: '/', label: 'Overview', icon: LayoutGrid },
  { section: 'Monitor', to: '/plants', label: 'RPG Plants', icon: Factory },
  { section: 'Monitor', to: '/suppliers', label: 'Supplier Plants', icon: Zap },
  { section: 'Analyse', to: '/frequency', label: 'Frequency', icon: Activity },
  { section: 'Analyse', to: '/meters', label: 'Meter Readings', icon: Gauge },
  { section: 'Act', to: '/schedule', label: 'Schedule', icon: CalendarClock },
]

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const keepExistingPageHeader = pathname === '/schedule'

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(1000px_380px_at_80%_-100px,#cfeeee,transparent_65%),#f3f6fa] md:flex-row">
      <aside className="z-20 flex w-full shrink-0 flex-col border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-[228px] md:border-b-0 md:border-r">
        <div className="flex h-[60px] items-center gap-2 border-b border-slate-100 px-5 md:h-auto md:py-5">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-gradient-to-br from-teal-700 to-blue-700 text-sm font-extrabold text-white">
            G
          </div>
          <div>
            <div className="font-bold text-gray-900 text-sm leading-tight">RPG GridSync</div>
            <div className="text-[11px] text-slate-500 leading-tight">Command Center</div>
          </div>
        </div>
        <nav className="flex flex-1 gap-1 overflow-x-auto p-2 md:block md:space-y-3 md:overflow-x-hidden md:overflow-y-auto md:p-3">
          {(['Monitor', 'Analyse', 'Act'] as const).map(section => (
            <div key={section} className="shrink-0 md:shrink">
              <div className="hidden px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500 md:block">{section}</div>
              <div className="flex gap-1 md:block md:space-y-0.5">
                {NAV.filter(item => item.section === section).map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/' || to === '/plants' || to === '/suppliers'}
                    className={({ isActive }) =>
                      `flex items-center gap-2 whitespace-nowrap rounded-[10px] px-2.5 py-2 text-xs font-semibold transition-colors md:w-full md:gap-2.5 md:px-2.5 md:text-sm ${
                        isActive
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <Icon size={17} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="hidden border-t border-slate-200 p-3 text-xs text-slate-500 md:block">
          RPG Group · Procurement<br />Day-ahead plan · 96 blocks × 15 min
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {keepExistingPageHeader && <header className="sticky top-0 z-10 flex min-h-[56px] items-center border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-[26px]">
          <h1 className="text-sm font-semibold text-slate-700">RPG GridSync — Energy Load Optimizer</h1>
        </header>}
        <main className="mx-auto w-full max-w-[1340px] px-4 py-4 md:px-[26px] md:py-5">{children}</main>
      </div>
      <GridSyncAgent />
    </div>
  )
}
