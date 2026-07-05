export type LeadsNovosRule = {
  name: string;
  keywords: string[];
  reply: string;
};

export const LEADS_NOVOS_RULES: LeadsNovosRule[] = [
  {
    name: 'greeting',
    keywords: ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite'],
    reply: 'Oi! Sou a Tawany, da Clinica QARA. Como posso te ajudar?',
  },
  {
    name: 'price',
    keywords: ['valor', 'preco', 'quanto custa', 'consulta custa'],
    reply: 'Os valores variam conforme o profissional e a unidade. Me diga qual especialidade ou medico voce procura que eu direciono certinho.',
  },
  {
    name: 'address',
    keywords: ['endereco', 'onde fica', 'localizacao', 'unidade'],
    reply: 'A QARA atende em Copacabana, Barra da Tijuca, Itaim Bibi em Sao Paulo e teleconsulta. Qual unidade voce quer?',
  },
  {
    name: 'hours',
    keywords: ['horario', 'funcionamento', 'abre', 'fecha'],
    reply: 'O atendimento presencial costuma ser de segunda a sexta, 08h as 21h, e sabado, 08h as 13h. Para marcar, me diga o melhor dia ou periodo.',
  },
  {
    name: 'insurance',
    keywords: ['convenio', 'plano', 'reembolso', 'particular'],
    reply: 'A QARA atende particular, mas emite nota fiscal para pedido de reembolso ao convenio quando o paciente desejar.',
  },
  {
    name: 'parking',
    keywords: ['estacionamento', 'vaga', 'garagem'],
    reply: 'Em Copacabana ha vaga para pacientes com autorizacao previa. Na Barra ha estacionamento rotativo. Para qual unidade voce vem?',
  },
  {
    name: 'booking',
    keywords: ['agendar', 'marcar consulta', 'marcar uma consulta', 'quero consulta', 'quero marcar'],
    reply: 'Claro. Para eu direcionar, qual melhor dia ou período para você?',
  },
];

export const LEADS_NOVOS_RISK_KEYWORDS = [
  'foto',
  'diagnostico',
  'diagnosticar',
  'prescricao',
  'remedio',
  'pinta',
  'sinal',
  'melanoma',
  'cancer',
  'sangrou',
  'sangramento',
  'dor intensa',
  'febre',
  'pus',
  'secrecao',
  'pos operatorio',
  'pos-operatorio',
  'reclamacao',
  'processo',
  'advogado',
];
