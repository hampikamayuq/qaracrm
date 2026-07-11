'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useLiveEvents } from '@/lib/use-live-events';

// Fora do inbox: notificação leve via SSE — badge "(N)" no título da aba
// enquanto ela está em segundo plano, mesmo padrão do notifications.ts do
// inbox. No /inbox este listener fica desligado: a página tem a própria
// integração (som + badge + refresh da lista).
export function LiveTitleBadge() {
  const pathname = usePathname();
  const onInbox = pathname?.startsWith('/inbox') ?? false;
  const unseenRef = useRef(0);
  const baseTitleRef = useRef('');

  useEffect(() => {
    baseTitleRef.current = document.title;
    const clearUnseen = () => {
      if (unseenRef.current === 0) return;
      unseenRef.current = 0;
      document.title = baseTitleRef.current;
    };
    const onVisible = () => {
      if (!document.hidden) clearUnseen();
    };
    window.addEventListener('focus', clearUnseen);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', clearUnseen);
      document.removeEventListener('visibilitychange', onVisible);
      document.title = baseTitleRef.current;
    };
  }, []);

  useLiveEvents(useCallback(() => {
    if (!document.hidden) return;
    unseenRef.current += 1;
    document.title = `(${unseenRef.current}) ${baseTitleRef.current}`;
  }, []), !onInbox);

  return null;
}
