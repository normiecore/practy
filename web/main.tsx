import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import { href, ToastProvider, useDialogFocus, useLoad, useRoute } from "./ui";
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

// Phones: the first four sections are bottom tabs; the rest sit under More.
const TAB_PATHS = ["", "matters", "approvals", "diary"];
const TABS = NAV.filter((n) => TAB_PATHS.includes(n.path));
const MORE = NAV.filter((n) => !TAB_PATHS.includes(n.path));

const svg = (body: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {body}
  </svg>
);
const ICONS: Record<string, ReactNode> = {
  "": svg(<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z" />),
  matters: svg(<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />),
  approvals: svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.3 2.6 2.6 5-5.4" />
    </>,
  ),
  diary: svg(
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>,
  ),
  more: svg(
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </>,
  ),
};

/** The phone's More sheet: the sections without a tab, the assistant, and signing out. */
function MoreSheet({ session, section, onClose, onAssistant }: { session: Session; section: string; onClose: () => void; onAssistant: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  // The sheet belongs to the phone layout; widening the window past it closes the sheet.
  useEffect(() => {
    const wide = matchMedia("(min-width: 901px)");
    const on = () => wide.matches && onClose();
    wide.addEventListener("change", on);
    return () => wide.removeEventListener("change", on);
  }, [onClose]);
  return (
    <div className="sheet-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-labelledby="more-title">
        <div className="sheet-head">
          <h2 id="more-title">More</h2>
          <button type="button" className="ghost modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-who">
          <span className="muted small">Signed in as</span>
          <strong>{session.user.displayName}</strong>
          <span className="muted small">{session.firmName}</span>
        </div>
        <nav className="sheet-list" aria-label="More sections">
          {MORE.map((n) => (
            <a key={n.path} href={href(n.path)} className={section === n.path ? "active" : undefined} aria-current={section === n.path ? "page" : undefined} onClick={onClose}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="sheet-list">
          <button type="button" onClick={onAssistant}>
            Assistant
          </button>
          <button type="button" className="sign-out" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function Shell({ session }: { session: Session }) {
  const route = useRoute();
  const [chatOpen, setChatOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pending = useLoad<unknown[]>("list_approvals", { status: "pending" });
  const section = route[0] ?? "";
  const matterId = section === "matters" ? route[1] : undefined;
  const routeKey = route.join("/");
  useEffect(() => setMoreOpen(false), [routeKey]);
  const pendingCount = pending.data?.length ?? 0;
  const inMore = MORE.some((n) => n.path === section);
  const closeMore = useCallback(() => setMoreOpen(false), []);

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
    <div className="app">
      <nav className="nav" aria-label="Main">
        <div className="brand">Practy</div>
        <div className="firm">{session.firmName}</div>
        {NAV.map((n) => (
          <a key={n.path} href={href(...(n.path ? [n.path] : []))} className={section === n.path ? "active" : undefined}>
            {n.label}
            {n.path === "approvals" && !!pendingCount && <span className="count">{pendingCount}</span>}
          </a>
        ))}
        <div className="spacer" />
        <button className="secondary" onClick={() => setChatOpen((o) => !o)}>
          {chatOpen ? "Close assistant" : "Assistant"}
        </button>
        <div className="user">
          <span className="who">{session.user.displayName}</span>
          <button className="ghost" style={{ padding: 0 }} onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </nav>
      {/* Phones and narrow windows: a slim top bar and a bottom tab bar replace the sidebar (see styles.css). */}
      <header className="topbar">
        <span className="brand">Practy</span>
        <span className="where">{NAV.find((n) => n.path === section)?.label}</span>
      </header>
      <main className="main">{page}</main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((n) => (
          <a key={n.path} href={href(...(n.path ? [n.path] : []))} className={section === n.path ? "active" : undefined} aria-current={section === n.path ? "page" : undefined}>
            {ICONS[n.path]}
            <span>{n.label}</span>
            {n.path === "approvals" && !!pendingCount && <span className="count">{pendingCount}</span>}
          </a>
        ))}
        <button type="button" className={inMore ? "active" : undefined} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}>
          {ICONS.more}
          <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <MoreSheet
          session={session}
          section={section}
          onClose={closeMore}
          onAssistant={() => {
            setMoreOpen(false);
            setChatOpen(true);
          }}
        />
      )}
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
