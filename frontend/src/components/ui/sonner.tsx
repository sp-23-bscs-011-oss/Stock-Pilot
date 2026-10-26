import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return <Sonner position="bottom-right" closeButton toastOptions={{ style: {
    background: "var(--surface)", color: "var(--text-strong)", borderColor: "var(--border)",
  } }} />;
}
