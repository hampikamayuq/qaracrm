import { z } from 'zod';
import type { DataApi } from 'src/lib/data';
import { readLead } from './readLead';
import { readPatient } from './readPatient';
import { readConversationHistory } from './readConversationHistory';
import { listProfessionals } from './listProfessionals';
import { listServices } from './listServices';
import { searchKnowledge } from './searchKnowledge';
import { checkBotFaq } from './checkBotFaq';
import { updateLead } from './updateLead';
import { updateConversation } from './updateConversation';
import { assignTag } from './assignTag';
import { createActivity } from './createActivity';
import { sendWhatsApp } from './sendWhatsApp';
import { handoffToHuman } from './handoffToHuman';

export type TawanyTool = {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: never, ctx: DataApi & { testMode?: boolean }) => Promise<string>;
};

export const ALL_TOOLS: TawanyTool[] = [
  readLead,
  readPatient,
  readConversationHistory,
  listProfessionals,
  listServices,
  searchKnowledge,
  checkBotFaq,
  updateLead,
  updateConversation,
  assignTag,
  createActivity,
  handoffToHuman,
];

// ponytail: sendWhatsApp stays out of the model schema on purpose — the
// handler calls it after a final, guard-passed reply, so letting the model
// invoke it AND return a free-text reply in the same iteration is a double-send.
// Logic-functions and other handlers import INTERNAL_TOOLS by name and call
// the tool function directly.
const INTERNAL_TOOLS: TawanyTool[] = [sendWhatsApp];

const zodFieldToJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  if (schema instanceof z.ZodOptional) return zodFieldToJsonSchema(schema.unwrap() as z.ZodTypeAny);
  if (schema instanceof z.ZodDefault)
    return zodFieldToJsonSchema((schema as z.ZodDefault<z.ZodTypeAny>).def.innerType);
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
  if (schema instanceof z.ZodObject) return zodToJsonSchema(schema);
  return { type: 'string' };
};

const zodToJsonSchema = (schema: z.ZodTypeAny): Record<string, unknown> => {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodFieldToJsonSchema(value);
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) required.push(key);
    }
    return { type: 'object', properties, required };
  }
  return { type: 'object', additionalProperties: true };
};

export const tawanyTools = {
  schema: ALL_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters),
    },
  })),
  async execute(name: string, argsJson: string, ctx: DataApi): Promise<string> {
    const tool = [...ALL_TOOLS, ...INTERNAL_TOOLS].find((t) => t.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson);
    } catch (e) {
      throw new Error(`Invalid JSON args for ${name}: ${(e as Error).message}`);
    }
    const validated = tool.parameters.parse(parsed) as never;
    return tool.execute(validated, ctx);
  },
};
