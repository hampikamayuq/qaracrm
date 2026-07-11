import { PlaceholderPage } from '../placeholder-page';

export default function SettingsPage() {
  return (
    <PlaceholderPage
      eyebrow="Sistema"
      title="Configuracoes"
      description="Configuracoes operacionais do CRM, acessos, canais e preferencias da clinica."
      items={['Usuarios e permissoes', 'Canais de atendimento — disponivel em Admin > Canais', 'Preferencias de operacao']}
    />
  );
}
