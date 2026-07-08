import { createAiClient } from '../lib/ai-client';
import {
  assertGoldenSetPassed,
  formatGoldenSetReport,
  loadGoldenCases,
  runGoldenSet,
} from '../lib/tawany/golden-set';

const main = async (): Promise<void> => {
  const cases = await loadGoldenCases();
  const result = await runGoldenSet({
    ai: createAiClient(),
    cases,
  });

  console.log(formatGoldenSetReport(result));
  assertGoldenSetPassed(result);
};

main().catch((error) => {
  console.error(`[golden-set] ${(error as Error).message}`);
  process.exitCode = 1;
});
