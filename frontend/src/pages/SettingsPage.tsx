import { PageHeader } from "../components/PageHeader";
import { StoresSection } from "../components/settings/StoresSection";
import { usePageTitle } from "../hooks/usePageTitle";

export default function SettingsPage() {
  usePageTitle("Settings");

  return (
    <section>
      <PageHeader title="Settings" description="Configure StockPilot for your business." />
      <div className="card-stack">
        <StoresSection />
        <div className="placeholder-card">
          <p className="placeholder-card__eyebrow">Coming later</p>
          <ul className="placeholder-card__list">
            <li>Business profile</li>
            <li>Tax rates and currency</li>
            <li>Receipt templates</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
