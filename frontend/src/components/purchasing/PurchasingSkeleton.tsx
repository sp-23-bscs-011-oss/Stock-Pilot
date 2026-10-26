import { Skeleton } from "../ui/skeleton";

export function PurchasingSkeleton({ message = "Loading purchasing data…" }: { message?: string }) {
  return <div role="status" aria-busy="true" className="card tw:space-y-4 tw:p-6">
    <span className="visually-hidden">{message}</span>
    <Skeleton className="tw:h-7 tw:w-48" />
    {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="tw:h-12 tw:w-full" />)}
  </div>;
}
