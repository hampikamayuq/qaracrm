import { describe, expect, it, vi } from 'vitest';
import { recordAudit, type AuditClient } from './audit';

const client = (create: ReturnType<typeof vi.fn>): AuditClient =>
  ({ auditLog: { create } }) as unknown as AuditClient;

describe('recordAudit', () => {
  it('grava o registro com os campos informados', async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({});

    // Act
    await recordAudit(client(create), {
      userId: 'u1',
      action: 'bot.update',
      entity: 'bot',
      entityId: 'b1',
      before: { name: 'Antigo' },
      after: { name: 'Novo' },
    });

    // Assert
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        action: 'bot.update',
        entity: 'bot',
        entityId: 'b1',
        before: { name: 'Antigo' },
        after: { name: 'Novo' },
      },
    });
  });

  it('omite before/after quando não informados e normaliza userId ausente', async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({});

    // Act
    await recordAudit(client(create), { action: 'lgpd.export', entity: 'lead', entityId: 'L1' });

    // Assert
    expect(create).toHaveBeenCalledWith({
      data: { userId: null, action: 'lgpd.export', entity: 'lead', entityId: 'L1' },
    });
  });

  it('não lança quando o prisma falha — auditoria não derruba a operação', async () => {
    // Arrange
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(new Error('db down'));

    // Act & Assert
    await expect(
      recordAudit(client(create), { action: 'x', entity: 'e', entityId: '1' }),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
