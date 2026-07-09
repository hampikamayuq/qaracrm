// Cliente HTTP para a API do CRM QARA (apps/api), usado pelo servidor MCP.
//
// Diferença crucial em relação ao antigo mcp-server.js: este cliente NUNCA
// acessa o Prisma diretamente. Toda operação passa pelas rotas Express, que
// encapsulam regras de negócio e gravam AuditLog/Activity. A autenticação
// exige uma Session viva no banco (apps/api/src/middleware/auth-middleware.ts),
// então o cliente faz login em POST /api/auth/login, guarda o token Bearer e
// refaz login automaticamente (uma única vez por chamada) se receber 401 —
// a Session pode expirar ou ser revogada a qualquer momento.

export type Envelope<T> = { success: true; data: T } | { success: false; error: string };

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
  }
}

export type ApiClientConfig = {
  baseUrl?: string;
  email?: string;
  password?: string;
  fetchImpl?: typeof fetch;
};

/** Monta querystring a partir de um objeto, ignorando undefined/null/''. */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

type LoginData = { token: string; user: { id: string; name: string; email: string; role: string } };

export class ApiClient {
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly password: string;
  private readonly fetchImpl: typeof fetch;
  private token: string | null = null;
  private loginPromise: Promise<string> | null = null;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? process.env.MCP_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
    this.email = config.email ?? process.env.MCP_EMAIL ?? '';
    this.password = config.password ?? process.env.MCP_PASSWORD ?? '';
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error('fetch global não disponível — use Node 18+ ou informe fetchImpl.');
    }
    if (!this.email || !this.password) {
      throw new Error(
        'MCP_EMAIL e MCP_PASSWORD são obrigatórios. Defina-os no ambiente ou no .mcp.json (env).',
      );
    }
  }

  /** Faz login (POST /api/auth/login) e guarda o token. Concorrente-safe. */
  private async login(): Promise<string> {
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      const res = await this.fetchImpl(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password }),
      });
      const parsed = (await res.json().catch(() => null)) as Envelope<LoginData> | null;
      if (!res.ok || !parsed || !parsed.success) {
        const message = parsed && !parsed.success ? parsed.error : `HTTP ${res.status}`;
        throw new ApiError(`Falha no login em ${this.baseUrl}: ${message}`, res.status, '/api/auth/login');
      }
      this.token = parsed.data.token;
      return this.token;
    })();

    try {
      return await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }

  private async ensureToken(): Promise<string> {
    return this.token ?? this.login();
  }

  private async request<T>(method: string, path: string, body: unknown, retried: boolean): Promise<T> {
    const token = await this.ensureToken();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && !retried) {
      // Sessão expirada/revogada: refaz login uma única vez e tenta de novo.
      this.token = null;
      await this.login();
      return this.request<T>(method, path, body, true);
    }

    const parsed = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok || !parsed || !parsed.success) {
      const message = parsed && !parsed.success ? parsed.error : `HTTP ${res.status}`;
      throw new ApiError(`${method} ${path} falhou: ${message}`, res.status, path);
    }
    return parsed.data;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined, false);
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>('POST', path, body, false);
  }

  patch<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>('PATCH', path, body, false);
  }
}
