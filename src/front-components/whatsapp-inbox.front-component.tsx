import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { createDataApi } from 'src/lib/data';
import { WHATSAPP_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

type ConversationRow = {
  id: string;
  externalId: string;
  status: string;
  needsHuman: boolean;
  lastMessageAt: string;
};

type MessageRow = {
  id: string;
  direction: 'IN' | 'OUT';
  body: string;
  sentAt: string;
};

const bubbleStyle = (mine: boolean): React.CSSProperties => ({
  alignSelf: mine ? 'flex-end' : 'flex-start',
  background: mine ? '#1a7f64' : '#f0f0f0',
  color: mine ? '#fff' : '#222',
  padding: '8px 14px',
  borderRadius: '16px',
  maxWidth: '70%',
  margin: '4px 0',
  fontSize: '14px',
});

const MessageThread = ({ conversationId }: { conversationId: string }) => {
  const [messages, setMessages] = useState<MessageRow[]>([]);

  useEffect(() => {
    void (async () => {
      const m = await createDataApi().list('chatMessage', {
        filter: { conversationId: { eq: conversationId } },
        orderBy: { sentAt: 'ASC' },
        select: { id: true, direction: true, body: true, sentAt: true },
      });
      setMessages(m as MessageRow[]);
    })();
  }, [conversationId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '12px', overflowY: 'auto' }}>
      {messages.map((m) => (
        <div key={m.id} style={bubbleStyle(m.direction === 'OUT')}>
          {m.body}
        </div>
      ))}
    </div>
  );
};

export const WhatsappInbox = () => {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    const c = (await createDataApi().list('conversation', {
      filter: { status: { in: ['OPEN', 'NEEDS_HUMAN'] } },
      orderBy: { lastMessageAt: 'DESC' },
      select: { id: true, externalId: true, status: true, needsHuman: true, lastMessageAt: true },
    })) as ConversationRow[];
    setConversations(c);
    if (c.length > 0) setSelected((prev) => prev ?? c[0].id);
  };

  useEffect(() => {
    void load();
  }, []);

  const resolve = async (id: string): Promise<void> => {
    await createDataApi().update('conversation', id, { status: 'RESOLVED', needsHuman: false });
    await load();
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', height: '100%', fontFamily: 'sans-serif' }}>
      <aside style={{ borderRight: '1px solid #e0e0e0', overflowY: 'auto' }}>
        <header style={{ padding: '12px 16px', fontWeight: 600, fontSize: '16px' }}>Inbox</header>
        {conversations.map((c) => (
          <div key={c.id}>
            <button
              type="button"
              onClick={() => setSelected(c.id)}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 16px',
                textAlign: 'left',
                background: c.id === selected ? '#f5f5f5' : 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <strong>{c.needsHuman ? '🔴 ' : ''}{c.externalId}</strong>
              <div style={{ fontSize: '12px', color: '#777' }}>{c.status}</div>
            </button>
            {c.id === selected && (
              <button type="button" onClick={() => void resolve(c.id)} style={{ margin: '0 16px 8px' }}>
                Resolver
              </button>
            )}
          </div>
        ))}
      </aside>
      <main style={{ minHeight: 0 }}>
        {selected ? <MessageThread conversationId={selected} /> : <div style={{ padding: '16px' }}>Selecione uma conversa</div>}
      </main>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: WHATSAPP_INBOX_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'whatsapp-inbox',
  description: 'Inbox WhatsApp/IG: lista de conversas + thread + resolver',
  component: WhatsappInbox,
});
