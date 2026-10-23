import { useState } from "react";
import { Outlet, useLocation, useNavigation } from "react-router";
import { Sidebar } from "../components/Sidebar";
import { Topbar } from "../components/Topbar";

export function AppLayout() {
  const navigation = useNavigation();
  const { pathname } = useLocation();
  // Remember which page the mobile drawer was opened on, so any navigation closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const sidebarOpen = drawerPath === pathname;
  const closeSidebar = () => setDrawerPath(null);

  return (
    <div className="app-shell" data-sidebar-open={sidebarOpen}>
      <Sidebar onNavigate={closeSidebar} />
      <div className="app-shell__backdrop" onClick={closeSidebar} aria-hidden="true" />
      <div className="app-shell__main">
        <Topbar onMenuClick={() => setDrawerPath(sidebarOpen ? null : pathname)} menuOpen={sidebarOpen} />
        {navigation.state === "loading" && <div className="route-progress" role="progressbar" aria-label="Loading page" />}
        <main className="app-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
