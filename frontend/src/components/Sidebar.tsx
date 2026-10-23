import { NavLink } from "react-router";
import { useCurrentUser } from "../auth/authContext";
import { canAccess } from "../auth/permissions";
import { navSections } from "../routes/paths";
import { Brand } from "./Brand";

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { role } = useCurrentUser();
  // Only show what this role can open; sections left empty are dropped.
  const sections = navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => canAccess(role, item.to)) }))
    .filter((section) => section.items.length > 0);

  return (
    <aside className="sidebar" aria-label="Primary">
      <div className="sidebar__brand">
        <Brand />
      </div>
      <nav className="sidebar__nav">
        {sections.map((section) => (
          <div key={section.title} className="sidebar__section">
            <p className="sidebar__section-title">{section.title}</p>
            <ul>
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) => (isActive ? "sidebar__link is-active" : "sidebar__link")}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
