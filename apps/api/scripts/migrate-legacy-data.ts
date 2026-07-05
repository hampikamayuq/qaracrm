// One-off ETL: legacy `public` schema (live pre-standalone backend) -> new `app` schema.
// Read-only against OLD_DATABASE_URL; only ever writes to NEW_DATABASE_URL.
// Preserves original row ids so relations line up without an id-remap table.
// Idempotent: createMany + skipDuplicates, safe to re-run after a partial failure.
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const OLD_URL = process.env.OLD_DATABASE_URL;
const NEW_URL = process.env.NEW_DATABASE_URL;
if (!OLD_URL || !NEW_URL) {
  throw new Error('Set OLD_DATABASE_URL (public schema) and NEW_DATABASE_URL (app schema)');
}

const oldDb = new PrismaClient({ datasources: { db: { url: OLD_URL } } });
const newDb = new PrismaClient({ datasources: { db: { url: NEW_URL } } });

const ROLE_MAP: Record<string, string> = {
  ADMIN: 'admin',
  DOCTOR: 'medico',
  SECRETARY: 'recepcao',
  FINANCE: 'financeiro',
  MARKETING: 'marketing',
};

const CONVERSATION_STATUS_MAP: Record<string, string> = {
  OPEN: 'OPEN',
  WAITING_PATIENT: 'PENDING_PATIENT',
  WAITING_TEAM: 'PENDING_HUMAN',
  RESOLVED: 'RESOLVED',
  ARCHIVED: 'CLOSED',
};

const MESSAGE_DIRECTION_MAP: Record<string, string> = {
  INBOUND: 'IN',
  OUTBOUND: 'OUT',
  SYSTEM: 'SYSTEM',
};

const APPOINTMENT_STATUS_MAP: Record<string, string> = {
  SCHEDULED: 'SCHEDULED',
  CONFIRMED: 'CONFIRMED',
  ATTENDED: 'DONE',
  NO_SHOW: 'NO_SHOW',
  RESCHEDULED: 'SCHEDULED',
  CANCELED: 'CANCELLED',
};

const LEAD_STAGES = [
  'NEW', 'CONTACTED', 'WAITING_PATIENT', 'APPOINTMENT_SCHEDULED',
  'ATTENDED', 'BUDGET_SENT', 'PROCEDURE_SCHEDULED', 'LOST', 'REACTIVATE',
];

function tryParseMediaUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const candidate = m.mediaUrl ?? m.media_url ?? m.url;
  return typeof candidate === 'string' ? candidate : null;
}

async function main() {
  console.log('=== ClinicUnit ===');
  const clinicUnits = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "ClinicUnit"`);
  await newDb.clinicUnit.createMany({
    data: clinicUnits.map((r) => ({
      id: r.id as string, name: r.name as string, address: r.address as string | null,
      city: r.city as string | null, state: r.state as string | null, active: r.active as boolean,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${clinicUnits.length} migrated`);

  console.log('=== AppointmentType ===');
  const apptTypes = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "AppointmentType"`);
  await newDb.appointmentType.createMany({
    data: apptTypes.map((r) => ({
      id: r.id as string, name: r.name as string, durationMinutes: r.durationMinutes as number,
      basePrice: r.basePrice as Prisma.Decimal, requiresDoctor: r.requiresDoctor as boolean, active: r.active as boolean,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${apptTypes.length} migrated`);

  console.log('=== User ===');
  const users = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "User"`);
  const randomPassword = () => bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);
  await newDb.user.createMany({
    data: users.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      email: r.email as string,
      password: (r.passwordHash as string | null) ?? randomPassword(),
      role: ROLE_MAP[r.role as string] ?? (r.role as string).toLowerCase(),
      active: r.active as boolean,
      createdAt: r.createdAt as Date,
      updatedAt: r.updatedAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${users.length} migrated (any with null passwordHash got a random locked password — reset needed)`);

  console.log('=== Pipeline + PipelineStage ===');
  const pipeline = await newDb.pipeline.create({ data: { name: 'Funil Principal', order: 0 } });
  const stageIdByName = new Map<string, string>();
  for (let i = 0; i < LEAD_STAGES.length; i++) {
    const stage = await newDb.pipelineStage.create({
      data: { name: LEAD_STAGES[i], order: i, pipelineId: pipeline.id },
    });
    stageIdByName.set(LEAD_STAGES[i], stage.id);
  }
  console.log(`  1 pipeline, ${LEAD_STAGES.length} stages created`);

  console.log('=== Tag ===');
  const tags = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Tag"`);
  await newDb.tag.createMany({
    data: tags.map((r) => ({ id: r.id as string, name: r.name as string, color: r.color as string | null, createdAt: r.createdAt as Date })),
    skipDuplicates: true,
  });
  console.log(`  ${tags.length} migrated`);

  console.log('=== QuickReply ===');
  const quickReplies = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "QuickReply"`);
  await newDb.quickReply.createMany({
    data: quickReplies.map((r) => ({
      id: r.id as string, shortcut: r.shortcut as string, title: r.title as string, content: r.content as string,
      active: r.active as boolean, createdAt: r.createdAt as Date, updatedAt: r.updatedAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${quickReplies.length} migrated`);

  console.log('=== Bot ===');
  const bots = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Bot"`);
  await newDb.bot.createMany({
    data: bots.map((r) => ({
      id: r.id as string, name: r.name as string, trigger: r.trigger as string, active: r.active as boolean,
      steps: r.steps as Prisma.InputJsonValue, createdAt: r.createdAt as Date, updatedAt: r.updatedAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${bots.length} migrated`);

  console.log('=== Professional ===');
  const professionals = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Professional"`);
  await newDb.professional.createMany({
    data: professionals.map((r) => ({
      id: r.id as string, name: r.name as string, specialty: (r.specialty as string | null) ?? '',
      active: r.active as boolean, userId: r.userId as string | null, defaultUnitId: r.defaultUnitId as string | null,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${professionals.length} migrated`);

  console.log('=== Service ===');
  const services = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Service"`);
  await newDb.service.createMany({
    data: services.map((r) => ({
      id: r.id as string, name: r.name as string, category: r.category as string | null,
      priceCents: Math.round(Number(r.basePrice) * 100), active: r.active as boolean,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${services.length} migrated`);

  console.log('=== Lead ===');
  const leads = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Lead"`);
  await newDb.lead.createMany({
    data: leads.map((r) => ({
      id: r.id as string, name: r.name as string, phone: r.phone as string | null, email: r.email as string | null,
      source: r.source as string | null, intent: r.interest as string | null,
      score: r.score as number, stageId: stageIdByName.get(r.stage as string) ?? null,
      temperature: r.temperature as string | null, assignedToId: r.assignedToId as string | null,
      nextAction: r.nextAction as string | null, nextActionAt: r.nextActionAt as Date | null,
      lostReason: r.lostReason as string | null, estimatedValue: r.estimatedValue as Prisma.Decimal | null,
      classification: r.classification as Prisma.InputJsonValue | null,
      createdAt: r.createdAt as Date, updatedAt: r.updatedAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${leads.length} migrated`);

  console.log('=== Patient ===');
  const patients = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Patient"`);
  const leadIdByPatientId = new Map<string, string>();
  for (const lead of leads) {
    if (lead.patientId) leadIdByPatientId.set(lead.patientId as string, lead.id as string);
  }
  await newDb.patient.createMany({
    data: patients.map((r) => ({
      id: r.id as string, name: r.name as string, phone: r.phone as string | null, email: r.email as string | null,
      leadId: leadIdByPatientId.get(r.id as string) ?? null,
      cpf: r.cpf as string | null, birthDate: r.birthDate as Date | null,
      preferredChannel: r.preferredChannel as string | null, lgpdConsent: r.lgpdConsent as boolean,
      notesAdministrative: r.notesAdministrative as string | null,
      createdAt: r.createdAt as Date, updatedAt: r.updatedAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${patients.length} migrated`);

  console.log('=== Conversation ===');
  const conversations = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Conversation"`);
  const orphanConversations = conversations.filter((r) => !r.leadId);
  if (orphanConversations.length > 0) {
    console.warn(`  WARNING: ${orphanConversations.length} conversations have no leadId (required in new schema) — skipped:`, orphanConversations.map((r) => r.id));
  }
  await newDb.conversation.createMany({
    data: conversations.filter((r) => r.leadId).map((r) => ({
      id: r.id as string, leadId: r.leadId as string, patientId: r.patientId as string | null,
      status: CONVERSATION_STATUS_MAP[r.status as string] ?? 'OPEN',
      metaContactId: null, metaThreadId: null, externalId: r.externalId as string | null,
      channel: r.channel as string | null, lastMessageAt: r.lastMessageAt as Date | null,
      classification: r.classification as Prisma.InputJsonValue | null,
      assignedToId: r.assignedToId as string | null,
      createdAt: r.createdAt as Date, updatedAt: r.updatedAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${conversations.length - orphanConversations.length} migrated`);

  console.log('=== Message -> ChatMessage ===');
  const messages = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Message"`);
  await newDb.chatMessage.createMany({
    data: messages.map((r) => ({
      id: r.id as string, conversationId: r.conversationId as string,
      externalId: r.providerMessageId as string | null,
      direction: MESSAGE_DIRECTION_MAP[r.direction as string] ?? 'IN',
      body: r.text as string, mediaUrl: tryParseMediaUrl(r.metadata),
      agentHandled: false, sentAt: r.createdAt as Date, createdAt: r.createdAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${messages.length} migrated`);

  console.log('=== Appointment ===');
  const appointments = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Appointment"`);
  await newDb.appointment.createMany({
    data: appointments.map((r) => ({
      id: r.id as string, leadId: r.leadId as string | null, patientId: r.patientId as string | null,
      professionalId: r.professionalId as string | null, serviceId: null,
      unitId: r.unitId as string | null, appointmentTypeId: r.appointmentTypeId as string | null,
      scheduledAt: r.startAt as Date, endAt: r.endAt as Date | null,
      status: APPOINTMENT_STATUS_MAP[r.status as string] ?? 'SCHEDULED',
      value: r.value as Prisma.Decimal | null, notes: r.notesAdministrative as string | null,
      createdAt: r.createdAt as Date, updatedAt: r.updatedAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${appointments.length} migrated`);

  console.log('=== Activity ===');
  const activities = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Activity"`);
  await newDb.activity.createMany({
    data: activities.map((r) => {
      let targetType = 'lead';
      let targetId = r.id as string; // fallback: self-reference if row has no lead/patient/conversation link
      if (r.conversationId) { targetType = 'conversation'; targetId = r.conversationId as string; }
      else if (r.leadId) { targetType = 'lead'; targetId = r.leadId as string; }
      else if (r.patientId) { targetType = 'patient'; targetId = r.patientId as string; }
      return {
        id: r.id as string, targetType, targetId,
        body: (r.description as string | null) ?? (r.title as string),
        conversationId: r.conversationId as string | null,
        userId: r.userId as string | null, type: r.type as string | null, title: r.title as string,
        createdAt: r.createdAt as Date,
      };
    }),
    skipDuplicates: true,
  });
  console.log(`  ${activities.length} migrated`);

  console.log('=== Task ===');
  const tasks = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Task"`);
  await newDb.task.createMany({
    data: tasks.map((r) => ({
      id: r.id as string, title: r.title as string, description: r.description as string | null,
      status: r.status as string, priority: 'MEDIUM', conversationId: null,
      leadId: r.leadId as string | null, patientId: r.patientId as string | null,
      assignedToId: r.assignedToId as string | null, dueAt: r.dueAt as Date | null,
      createdAt: r.createdAt as Date, updatedAt: r.updatedAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${tasks.length} migrated`);

  console.log('=== Payment ===');
  const payments = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Payment"`);
  await newDb.payment.createMany({
    data: payments.map((r) => ({
      id: r.id as string, amount: r.amount as Prisma.Decimal, method: r.method as string,
      installments: r.installments as number, cardFee: r.cardFee as Prisma.Decimal | null,
      paidAt: r.paidAt as Date | null, status: r.status as string, createdAt: r.createdAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${payments.length} migrated`);

  console.log('=== AuditLog ===');
  const auditLogs = await oldDb.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "AuditLog"`);
  await newDb.auditLog.createMany({
    data: auditLogs.map((r) => ({
      id: r.id as string, userId: r.userId as string | null, action: r.action as string,
      entity: r.entity as string, entityId: r.entityId as string,
      before: r.before as Prisma.InputJsonValue | null, after: r.after as Prisma.InputJsonValue | null,
      createdAt: r.createdAt as Date,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${auditLogs.length} migrated`);

  console.log('\nDone.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await oldDb.$disconnect(); await newDb.$disconnect(); });
