import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('src/lib/data');

import { createDataApi } from 'src/lib/data';
import { WhatsappInbox } from '../front-components/whatsapp-inbox.front-component';

describe('WhatsappInbox', () => {
  it('renders the inbox header', () => {
    const mockList = vi.fn().mockResolvedValue([
      { id: 'c1', externalId: '+5521999999999', status: 'OPEN', needsHuman: true, lastMessageAt: '2026-07-03T10:00:00Z' },
    ]);
    vi.mocked(createDataApi).mockReturnValue({
      get: vi.fn().mockResolvedValue({}),
      list: mockList,
      create: vi.fn(),
      update: vi.fn(),
    } as any);

    render(<WhatsappInbox />);
    expect(screen.getByText(/inbox/i)).toBeInTheDocument();
  });

  it('shows a Resolver button for the selected conversation', async () => {
    const mockList = vi.fn().mockResolvedValue([
      { id: 'c1', externalId: '+5521999999999', status: 'OPEN', needsHuman: true, lastMessageAt: '2026-07-03T10:00:00Z' },
    ]);
    vi.mocked(createDataApi).mockReturnValue({
      get: vi.fn().mockResolvedValue({}),
      list: mockList,
      create: vi.fn(),
      update: vi.fn(),
    } as any);

    render(<WhatsappInbox />);
    expect(await screen.findByRole('button', { name: /resolver/i })).toBeInTheDocument();
  });

  it('orders conversations with needsHuman first, then by lastMessageAt DESC', async () => {
    const mockList = vi.fn().mockImplementation(async (obj: string) => {
      if (obj === 'conversation') {
        // Return conversations in reverse order: newer needsHuman: false first, then older needsHuman: true
        return [
          { id: 'c2', externalId: '+5521888888888', status: 'OPEN', needsHuman: false, lastMessageAt: '2026-07-03T15:00:00Z' },
          { id: 'c1', externalId: '+5521999999999', status: 'NEEDS_HUMAN', needsHuman: true, lastMessageAt: '2026-07-03T10:00:00Z' },
        ];
      }
      return [{ id: 'm1', direction: 'IN', body: 'oi', sentAt: '2026-07-03T10:00:00Z' }];
    });

    vi.mocked(createDataApi).mockReturnValue({
      get: vi.fn().mockResolvedValue({}),
      list: mockList,
      create: vi.fn(),
      update: vi.fn(),
    } as any);

    const { container } = render(<WhatsappInbox />);

    // Wait for messages to load (indicating component is mounted)
    await screen.findByText('oi');

    // Find the last aside element (the most recent render)
    const asideElements = Array.from(container.querySelectorAll('aside'));
    const aside = asideElements[asideElements.length - 1];

    // Get all div wrappers of conversations (each conversation is in a div under the aside's direct children)
    const conversationDivs = Array.from(aside.children).filter((el) => el.tagName === 'DIV');

    // Filter to conversations (not the header)
    const conversationButtons = conversationDivs.flatMap((div) =>
      Array.from(div.querySelectorAll('button')).filter((btn) => btn.querySelector('strong'))
    );

    expect(conversationButtons.length).toBe(2);

    // The first conversation should be the needsHuman one (with emoji)
    const first = conversationButtons[0];
    expect(first.textContent).toContain('🔴');
    expect(first.textContent).toContain('+5521999999999');

    // The second should be the non-needsHuman one (without emoji)
    const second = conversationButtons[1];
    expect(second.textContent).not.toContain('🔴');
    expect(second.textContent).toContain('+5521888888888');
  });
});
