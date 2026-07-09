// Construção do servidor MCP (registro das tools) do CRM da Clínica QARA — Fase 3/4B.
//
// Extraído de index.ts (LEVA 4B) para ser reutilizado tanto pelo entrypoint stdio
// (index.ts, uso local no Claude Desktop/Code) quanto pelo entrypoint HTTP remoto
// (http.ts, uso via serviço web, ex.: Render). NENHUMA mudança de comportamento
// das tools em si — apenas a fábrica McpServer virou uma função.
//
// Diferença crucial em relação ao antigo mcp-server.js (crm-clinica-qara-main):
// este servidor NUNCA acessa o Prisma diretamente. Toda tool chama a API
// Express (apps/api) via HTTP, porque as rotas encapsulam regras de negócio e
// gravação de Activity/AuditLog, e a autenticação exige uma Session viva no
// banco (não dá para "forjar" um usuário local).
//
// REGRA DE SEGURANÇA (herdada do antigo servidor): nenhuma tool envia mensagem
// a paciente (não expomos POST /api/inbox/:id/reply), nenhuma tool deleta
// nada, e nenhuma tool toca rotas de pagamento/financeiro.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiClient, ApiError, buildQuery } from './api-client.js';

// ---- Enums espelhados das rotas reais (apps/api/src/routes/pipeline-routes.ts) ----
// A UI mais nova usa estágios em minúsculas/kebab-case (UI_STAGES) e um
// segundo eixo, "pipeline" (especialidade clínica) — diferente do antigo
// LEAD_STAGES em maiúsculas do mcp-server.js original.
const UI_STAGES = [
  'novo-lead',
  'qualificado',
  'horario-oferecido',
  'agendado',
  'confirmado',
  'atendido',
  'reagendado',
  'perdido',
  'alta-manutencao',
] as const;

const CLINICAL_PIPELINES = [
  'dermatologia-clinica',
  'tricologia',
  'cirurgia',
  'unhas',
  'podologia',
  'inflamatorias',
  'dermatopediatria',
  'administrativo',
  'reativacao',
] as const;

const LOSS_REASONS = ['preco', 'plano', 'horario', 'sem-resposta', 'concorrente', 'fora-de-perfil', 'outro'] as const;

const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELED'] as const;
const REPORT_TYPES = ['comercial', 'atendimento', 'tawany'] as const;
const REPORT_PERIODS = ['7d', '30d', '90d'] as const;

// Serializa a resposta da tool: erros viram CallToolResult com isError.
function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function tool<A>(handler: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await handler(args));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error)?.message || String(err);
      return { content: [{ type: 'text' as const, text: `Erro: ${message}` }], isError: true };
    }
  };
}

const READ = { readOnlyHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false };

type PipelineLead = {
  id: string;
  name: { firstName: string; lastName: string };
  stage: string;
  whatsapp?: { primaryPhoneNumber?: string | null };
  email?: { primaryEmail?: string | null };
};

type QuickReply = { id: string; shortcut: string; title: string; content: string; active: boolean };

/**
 * Constrói um McpServer novo com todas as tools do CRM registradas.
 *
 * Recebe um ApiClient opcional (default: `new ApiClient()`, lendo credenciais
 * do ambiente) — permite que o entrypoint HTTP compartilhe um único ApiClient
 * (e portanto um único login) entre sessões, e que testes injetem um cliente
 * fake sem precisar de MCP_EMAIL/MCP_PASSWORD reais.
 */
export function buildServer(api: ApiClient = new ApiClient()): McpServer {
  const server = new McpServer({ name: 'qara-crm', version: '0.1.0' });

  // ================================ Leitura ================================

  server.registerTool(
    'list_leads',
    {
      description:
        'Lista leads do funil (GET /api/pipeline/leads). Filtra por pipeline (especialidade, filtrado no servidor), ' +
        'e por stage/busca/limite (filtrados aqui, pois a rota atual não recebe esses parâmetros).',
      inputSchema: {
        pipeline: z.enum(CLINICAL_PIPELINES).optional().describe('Especialidade clínica do funil'),
        stage: z.enum(UI_STAGES).optional().describe('Estágio do funil (kebab-case)'),
        search: z.string().optional().describe('Busca por nome, telefone ou email'),
        limit: z.number().int().positive().max(500).optional(),
      },
      annotations: READ,
    },
    tool(async ({ pipeline, stage, search, limit }) => {
      const path = `/api/pipeline/leads${buildQuery({ pipeline })}`;
      let leads = await api.get<PipelineLead[]>(path);
      if (stage) leads = leads.filter((l) => l.stage === stage);
      if (search) {
        const q = search.trim().toLowerCase();
        leads = leads.filter((l) => {
          const name = `${l.name?.firstName ?? ''} ${l.name?.lastName ?? ''}`.toLowerCase();
          const phone = l.whatsapp?.primaryPhoneNumber ?? '';
          const email = (l.email?.primaryEmail ?? '').toLowerCase();
          return name.includes(q) || phone.includes(search.trim()) || email.includes(q);
        });
      }
      return limit ? leads.slice(0, limit) : leads;
    }),
  );

  server.registerTool(
    'lead_timeline',
    {
      description:
        'Timeline de atividades de um lead (GET /api/pipeline/leads/:id/timeline): mudanças de estágio/pipeline, ' +
        'notas, tarefas, agendamentos, mensagens agregadas por dia e sugestões da Tawany.',
      inputSchema: {
        leadId: z.string(),
        limit: z.number().int().positive().max(200).optional(),
      },
      annotations: READ,
    },
    tool(({ leadId, limit }) => api.get(`/api/pipeline/leads/${encodeURIComponent(leadId)}/timeline${buildQuery({ limit })}`)),
  );

  server.registerTool(
    'list_conversations',
    {
      description: 'Lista conversas do inbox (GET /api/inbox/list). Filtra por status, needsHuman, busca por nome do lead e paginação.',
      inputSchema: {
        status: z.string().optional().describe('Ex.: OPEN, PENDING_PATIENT, PENDING_HUMAN, RESOLVED, CLOSED'),
        needsHuman: z.boolean().optional(),
        search: z.string().optional().describe('Busca por nome do lead'),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(100).optional(),
      },
      annotations: READ,
    },
    tool(({ status, needsHuman, search, page, pageSize }) =>
      api.get(`/api/inbox/list${buildQuery({ status, needsHuman, search, page, pageSize })}`),
    ),
  );

  server.registerTool(
    'conversation_messages',
    {
      description:
        'Detalhe de uma conversa (GET /api/inbox/:id): inclui as mensagens (até 100, mais antigas primeiro), ' +
        'dados do lead/paciente, tarefas abertas e sugestões pendentes da Tawany.',
      inputSchema: { conversationId: z.string() },
      annotations: READ,
    },
    tool(({ conversationId }) => api.get(`/api/inbox/${encodeURIComponent(conversationId)}`)),
  );

  server.registerTool(
    'list_tasks',
    {
      description:
        'Lista tarefas/follow-ups (GET /api/tasks). O servidor só filtra por status (default: exclui DONE/CANCELED); ' +
        'assignedToId e overdue são filtrados aqui.',
      inputSchema: {
        status: z.enum(TASK_STATUSES).optional(),
        assignedToId: z.string().optional(),
        overdue: z.boolean().optional().describe('Apenas tarefas com dueAt no passado e status aberto'),
        limit: z.number().int().positive().max(200).optional(),
      },
      annotations: READ,
    },
    tool(async ({ status, assignedToId, overdue, limit }) => {
      type TaskRow = {
        id: string;
        status: string;
        dueAt: string | null;
        assignedTo?: { id: string; name: string } | null;
      };
      let tasks = await api.get<TaskRow[]>(`/api/tasks${buildQuery({ status })}`);
      if (assignedToId) tasks = tasks.filter((t) => t.assignedTo?.id === assignedToId);
      if (overdue) {
        const now = Date.now();
        tasks = tasks.filter(
          (t) => t.status !== 'DONE' && t.status !== 'CANCELED' && t.dueAt && new Date(t.dueAt).getTime() < now,
        );
      }
      return limit ? tasks.slice(0, limit) : tasks;
    }),
  );

  server.registerTool(
    'review_queue',
    {
      description:
        'Fila de revisão da Tawany (GET /api/tawany/review-queue): sugestões já enviadas que receberam feedback ' +
        'negativo (👎), com a pergunta do paciente que originou a resposta.',
      inputSchema: {},
      annotations: READ,
    },
    tool(() => api.get('/api/tawany/review-queue')),
  );

  server.registerTool(
    'get_reports',
    {
      description:
        'Relatórios (GET /api/reports/comercial|atendimento|tawany). Use period (7d/30d/90d, default 30d no servidor) ' +
        'ou from/to (YYYY-MM-DD, máx. 366 dias).',
      inputSchema: {
        tipo: z.enum(REPORT_TYPES),
        period: z.enum(REPORT_PERIODS).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      },
      annotations: READ,
    },
    tool(({ tipo, period, from, to }) => api.get(`/api/reports/${tipo}${buildQuery({ period, from, to })}`)),
  );

  server.registerTool(
    'list_quick_replies',
    {
      description:
        'Lista respostas rápidas cadastradas (GET /api/quick-replies): atalho, título e conteúdo (com placeholders ' +
        'como {{nome}}/{{primeiro_nome}}/{{unidade}}). Por padrão só traz as ativas; search filtra por atalho/título/conteúdo.',
      inputSchema: {
        search: z.string().optional().describe('Busca por atalho, título ou conteúdo'),
        active: z.enum(['true', 'false', 'all']).optional().describe('Default: só ativas (true)'),
      },
      annotations: READ,
    },
    tool(({ search, active }) => api.get<QuickReply[]>(`/api/quick-replies${buildQuery({ search, active })}`)),
  );

  server.registerTool(
    'list_patients',
    {
      description:
        'Lista pacientes cadastrados (GET /api/patients). Busca por nome (ILIKE) ou telefone via `search`, ' +
        'com paginação (page/pageSize). Devolve { items, total, page }.',
      inputSchema: {
        search: z.string().optional().describe('Busca por nome ou telefone'),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(100).optional(),
      },
      annotations: READ,
    },
    tool(({ search, page, pageSize }) => api.get(`/api/patients${buildQuery({ search, page, pageSize })}`)),
  );

  server.registerTool(
    'patient_timeline',
    {
      description:
        'Detalhe de um paciente com timeline (GET /api/patients/:id): dados cadastrais, lead de origem, consultas, ' +
        'orçamentos e a timeline unificada (consultas, orçamentos, mensagens agregadas por dia, tarefas, notas e conversão).',
      inputSchema: { patientId: z.string() },
      annotations: READ,
    },
    tool(({ patientId }) => api.get(`/api/patients/${encodeURIComponent(patientId)}`)),
  );

  // =========================== Escritas seguras ============================

  server.registerTool(
    'create_task',
    {
      description:
        'Cria uma tarefa/follow-up (POST /api/tasks). Requer title. A API sempre atribui a tarefa ao usuário ' +
        'autenticado (o usuário de serviço do MCP) — não é possível atribuir a outra pessoa por esta tool.',
      inputSchema: {
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        priority: z.enum(TASK_PRIORITIES).optional(),
        dueAt: z.string().optional().describe('Data/hora ISO 8601'),
        leadId: z.string().optional(),
        conversationId: z.string().optional(),
      },
      annotations: WRITE,
    },
    tool((input) => api.post('/api/tasks', input)),
  );

  server.registerTool(
    'draft_reply',
    {
      description:
        'Rascunha uma resposta SEM ENVIAR nada ao paciente: cria uma Task "Rascunho de resposta" (POST /api/tasks) ' +
        'vinculada à conversa, com o texto do rascunho na descrição, para um humano revisar e enviar manualmente pelo ' +
        'inbox. Mesmo espírito do draft_reply do protótipo original (crm-clinica-qara-main/mcp-server.js), mas aqui o ' +
        'rascunho fica registrado como tarefa em vez de só ser devolvido na resposta da tool.',
      inputSchema: {
        conversationId: z.string(),
        draft: z.string().min(1).describe('Texto do rascunho (já com variáveis substituídas, se vier de uma quick reply)'),
      },
      annotations: WRITE,
    },
    tool(({ conversationId, draft }) =>
      api.post('/api/tasks', {
        title: 'Rascunho de resposta',
        description: draft,
        conversationId,
      }),
    ),
  );

  server.registerTool(
    'add_note',
    {
      description: 'Adiciona uma nota interna a um lead (POST /api/pipeline/leads/:id/notes). Máx. 2000 caracteres.',
      inputSchema: {
        leadId: z.string(),
        body: z.string().min(1).max(2000),
      },
      annotations: WRITE,
    },
    tool(({ leadId, body }) => api.post(`/api/pipeline/leads/${encodeURIComponent(leadId)}/notes`, { body })),
  );

  server.registerTool(
    'move_lead_stage',
    {
      description:
        'Move um lead para outro estágio do funil (PATCH /api/pipeline/leads/:id/move). ' +
        'Para stage="perdido" é obrigatório informar lostReason. Opcionalmente troca o pipeline (especialidade) e ' +
        'anexa uma nota ao histórico da mudança.',
      inputSchema: {
        leadId: z.string(),
        stage: z.enum(UI_STAGES),
        pipeline: z.enum(CLINICAL_PIPELINES).optional(),
        lostReason: z.enum(LOSS_REASONS).optional(),
        note: z.string().optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    tool(({ leadId, ...body }) => {
      if (body.stage === 'perdido' && !body.lostReason) {
        throw new Error(`Mover para "perdido" exige lostReason. Valores aceitos: ${LOSS_REASONS.join(', ')}`);
      }
      return api.patch(`/api/pipeline/leads/${encodeURIComponent(leadId)}/move`, body);
    }),
  );

  server.registerTool(
    'approve_suggestion',
    {
      description:
        'Aprova e envia uma sugestão pendente da Tawany (POST /api/tawany/approve). Opcionalmente troca o texto ' +
        '(body) antes de enviar — a API marca humanEdited=true nesse caso. Esta é a ÚNICA forma, entre as tools deste ' +
        'servidor, de uma mensagem chegar ao paciente, e mesmo assim exige aprovação humana explícita via chamada da tool.',
      inputSchema: {
        suggestionId: z.string(),
        body: z.string().min(1).optional().describe('Texto editado (opcional); se omitido, envia o texto original'),
      },
      annotations: WRITE,
    },
    tool(({ suggestionId, body }) => api.post('/api/tawany/approve', { suggestionId, ...(body ? { body } : {}) })),
  );

  server.registerTool(
    'reject_suggestion',
    {
      description:
        'Rejeita uma sugestão pendente da Tawany (POST /api/tawany/reject) — nunca é enviada ao paciente. ' +
        'A rota de rejeição em si não aceita motivo/feedback; se "note" for informado, esta tool registra também um ' +
        'feedback 👎 (POST /api/tawany/suggestions/:id/feedback) com essa nota, para alimentar a fila de revisão.',
      inputSchema: {
        suggestionId: z.string(),
        note: z.string().max(2000).optional().describe('Motivo da rejeição (vira feedback negativo registrado à parte)'),
      },
      annotations: WRITE,
    },
    tool(async ({ suggestionId, note }) => {
      const result = await api.post('/api/tawany/reject', { suggestionId });
      if (note && note.trim()) {
        await api.post(`/api/tawany/suggestions/${encodeURIComponent(suggestionId)}/feedback`, {
          feedback: 'DOWN',
          note: note.trim(),
        });
      }
      return result;
    }),
  );

  return server;
}
