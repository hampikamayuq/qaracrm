import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('src/lib/data', () => ({
  createDataApi: () => ({
    get: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockImplementation(async (obj: string) =>
      obj === 'conversation'
        ? [{ id: 'c1', externalId: '+5521999999999', status: 'OPEN', needsHuman: true, lastMessageAt: '2026-07-03T10:00:00Z' }]
        : [{ id: 'm1', direction: 'IN', body: 'oi', sentAt: '2026-07-03T10:00:00Z' }]),
    create: vi.fn(),
    update: vi.fn(),
  }),
}));

import { WhatsappInbox } from '../front-components/whatsapp-inbox.front-component';

describe('WhatsappInbox', () => {
  it('renders the inbox header', () => {
    render(<WhatsappInbox />);
    expect(screen.getByText(/inbox/i)).toBeInTheDocument();
  });

  it('shows a Resolver button for the selected conversation', async () => {
    render(<WhatsappInbox />);
    expect(await screen.findByRole('button', { name: /resolver/i })).toBeInTheDocument();
  });
});
