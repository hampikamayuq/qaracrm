// Barrel for the lead-score library. The orchestrator and LF import from
// here so the directory is treated as a single unit by callers.

export { heuristicScore } from './heuristic';
export type { HeuristicLead, HeuristicMessage, HeuristicResult } from './heuristic';
