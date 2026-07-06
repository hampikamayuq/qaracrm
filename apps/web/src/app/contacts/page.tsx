import { PlaceholderPage } from '../placeholder-page';

export default function ContactsPage() {
  return (
    <PlaceholderPage
      eyebrow="Relacionamento"
      title="Contatos"
      description="Base unica para leads, pacientes e responsaveis. Esta tela vai concentrar dados de contato, tags e historico recente."
      items={['Busca por nome ou telefone', 'Tags e origem do lead', 'Atalho para Inbox e Pipeline']}
    />
  );
}
