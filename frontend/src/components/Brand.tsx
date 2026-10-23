import { env } from "../config/env";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand__mark" aria-hidden="true">
        SP
      </span>
      <span className="brand__name">{env.appName}</span>
    </div>
  );
}
