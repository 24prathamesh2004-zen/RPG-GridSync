import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState } from 'react'
import AppShell from './components/layout/AppShell'
import CommandCenterPage from './pages/CommandCenterPage'
import SchedulePage from './pages/SchedulePage'

export default function App() {
  const [companyFilter, setCompanyFilter] = useState<'' | 'CEAT' | 'KEC'>('')

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<CommandCenterPage companyFilter={companyFilter} onCompanyFilter={setCompanyFilter} />} />
          <Route path="/plants" element={<CommandCenterPage companyFilter={companyFilter} onCompanyFilter={setCompanyFilter} />} />
          <Route path="/plants/:plantId" element={<CommandCenterPage companyFilter={companyFilter} onCompanyFilter={setCompanyFilter} />} />
          <Route path="/suppliers" element={<CommandCenterPage companyFilter={companyFilter} onCompanyFilter={setCompanyFilter} />} />
          <Route path="/suppliers/:supplierId" element={<CommandCenterPage companyFilter={companyFilter} onCompanyFilter={setCompanyFilter} />} />
          <Route path="/frequency" element={<CommandCenterPage companyFilter={companyFilter} onCompanyFilter={setCompanyFilter} />} />
          <Route path="/meters" element={<CommandCenterPage companyFilter={companyFilter} onCompanyFilter={setCompanyFilter} />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/advisor" element={<Navigate to="/" replace />} />
          <Route path="/windows" element={<Navigate to="/plants" replace />} />
          <Route path="/impact" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}
