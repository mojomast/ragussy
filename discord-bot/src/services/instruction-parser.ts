import { z } from 'zod';
import { env, logger } from '../config/index.js';
import {
  normalizeIntent,
  type ConversionIntent,
  type ConversionOperation,
  type SummaryStyle,
  conversionIntentSchema,
} from './conversion-intent.js';
import { ragApi, type RagApiClient } from './rag-api.js';

const SECTION_NOTE_PREFIX = 'section_hint:';
const IGNORED_NOTE_PREFIX = 'ignored:';

export type ParseMethod = 'rules' | 'llm-fallback';

export interface ParseIntentOptions {
  ragApiClient?: RagApiClient;
  timeoutMs?: number;
  defaultIngestNow?: boolean;
  defaultOutputFileName?: string;
}

export interface ParseIntentResult {
  intent: ConversionIntent;
  parseMethod: ParseMethod;
}

interface RuleParseResult {
  intent: ConversionIntent;
  matchedSignals: number;
  conflicts: string[];
}

export class IntentClarificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntentClarificationError';
  }
}

const llmIntentSchema = conversionIntentSchema.partial().extend({
  notes: z.array(z.string()).optional(),
});

export async function parseConversionInstructions(
  instructions: string,
  options: ParseIntentOptions = {}
): Promise<ParseIntentResult> {
  const trimmed = instructions.trim();

  if (!trimmed) {
    return {
      intent: applyDefaults(normalizeIntent({}), options),
      parseMethod: 'rules',
    };
  }

  const ruleParse = parseWithRules(trimmed);
  if (ruleParse.conflicts.length > 0) {
    throw new IntentClarificationError(ruleParse.conflicts.join(' '));
  }

  if (ruleParse.matchedSignals > 0) {
    return {
      intent: applyDefaults(ruleParse.intent, options),
      parseMethod: 'rules',
    };
  }

  const ragApiClient = options.ragApiClient ?? ragApi;
  const timeoutMs = options.timeoutMs ?? env.INSTRUCTION_PARSE_TIMEOUT_MS;

  try {
    const llmPrompt = buildLlmPrompt(trimmed);
    const llmResponse = await ragApiClient.chat({ message: llmPrompt }, timeoutMs);
    const parsedJson = JSON.parse(extractJsonObject(llmResponse.answer)) as unknown;
    const llmIntent = llmIntentSchema.parse(parsedJson);

    if (
      llmIntent.notes?.some(note => /\b(ambiguous|unclear|conflict|not sure)\b/i.test(note))
    ) {
      throw new IntentClarificationError(
        'Your instructions appear ambiguous. Please clarify the main operation and ingest behavior.'
      );
    }

    return {
      intent: applyDefaults(normalizeIntent(llmIntent), options),
      parseMethod: 'llm-fallback',
    };
  } catch (error) {
    logger.warn({ error }, 'Instruction parsing LLM fallback failed');
    throw new IntentClarificationError(
      'I could not confidently interpret those conversion instructions. Please rephrase with clear steps like "summarize in bullets, keep tables, do not ingest".'
    );
  }
}

export function getIgnoredInstructionNotes(intent: ConversionIntent): string[] {
  return intent.notes
    .filter(note => note.startsWith(IGNORED_NOTE_PREFIX))
    .map(note => note.slice(IGNORED_NOTE_PREFIX.length).trim())
    .filter(Boolean);
}

export function getSectionHints(intent: ConversionIntent): string[] {
  return intent.notes
    .filter(note => note.startsWith(SECTION_NOTE_PREFIX))
    .map(note => note.slice(SECTION_NOTE_PREFIX.length).trim())
    .filter(Boolean);
}

function parseWithRules(instructions: string): RuleParseResult {
  const lower = instructions.toLowerCase();
  const notes: string[] = [];
  let matchedSignals = 0;

  let operation: ConversionOperation = 'convert';
  let summaryStyle: SummaryStyle | undefined;
  let includeMetadata = false;
  let stripBoilerplate = false;
  let preserveLinks = true;
  let preserveTables = true;
  let ingestNow: boolean | undefined;
  let outputFileName: string | undefined;

  const conflicts: string[] = [];

  const operationMatches = new Set<ConversionOperation>();
  if (/\b(summarize|summary|tl;dr|tldr|bullet summary|bulleted summary)\b/i.test(instructions)) {
    operationMatches.add('summarize');
    matchedSignals += 1;
  }
  if (/\b(extract sections?|extract headings?|only sections?|only headings?)\b/i.test(instructions)) {
    operationMatches.add('extract_sections');
    matchedSignals += 1;
  }
  if (/\b(clean markdown|normalize markdown|tidy markdown|clean up markdown)\b/i.test(instructions)) {
    operationMatches.add('clean_markdown');
    matchedSignals += 1;
  }
  if (/\b(convert(?:\s+it|\s+this|\s+document)?\s+(?:to|into)\s+markdown)\b/i.test(instructions)) {
    matchedSignals += 1;
  }

  if (operationMatches.size > 1) {
    conflicts.push(
      'I found multiple primary operations in one request. Please choose one: convert, summarize, extract sections, or clean markdown.'
    );
  } else if (operationMatches.size === 1) {
    operation = operationMatches.values().next().value as ConversionOperation;
  }

  const unsupportedFormat = lower.match(/\b(?:to|into)\s+(html|txt|text|pdf|docx|json|xml)\b/i);
  if (unsupportedFormat) {
    notes.push(`${IGNORED_NOTE_PREFIX}Requested output format "${unsupportedFormat[1]}" is not supported yet; using markdown.`);
    matchedSignals += 1;
  }

  const bulletSummary = /\b(bullet summary|bulleted summary|in bullets|bullet points?)\b/i.test(instructions);
  const shortSummary = /\b(short summary|brief summary|concise summary)\b/i.test(instructions);
  const detailedSummary = /\b(detailed summary|long summary|full summary)\b/i.test(instructions);

  if (bulletSummary) {
    summaryStyle = 'bullets';
    matchedSignals += 1;
  }
  if (shortSummary) {
    if (summaryStyle && summaryStyle !== 'short') {
      conflicts.push('Your summary style is conflicting (both bullet/short/detailed). Please pick one style.');
    }
    summaryStyle = 'short';
    matchedSignals += 1;
  }
  if (detailedSummary) {
    if (summaryStyle && summaryStyle !== 'detailed') {
      conflicts.push('Your summary style is conflicting (both bullet/short/detailed). Please pick one style.');
    }
    summaryStyle = 'detailed';
    matchedSignals += 1;
  }

  const includeMetadataYes = /\b(include metadata|with metadata|add metadata)\b/i.test(instructions);
  const includeMetadataNo = /\b(without metadata|exclude metadata|no metadata)\b/i.test(instructions);
  if (includeMetadataYes && includeMetadataNo) {
    conflicts.push('You asked to both include and exclude metadata. Please choose one.');
  } else if (includeMetadataYes) {
    includeMetadata = true;
    matchedSignals += 1;
  } else if (includeMetadataNo) {
    includeMetadata = false;
    matchedSignals += 1;
  }

  const stripYes = /\b(remove boilerplate|strip boilerplate|remove footer|remove nav|remove legal)\b/i.test(instructions);
  const stripNo = /\b(keep boilerplate|do not remove boilerplate)\b/i.test(instructions);
  if (stripYes && stripNo) {
    conflicts.push('You asked to both keep and remove boilerplate. Please choose one.');
  } else if (stripYes) {
    stripBoilerplate = true;
    matchedSignals += 1;
  } else if (stripNo) {
    stripBoilerplate = false;
    matchedSignals += 1;
  }

  const keepLinks = /\b(keep links|preserve links)\b/i.test(instructions);
  const removeLinks = /\b(remove links|strip links|without links|no links)\b/i.test(instructions);
  if (keepLinks && removeLinks) {
    conflicts.push('You asked to both keep and remove links. Please choose one.');
  } else if (keepLinks) {
    preserveLinks = true;
    matchedSignals += 1;
  } else if (removeLinks) {
    preserveLinks = false;
    matchedSignals += 1;
  }

  const keepTables = /\b(keep tables|preserve tables)\b/i.test(instructions);
  const removeTables = /\b(remove tables|strip tables|without tables|no tables)\b/i.test(instructions);
  if (keepTables && removeTables) {
    conflicts.push('You asked to both keep and remove tables. Please choose one.');
  } else if (keepTables) {
    preserveTables = true;
    matchedSignals += 1;
  } else if (removeTables) {
    preserveTables = false;
    matchedSignals += 1;
  }

  const ingestYes = /\b(ingest now|index now|ingest immediately|upload and ingest)\b/i.test(instructions);
  const ingestNo = /\b(do not ingest|don't ingest|skip ingest|no ingest|upload only)\b/i.test(instructions);
  if (ingestYes && ingestNo) {
    conflicts.push('You asked to both ingest and skip ingest. Please pick one.');
  } else if (ingestYes) {
    ingestNow = true;
    matchedSignals += 1;
  } else if (ingestNo) {
    ingestNow = false;
    matchedSignals += 1;
  }

  const outputNameMatch =
    instructions.match(/\btarget[_\s-]?name\s*[:=]\s*["']?([^"'\n]+)["']?/i) ??
    instructions.match(/\boutput(?:[_\s-]?file)?(?:[_\s-]?name)?\s*[:=]\s*["']?([^"'\n]+)["']?/i) ??
    instructions.match(/\bname\s+(?:it|the output)\s+["']([^"']+)["']/i);
  if (outputNameMatch?.[1]) {
    outputFileName = outputNameMatch[1].trim();
    matchedSignals += 1;
  }

  if (operation === 'extract_sections') {
    const hints = extractSectionHintsFromInstructions(instructions);
    for (const hint of hints) {
      notes.push(`${SECTION_NOTE_PREFIX}${hint}`);
    }

    if (hints.length === 0) {
      notes.push(
        `${IGNORED_NOTE_PREFIX}No section names were detected for extract_sections, so the full document was kept.`
      );
    }
  }

  if (/\b(translate|run script|execute|shell command|python|javascript)\b/i.test(instructions)) {
    notes.push(
      `${IGNORED_NOTE_PREFIX}Execution or translation instructions are unsupported for document conversion and were ignored.`
    );
    matchedSignals += 1;
  }

  const intent = normalizeIntent({
    targetFormat: 'markdown',
    operation,
    summaryStyle,
    includeMetadata,
    stripBoilerplate,
    preserveLinks,
    preserveTables,
    ingestNow,
    outputFileName,
    notes,
  });

  return {
    intent,
    matchedSignals,
    conflicts,
  };
}

function applyDefaults(intent: ConversionIntent, options: ParseIntentOptions): ConversionIntent {
  return normalizeIntent({
    ...intent,
    ingestNow: intent.ingestNow ?? options.defaultIngestNow,
    outputFileName: intent.outputFileName ?? options.defaultOutputFileName,
  });
}

function extractSectionHintsFromInstructions(instructions: string): string[] {
  const matches: string[] = [];
  const sectionLineMatch = instructions.match(/\b(?:sections?|headings?)\s*[:=]\s*([^\n]+)/i);
  if (sectionLineMatch?.[1]) {
    matches.push(...splitHintList(sectionLineMatch[1]));
  }

  const extractMatch = instructions.match(
    /\bextract\s+(?:sections?|headings?)\s+(?:for|about|called|named)\s+([^\n.]+)/i
  );
  if (extractMatch?.[1]) {
    matches.push(...splitHintList(extractMatch[1]));
  }

  return Array.from(new Set(matches));
}

function splitHintList(value: string): string[] {
  return value
    .split(/,|\band\b/gi)
    .map(part => part.trim())
    .filter(part => part.length > 0 && part.length <= 80);
}

function buildLlmPrompt(instructions: string): string {
  return [
    'You are a strict conversion instruction parser.',
    'Return ONLY a JSON object with these fields:',
    '{',
    '  "targetFormat": "markdown",',
    '  "operation": "convert" | "summarize" | "extract_sections" | "clean_markdown",',
    '  "summaryStyle": "short" | "detailed" | "bullets" | null,',
    '  "includeMetadata": boolean,',
    '  "stripBoilerplate": boolean,',
    '  "preserveLinks": boolean,',
    '  "preserveTables": boolean,',
    '  "ingestNow": boolean | null,',
    '  "outputFileName": string | null,',
    '  "notes": string[]',
    '}',
    '',
    'Rules:',
    '- If user asks for unsupported output formats, set targetFormat to "markdown" and mention in notes.',
    '- If ambiguous, add a note describing ambiguity.',
    '- Use defaults: includeMetadata=false, stripBoilerplate=false, preserveLinks=true, preserveTables=true.',
    '- Do not include markdown code fences in your response.',
    '',
    `User instructions: ${instructions}`,
  ].join('\n');
}

function extractJsonObject(responseText: string): string {
  const fencedMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = responseText.indexOf('{');
  const lastBrace = responseText.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No JSON object found in parser response');
  }

  return responseText.slice(firstBrace, lastBrace + 1).trim();
}
