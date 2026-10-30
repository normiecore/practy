import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadSession, logout, type Session } from "./api";
import { Chat } from "./pages/chat";
import { Approvals } from "./pages/approvals";
import { CommandsPage } from "./pages/commands";
import { Compliance } from "./pages/compliance";
import { Diary } from "./pages/diary";
import { Filing } from "./pages/filing";
import { Home } from "./pages/home";
import { MatterWorkspace } from "./pages/matter";
import { Matters } from "./pages/matters";
import { Settings } from "./pages/settings";
import { Trust } from "./pages/trust";
import { href, ToastProvider, useLoad, useRoute } from "./ui";
import "./styles.css";

const NAV: { path: string; label: string }[] = [
  { path: "", label: "Today" },
  { path: "matters", label: "Matters" },
  { path: "approvals", label: "Approvals" },
  { path: "diary", label: "Diary" },
  { path: "filing", label: "Email filing" },
  { path: "trust", label: "Trust" },
  { path: "compliance", label: "Compliance" },
  { path: "settings", label: "Settings" },
  { path: "commands", label: "All commands" },
];

function Shell({ session }: { session: Session }) {
  const route = useRoute();
  const [chatOpen, setChatOpen] = useState(false);
  const pending = useLoad<unknown[]>("list_approvals", { status: "pending" });
  const section = route[0] ?? "";
  const matterId = section === "matters" ? route[1] : undefined;

  let page;
  switch (section) {
    case "":
      page = <Home />;
      break;
    case "matters":
      page = matterId ? <MatterWorkspace id={matterId} tab={route[2]} /> : <Matters />;
      break;
    case "approvals":
      page = <Approvals />;
      break;
    case "diary":
      page = <Diary />;
      break;
    case "filing":
      page = <Filing />;
      break;
    case "trust":
      page = <Trust />;
      break;
    case "compliance":
      page = <Compliance tab={route[1]} />;
      break;
    case "settings":
      page = <Settings tab={route[1]} />;
      break;
    case "commands":
      page = <CommandsPage />;
      break;
    default:
      page = <div className="empty">Page not found</div>;
  }

  return (
    <div className="app" style={chatOpen ? undefined : { gridTemplateColumns: "220px 1fr" }}>
      <nav className="nav" aria-label="Main">
        <div className="brand">Practy</div>
        <div className="firm">{session.firmName}</div>
        {NAV.map((n) => (
          <a key={n.path} href={href(...(n.path ? [n.path] : []))} className={section === n.path ? "active" : undefined}>
            {n.label}
            {n.path === "approvals" && !!pending.data?.length && <span className="count">{pending.data.length}</span>}
          </a>
        ))}
        <div className="spacer" />
        <button className="secondary" onClick={() => setChatOpen((o) => !o)}>
          {chatOpen ? "Close assistant" : "Assistant"}
        </button>
        <div className="user">
          {session.user.displayName}
          <br />
          <button className="ghost" style={{ padding: 0 }} onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </nav>
      <main className="main">{page}</main>
      {chatOpen && <Chat matterId={matterId} onClose={() => setChatOpen(false)} />}
    </div>
  );
}

// Server redirects (such as /settings?connected=xero after an integration connects) use paths; the app routes by hash.
if (location.pathname !== "/" && !location.hash) {
  const params = new URLSearchParams(location.search);
  history.replaceState(null, "", `/?${params}#${location.pathname}`);
}

function Root() {
  const [session, setSession] = useState<Session | null | undefined>();
  useEffect(() => {
    loadSession().then(setSession, () => setSession(null));
  }, []);
  useEffect(() => {
    if (session === null) window.location.href = `/auth/login?returnTo=${encodeURIComponent(location.pathname + location.hash)}`;
  }, [session]);
  if (!session) return <div className="empty">Loading…</div>;
  return (
    <ToastProvider>
      <Shell session={session} />
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
