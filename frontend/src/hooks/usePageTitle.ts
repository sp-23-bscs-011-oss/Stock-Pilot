import { useEffect } from "react";
import { env } from "../config/env";

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${env.appName}`;
  }, [title]);
}
