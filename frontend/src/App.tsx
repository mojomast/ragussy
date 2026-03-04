import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { getFrontendConfig } from "./lib/api";
import ChatLabPage from "./pages/ChatLabPage";
import RunsPage from "./pages/RunsPage";

function resolveExternalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (!localHosts.has(parsed.hostname)) {
      return rawUrl;
    }
    const next = new URL(rawUrl);
    next.hostname = window.location.hostname;
    next.protocol = window.location.protocol;
    return next.toString();
  } catch {
    return rawUrl;
  }
}

function App() {
  const [ragussyAdminUrl, setRagussyAdminUrl] = useState<string>("");

  useEffect(() => {
    getFrontendConfig()
      .then((cfg) => setRagussyAdminUrl(resolveExternalUrl(cfg.ragussy_admin_url)))
      .catch(() => setRagussyAdminUrl(""));
  }, []);

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
            {ragussyAdminUrl ? (
              <a
                href={ragussyAdminUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-white"
              >
                Ragussy Admin
              </a>
            ) : null}
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
