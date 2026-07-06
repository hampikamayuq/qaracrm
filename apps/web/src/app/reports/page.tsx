import { PlaceholderPage } from '../placeholder-page';

export default function ReportsPage() {
  return (
    <PlaceholderPage
      eyebrow="Gestao"
      title="Relatorios"
      description="Indicadores minimos para acompanhar volume, conversao, tempo de resposta e uso da Tawany."
      items={['Conversas por canal', 'Leads por etapa', 'Sugestoes aprovadas e rejeitadas']}
    />
  );
}
