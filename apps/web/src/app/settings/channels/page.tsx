'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Plus, Power, QrCode, Smartphone, Trash2, Unplug } from 'lucide-react';
import { api, type WhatsAppChannel, type WhatsAppChannelStatus } from '@/lib/api';

const STATUS_META: Record<WhatsAppChannelStatus, { label: string; chip: string }> = {
  CONNECTED: { label: 'Conectado', chip: 'chip-ok' },
  PAIRING: { label: 'Pareando', chip: 'chip-warning' },
  DISCONNECTED: { label: 'Desconectado', chip: 'chip-danger' },
};

const formatDate = (value: string | null | undefined) => (
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
);

const asDataUri = (qr: string) => (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`);

// Enquanto o painel de pareamento está aberto: status a cada 3s (fecha ao
// conectar) e QR novo a cada 30s (o QR do WhatsApp expira em ~40s).
const STATUS_POLL_MS = 3000;
const QR_REFRESH_MS = 30_000;

export default function ChannelsPage() {
  const [channels, setChannels] = useState<WhatsAppChannel[]>([]);
  const [evolutionConfigured, setEvolutionConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // Instância com o painel de pareamento aberto + QR atual.
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const timersRef = useRef<{ status?: number; qr?: number }>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getChannels();
      setChannels(data.items);
      setEvolutionConfigured(data.evolutionConfigured);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(''), 4000);
  };

  const stopPairing = useCallback(() => {
    if (timersRef.current.status) window.clearInterval(timersRef.current.status);
    if (timersRef.current.qr) window.clearInterval(timersRef.current.qr);
    timersRef.current = {};
    setPairingId(null);
    setQr(null);
  }, []);

  // Cleanup dos timers ao sair da página.
  useEffect(() => stopPairing, [stopPairing]);

  const startPairing = async (channel: WhatsAppChannel) => {
    stopPairing();
    setPairingId(channel.id);
    setQr(null);

    const fetchQr = async () => {
      const res = await api.getChannelQr(channel.id);
      if (!res.success) {
        flash(res.error ?? 'Falha ao buscar o QR code.');
        stopPairing();
        return;
      }
      setQr(res.data?.qrBase64 ?? null);
    };
    await fetchQr();

    timersRef.current.qr = window.setInterval(() => void fetchQr(), QR_REFRESH_MS);
    timersRef.current.status = window.setInterval(async () => {
      const res = await api.getChannelStatus(channel.id);
      const status = res.data?.status;
      if (status) {
        setChannels((current) => current.map((c) => (c.id === channel.id ? { ...c, ...res.data } : c)));
      }
      if (status === 'CONNECTED') {
        stopPairing();
        flash(`Número "${channel.name}" conectado.`);
        void reload();
      }
    }, STATUS_POLL_MS);
  };

  const create = async () => {
    if (!newName.trim()) {
      flash('Dê um nome ao número (ex.: Recepção, Comercial).');
      return;
    }
    setCreating(true);
    try {
      const res = await api.createChannel(newName.trim());
      if (!res.success) {
        flash(res.error ?? 'Falha ao criar o número.');
        return;
      }
      setNewName('');
      flash('Número criado. Clique em Conectar para parear com o QR code.');
      await reload();
    } finally {
      setCreating(false);
    }
  };

  const disconnect = async (channel: WhatsAppChannel) => {
    const res = await api.disconnectChannel(channel.id);
    if (!res.success) {
      flash(res.error ?? 'Falha ao desconectar.');
      return;
    }
    if (pairingId === channel.id) stopPairing();
    flash(`Número "${channel.name}" desconectado.`);
    await reload();
  };

  const remove = async (channel: WhatsAppChannel) => {
    if (!window.confirm(`Remover o número "${channel.name}"? As conversas existentes ficam no histórico.`)) return;
    const res = await api.deleteChannel(channel.id);
    if (!res.success) {
      flash(res.error ?? 'Falha ao remover.');
      return;
    }
    if (pairingId === channel.id) stopPairing();
    flash(`Número "${channel.name}" removido.`);
    await reload();
  };

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 className="title-large">Canais de atendimento</h1>
          <div className="muted">
            Número oficial (Meta Cloud API) + números extras conectados por QR code via gateway Evolution.
          </div>
        </div>
      </div>

      {feedback ? <div className="flash" role="status">{feedback}</div> : null}

      <section aria-labelledby="official-channel-title">
        <h2 className="section-title" id="official-channel-title">
          <Smartphone size={15} /> Número oficial
        </h2>
        <div className="card">
          <div className="card-head">
            <strong>WhatsApp oficial (Meta Cloud API)</strong>
            <span className="chip chip-accent">Tawany + automações</span>
          </div>
          <div className="muted">
            Configurado por variáveis de ambiente da API (META_PHONE_NUMBER_ID). Templates, lembretes,
            follow-ups, NPS e a Tawany operam exclusivamente neste número.
          </div>
        </div>
      </section>

      <section aria-labelledby="qr-channels-title">
        <h2 className="section-title" id="qr-channels-title">
          <QrCode size={15} /> Números extras via QR ({channels.length})
        </h2>

        {!evolutionConfigured ? (
          <div className="test-banner" role="alert">
            <AlertTriangle size={14} /> Gateway Evolution não configurado na API (EVOLUTION_BASE_URL,
            EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_SECRET, EVOLUTION_WEBHOOK_URL). Ver docs/whatsapp-qr-numeros.md.
          </div>
        ) : null}

        {loading ? <div className="card muted">Carregando…</div> : null}
        {!loading && channels.length === 0 ? (
          <div className="card muted">Nenhum número extra ainda. Adicione um abaixo e conecte pelo QR code.</div>
        ) : null}

        {channels.map((channel) => {
          const status = STATUS_META[channel.status] ?? STATUS_META.DISCONNECTED;
          const isPairing = pairingId === channel.id;
          return (
            <article className="card" key={channel.id}>
              <div className="card-head">
                <strong>{channel.name}</strong>
                <span className={`chip ${status.chip}`}>{status.label}</span>
              </div>
              <div className="muted">
                {channel.phoneNumber ? `+${channel.phoneNumber}` : 'Telefone aparece após o pareamento'}
                {' · '}última conexão: {formatDate(channel.lastConnectedAt)}
              </div>
              {isPairing ? (
                <div className="qr-pairing">
                  {qr ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- QR efêmero em data-uri, next/image não se aplica */
                    <img
                      src={asDataUri(qr)}
                      alt={`QR code para parear o número ${channel.name}`}
                      width={240}
                      height={240}
                    />
                  ) : (
                    <div className="muted">Gerando QR code…</div>
                  )}
                  <div className="muted">
                    No celular do número: WhatsApp → Configurações → Dispositivos conectados →
                    Conectar dispositivo → aponte a câmera para o QR. O código renova sozinho a cada 30s.
                  </div>
                </div>
              ) : null}
              <div className="suggestion-actions">
                {channel.status !== 'CONNECTED' && !isPairing ? (
                  <button className="btn btn-primary" type="button" onClick={() => void startPairing(channel)}>
                    <QrCode size={14} />Conectar
                  </button>
                ) : null}
                {isPairing ? (
                  <button className="btn" type="button" onClick={stopPairing}>
                    Fechar pareamento
                  </button>
                ) : null}
                {channel.status === 'CONNECTED' ? (
                  <button className="btn" type="button" onClick={() => void disconnect(channel)}>
                    <Unplug size={14} />Desconectar
                  </button>
                ) : null}
                <button
                  className="btn btn-danger"
                  type="button"
                  aria-label={`Remover número: ${channel.name}`}
                  onClick={() => void remove(channel)}
                >
                  <Trash2 size={14} />Remover
                </button>
              </div>
            </article>
          );
        })}

        <div className="card">
          <label className="field">
            <span>Nome do novo número (uso interno)</span>
            <input
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ex.: Recepção, Comercial, Dra. Ana"
              disabled={!evolutionConfigured}
            />
          </label>
          <div className="suggestion-actions">
            <button
              className="btn btn-primary"
              type="button"
              disabled={creating || !evolutionConfigured}
              onClick={() => void create()}
            >
              <Plus size={14} />{creating ? 'Criando…' : 'Adicionar número'}
            </button>
          </div>
        </div>

        <div className="test-banner" role="note">
          <Power size={14} /> Números conectados por QR são <strong>atendimento humano apenas</strong>:
          sem Tawany, bots, follow-ups ou lembretes automáticos. A conexão usa um gateway não-oficial
          (fora dos termos do WhatsApp) — há risco de banimento do número. Use somente números
          secundários; o número principal da clínica fica na Cloud API oficial.
        </div>
      </section>
    </main>
  );
}
