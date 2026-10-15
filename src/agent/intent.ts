import OpenAIConstructor from 'openai';
import { ReadAgentError, type ReadIntent, type ResponsesProvider } from './types.js';

export const INTENT_SCHEMA = {
  type: 'object',
  properties: { intent: { type: 'string', enum: ['impact', 'prerequisites', 'owners', 'current_rationale', 'history'] } },
  required: ['intent'],
  additionalProperties: false,
} as const;

export function parseIntentOutput(text: string): ReadIntent {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ReadAgentError('invalid_model_output', 'Intent output was not valid JSON'); }
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || typeof value.intent !== 'string') {
    throw new ReadAgentError('invalid_model_output', 'Intent output was outside the supported enum');
  }
  if (!['impact', 'prerequisites', 'owners', 'current_rationale', 'history'].includes(value.intent)) {
    throw new ReadAgentError('unsupported_intent', 'Model selected an unsupported read intent');
  }
  return value.intent as ReadIntent;
}

export function openAIResponsesProvider(apiKey: string): ResponsesProvider {
  if (!apiKey) throw new ReadAgentError('drafting_unavailable', 'Provider credential is unavailable');
  const client = new OpenAIConstructor({ apiKey, maxRetries: 0, timeout: 30_000 });
  return {
    create: (request, options) => client.responses.create(request, options),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
