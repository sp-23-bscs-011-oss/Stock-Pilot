import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";
import { healthService } from "../services/healthService";

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => healthService.getHealth(signal),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
