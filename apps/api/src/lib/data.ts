import { CoreApiClient } from 'twenty-client-sdk/core';

export type ListOptions = {
  filter?: Record<string, unknown>;
  orderBy?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
  select?: Record<string, unknown>;
};

export type DataApi = {
  get(
    object: string,
    id: string,
    select?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  list(object: string, options?: ListOptions): Promise<Record<string, unknown>[]>;
  create(object: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(
    object: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
};

// Verified against the generated GraphQL schema (2026-07-04):
//   query:    <singular>(filter!) → record | <plural>(first, filter, orderBy: [T!]) → Connection{edges{node}}
//   mutation: create<T>(data) | update<T>(id, data)
//   orderBy direction enum: AscNullsLast / DescNullsLast

const DIRECTION: Record<'ASC' | 'DESC', string> = {
  ASC: 'AscNullsLast',
  DESC: 'DescNullsLast',
};

const capitalize = (s: string): string => `${s[0].toUpperCase()}${s.slice(1)}`;

// ponytail: naive English pluralization; matches Twenty's own namePlural for
// every object in this app because we declare namePlural explicitly per object.
const pluralize = (s: string): string => `${s}s`;

export const createDataApi = (client: CoreApiClient = new CoreApiClient()): DataApi => {
  const anyClient = client as unknown as {
    query(q: Record<string, unknown>): Promise<Record<string, unknown>>;
    mutation(m: Record<string, unknown>): Promise<Record<string, unknown>>;
  };

  return {
    async get(object, id, select = { id: true }) {
      const result = await anyClient.query({
        [object]: { __args: { filter: { id: { eq: id } } }, ...select },
      });
      return (result[object] ?? null) as Record<string, unknown> | null;
    },

    async list(object, options = {}) {
      const plural = pluralize(object);
      const orderBy = options.orderBy
        ? [
            Object.fromEntries(
              Object.entries(options.orderBy).map(([field, dir]) => [field, DIRECTION[dir]]),
            ),
          ]
        : undefined;

      const result = await anyClient.query({
        [plural]: {
          __args: {
            ...(options.filter ? { filter: options.filter } : {}),
            ...(orderBy ? { orderBy } : {}),
            ...(options.limit ? { first: options.limit } : {}),
          },
          edges: { node: options.select ?? { id: true } },
        },
      });

      const connection = result[plural] as
        | { edges?: Array<{ node: Record<string, unknown> }> }
        | null
        | undefined;
      return (connection?.edges ?? []).map((e) => e.node);
    },

    async create(object, data) {
      const mutationName = `create${capitalize(object)}`;
      const result = await anyClient.mutation({
        [mutationName]: { __args: { data }, id: true },
      });
      return result[mutationName] as Record<string, unknown>;
    },

    async update(object, id, data) {
      const mutationName = `update${capitalize(object)}`;
      const result = await anyClient.mutation({
        [mutationName]: { __args: { id, data }, id: true },
      });
      return result[mutationName] as Record<string, unknown>;
    },
  };
};
