import type { Metadata } from 'next';
import Link from 'next/link';
import { SidebarNav } from './sidebar-nav';
import { SidebarFooter } from './sidebar-footer';
import { CommandPalette } from './command-palette';
import './globals.css';

export const metadata: Metadata = {
  title: 'QARA CRM',
  description: 'Gestão de relacionamento da Clínica QARA',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="app-shell">
          <aside className="sidebar" aria-label="Barra lateral">
            <Link className="brand-block" href="/">
              <span className="brand-mark" aria-hidden="true">Q</span>
              <span>
                <strong>QARA CRM</strong>
                <small>Clínica dermatológica</small>
              </span>
            </Link>
            <CommandPalette />
            <SidebarNav />
            <SidebarFooter />
          </aside>
          <div className="content-shell">{children}</div>
        </div>
      </body>
    </html>
  );
}
