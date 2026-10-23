import { Outlet } from "react-router";
import { Brand } from "../components/Brand";

export function AuthLayout() {
  return (
    <div className="auth-shell">
      <div className="auth-shell__panel">
        <Brand />
        <Outlet />
      </div>
    </div>
  );
}
