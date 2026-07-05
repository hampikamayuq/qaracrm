import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from './deps';
import { createPrismaDataApi } from './prisma-data-api';
import type { DataApi } from './data';

let api: DataApi;

beforeAll(async () => {
  api = createPrismaDataApi(prisma);
  // Clean test data
  await prisma.chatMessage.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.chatMessage.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('PrismaDataApi', () => {
  it('creates and retrieves a lead', async () => {
    const lead = await api.create('lead', { name: 'Test Lead', phone: '+5511999999999' });
    expect(lead).toBeDefined();
    expect((lead as Record<string, unknown>).name).toBe('Test Lead');

    const found = await api.get('lead', (lead as Record<string, unknown>).id as string, { id: true, name: true });
    expect(found).toBeDefined();
    expect((found as Record<string, unknown>).name).toBe('Test Lead');
  });

  it('returns null for missing record', async () => {
    const result = await api.get('lead', 'non-existent-id', { id: true });
    expect(result).toBeNull();
  });

  it('lists leads', async () => {
    await api.create('lead', { name: 'A' });
    await api.create('lead', { name: 'B' });
    const list = await api.list('lead', { limit: 10 });
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('lists with filter', async () => {
    await api.create('lead', { name: 'UniqueFilterTest' });
    const list = await api.list('lead', {
      filter: { name: { eq: 'UniqueFilterTest' } },
    });
    expect(list.length).toBe(1);
  });

  it('lists with orderBy', async () => {
    const list = await api.list('lead', { orderBy: { name: 'ASC' }, limit: 5 });
    const names = list.map((r) => (r as Record<string, unknown>).name as string).filter(Boolean).slice(0, 2);
    expect(names[0] <= names[1]).toBe(true); // ascending
  });

  it('updates a record', async () => {
    const lead = await api.create('lead', { name: 'Before' });
    const id = (lead as Record<string, unknown>).id as string;
    const updated = await api.update('lead', id, { name: 'After' });
    expect((updated as Record<string, unknown>).name).toBe('After');

    const found = await api.get('lead', id, { name: true });
    expect((found as Record<string, unknown>).name).toBe('After');
  });

  it('select returns only requested fields', async () => {
    const lead = await api.create('lead', { name: 'Select Test', phone: '+5511', email: 's@t.com' });
    const found = await api.get('lead', (lead as Record<string, unknown>).id as string, { name: true });
    expect((found as Record<string, unknown>).name).toBe('Select Test');
    expect((found as Record<string, unknown>).phone).toBeUndefined();
    expect((found as Record<string, unknown>).email).toBeUndefined();
  });
});