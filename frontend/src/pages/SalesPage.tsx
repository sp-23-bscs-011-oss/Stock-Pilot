import { ModulePlaceholder } from "../components/ModulePlaceholder";

export default function SalesPage() {
  return (
    <ModulePlaceholder
      title="Sales"
      description="Review completed transactions."
      planned={[
        "Sales history with filters",
        "Transaction details and receipts",
        "Refunds and returns",
      ]}
    />
  );
}
