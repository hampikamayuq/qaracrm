import { describe, it, expect, vi } from 'vitest';
import { createDataApi } from './data';
import type { CoreApiClient } from 'twenty-client-sdk/core';

type MockClient = { query: ReturnType<typeof vi.fn>; mutation: ReturnType<typeof vi.fn> };

const makeClient = (): MockClient =>
  ({
    query: vi.fn().mockResolvedValue({}),
    mutation: vi.fn().mockResolvedValue({}),
  });

const asCore = (c: MockClient): CoreApiClient => c as unknown as CoreApiClient;

describe('createDataApi', () => {
  it('get() queries the singular name with id filter', async () => {
    const client = makeClient();
    client.query.mockResolvedValue({ lead: { id: 'abc', score: 75 } });
    const result = await createDataApi(asCore(client)).get('lead', 'abc', {
      id: true,
      score: true,
    });
    expect(client.query).toHaveBeenCalledWith({
      lead: { __args: { filter: { id: { eq: 'abc' } } }, id: true, score: true },
    });
    expect(result).toEqual({ id: 'abc', score: 75 });
  });

  it('list() queries the plural connection and unwraps edges/node', async () => {
    const client = makeClient();
    client.query.mockResolvedValue({
      messages: { edges: [{ node: { id: 'm1' } }, { node: { id: 'm2' } }] },
    });
    const result = await createDataApi(asCore(client)).list('message', {
      filter: { conversationId: { eq: 'c1' } },
      orderBy: { sentAt: 'DESC' },
      limit: 3,
      select: { id: true },
    });
    expect(client.query).toHaveBeenCalledWith({
      messages: {
        __args: {
          filter: { conversationId: { eq: 'c1' } },
          orderBy: [{ sentAt: 'DescNullsLast' }],
          first: 3,
        },
        edges: { node: { id: true } },
      },
    });
    expect(result).toEqual([{ id: 'm1' }, { id: 'm2' }]);
  });

  it('create() calls the create mutation with data', async () => {
    const client = makeClient();
    client.mutation.mockResolvedValue({ createTask: { id: 't1' } });
    const result = await createDataApi(asCore(client)).create('task', { title: 'Follow-up' });
    expect(client.mutation).toHaveBeenCalledWith({
      createTask: { __args: { data: { title: 'Follow-up' } }, id: true },
    });
    expect(result).toEqual({ id: 't1' });
  });

  it('update() calls the update mutation with id + data', async () => {
    const client = makeClient();
    client.mutation.mockResolvedValue({ updateConversation: { id: 'c1' } });
    await createDataApi(asCore(client)).update('conversation', 'c1', { status: 'resolved' });
    expect(client.mutation).toHaveBeenCalledWith({
      updateConversation: { __args: { id: 'c1', data: { status: 'resolved' } }, id: true },
    });
  });
});
