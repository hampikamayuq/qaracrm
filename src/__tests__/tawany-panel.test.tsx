import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('src/lib/data');

import { createDataApi } from 'src/lib/data';
import { TawanyPanel } from '../front-components/tawany-panel.front-component';

describe('TawanyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the Tawany brand', () => {
    const mockList = vi.fn().mockResolvedValue([
      { id: 'c1', needsHuman: true, status: 'OPEN' },
      { id: 'c2', needsHuman: false, status: 'RESOLVED' },
    ]);
    vi.mocked(createDataApi).mockReturnValue({
      get: vi.fn(),
      list: mockList,
      create: vi.fn(),
      update: vi.fn(),
    } as any);

    render(<TawanyPanel />);
    expect(screen.getByText(/tawany/i)).toBeInTheDocument();
  });

  it('shows needs-human count', async () => {
    const mockList = vi.fn().mockResolvedValue([
      { id: 'c1', needsHuman: true, status: 'OPEN' },
      { id: 'c2', needsHuman: false, status: 'RESOLVED' },
    ]);
    vi.mocked(createDataApi).mockReturnValue({
      get: vi.fn(),
      list: mockList,
      create: vi.fn(),
      update: vi.fn(),
    } as any);

    render(<TawanyPanel />);
    expect(await screen.findByText(/aguardando humano/i)).toBeInTheDocument();
  });
});
