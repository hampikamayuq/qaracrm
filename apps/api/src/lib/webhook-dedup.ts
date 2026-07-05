const DEDUP_WINDOW_MS = 5 * 60 * 1000;

type WebhookEventReader = {
  webhookEvent: {
    findFirst(args: {
      where: { source: string; signature: string; createdAt: { gte: Date } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

// ponytail: signature-based dedup. WAMID-based is more semantic, but signature
// is already persisted on WebhookEvent, so this avoids another schema change.
export const isDuplicateWebhook = async (
  prisma: WebhookEventReader,
  source: string,
  signature: string | null,
): Promise<boolean> => {
  if (!signature) return false;

  const existing = await prisma.webhookEvent.findFirst({
    where: {
      source,
      signature,
      createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
    },
    select: { id: true },
  });

  return existing !== null;
};
