import { useEffect, useState } from 'react';

// Store the request key with the answer so an old run/client can never flash
// on screen, including the render before effect cleanup.
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              error instanceof Error
                ? error.message
                : 'Не удалось загрузить данные.',
          });
      });
    return () => controller.abort();
    // The key includes every input to the loader. Inline loader identity is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  const current = result?.key === key ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !!key && !current,
    retry: () => {
      setResult(undefined);
      setRevision((value) => value + 1);
    },
  };
}
