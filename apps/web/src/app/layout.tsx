import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarChart3,
  Bot,
  CalendarDays,
  ContactRound,
  FileText,
  Inbox,
  KanbanSquare,
  LogIn,
  Settings,
  BookOpen,
  ListTodo,
} from 'lucide-react';
import './globals.css';

export const metadata: Metadata = {
  title: 'QARA CRM',
  description: 'Gestao de relacionamento da Clinica QARA',
};

const primaryNav = [
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/contacts', label: 'Contatos', icon: ContactRound },
  { href: '/calendar', label: 'Agenda', icon: CalendarDays },
  { href: '/quotes', label: 'Orcamentos', icon: FileText },
  { href: '/tasks', label: 'Tarefas', icon: ListTodo },
  { href: '/reports', label: 'Relatorios', icon: BarChart3 },
];

const settingsNav = [
  { href: '/settings', label: 'Configuracoes', icon: Settings },
  { href: '/settings/knowledge', label: 'Conhecimento', icon: BookOpen },
  { href: '/settings/ai', label: 'IA', icon: Bot },
  { href: '/login', label: 'Login', icon: LogIn },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="app-shell">
          <aside className="sidebar" aria-label="Navegacao principal">
            <Link className="brand-block" href="/inbox">
              <span className="brand-mark">Q</span>
              <span>
                <strong>QARA CRM</strong>
                <small>Clinica dermatologica</small>
              </span>
            </Link>
            <nav className="side-nav">
              <div className="nav-group-label">Operacao</div>
              {primaryNav.map((item) => {
                const Icon = item.icon;
                return (
                  <Link className="navlink" href={item.href} key={item.href}>
                    <Icon size={17} />
                    {item.label}
                  </Link>
                );
              })}
              <div className="nav-group-label">Admin</div>
              {settingsNav.map((item) => {
                const Icon = item.icon;
                return (
                  <Link className="navlink" href={item.href} key={item.href}>
                    <Icon size={17} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="sidebar-footer">
              <span className="status-dot" />
              Human approval ativo
            </div>
          </aside>
          <div className="content-shell">
            <header className="mobile-topbar">
              <Link className="brand-mini" href="/inbox">QARA CRM</Link>
              <Link className="navlink navlink-compact" href="/login"><LogIn size={17} />Login</Link>
            </header>
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
