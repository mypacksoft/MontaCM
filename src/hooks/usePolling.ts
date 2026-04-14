import { useEffect, useRef } from 'react';

export function usePolling(callback: () => void, interval: number, enabled = true) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    savedCallback.current();
    const id = setInterval(() => savedCallback.current(), interval);
    return () => clearInterval(id);
  }, [interval, enabled]);
}
