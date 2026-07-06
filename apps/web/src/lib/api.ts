const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export type ApiResponse<T> = { success: boolean; data?: T; error?: string };

export type Conversation = {
  id: string;
  status: string;
  needsHuman: boolean;
  updatedAt: string;
  lead?: { id: string; name: string };
  messages?: Array<{ body: string; sentAt: string }>;
  aiSuggestions?: Array<{ id: string; body: string; riskLevel: string | null }>;
};

export type Lead = {
  id: string;
  name: string;
  score: number;
  tags?: string[];
};

export type PipelineStage = {
  id: string;
  name: string;
  leads: Lead[];
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
};
