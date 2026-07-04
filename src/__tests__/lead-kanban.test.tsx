import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockDataApi = {
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock('src/lib/data', () => ({
  createDataApi: () => mockDataApi,
}));

import { LeadKanban } from '../front-components/lead-kanban.front-component';

describe('LeadKanban', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDataApi.list.mockResolvedValue([
      { id: 'l1', name: { firstName: 'Maria', lastName: 'Silva' }, stage: 'NOVO', score: 0, whatsapp: { primaryPhoneNumber: '999999999' } },
      { id: 'l2', name: { firstName: 'João', lastName: 'Souza' }, stage: 'AGENDADO', score: 75, whatsapp: { primaryPhoneNumber: '888888888' } },
    ]);
    mockDataApi.update.mockResolvedValue({});
  });

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

  it('calls createDataApi().update with correct args when stage is changed via dropdown', async () => {
    mockDataApi.update.mockResolvedValue({});
    render(<LeadKanban />);

    // Wait for selects to be rendered
    await waitFor(() => {
      const selects = screen.queryAllByRole('combobox');
      expect(selects.length).toBeGreaterThan(0);
    });

    // Find all select elements and get the first one (for Maria Silva in NOVO stage)
    const selects = screen.getAllByRole('combobox');
    const selectForMaria = selects[0] as HTMLSelectElement;

    // Verify the select is currently set to NOVO
    expect(selectForMaria.value).toBe('NOVO');

    // Change stage to QUALIFICADO
    fireEvent.change(selectForMaria, { target: { value: 'QUALIFICADO' } });

    // Verify that update was called with the correct arguments
    expect(mockDataApi.update).toHaveBeenCalledWith('lead', 'l1', { stage: 'QUALIFICADO' });
  });

  it('renders "(sem nome)" when lead name is null', async () => {
    mockDataApi.list.mockResolvedValue([
      { id: 'l3', name: null, stage: 'NOVO', score: 50, whatsapp: { primaryPhoneNumber: '555555555' } },
    ]);

    render(<LeadKanban />);

    // Should display the fallback text "(sem nome)" instead of crashing
    expect(await screen.findByText('(sem nome)')).toBeInTheDocument();
  });

  it('renders without crashing when lead whatsapp is null', async () => {
    mockDataApi.list.mockResolvedValue([
      { id: 'l4', name: { firstName: 'Alice', lastName: 'Brown' }, stage: 'NOVO', score: 60, whatsapp: null },
    ]);

    render(<LeadKanban />);

    // Should render the lead name without crashing despite null whatsapp
    expect(await screen.findByText('Alice Brown')).toBeInTheDocument();
    // Verify score is also rendered (confirms card rendered correctly)
    expect(await screen.findByText(/score: 60/i)).toBeInTheDocument();
  });
});
