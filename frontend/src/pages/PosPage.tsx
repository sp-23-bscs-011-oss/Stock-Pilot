import { ModulePlaceholder } from "../components/ModulePlaceholder";

export default function PosPage() {
  return (
    <ModulePlaceholder
      title="Point of Sale"
      description="Ring up customer sales at the counter."
      planned={[
        "Barcode and keyword product lookup",
        "Cart with discounts and taxes",
        "Cash, card and split payments",
        "Printable receipts",
      ]}
    />
  );
}
