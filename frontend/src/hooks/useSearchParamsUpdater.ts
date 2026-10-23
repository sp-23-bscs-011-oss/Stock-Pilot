import { useCallback } from "react";
import { useSearchParams } from "react-router";

export type ParamChanges = Record<string, string | number | undefined>;

/**
 * List pages keep their filters in the URL. This returns the current params and an updater
 * that merges changes (empty values remove the key). Any change that doesn't set `page`
 * returns to the first page, since the old page number no longer means anything.
 */
export function useSearchParamsUpdater() {
  const [searchParams, setSearchParams] = useSearchParams();

  const updateParams = useCallback(
    (changes: ParamChanges) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined || value === "") next.delete(key);
            else next.set(key, String(value));
          }
          if (!("page" in changes)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [searchParams, updateParams] as const;
}
