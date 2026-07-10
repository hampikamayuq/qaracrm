// Notificações do inbox (Lote 2.1): o polling da lista detecta deltas no
// cliente — mensagem nova do paciente e handoff novo — para tocar um som curto
// e marcar o título da aba quando a equipe está em outra aba.

export type ConversationSnapshot = { lastMessageAt: string | null; needsHuman: boolean };

export type InboxDelta = { newMessages: number; newHandoffs: number };

type SnapshotItem = {
  id: string;
  needsHuman: boolean;
  lastMessageAt?: string | null;
  messages?: Array<{ direction?: string }>;
};

export const snapshotOf = (items: SnapshotItem[]): Map<string, ConversationSnapshot> =>
  new Map(items.map((item) => [item.id, {
    lastMessageAt: item.lastMessageAt ?? null,
    needsHuman: item.needsHuman,
  }]));

// Compara o snapshot anterior com a lista recém-carregada. `prev` null = primeira
// carga: só semeia, nunca notifica (evita rajada de sons ao abrir o inbox).
export const diffConversations = (
  prev: Map<string, ConversationSnapshot> | null,
  items: SnapshotItem[],
): InboxDelta => {
  const delta: InboxDelta = { newMessages: 0, newHandoffs: 0 };
  if (!prev) return delta;
  for (const item of items) {
    const before = prev.get(item.id);
    const lastInbound = item.messages?.[0]?.direction === 'IN';
    if (!before) {
      // conversa nova na janela do polling
      if (lastInbound) delta.newMessages += 1;
      if (item.needsHuman) delta.newHandoffs += 1;
      continue;
    }
    const last = item.lastMessageAt ?? '';
    if (lastInbound && last && last !== (before.lastMessageAt ?? '')) delta.newMessages += 1;
    if (item.needsHuman && !before.needsHuman) delta.newHandoffs += 1;
  }
  return delta;
};

// Som via WebAudio (sem asset): blip curto para mensagem, dois tons graves para
// handoff — realce distinto pedido no plano. Navegador pode bloquear áudio antes
// do primeiro gesto do usuário; falha é silenciosa de propósito.
let audioCtx: AudioContext | null = null;

const tone = (ctx: AudioContext, freq: number, at: number, duration: number): void => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
};

export const playNotificationSound = (kind: 'message' | 'handoff'): void => {
  try {
    audioCtx ??= new AudioContext();
    void audioCtx.resume?.();
    const now = audioCtx.currentTime;
    if (kind === 'handoff') {
      tone(audioCtx, 660, now, 0.14);
      tone(audioCtx, 494, now + 0.16, 0.2);
    } else {
      tone(audioCtx, 880, now, 0.12);
    }
  } catch {
    // sem áudio disponível — o badge no título ainda funciona
  }
};
