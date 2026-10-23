import { ModulePlaceholder } from "../components/ModulePlaceholder";

export default function ReportsPage() {
  return (
    <ModulePlaceholder
      title="Reports"
      description="Understand how the business is performing."
      planned={[
        "Sales by period, product and staff member",
        "Inventory valuation",
        "Profit and margin reports",
        "CSV export",
      ]}
    />
  );
}
