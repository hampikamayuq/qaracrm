import { PlaceholderPage } from '../placeholder-page';

export default function TasksPage() {
  return (
    <PlaceholderPage
      eyebrow="Follow-up"
      title="Tarefas"
      description="Fila de retornos, pendencias humanas e proximas acoes da equipe."
      items={['Prioridade e vencimento', 'Responsavel', 'Vinculo com lead, paciente ou conversa']}
    />
  );
}
