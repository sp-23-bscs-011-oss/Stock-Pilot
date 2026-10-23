import type { ComponentType } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { GuestOnly, RequireAuth, RequireRole } from "../auth/guards";
import { routeAccess } from "../auth/permissions";
import { PageLoader } from "../components/PageLoader";
import { RouteErrorPage } from "../components/RouteErrorPage";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { paths } from "./paths";

type PageModule = () => Promise<{ default: ComponentType }>;

// Each page is code-split; React Router resolves the module before rendering the route.
const page = (load: PageModule) => async () => ({
  Component: (await load()).default,
});

/**
 * A page restricted to the roles listed for its path in `routeAccess`. `subpages` (relative
 * paths such as ":id") share the same rule.
 */
const guarded = (path: string, load: PageModule, subpages: Record<string, PageModule> = {}): RouteObject => {
  const roles = routeAccess[path];
  if (!roles) throw new Error(`No access rule defined for ${path}`);
  return {
    path,
    element: <RequireRole roles={roles} />,
    children: [
      { index: true, lazy: page(load) },
      ...Object.entries(subpages).map(([subpath, loadSubpage]) => ({ path: subpath, lazy: page(loadSubpage) })),
    ],
  };
};

export const router = createBrowserRouter([
  {
    // Pathless root so every route shares one error boundary and initial-load fallback.
    errorElement: <RouteErrorPage />,
    HydrateFallback: PageLoader,
    children: [
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            errorElement: <RouteErrorPage />,
            children: [
              { index: true, lazy: page(() => import("../pages/DashboardPage")) },
              guarded(paths.products, () => import("../pages/ProductsPage")),
              guarded(paths.inventory, () => import("../pages/InventoryPage")),
              guarded(paths.suppliers, () => import("../pages/SuppliersPage"), {
                ":id": () => import("../pages/SupplierDetailPage"),
              }),
              guarded(paths.purchases, () => import("../pages/PurchasesPage"), {
                new: () => import("../pages/PurchaseOrderEditorPage"),
                ":id": () => import("../pages/PurchaseOrderDetailPage"),
                ":id/edit": () => import("../pages/PurchaseOrderEditorPage"),
              }),
              guarded(paths.pos, () => import("../pages/PosPage")),
              guarded(paths.sales, () => import("../pages/SalesPage")),
              guarded(paths.reports, () => import("../pages/ReportsPage")),
              guarded(paths.staff, () => import("../pages/StaffPage")),
              guarded(paths.settings, () => import("../pages/SettingsPage")),
              { path: paths.account, lazy: page(() => import("../pages/AccountPage")) },
              { path: "*", lazy: page(() => import("../pages/NotFoundPage")) },
            ],
          },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          {
            element: <GuestOnly />,
            children: [
              { path: paths.login, lazy: page(() => import("../pages/LoginPage")) },
              { path: paths.setup, lazy: page(() => import("../pages/SetupPage")) },
            ],
          },
          {
            element: <RequireAuth />,
            children: [{ path: paths.changePassword, lazy: page(() => import("../pages/ChangePasswordPage")) }],
          },
        ],
      },
    ],
  },
]);
