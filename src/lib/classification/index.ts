// Barrel for the classification module. Every consumer
// (tawany-handler, lead-scorer, future bots) imports from here.
export {
  ClassificationResult,
  INTENCAO_PRINCIPAL,
  TEMPERATURA,
  PRIORIDADE,
  PIPELINE_FUNIL,
  type ClassificationResult as ClassificationResultType,
} from './schema';
