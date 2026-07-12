const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export type ApiResponse<T> = { success: boolean; data?: T; error?: string };

// Estado derivado de quem conduz a conversa (badge do inbox)
export type AgentState = 'tawany_ativa' | 'aguardando_humano' | 'humano_assumiu';

export type Conversation = {
  id: string;
  status: string;
  needsHuman: boolean;
  agentState?: AgentState;
  handoffReason?: string | null;
  channel?: string | null;
  // Número extra via QR (instância Evolution); null/ausente = canal oficial.
  instance?: { id: string; name: string } | null;
  lastMessageAt?: string | null;
  updatedAt: string;
  lead?: {
    id: string;
    name: string;
    phone?: string | null;
    score?: number;
    tags?: string[];
    temperature?: string | null;
  };
  messages?: Array<{ id?: string; body: string; sentAt: string; direction?: string }>;
  aiSuggestions?: Array<{ id: string; body: string; riskLevel: string | null; status?: string }>;
};

export type Lead = {
  id: string;
  name: string;
  score: number;
  tags?: string[];
};

export type PipelineLead = {
  id: string;
  name: { firstName: string; lastName: string } | null;
  stage: string;
  score: number;
  whatsapp: { primaryPhoneNumber: string | null } | null;
  email: { primaryEmail: string | null } | null;
  source: string | null;
  intent: string | null;
  tags: string[];
  temperature: string | null;
  pipeline: string | null;
  lostReason: string | null;
  stageEnteredAt: string | null;
  daysInStage: number;
  isStalled: boolean;
  notes: string | null;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
};

export type TimelineItem = {
  id: string;
  type: 'stage_change' | 'pipeline_change' | 'note' | 'task' | 'appointment' | 'messages' | 'suggestion' | 'bot' | 'budget';
  at: string;
  title: string;
  detail?: string;
  byName?: string | null;
};

export type FeedPeriod = '24h' | '7d';

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'DONE' | 'NO_SHOW' | 'CANCELLED';

export type Appointment = {
  id: string;
  scheduledAt: string;
  endAt: string | null;
  status: string;
  notes: string | null;
  leadId: string | null;
  patientId: string | null;
  professionalId: string | null;
  serviceId: string | null;
  unitId: string | null;
  lead: { id: string; name: string; phone: string | null } | null;
  patient: { id: string; name: string } | null;
  professional: { id: string; name: string; specialty: string } | null;
  unit: { id: string; name: string } | null;
};

export type Professional = { id: string; name: string; specialty: string };

export type ClinicUnit = { id: string; name: string; city: string | null };

export type TaskCategory = 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'NO_DATE';

export type TaskItem = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  category: TaskCategory | null;
  lead: { id: string; name: string } | null;
  conversation: { id: string } | null;
  assignedTo: { id: string; name: string } | null;
};

export type QuickReply = {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  active: boolean;
};

export type BudgetStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

// amount/entryAmount chegam como string (Decimal do Prisma serializado em JSON).
export type Budget = {
  id: string;
  title: string;
  amount: string;
  entryAmount: string | null;
  installments: number;
  status: BudgetStatus;
  expiresAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  notes: string | null;
  totalPaid: number;
  balance: number;
  createdAt: string;
  leadId: string | null;
  patientId: string | null;
  serviceId: string | null;
  lead: { id: string; name: string; phone: string | null } | null;
  patient: { id: string; name: string } | null;
  service: { id: string; name: string } | null;
};

export type BudgetInput = {
  title: string;
  amount: number;
  entryAmount?: number | null;
  installments?: number;
  expiresAt?: string | null;
  notes?: string | null;
  leadId?: string | null;
};

// ---------------- pagamentos ----------------

export type PaymentMethod = 'CASH' | 'PIX' | 'DEBIT' | 'CREDIT' | 'BANK_TRANSFER' | 'OTHER';

export type PaymentStatus = 'PENDING' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELED' | 'REFUNDED';

// amount/cardFee chegam como string (Decimal do Prisma serializado em JSON).
export type Payment = {
  id: string;
  budgetId: string | null;
  amount: string;
  method: PaymentMethod;
  installments: number;
  cardFee: string | null;
  paidAt: string | null;
  status: PaymentStatus;
  createdAt: string;
};

export type PaymentInput = {
  budgetId: string;
  amount: number;
  method: PaymentMethod;
  installments?: number;
  cardFee?: number | null;
  status?: 'PENDING' | 'PAID' | 'PARTIALLY_PAID';
  paidAt?: string | null;
};

// ---------------- pacientes ----------------

export type Patient = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  cpf: string | null;
  birthDate: string | null;
  preferredChannel: string | null;
  lgpdConsent: boolean;
  notesAdministrative: string | null;
  leadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PatientDetail = Patient & {
  lead: { id: string; name: string; stage: string } | null;
  appointments: Array<{
    id: string;
    scheduledAt: string;
    status: string;
    value: string | null;
    professional: { name: string } | null;
    service: { name: string } | null;
  }>;
  budgets: Array<{
    id: string;
    title: string;
    amount: string;
    status: BudgetStatus;
    sentAt: string | null;
    respondedAt: string | null;
    createdAt: string;
  }>;
  timeline: TimelineItem[];
};

export type PatientInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  cpf?: string | null;
  birthDate?: string | null;
  preferredChannel?: string | null;
  lgpdConsent?: boolean;
  notesAdministrative?: string | null;
};

export type Pipeline = {
  id: string;
  name: string;
  slug: string;
  order: number;
  color: string;
};

export type PipelineStage = {
  id: string;
  name: string;
  leads: Lead[];
};

export type Tag = {
  value: string;
  label: string;
  color: string;
  category: string;
};

export type ContextualTags = {
  alerta: string[];
  pipeline: string[];
  origem: string[];
};

export type BotSummary = {
  id: string;
  name: string;
  trigger: string;
  active: boolean;
  priority: number;
  rules: number;
  createdAt: string;
  updatedAt: string;
};

export type BotAction = 'reply' | 'handoff' | 'tawany';

export type BotRuleInput = {
  terms: string[];
  responses: string[];
  action?: BotAction;
  handoffReason?: string;
};

export type BotMetrics = {
  counts: Array<{ botId: string; d7: number; d30: number }>;
  recent: Array<{
    botId: string;
    botName: string;
    conversationId: string;
    ruleIndex: number;
    action: BotAction;
    createdAt: string;
  }>;
};

export type BotDetail = {
  id: string;
  name: string;
  trigger: string;
  active: boolean;
  rules: BotRuleInput[];
  createdAt: string;
  updatedAt: string;
};

export type BotVersion = {
  id: string;
  name: string | null;
  rules: number;
  byUserId: string | null;
  byName: string | null;
  at: string;
};

export type BotTestResult = {
  matched: boolean;
  blockedByRisk?: boolean;
  botName?: string;
  ruleIndex?: number;
  action?: BotAction;
  terms?: string[];
  responses: string[];
};

export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string };

export type WhatsAppTemplate = {
  id: string;
  name: string;
  status: string; // APPROVED | PENDING | REJECTED
  category: string;
  language: string;
  header: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  rejectedReason: string | null;
};

export type ConversationDetail = Omit<Conversation, 'messages' | 'aiSuggestions' | 'lead'> & {
  classification?: unknown;
  lead: NonNullable<Conversation['lead']> & {
    email?: string | null;
    source?: string | null;
    intent?: string | null;
    nextAction?: string | null;
    stage?: { id: string; name: string } | null;
  };
  patient?: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    preferredChannel?: string | null;
    notesAdministrative?: string | null;
  } | null;
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    mediaUrl?: string | null;
    agentHandled: boolean;
    sentAt: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt?: string | null;
  }>;
  aiSuggestions: Array<{
    id: string;
    body: string;
    riskLevel: string | null;
    status?: string;
    createdAt?: string;
  }>;
  // Sugestões já enviadas (SENT/TEST_SENT) — feedback 👍/👎 nas bolhas da Tawany
  sentSuggestions?: Array<{
    id: string;
    body: string;
    status: string;
    feedback: 'UP' | 'DOWN' | null;
  }>;
};

// ---------------- knowledge vivo & IA ----------------

export type KnowledgeSection = {
  id: string;
  slug: string;
  title: string;
  content: string;
  updatedAt: string;
  updatedById: string | null;
  updatedByName: string | null;
};

// ---------------- trilha de auditoria ----------------

export type AuditEntry = {
  id: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

export type AuditLogPage = {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  entities: string[];
};

export type TawanyExample = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
};

export type ReviewQueueItem = {
  id: string;
  body: string;
  feedbackNote: string | null;
  conversationId: string;
  messageId: string | null;
  question: string | null;
  status: string;
  createdAt: string;
};

export type AiOperationMode = 'shadow' | 'human_approval' | 'recomendacoes' | 'autopilot' | 'hibrido';
export type AiSettings = {
  mode: AiOperationMode;
  shadowMode: string;
  promptVersion: string;
  autopilotIntents: string[];
};

// ---------------- usuários (gestão pelo admin) ----------------

export type UserRole = 'admin' | 'recepcao' | 'medico' | 'financeiro' | 'marketing';

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
};

export type CreateUserInput = { name: string; email: string; password: string; role: UserRole };

export type UpdateUserInput = { name?: string; role?: UserRole; active?: boolean; password?: string };

// ---------------- canais (números extras de WhatsApp via QR) ----------------

export type WhatsAppChannelStatus = 'DISCONNECTED' | 'PAIRING' | 'CONNECTED';

export type WhatsAppChannel = {
  id: string;
  name: string;
  instanceName: string;
  phoneNumber: string | null;
  status: WhatsAppChannelStatus;
  lastConnectedAt: string | null;
  createdAt: string;
};

// ---------------- dashboard ----------------

export type DashboardPeriod = '7d' | '30d' | '90d';

export type DashboardSummary = {
  leadsAtivos: number;
  aguardandoResposta: number;
  agendamentosSemana: number;
  followupsAtrasados: number;
  novosNoPeriodo: { atual: number; anterior: number; variacaoPct: number | null };
};

export type DashboardDailyPoint = { date: string; count: number };

export type DashboardFunnelStage = { stage: string; label: string; count: number };

export type DashboardLeadsPerDay = {
  series: DashboardDailyPoint[];
  previous: DashboardDailyPoint[];
};

export type DashboardSource = { source: string; count: number };

export type DashboardLossReason = { reason: string; count: number };

export type DashboardTawany = {
  perDay: DashboardDailyPoint[];
  respostas: number;
  handoffs: number;
  taxaHandoffPct: number | null;
  bloqueios: Array<{ motivo: string; count: number }>;
  latenciaMediaMs: number | null;
  fallbacks: number;
  total: number;
};

export type DashboardResponseTime = {
  medianaMin: number | null;
  mediaMin: number | null;
  conversas: number;
  medianaAnteriorMin: number | null;
  variacaoPct: number | null;
};

// Painel consolidado (GET /dashboard/overview): agregado enxuto por área.
export type DashboardOverviewAppointment = {
  id: string;
  scheduledAt: string;
  status: string;
  paciente: string | null;
  profissional: string | null;
  especialidade: string | null;
};

export type DashboardOverview = {
  comercial: {
    novosLeads: number;
    novosLeadsAnterior: number;
    novosLeadsVariacaoPct: number | null;
    porEstagio: DashboardFunnelStage[];
    conversaoPct: number | null;
  };
  atendimento: {
    conversasAbertas: number;
    aguardandoHumano: number;
    sugestoesPendentes: number;
    medianaRespostaMin: number | null;
    conversasComResposta: number;
  };
  financeiro: {
    recebido: number;
    recebidoAnterior: number;
    aReceber: number;
    taxaAceitacaoPct: number | null;
  };
  nps: {
    notaMedia: number | null;
    npsClassico: number | null;
    respondidos: number;
    enviados: number;
  };
  agenda: {
    totalHoje: number;
    confirmadas: number;
    pendentes: number;
    proximas: DashboardOverviewAppointment[];
  };
  tarefas: { abertas: number; atrasadas: number };
};

// ---------------- relatórios ----------------

export type ReportTipo = 'comercial' | 'atendimento' | 'tawany' | 'financeiro';

// period preset OU from/to (YYYY-MM-DD, máx. 366 dias) — from/to tem precedência.
export type ReportParams = { period?: DashboardPeriod; from?: string; to?: string };

export type ReportComercial = {
  leadsNovos: number;
  porEstagio: Array<{ stage: string; label: string; count: number }>;
  conversaoPct: number | null;
  porEspecialidade: Array<{ pipeline: string; count: number; convertidos: number }>;
  perdas: Array<{ reason: string; count: number }>;
  comparativo: { leadsNovos: number; conversaoPct: number | null; perdas: number };
};

export type ReportAtendimento = {
  conversasAtivas: number;
  medianaPrimeiraRespostaMin: number | null;
  mensagensRecebidas: number;
  mensagensEnviadas: number;
  tawanyVsHumano: { tawany: number; humano: number };
  comparativo: {
    conversasAtivas: number;
    medianaPrimeiraRespostaMin: number | null;
    mensagensRecebidas: number;
    mensagensEnviadas: number;
    tawanyVsHumano: { tawany: number; humano: number };
  };
};

export type ReportTawany = {
  respostas: number;
  handoffs: number;
  taxaResolucaoPct: number | null;
  bloqueios: Array<{ motivo: string; count: number }>;
  latenciaMediaMs: number | null;
  fallbacks: number;
  porDia: DashboardDailyPoint[];
  comparativo: { respostas: number; handoffs: number; taxaResolucaoPct: number | null };
};

// valores monetários já chegam calculados como number (o backend agrega o
// Decimal do Prisma e arredonda) — nada de parsing de string aqui.
export type ReportFinanceiro = {
  orcamentos: {
    total: number;
    porStatus: Array<{ status: BudgetStatus; label: string; count: number; valor: number }>;
    taxaAceitacaoPct: number | null;
    tempoMedioRespostaHoras: number | null;
    valorMedio: number | null;
    comparativo: { total: number; taxaAceitacaoPct: number | null; valorMedio: number | null };
  };
  pagamentos: {
    totalRecebido: number;
    porMetodo: Array<{ method: string; valor: number }>;
    pendente: number;
    comparativo: { totalRecebido: number };
  };
  nps: {
    enviados: number;
    respondidos: number;
    taxaRespostaPct: number | null;
    notaMedia: number | null;
    distribuicao: { detratores: number; neutros: number; promotores: number };
    npsClassico: number | null;
    comparativo: {
      enviados: number;
      respondidos: number;
      taxaRespostaPct: number | null;
      notaMedia: number | null;
      npsClassico: number | null;
    };
  };
};

const getToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('auth_token') ?? localStorage.getItem('auth_token');
};

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
};

export const api = {
  async fetch<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    try {
      const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
      if (res.status === 401 && typeof window !== 'undefined') {
        sessionStorage.removeItem('auth_token');
        localStorage.removeItem('auth_token');
        if (window.location.pathname !== '/login') window.location.href = '/login';
      }
      return (await res.json()) as ApiResponse<T>;
    } catch {
      // Rede caiu ou resposta inválida: devolve o mesmo envelope que os callers já tratam.
      return { success: false, error: 'Falha de rede — tente novamente' };
    }
  },

  get<T>(path: string): Promise<ApiResponse<T>> {
    return this.fetch<T>(path);
  },

  post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    return this.fetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
  },

  async login(email: string, password: string): Promise<ApiResponse<{ token: string }>> {
    return this.post('/auth/login', { email, password });
  },

  async getMe(): Promise<{ id: string; name: string; email: string; role: string } | null> {
    const res = await this.get<{ id: string; name: string; email: string; role: string }>('/auth/me');
    return res.data ?? null;
  },

  // Contadores do sidebar (badges). Tolerante a falha: null = não mostra badge.
  async getSidebarCounts(): Promise<{ aguardandoResposta: number; followupsAtrasados: number } | null> {
    try {
      const res = await this.get<DashboardSummary>('/dashboard/summary?period=7d');
      if (!res.success || !res.data) return null;
      return {
        aguardandoResposta: res.data.aguardandoResposta,
        followupsAtrasados: res.data.followupsAtrasados,
      };
    } catch {
      return null;
    }
  },

  async getConversations(opts: {
    search?: string;
    status?: string;
    needsHuman?: boolean;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ items: Conversation[]; total: number; page: number }> {
    const res = await this.get<{ items: Conversation[]; total: number; page: number }>(`/inbox/list${qs(opts)}`);
    return res.data ?? { items: [], total: 0, page: 1 };
  },

  async getTemplates(): Promise<{ configured: boolean; templates: WhatsAppTemplate[] } | null> {
    const res = await this.get<{ configured: boolean; templates: WhatsAppTemplate[] }>('/templates');
    return res.data ?? null;
  },

  createTemplate(input: {
    name: string; category: string; body: string;
    header?: string; footer?: string; examples?: string[]; buttons?: TemplateButton[];
  }): Promise<ApiResponse<{ name: string; status: string }>> {
    return this.post('/templates', input);
  },

  deleteTemplate(name: string): Promise<ApiResponse<{ deleted: string }>> {
    return this.fetch(`/templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },

  // Inicia (ou reabre) conversa a partir de um contato/lead.
  startConversation(input: { leadId?: string; patientId?: string }): Promise<ApiResponse<{ conversationId: string; created: boolean }>> {
    return this.post('/inbox/start', input);
  },

  async getConversation(id: string): Promise<ConversationDetail | null> {
    const res = await this.get<ConversationDetail>(`/inbox/${id}`);
    return res.data ?? null;
  },

  sendReply(conversationId: string, text: string): Promise<ApiResponse<{ ok: boolean; sent: boolean }>> {
    return this.post(`/inbox/${conversationId}/reply`, { text });
  },

  runTawany(messageId: string, testMode?: boolean): Promise<ApiResponse<unknown>> {
    return this.post('/tawany/run', { messageId, testMode });
  },

  handoff(conversationId: string): Promise<ApiResponse<{ needsHuman: boolean }>> {
    return this.post(`/inbox/${conversationId}/handoff`, {});
  },

  devolverTawany(conversationId: string): Promise<ApiResponse<{ status: string; needsHuman: boolean; agentState: AgentState }>> {
    return this.post(`/inbox/${conversationId}/devolver-tawany`, {});
  },

  // ---------------- feedback 👍/👎 e exemplos few-shot ----------------

  sendSuggestionFeedback(suggestionId: string, feedback: 'UP' | 'DOWN', note?: string): Promise<ApiResponse<{ feedback: string }>> {
    return this.post(`/tawany/suggestions/${suggestionId}/feedback`, note ? { feedback, note } : { feedback });
  },

  async getReviewQueue(): Promise<ReviewQueueItem[]> {
    const res = await this.get<ReviewQueueItem[]>('/tawany/review-queue');
    return res.data ?? [];
  },

  async getExamples(): Promise<TawanyExample[]> {
    const res = await this.get<TawanyExample[]>('/tawany/examples');
    return res.data ?? [];
  },

  createExample(question: string, answer: string): Promise<ApiResponse<TawanyExample>> {
    return this.post('/tawany/examples', { question, answer });
  },

  deleteExample(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.fetch(`/tawany/examples/${id}`, { method: 'DELETE' });
  },

  // ---------------- usuários (gestão pelo admin) ----------------

  async listUsers(): Promise<ManagedUser[]> {
    const res = await this.get<ManagedUser[]>('/users');
    return res.data ?? [];
  },

  createUser(input: CreateUserInput): Promise<ApiResponse<ManagedUser>> {
    return this.post('/users', input);
  },

  updateUser(id: string, input: UpdateUserInput): Promise<ApiResponse<ManagedUser>> {
    return this.fetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  },

  // ---------------- canais (números extras via QR) ----------------

  async getChannels(): Promise<{ items: WhatsAppChannel[]; evolutionConfigured: boolean }> {
    const res = await this.get<{ items: WhatsAppChannel[]; evolutionConfigured: boolean }>('/channels');
    return res.data ?? { items: [], evolutionConfigured: false };
  },

  // Vincula instância já existente no gateway Evolution (criada pelo manager).
  linkChannel(name: string, instanceName: string): Promise<ApiResponse<WhatsAppChannel>> {
    return this.post('/channels/link', { name, instanceName });
  },

  createChannel(name: string): Promise<ApiResponse<WhatsAppChannel>> {
    return this.post('/channels', { name });
  },

  getChannelQr(id: string): Promise<ApiResponse<{ qrBase64: string | null; pairingCode: string | null }>> {
    return this.get(`/channels/${id}/qr`);
  },

  getChannelStatus(id: string): Promise<ApiResponse<WhatsAppChannel>> {
    return this.get(`/channels/${id}/status`);
  },

  disconnectChannel(id: string): Promise<ApiResponse<WhatsAppChannel>> {
    return this.post(`/channels/${id}/disconnect`, {});
  },

  deleteChannel(id: string): Promise<ApiResponse<{ id: string }>> {
    return this.fetch(`/channels/${id}`, { method: 'DELETE' });
  },

  // ---------------- knowledge vivo ----------------

  async getKnowledgeSections(): Promise<KnowledgeSection[]> {
    const res = await this.get<KnowledgeSection[]>('/settings/knowledge');
    return res.data ?? [];
  },

  updateKnowledgeSection(slug: string, input: { content: string; title?: string }): Promise<ApiResponse<{ slug: string }>> {
    return this.fetch(`/settings/knowledge/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(input) });
  },

  async getAiSettings(): Promise<AiSettings | null> {
    const res = await this.get<AiSettings>('/settings/ai');
    return res.data ?? null;
  },

  updateAiSettings(
    mode: AiOperationMode,
    autopilotIntents: string[] = [],
  ): Promise<ApiResponse<{ mode: AiOperationMode; autopilotIntents: string[] }>> {
    return this.fetch('/settings/ai', { method: 'PUT', body: JSON.stringify({ mode, autopilotIntents }) });
  },

  // ---------------- trilha de auditoria ----------------

  async getAuditLog(filters: {
    entity?: string;
    action?: string;
    userId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<AuditLogPage> {
    const res = await this.get<AuditLogPage>(`/audit${qs(filters)}`);
    return res.data ?? { items: [], total: 0, page: 1, pageSize: 25, entities: [] };
  },

  setConversationStatus(conversationId: string, status: string): Promise<ApiResponse<{ status: string }>> {
    return this.fetch(`/inbox/${conversationId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },

  addTag(conversationId: string, tag: string): Promise<ApiResponse<{ tags: string[] }>> {
    return this.post(`/inbox/${conversationId}/tags`, { tag });
  },

  removeTag(conversationId: string, tag: string): Promise<ApiResponse<{ tags: string[] }>> {
    return this.fetch(`/inbox/${conversationId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  },

  // ---------------- respostas rápidas ----------------

  async getQuickReplies(search?: string): Promise<QuickReply[]> {
    const res = await this.get<QuickReply[]>(`/quick-replies${qs({ search })}`);
    return res.data ?? [];
  },

  createTask(input: {
    title: string;
    conversationId?: string;
    leadId?: string;
    priority?: string;
    dueAt?: string;
  }): Promise<ApiResponse<{ id: string }>> {
    return this.post('/tasks', input);
  },

  async getBots(): Promise<BotSummary[]> {
    const res = await this.get<BotSummary[]>('/bots');
    return res.data ?? [];
  },

  async getBotMetrics(): Promise<BotMetrics | null> {
    try {
      const res = await this.get<BotMetrics>('/bots/metrics');
      return res.data ?? null;
    } catch {
      return null; // métricas nunca seguram a lista
    }
  },

  reorderBots(ids: string[]): Promise<ApiResponse<{ reordered: number }>> {
    return this.fetch('/bots/reorder', { method: 'PUT', body: JSON.stringify({ ids }) });
  },

  toggleBot(id: string, active: boolean): Promise<ApiResponse<{ active: boolean }>> {
    return this.fetch(`/bots/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
  },

  importBot(flow: unknown, source: string): Promise<ApiResponse<{ id: string; name: string; rules: number; replaced: boolean }>> {
    return this.post('/bots/import', { flow, source });
  },

  // flow inline (opcional) testa o fluxo do editor sem salvar.
  testBot(text: string, flow?: { rules: BotRuleInput[] }): Promise<ApiResponse<BotTestResult>> {
    return this.post('/bots/test', flow ? { text, flow } : { text });
  },

  async getBot(id: string): Promise<BotDetail | null> {
    const res = await this.get<BotDetail>(`/bots/${id}`);
    return res.data ?? null;
  },

  createBot(input: { name: string; rules: BotRuleInput[] }): Promise<ApiResponse<{ id: string; name: string; rules: number }>> {
    return this.post('/bots', input);
  },

  updateBot(id: string, input: { name: string; rules: BotRuleInput[] }): Promise<ApiResponse<{ id: string; name: string; rules: number }>> {
    return this.fetch(`/bots/${id}`, { method: 'PUT', body: JSON.stringify(input) });
  },

  duplicateBot(id: string): Promise<ApiResponse<{ id: string; name: string; active: boolean }>> {
    return this.post(`/bots/${id}/duplicate`, {});
  },

  async getBotVersions(id: string): Promise<BotVersion[]> {
    const res = await this.get<BotVersion[]>(`/bots/${id}/versions`);
    return res.data ?? [];
  },

  revertBot(id: string, versionId: string): Promise<ApiResponse<{ id: string; name: string; rules: number }>> {
    return this.post(`/bots/${id}/revert`, { versionId });
  },

  async getBotRiskTerms(): Promise<string[]> {
    const res = await this.get<string[]>('/bots/risk-terms');
    return res.data ?? [];
  },

  async getPipeline(): Promise<PipelineStage[]> {
    const res = await this.get<PipelineStage[]>('/operations/pipeline');
    return res.data ?? [];
  },

  approveSuggestion(suggestionId: string, body?: string): Promise<ApiResponse<{ sent: boolean }>> {
    return this.post('/tawany/approve', { suggestionId, body });
  },

  rejectSuggestion(suggestionId: string): Promise<ApiResponse<{ rejected: boolean }>> {
    return this.post('/tawany/reject', { suggestionId });
  },

  async getPipelines(): Promise<Pipeline[]> {
    const res = await this.get<Pipeline[]>('/pipeline/pipelines');
    return res.data ?? [];
  },

  async getPipelineLeads(pipeline?: string): Promise<PipelineLead[]> {
    const params = pipeline && pipeline !== 'all' ? `?pipeline=${pipeline}` : '';
    const res = await this.get<PipelineLead[]>(`/pipeline/leads${params}`);
    return res.data ?? [];
  },

  moveLead(
    leadId: string,
    stage: string,
    opts: { pipeline?: string; lostReason?: string; note?: string } = {},
  ): Promise<ApiResponse<{ stage: string; pipeline?: string; lostReason?: string }>> {
    return this.fetch(`/pipeline/leads/${leadId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ stage, ...opts }),
    });
  },

  async getLeadTimeline(leadId: string, limit = 50): Promise<TimelineItem[]> {
    const res = await this.get<TimelineItem[]>(`/pipeline/leads/${leadId}/timeline?limit=${limit}`);
    return res.data ?? [];
  },

  addLeadNote(leadId: string, body: string): Promise<ApiResponse<{ id: string; body: string; at: string }>> {
    return this.post(`/pipeline/leads/${leadId}/notes`, { body });
  },

  updateLeadPipeline(leadId: string, pipeline: string): Promise<ApiResponse<{ pipeline: string }>> {
    return this.fetch(`/pipeline/leads/${leadId}/pipeline`, {
      method: 'PATCH',
      body: JSON.stringify({ pipeline }),
    });
  },

  async getCanonicalTags(): Promise<Tag[]> {
    const res = await this.get<Tag[]>('/tags/canonical');
    return res.data ?? [];
  },

  async getContextualTags(): Promise<ContextualTags> {
    const res = await this.get<ContextualTags>('/tags/contextual');
    return res.data ?? { alerta: [], pipeline: [], origem: [] };
  },

  addLeadTag(leadId: string, tag: string): Promise<ApiResponse<{ tags: string[]; added: boolean }>> {
    return this.post(`/tags/leads/${leadId}/tags`, { tag });
  },

  removeLeadTag(leadId: string, tag: string): Promise<ApiResponse<{ tags: string[]; removed: boolean }>> {
    return this.fetch(`/tags/leads/${leadId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  },

  replaceLeadTags(leadId: string, tags: string[]): Promise<ApiResponse<{ tags: string[] }>> {
    return this.fetch(`/tags/leads/${leadId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    });
  },

  // ---------------- agenda ----------------

  async getAppointments(opts: {
    from?: string;
    to?: string;
    professionalId?: string;
    status?: string;
  } = {}): Promise<Appointment[]> {
    const res = await this.get<Appointment[]>(`/appointments${qs(opts)}`);
    return res.data ?? [];
  },

  createAppointment(input: {
    scheduledAt: string;
    endAt?: string;
    leadId?: string;
    patientId?: string;
    professionalId?: string;
    unitId?: string;
    notes?: string;
  }): Promise<ApiResponse<Appointment>> {
    return this.post('/appointments', input);
  },

  updateAppointment(id: string, input: { status?: AppointmentStatus; scheduledAt?: string; notes?: string }): Promise<ApiResponse<Appointment>> {
    return this.fetch(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  },

  async getProfessionals(): Promise<Professional[]> {
    const res = await this.get<Professional[]>('/appointments/professionals');
    return res.data ?? [];
  },

  async getUnits(): Promise<ClinicUnit[]> {
    const res = await this.get<ClinicUnit[]>('/appointments/units');
    return res.data ?? [];
  },

  // .ics precisa do header Authorization → baixa via fetch e devolve o Blob.
  async downloadAgendaIcs(from: string, to: string): Promise<Blob | null> {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${BASE_URL}/appointments/export.ics${qs({ from, to })}`, { headers });
    if (!res.ok) return null;
    return res.blob();
  },

  // ---------------- tarefas & atividades ----------------

  async getTasks(): Promise<TaskItem[]> {
    const res = await this.get<TaskItem[]>('/tasks');
    return res.data ?? [];
  },

  setTaskStatus(id: string, status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELED'): Promise<ApiResponse<{ status: string }>> {
    return this.fetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },

  // ---------------- orçamentos ----------------

  async getBudgets(opts: { status?: string; leadId?: string } = {}): Promise<Budget[]> {
    const res = await this.get<Budget[]>(`/budgets${qs(opts)}`);
    return res.data ?? [];
  },

  createBudget(input: BudgetInput): Promise<ApiResponse<Budget>> {
    return this.post('/budgets', input);
  },

  updateBudget(id: string, input: Partial<BudgetInput>): Promise<ApiResponse<Budget>> {
    return this.fetch(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  },

  sendBudget(id: string): Promise<ApiResponse<Budget>> {
    return this.post(`/budgets/${id}/send`, {});
  },

  acceptBudget(id: string): Promise<ApiResponse<Budget>> {
    return this.post(`/budgets/${id}/accept`, {});
  },

  rejectBudget(id: string): Promise<ApiResponse<Budget>> {
    return this.post(`/budgets/${id}/reject`, {});
  },

  // ---------------- pagamentos ----------------

  async getPayments(opts: { budgetId?: string; status?: string } = {}): Promise<Payment[]> {
    const res = await this.get<Payment[]>(`/payments${qs(opts)}`);
    return res.data ?? [];
  },

  createPayment(input: PaymentInput): Promise<ApiResponse<Payment>> {
    return this.post('/payments', input);
  },

  updatePayment(id: string, input: { status: 'PAID' | 'CANCELED'; paidAt?: string | null }): Promise<ApiResponse<Payment>> {
    return this.fetch(`/payments/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  },

  // ---------------- pacientes ----------------

  async getPatients(opts: { search?: string; page?: number; pageSize?: number } = {}): Promise<{ items: Patient[]; total: number; page: number }> {
    const res = await this.get<{ items: Patient[]; total: number; page: number }>(`/patients${qs(opts)}`);
    return res.data ?? { items: [], total: 0, page: 1 };
  },

  async getPatient(id: string): Promise<PatientDetail | null> {
    const res = await this.get<PatientDetail>(`/patients/${id}`);
    return res.data ?? null;
  },

  createPatient(input: PatientInput): Promise<ApiResponse<Patient>> {
    return this.post('/patients', input);
  },

  updatePatient(id: string, input: Partial<PatientInput>): Promise<ApiResponse<Patient>> {
    return this.fetch(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  },

  convertLeadToPatient(leadId: string): Promise<ApiResponse<Patient & { alreadyConverted?: boolean }>> {
    return this.post(`/patients/convert-from-lead/${leadId}`, {});
  },

  async getActivityFeed(period: FeedPeriod): Promise<TimelineItem[]> {
    const res = await this.get<TimelineItem[]>(`/activities/feed?period=${period}`);
    return res.data ?? [];
  },

  // Dashboard: um fetcher só — lança em falha para o Promise.all da página
  // cair no estado de erro com retry.
  async getDashboard<T>(path: string, period: DashboardPeriod): Promise<T> {
    const res = await this.get<T>(`/dashboard/${path}?period=${period}`);
    if (!res.success || res.data === undefined) {
      throw new Error(res.error ?? 'Falha ao carregar o dashboard');
    }
    return res.data;
  },

  // ---------------- relatórios ----------------

  // Mesmo contrato do getDashboard: lança em falha para o Promise.all da
  // página cair no estado de erro com retry.
  async getReport<T>(tipo: ReportTipo, params: ReportParams): Promise<T> {
    const res = await this.get<T>(`/reports/${tipo}${qs(params)}`);
    if (!res.success || res.data === undefined) {
      throw new Error(res.error ?? 'Falha ao carregar o relatório');
    }
    return res.data;
  },

  // CSV precisa do header Authorization → baixa via fetch e devolve o Blob
  // (mesmo padrão do .ics da agenda).
  async downloadReportCsv(tipo: ReportTipo, params: ReportParams): Promise<Blob | null> {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${BASE_URL}/reports/${tipo}/export.csv${qs(params)}`, { headers });
    if (!res.ok) return null;
    return res.blob();
  },
};
