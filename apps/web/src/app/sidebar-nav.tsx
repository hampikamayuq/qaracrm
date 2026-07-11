'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  ContactRound,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListTodo,
  Settings,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';

type NavItem = { href: string; label: string; icon: LucideIcon; badgeKey?: 'aguardandoResposta' | 'followupsAtrasados' };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operação',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/inbox', label: 'Inbox', icon: Inbox, badgeKey: 'aguardandoResposta' },
      { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
      { href: '/contacts', label: 'Contatos', icon: ContactRound },
      { href: '/calendar', label: 'Agenda', icon: CalendarDays },
      { href: '/quotes', label: 'Orçamentos', icon: FileText },
      { href: '/tasks', label: 'Tarefas', icon: ListTodo, badgeKey: 'followupsAtrasados' },
      { href: '/bots', label: 'Bots', icon: Bot },
      { href: '/reports', label: 'Relatórios', icon: BarChart3 },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/settings', label: 'Configurações', icon: Settings },
      { href: '/settings/channels', label: 'Canais', icon: Smartphone },
      { href: '/settings/knowledge', label: 'Conhecimento', icon: BookOpen },
      { href: '/settings/ai', label: 'IA', icon: Sparkles },
    ],
  },
];

const BADGE_REFRESH_MS = 60_000;

export function SidebarNav() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<{ aguardandoResposta: number; followupsAtrasados: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await api.getSidebarCounts();
      if (!cancelled) setCounts(data);
    };
    void load();
    const timer = window.setInterval(() => void load(), BADGE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pathname]);

  const activeHref = NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="side-nav" aria-label="Navegação principal">
      {NAV_GROUPS.map((group) => (
        <Fragment key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === activeHref;
            const badge = item.badgeKey && counts ? counts[item.badgeKey] : 0;
            return (
              <Link
                className={`navlink ${isActive ? 'navlink-active' : ''}`}
                href={item.href}
                key={item.href}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={16} strokeWidth={isActive ? 2.2 : 2} />
                {item.label}
                {badge > 0 ? (
                  <span className="nav-badge" aria-label={`${badge} pendentes`}>{badge > 99 ? '99+' : badge}</span>
                ) : null}
              </Link>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
