import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** While true, Escape, the close button and backdrop clicks are ignored (e.g. mid-save). */
  busy?: boolean;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

/**
 * A modal built on the native <dialog> element, which provides focus trapping, Escape to
 * close, inert background content and focus restoration without extra code. Children are
 * mounted only while open, so forms inside start fresh each time.
 */
export function Dialog({ open, onClose, title, description, busy = false, size = "md", children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape key: keep the dialog under React's control.
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        // A click on the <dialog> itself (not its content) is a click on the backdrop.
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      {open && (
        <div className="dialog__body">
          <header className="dialog__header">
            <div>
              <h2 id={titleId} className="dialog__title">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="dialog__description">
                  {description}
                </p>
              )}
            </div>
            <button type="button" className="dialog__close" onClick={onClose} disabled={busy} aria-label="Close">
              ×
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
