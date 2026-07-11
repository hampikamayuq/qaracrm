import { describe, expect, it, vi } from 'vitest';
import { emitInboundMessage, subscribe, type InboundMessageEvent } from './events';

describe('events — emitInboundMessage/subscribe', () => {
  it('delivers the event to every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe(a);
    const offB = subscribe(b);

    emitInboundMessage({ conversationId: 'conv-1', leadName: 'Maria', preview: 'Oi' });

    const expected: InboundMessageEvent = { conversationId: 'conv-1', leadName: 'Maria', preview: 'Oi' };
    expect(a).toHaveBeenCalledWith(expected);
    expect(b).toHaveBeenCalledWith(expected);
    offA();
    offB();
  });

  it('truncates the preview at 80 chars', () => {
    const listener = vi.fn();
    const off = subscribe(listener);

    emitInboundMessage({ conversationId: 'conv-1', preview: 'x'.repeat(200) });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ preview: 'x'.repeat(80) }),
    );
    off();
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    off();

    emitInboundMessage({ conversationId: 'conv-1', preview: 'Oi' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('never propagates a throwing listener to the emitter (webhook safe)', () => {
    const boom = vi.fn(() => {
      throw new Error('listener quebrado');
    });
    const off = subscribe(boom);

    expect(() => emitInboundMessage({ conversationId: 'conv-1', preview: 'Oi' })).not.toThrow();
    off();
  });
});
