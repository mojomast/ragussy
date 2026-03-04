import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import ChatLabPage from "./pages/ChatLabPage";
import RunsPage from "./pages/RunsPage";

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-100 to-slate-200 text-slate-900">
      <header className="border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold">LLM Model Lab</h1>
          <nav className="flex gap-2 rounded-lg bg-slate-100 p-1">
            <NavLink
              to="/"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
                  isActive ? "bg-white text-slate-900 shadow" : "text-slate-600"
                }`
              }
            >
              Chat Lab
            </NavLink>
            <NavLink
              to="/runs"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
                  isActive ? "bg-white text-slate-900 shadow" : "text-slate-600"
                }`
              }
            >
              Runs
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] p-4">
        <Routes>
          <Route path="/" element={<ChatLabPage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
