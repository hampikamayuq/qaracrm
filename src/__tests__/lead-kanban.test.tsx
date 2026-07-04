import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('src/lib/data', () => ({
  createDataApi: () => ({
    get: vi.fn(),
    list: vi.fn().mockResolvedValue([
      { id: 'l1', name: { firstName: 'Maria', lastName: 'Silva' }, stage: 'NOVO', score: 0, whatsapp: { primaryPhoneNumber: '999999999' } },
      { id: 'l2', name: { firstName: 'João', lastName: 'Souza' }, stage: 'AGENDADO', score: 75, whatsapp: { primaryPhoneNumber: '888888888' } },
    ]),
    create: vi.fn(),
    update: vi.fn(),
  }),
}));

import { LeadKanban } from '../front-components/lead-kanban.front-component';

describe('LeadKanban', () => {
  it('renders the kanban board title', () => {
    render(<LeadKanban />);
    expect(screen.getByText(/funil de leads/i)).toBeInTheDocument();
  });

  it('shows leads grouped by stage', async () => {
    render(<LeadKanban />);
    const mariaSilva = await screen.findAllByText('Maria Silva');
    const joaoSouza = await screen.findAllByText('João Souza');
    expect(mariaSilva.length).toBeGreaterThan(0);
    expect(joaoSouza.length).toBeGreaterThan(0);
  });
});
