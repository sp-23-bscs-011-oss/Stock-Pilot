import { Spinner } from "./Spinner";

export function PageLoader({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="page-loader">
      <Spinner size={28} label={message} />
      <p>{message}</p>
    </div>
  );
}
