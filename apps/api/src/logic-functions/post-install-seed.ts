import { definePostInstallLogicFunction } from 'twenty-sdk/define';
import { createDataApi } from 'src/lib/data';
import { seed } from 'src/seed/seed';

export default definePostInstallLogicFunction({
  universalIdentifier: '1b498eb8-f7ff-4996-88d9-1ce075186a1b',
  name: 'post-install-seed',
  description: 'Idempotent seed: 1 clinic unit, 5 professionals, 5 services',
  handler: async (): Promise<void> => {
    const { created } = await seed(createDataApi());
    console.log(`[seed] created ${created} records`);
  },
});
