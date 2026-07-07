import type { Metadata } from 'next';
import Link from 'next/link';
import { SidebarNav } from './sidebar-nav';
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
            <SidebarNav />
            <div className="sidebar-footer">
              <span className="user-avatar" aria-hidden="true">EQ</span>
              <div className="user-meta">
                <strong>Equipe QARA</strong>
                <span>
                  <span className="status-dot" aria-hidden="true" />
                  Aprovação humana ativa
                </span>
              </div>
            </div>
          </aside>
          <div className="content-shell">{children}</div>
        </div>
      </body>
    </html>
  );
}
