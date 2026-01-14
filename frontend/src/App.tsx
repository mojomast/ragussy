import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import SetupWizard from './pages/SetupWizard'
import Chat from './pages/Chat'
import Documents from './pages/Documents'
import VectorStore from './pages/VectorStore'
import Settings from './pages/Settings'
import { Toaster } from './components/Toast'

function App() {
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkSetupStatus()
  }, [])

  const checkSetupStatus = async () => {
    try {
      const res = await fetch('/api/settings/setup-status')
      const data = await res.json()
      setIsConfigured(data.isConfigured)
    } catch {
      setIsConfigured(false)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Toaster>
        <Routes>
          {!isConfigured ? (
            <>
              <Route path="/setup" element={<SetupWizard onComplete={() => setIsConfigured(true)} />} />
              <Route path="*" element={<Navigate to="/setup" replace />} />
            </>
          ) : (
            <Route element={<Layout />}>
              <Route path="/" element={<Chat />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/vectors" element={<VectorStore />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          )}
        </Routes>
      </Toaster>
    </BrowserRouter>
  )
}

export default App
