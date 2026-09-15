import { useCallback, useEffect, useRef } from 'react';

export function useAbortScope() {
  const controllers = useRef(new Set<AbortController>());
  useEffect(
    () => () => {
      for (const controller of controllers.current) {
        controller.abort(new DOMException('Route changed', 'AbortError'));
      }
      controllers.current.clear();
    },
    [],
  );

  return useCallback(
    async <T>(operation: (signal: AbortSignal) => Promise<T>) => {
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        return await operation(controller.signal);
      } finally {
        controllers.current.delete(controller);
      }
    },
    [],
  );
}

export function saveBrowserDownload(blob: Blob, filename: string): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
