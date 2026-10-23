import type { ReactNode } from "react";
import { Alert } from "./Alert";
import { Dialog } from "./Dialog";
import { Spinner } from "./Spinner";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  tone?: "default" | "danger";
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  pendingLabel = "Working…",
  tone = "default",
  pending = false,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title} busy={pending} size="sm">
      <div className="dialog__content">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="dialog__text">{children}</div>
      </div>
      <footer className="dialog__footer">
        <button type="button" className="button button--ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button
          type="button"
          className={tone === "danger" ? "button button--danger-solid" : "button"}
          onClick={onConfirm}
          disabled={pending}
          autoFocus
        >
          {pending && <Spinner size={14} label={pendingLabel} />}
          {pending ? pendingLabel : confirmLabel}
        </button>
      </footer>
    </Dialog>
  );
}
