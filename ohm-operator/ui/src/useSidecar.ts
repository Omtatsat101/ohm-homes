import { useCallback, useEffect, useState } from "react";

export function useSidecar<T>(load: () => Promise<T>, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  useEffect(() => {
    refresh();
    if (!intervalMs) return;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}
