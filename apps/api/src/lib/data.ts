export type ListOptions = {
  filter?: Record<string, unknown>;
  orderBy?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
  offset?: number;
  select?: Record<string, unknown>;
};

export type DataApi = {
  get(object: string, id: string, select?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  list(object: string, options?: ListOptions): Promise<Record<string, unknown>[]>;
  create(object: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(object: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
};

// Re-export the Prisma implementation
export { createPrismaDataApi } from './prisma-data-api';