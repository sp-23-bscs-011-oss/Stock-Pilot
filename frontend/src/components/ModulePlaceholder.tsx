import { usePageTitle } from "../hooks/usePageTitle";
import { PageHeader } from "./PageHeader";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  /** Capabilities planned for this module; shown so the empty page explains itself. */
  planned: string[];
}

export function ModulePlaceholder({ title, description, planned }: ModulePlaceholderProps) {
  usePageTitle(title);

  return (
    <section>
      <PageHeader title={title} description={description} />
      <div className="placeholder-card">
        <p className="placeholder-card__eyebrow">Not built yet</p>
        <p className="placeholder-card__lead">
          This module is scaffolded and routed. Its features arrive in an upcoming phase:
        </p>
        <ul className="placeholder-card__list">
          {planned.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
