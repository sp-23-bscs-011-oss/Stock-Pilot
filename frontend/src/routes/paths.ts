export const paths = {
  dashboard: "/",
  products: "/products",
  inventory: "/inventory",
  suppliers: "/suppliers",
  purchases: "/purchases",
  pos: "/pos",
  sales: "/sales",
  reports: "/reports",
  staff: "/staff",
  settings: "/settings",
  account: "/account",
  login: "/login",
  setup: "/setup",
  changePassword: "/change-password",
} as const;

export const supplierPath = (id: string) => `${paths.suppliers}/${id}`;
export const purchaseOrderPath = (id: string) => `${paths.purchases}/${id}`;
export const editPurchaseOrderPath = (id: string) => `${paths.purchases}/${id}/edit`;
/** Optionally preselects a supplier, e.g. from the supplier's page. */
export const newPurchaseOrderPath = (supplierId?: string) =>
  `${paths.purchases}/new${supplierId ? `?supplier=${supplierId}` : ""}`;

export interface NavItem {
  label: string;
  to: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [{ label: "Dashboard", to: paths.dashboard }],
  },
  {
    title: "Catalog & Stock",
    items: [
      { label: "Products", to: paths.products },
      { label: "Inventory", to: paths.inventory },
      { label: "Suppliers", to: paths.suppliers },
      { label: "Purchases", to: paths.purchases },
    ],
  },
  {
    title: "Selling",
    items: [
      { label: "Point of Sale", to: paths.pos },
      { label: "Sales", to: paths.sales },
      { label: "Reports", to: paths.reports },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Staff", to: paths.staff },
      { label: "Settings", to: paths.settings },
    ],
  },
];
