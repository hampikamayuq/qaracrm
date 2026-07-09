// Cria/atualiza o usuário de serviço usado pelo servidor MCP (packages/mcp) para
// autenticar contra a API via POST /api/auth/login — o MCP não tem acesso
// direto ao Prisma, então precisa de uma conta real na tabela User.
//
// Idempotente: se o email já existir, apenas atualiza a senha/role/active.
//
// Uso (a partir de apps/api):
//   MCP_USER_EMAIL=mcp@qara.local MCP_USER_PASSWORD='senha-forte' npx tsx src/scripts/create-mcp-user.ts
// ou via script npm:
//   MCP_USER_EMAIL=mcp@qara.local MCP_USER_PASSWORD='senha-forte' pnpm mcp:user
//
// Argumentos de linha de comando (opcionais) sobrepõem as env vars:
//   npx tsx src/scripts/create-mcp-user.ts --email mcp@qara.local --password 'senha-forte' --role agente_ia
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/auth';

// Roles válidos hoje (schema.prisma, User.role é string livre documentada):
// "admin" | "recepcao" | "medico" | "financeiro" | "marketing" | "agente_ia"
const VALID_ROLES = ['admin', 'recepcao', 'medico', 'financeiro', 'marketing', 'agente_ia'] as const;
type Role = (typeof VALID_ROLES)[number];

const DEFAULT_ROLE: Role = 'agente_ia';
const DEFAULT_NAME = 'Assistente MCP (Claude)';

type Args = { email?: string; password?: string; role?: string; name?: string };

const parseArgs = (argv: string[]): Args => {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--email') args.email = value;
    if (flag === '--password') args.password = value;
    if (flag === '--role') args.role = value;
    if (flag === '--name') args.name = value;
  }
  return args;
};

const main = async (): Promise<void> => {
  const cli = parseArgs(process.argv.slice(2));
  const email = cli.email ?? process.env.MCP_USER_EMAIL ?? 'mcp@qara.local';
  const password = cli.password ?? process.env.MCP_USER_PASSWORD;
  const name = cli.name ?? process.env.MCP_USER_NAME ?? DEFAULT_NAME;
  const roleInput = cli.role ?? process.env.MCP_USER_ROLE ?? DEFAULT_ROLE;

  if (!password) {
    console.error(
      '[create-mcp-user] Informe a senha via MCP_USER_PASSWORD ou --password. Abortando (não crio usuário sem senha).',
    );
    process.exitCode = 1;
    return;
  }
  if (!(VALID_ROLES as readonly string[]).includes(roleInput)) {
    console.error(`[create-mcp-user] role inválida "${roleInput}". Valores aceitos: ${VALID_ROLES.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const role = roleInput as Role;

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.upsert({
      where: { email },
      create: { name, email, password: passwordHash, role, active: true },
      update: { name, password: passwordHash, role, active: true },
      select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
    });
    const created = user.createdAt.getTime() === user.updatedAt.getTime();
    console.log(
      `[create-mcp-user] usuário ${created ? 'criado' : 'atualizado'}: ${user.email} (id=${user.id}, role=${user.role})`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error('[create-mcp-user] failed:', error);
  process.exitCode = 1;
});
