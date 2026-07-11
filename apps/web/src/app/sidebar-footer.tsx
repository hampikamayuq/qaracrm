'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { api, type AiOperationMode } from '@/lib/api';

const MODE_SHORT: Record<AiOperationMode, string> = {
  shadow: 'Tawany em shadow',
  human_approval: 'Aprovação humana ativa',
  recomendacoes: 'Aprovação humana ativa',
  autopilot: 'Tawany em autopilot',
  hibrido: 'Tawany em modo híbrido',
};

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'EQ';

export function SidebarFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);
  const [mode, setMode] = useState<AiOperationMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [me, ai] = await Promise.all([api.getMe(), api.getAiSettings()]);
        if (cancelled) return;
        if (me) setUser({ name: me.name, role: me.role });
        if (ai) setMode(ai.mode);
      } catch {
        // API fora: mantém o fallback estático do footer.
      }
    })();
    return () => {
      cancelled = true;
    };
    // pathname: revalida ao navegar (ex.: depois de salvar o modo em /settings/ai)
  }, [pathname]);

  const logout = () => {
    sessionStorage.removeItem('auth_token');
    localStorage.removeItem('auth_token');
    router.push('/login');
  };

  return (
    <div className="sidebar-footer">
      <span className="user-avatar" aria-hidden="true">{initials(user?.name ?? 'Equipe QARA')}</span>
      <div className="user-meta">
        <strong>{user?.name ?? 'Equipe QARA'}</strong>
        <span>
          <span className={`status-dot ${mode === 'autopilot' ? 'status-dot-ai' : ''}`} aria-hidden="true" />
          {mode ? MODE_SHORT[mode] : '—'}
        </span>
      </div>
      <button className="icon-btn sidebar-logout" type="button" onClick={logout} aria-label="Sair" title="Sair">
        <LogOut size={15} />
      </button>
    </div>
  );
}
