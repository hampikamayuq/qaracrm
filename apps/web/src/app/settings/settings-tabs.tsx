'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/settings/channels', label: 'Canais' },
  { href: '/settings/knowledge', label: 'Conhecimento' },
  { href: '/settings/ai', label: 'IA' },
  { href: '/settings/templates', label: 'Templates' },
  { href: '/settings/users', label: 'Usuários' },
  { href: '/settings/audit', label: 'Auditoria' },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="settings-tabs" aria-label="Seções de configuração">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            className={`settings-tab ${active ? 'settings-tab-active' : ''}`}
            href={tab.href}
            key={tab.href}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
