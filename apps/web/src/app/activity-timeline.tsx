'use client';

import {
  ArrowRightLeft,
  Bot,
  CalendarDays,
  FileText,
  KanbanSquare,
  ListTodo,
  MessageSquare,
  Sparkles,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import type { TimelineItem } from '@/lib/api';

// Cor semântica por tipo: Tawany violeta, movimento teal, perda vermelho,
// task âmbar, agendamento azul.
const TYPE_META: Record<TimelineItem['type'], { icon: LucideIcon; tone: string }> = {
  stage_change: { icon: ArrowRightLeft, tone: 'tl-accent' },
  pipeline_change: { icon: KanbanSquare, tone: 'tl-accent' },
  note: { icon: StickyNote, tone: 'tl-muted' },
  task: { icon: ListTodo, tone: 'tl-warning' },
  appointment: { icon: CalendarDays, tone: 'tl-info' },
  messages: { icon: MessageSquare, tone: 'tl-muted' },
  suggestion: { icon: Sparkles, tone: 'tl-ai' },
  bot: { icon: Bot, tone: 'tl-info' },
  budget: { icon: FileText, tone: 'tl-info' },
};

const itemTone = (item: TimelineItem): string => {
  // ponytail: perda detectada pelo título (o backend não manda variante).
  if (item.type === 'stage_change' && item.title.includes('Perdido')) return 'tl-danger';
  if (item.type === 'note' && item.byName === 'Tawany') return 'tl-ai';
  return TYPE_META[item.type]?.tone ?? 'tl-muted';
};

export const relativeTime = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
};

export function ActivityTimeline({ items, emptyText }: { items: TimelineItem[]; emptyText: string }) {
  if (items.length === 0) {
    return <div className="tl-empty">{emptyText}</div>;
  }
  return (
    <ul className="tl">
      {items.map((item) => {
        const Icon = (TYPE_META[item.type] ?? TYPE_META.note).icon;
        return (
          <li key={item.id} className="tl-item">
            <span className={`tl-icon ${itemTone(item)}`} aria-hidden="true">
              <Icon size={13} />
            </span>
            <div className="tl-content">
              <div className="tl-title">{item.title}</div>
              {item.detail ? <div className="tl-detail">{item.detail}</div> : null}
              <div className="tl-meta faint">
                {item.byName ? `por ${item.byName} · ` : ''}
                <time dateTime={item.at} title={new Date(item.at).toLocaleString('pt-BR')}>{relativeTime(item.at)}</time>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
