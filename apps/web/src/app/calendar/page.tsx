import { PlaceholderPage } from '../placeholder-page';

export default function CalendarPage() {
  return (
    <PlaceholderPage
      eyebrow="Agenda"
      title="Agenda"
      description="Visao operacional de consultas, lembretes D-1 e disponibilidade por profissional."
      items={['Consultas por dia', 'Status confirmado, remarcado ou faltou', 'Lembretes automaticos quando habilitados']}
    />
  );
}
