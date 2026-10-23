import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { useAuth, useCurrentUser } from "../auth/authContext";
import { roleLabels } from "../auth/permissions";
import { paths } from "../routes/paths";
import { ApiStatusBadge } from "./ApiStatusBadge";

interface TopbarProps {
  onMenuClick: () => void;
  menuOpen: boolean;
}

export function Topbar({ onMenuClick, menuOpen }: TopbarProps) {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const logoutMutation = useMutation({
    mutationFn: logout,
    // Land on a clean login page rather than one that returns to this screen.
    onSuccess: () => void navigate(paths.login, { replace: true }),
  });

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar__menu"
        onClick={onMenuClick}
        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={menuOpen}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div className="topbar__spacer" />
      <ApiStatusBadge />
      <Link to={paths.account} className="user-chip" title="Your account">
        <span className="user-chip__avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="user-chip__text">
          <span className="user-chip__name">{user.name}</span>
          <span className="user-chip__role">{roleLabels[user.role]}</span>
        </span>
      </Link>
      <button
        type="button"
        className="button button--ghost"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
      >
        {logoutMutation.isPending ? "Signing out…" : "Sign out"}
      </button>
    </header>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}
