import { useEffect, useRef, useState } from "react";

const NOTICE_VISIBLE_MS = 3_400;
const NOTICE_EXIT_MS = 220;
const NOTICE_MAX = 4;

interface NoticeItem {
  id: number;
  message: string;
  closing: boolean;
}

export function useNotice() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Map<number, number>>(new Map());

  function dismiss(id: number) {
    setNotices((current) => current.map((item) => item.id === id ? { ...item, closing: true } : item));
    const exitTimer = window.setTimeout(() => {
      timersRef.current.delete(id);
      setNotices((current) => current.filter((item) => item.id !== id));
    }, NOTICE_EXIT_MS);
    timersRef.current.set(id, exitTimer);
  }

  function showNotice(message: string) {
    const id = ++counterRef.current;
    setNotices((current) => [...current, { id, message, closing: false }].slice(-NOTICE_MAX));
    const visibleTimer = window.setTimeout(() => dismiss(id), NOTICE_VISIBLE_MS);
    timersRef.current.set(id, visibleTimer);
  }

  useEffect(() => {
    const timers = timersRef.current;
    return () => { timers.forEach((timer) => window.clearTimeout(timer)); timers.clear(); };
  }, []);

  return { notices, showNotice };
}
