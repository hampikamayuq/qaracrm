import type { PrismaClient } from '@prisma/client';
import type { DataApi, ListOptions } from './data';

// Map object names to Prisma delegate keys.
// ponytail: simple map, add when new models need DataApi access.
const MODEL_MAP: Record<string, keyof PrismaClient> = {
  lead: 'lead',
  patient: 'patient',
  conversation: 'conversation',
  chatMessage: 'chatMessage',
  aiSuggestion: 'aiSuggestion',
  task: 'task',
  activity: 'activity',
  professional: 'professional',
  service: 'service',
  user: 'user',
  session: 'session',
  pipeline: 'pipeline',
  pipelineStage: 'pipelineStage',
  aiRunLog: 'aiRunLog',
  knowledgeArticle: 'knowledgeArticle',
  webhookEvent: 'webhookEvent',
  appointment: 'appointment',
};

export const createPrismaDataApi = (prisma: PrismaClient): DataApi => ({
  async get(object: string, id: string, select?: Record<string, unknown>) {
    const delegate = MODEL_MAP[object] as string | undefined;
    if (!delegate) throw new Error(`Unknown object: ${object}`);
    const rec = (prisma as Record<string, unknown>)[delegate as string] as {
      findUnique(args: unknown): Promise<unknown>;
    };
    return rec.findUnique({
      where: { id },
      ...(select ? { select: Object.fromEntries(Object.entries(select).filter(([, v]) => v === true)) } : {}),
    }) as Promise<Record<string, unknown> | null>;
  },

  async list(object: string, options?: ListOptions) {
    const delegate = MODEL_MAP[object] as string | undefined;
    if (!delegate) throw new Error(`Unknown object: ${object}`);
    const rec = (prisma as Record<string, unknown>)[delegate as string] as {
      findMany(args: unknown): Promise<unknown[]>;
    };

    const args: Record<string, unknown> = {};

    if (options?.filter) {
      args.where = Object.fromEntries(
        Object.entries(options.filter).map(([key, val]) => {
          if (typeof val === 'object' && val !== null && 'eq' in val) {
            return [key, (val as { eq: unknown }).eq];
          }
          return [key, val];
        }),
      );
    }

    if (options?.orderBy) {
      args.orderBy = Object.entries(options.orderBy).map(([key, dir]) => ({
        [key]: dir.toLowerCase(),
      }));
    }

    if (typeof options?.limit === 'number') {
      args.take = options.limit;
    }

    if (typeof options?.offset === 'number') {
      args.skip = options.offset;
    }

    if (options?.select) {
      args.select = Object.fromEntries(Object.entries(options.select).filter(([, v]) => v === true));
    }

    return rec.findMany(args) as Promise<Record<string, unknown>[]>;
  },

  async create(object: string, data: Record<string, unknown>) {
    const delegate = MODEL_MAP[object] as string | undefined;
    if (!delegate) throw new Error(`Unknown object: ${object}`);
    const rec = (prisma as Record<string, unknown>)[delegate as string] as {
      create(args: unknown): Promise<unknown>;
    };
    return rec.create({ data }) as Promise<Record<string, unknown>>;
  },

  async update(object: string, id: string, data: Record<string, unknown>) {
    const delegate = MODEL_MAP[object] as string | undefined;
    if (!delegate) throw new Error(`Unknown object: ${object}`);
    const rec = (prisma as Record<string, unknown>)[delegate as string] as {
      update(args: unknown): Promise<unknown>;
    };
    return rec.update({ where: { id }, data }) as Promise<Record<string, unknown>>;
  },
});