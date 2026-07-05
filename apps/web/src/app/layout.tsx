import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox, KanbanSquare, LogIn } from 'lucide-react';
import './globals.css';

export const metadata: Metadata = {
  title: 'QARA CRM',
  description: 'Gestao de relacionamento da Clinica QARA',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="shell">
          <nav className="topbar">
            <Link className="brand" href="/inbox">QARA CRM</Link>
            <Link className="navlink" href="/inbox"><Inbox size={17} />Inbox</Link>
            <Link className="navlink" href="/pipeline"><KanbanSquare size={17} />Pipeline</Link>
            <Link className="navlink" href="/login"><LogIn size={17} />Login</Link>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
