import type { ReactNode } from "react";

interface ErrorStateProps {
  title?: string;
  message: string;
  detail?: string;
  onRetry?: () => void;
  retrying?: boolean;
  actions?: ReactNode;
}

export function ErrorState({ title = "Something went wrong", message, detail, onRetry, retrying, actions }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <h2 className="error-state__title">{title}</h2>
      <p className="error-state__message">{message}</p>
      {detail && <p className="error-state__detail">{detail}</p>}
      {(onRetry || actions) && (
        <div className="error-state__actions">
          {onRetry && (
            <button type="button" className="button" onClick={onRetry} disabled={retrying}>
              {retrying ? "Retrying…" : "Try again"}
            </button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
