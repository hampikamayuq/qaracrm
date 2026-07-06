import { PlaceholderPage } from '../../placeholder-page';

export default function AiSettingsPage() {
  return (
    <PlaceholderPage
      eyebrow="IA"
      title="Configuracoes de IA"
      description="Controle de modelos, modo human approval e regras para quando a Tawany deve pedir revisao humana."
      items={['Modo shadow, aprovacao humana ou autopilot', 'Modelos principal e fallback', 'Politicas de risco']}
    />
  );
}
