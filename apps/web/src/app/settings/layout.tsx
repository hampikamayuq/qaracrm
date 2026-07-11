import { SettingsTabs } from './settings-tabs';

// Todas as telas de /settings/* compartilham a barra de abas; cada página
// continua dona do próprio <main className="page">.
export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="settings-shell">
      <SettingsTabs />
      {children}
    </div>
  );
}
