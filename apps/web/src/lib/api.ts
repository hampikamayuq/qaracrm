const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export type ApiResponse<T> = { success: boolean; data?: T; error?: string };

export type Conversation = {
  id: string;
  status: string;
  needsHuman: boolean;
  channel?: string | null;
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

export type LeadHistoryEntry = {
  id: string;
  type: 'stage_change' | 'pipeline_change';
  from: string | null;
  to: string | null;
  lostReason: string | null;
  note: string | null;
  byUserId: string | null;
  byName: string | null;
  at: string;
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
  rules: number;
  createdAt: string;
  updatedAt: string;
};

export type BotRuleInput = { terms: string[]; responses: string[] };

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
  terms?: string[];
  responses: string[];
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

    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    if (res.status === 401 && typeof window !== 'undefined') {
      sessionStorage.removeItem('auth_token');
      localStorage.removeItem('auth_token');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return res.json() as Promise<ApiResponse<T>>;
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

  setConversationStatus(conversationId: string, status: string): Promise<ApiResponse<{ status: string }>> {
    return this.fetch(`/inbox/${conversationId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },

  addTag(conversationId: string, tag: string): Promise<ApiResponse<{ tags: string[] }>> {
    return this.post(`/inbox/${conversationId}/tags`, { tag });
  },

  removeTag(conversationId: string, tag: string): Promise<ApiResponse<{ tags: string[] }>> {
    return this.fetch(`/inbox/${conversationId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
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

  async getLeadHistory(leadId: string): Promise<LeadHistoryEntry[]> {
    const res = await this.get<LeadHistoryEntry[]>(`/pipeline/leads/${leadId}/history`);
    return res.data ?? [];
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

  // Dashboard: um fetcher só — lança em falha para o Promise.all da página
  // cair no estado de erro com retry.
  async getDashboard<T>(path: string, period: DashboardPeriod): Promise<T> {
    const res = await this.get<T>(`/dashboard/${path}?period=${period}`);
    if (!res.success || res.data === undefined) {
      throw new Error(res.error ?? 'Falha ao carregar o dashboard');
    }
    return res.data;
  },
};
