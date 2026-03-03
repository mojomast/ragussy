import path from 'path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import TurndownService from 'turndown';
import {
  normalizeIntent,
  type ConversionIntent,
  type SummaryStyle,
} from './document-conversion-intent.js';
import { getChatModel } from './llm.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  hr: '---',
});

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);
const PLAINTEXT_EXTENSIONS = new Set([
  '.txt',
  '.text',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.rst',
  '.adoc',
]);

const SECTION_NOTE_PREFIX = 'section_hint:';
const IGNORED_NOTE_PREFIX = 'ignored:';
const BLOCKED_BINARY_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.bin',
  '.msi',
  '.apk',
  '.ipa',
  '.dmg',
  '.pkg',
  '.iso',
  '.jar',
  '.class',
]);

const TEXT_LIKE_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/x-sh',
]);

export interface RawDocumentInput {
  fileName: string;
  mimeType?: string | null;
  bytes: Uint8Array;
}

export interface ConvertedDocument {
  fileName: string;
  markdown: string;
  sourceFormat: 'md' | 'txt' | 'html' | 'docx' | 'pdf';
  warnings: string[];
}

export interface IntentConvertedDocument extends ConvertedDocument {
  appliedActions: string[];
  ignoredInstructions: string[];
}

function decodeUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf-8');
}

function sanitizeOutputName(fileName: string): string {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  const safeBase = base
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');

  const finalBase = safeBase.length > 0 ? safeBase : 'document';
  return `${finalBase}.md`;
}

function unsupportedFormatError(ext: string, mimeType?: string | null): never {
  const hint = mimeType ? ` (${mimeType})` : '';
  throw new Error(
    `Unsupported document format: ${ext || 'unknown'}${hint}. ` +
      'Supported formats: .md, .txt, .html, .docx, .pdf'
  );
}

function isLikelyTextMime(mimeType?: string | null): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return normalized.startsWith('text/') || TEXT_LIKE_MIME_TYPES.has(normalized);
}

function assertSupportedAttachmentType(fileName: string, mimeType?: string | null): void {
  const ext = path.extname(fileName).toLowerCase();
  const normalizedMime = mimeType?.toLowerCase().split(';')[0].trim();

  if (BLOCKED_BINARY_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported executable/binary file: ${ext}`);
  }

  if (!normalizedMime) {
    return;
  }

  if (normalizedMime === 'application/octet-stream') {
    if (
      !MARKDOWN_EXTENSIONS.has(ext) &&
      !PLAINTEXT_EXTENSIONS.has(ext) &&
      ext !== '.html' &&
      ext !== '.htm' &&
      ext !== '.docx' &&
      ext !== '.pdf'
    ) {
      throw new Error(`Unsupported binary upload: ${fileName}`);
    }
    return;
  }

  if (ext === '.pdf' && normalizedMime !== 'application/pdf') {
    throw new Error(`MIME/extension mismatch: expected application/pdf for ${ext}`);
  }

  if (
    ext === '.docx' &&
    normalizedMime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    throw new Error(`MIME/extension mismatch: expected DOCX mime type for ${ext}`);
  }

  if ((ext === '.html' || ext === '.htm') && normalizedMime !== 'text/html') {
    throw new Error(`MIME/extension mismatch: expected text/html for ${ext}`);
  }

  if ((MARKDOWN_EXTENSIONS.has(ext) || PLAINTEXT_EXTENSIONS.has(ext)) && !isLikelyTextMime(normalizedMime)) {
    throw new Error(`MIME/extension mismatch: expected text-like mime type for ${ext}`);
  }
}

export async function convertDocument(input: RawDocumentInput): Promise<ConvertedDocument> {
  const ext = path.extname(input.fileName).toLowerCase();
  const mimeType = input.mimeType?.toLowerCase();
  const outputName = sanitizeOutputName(input.fileName);

  assertSupportedAttachmentType(input.fileName, mimeType);

  if (MARKDOWN_EXTENSIONS.has(ext) || mimeType === 'text/markdown') {
    return {
      fileName: outputName,
      markdown: decodeUtf8(input.bytes).trim(),
      sourceFormat: 'md',
      warnings: [],
    };
  }

  if (
    PLAINTEXT_EXTENSIONS.has(ext) ||
    (mimeType?.startsWith('text/') && mimeType !== 'text/html')
  ) {
    return {
      fileName: outputName,
      markdown: decodeUtf8(input.bytes).trim(),
      sourceFormat: 'txt',
      warnings: [],
    };
  }

  if (ext === '.html' || ext === '.htm' || mimeType === 'text/html') {
    const html = decodeUtf8(input.bytes);
    const markdown = turndown.turndown(html).trim();

    return {
      fileName: outputName,
      markdown,
      sourceFormat: 'html',
      warnings: [],
    };
  }

  if (
    ext === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const { value, messages } = await mammoth.convertToHtml({
      buffer: Buffer.from(input.bytes),
    });

    return {
      fileName: outputName,
      markdown: turndown.turndown(value).trim(),
      sourceFormat: 'docx',
      warnings: messages.map(msg => msg.message),
    };
  }

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const parsed = await pdfParse(Buffer.from(input.bytes));
    const markdown = parsed.text.trim();

    if (!markdown) {
      return {
        fileName: outputName,
        markdown: '',
        sourceFormat: 'pdf',
        warnings: ['PDF text extraction returned empty content (possibly scanned/image-only PDF).'],
      };
    }

    return {
      fileName: outputName,
      markdown,
      sourceFormat: 'pdf',
      warnings: [],
    };
  }

  unsupportedFormatError(ext, mimeType);
}

export async function convertDocumentWithIntent(
  input: RawDocumentInput,
  intentInput: unknown
): Promise<IntentConvertedDocument> {
  const intent = normalizeIntent(intentInput);
  const base = await convertDocument(input);
  let markdown = base.markdown;

  const appliedActions: string[] = ['convert'];
  const ignoredInstructions = intent.notes
    .filter(note => note.startsWith(IGNORED_NOTE_PREFIX))
    .map(note => note.slice(IGNORED_NOTE_PREFIX.length).trim())
    .filter(Boolean);

  if (intent.operation === 'clean_markdown') {
    markdown = normalizeMarkdown(markdown);
    appliedActions.push('clean_markdown');
  }

  if (intent.stripBoilerplate) {
    const stripped = stripBoilerplateLines(markdown);
    if (stripped !== markdown) {
      markdown = stripped;
      appliedActions.push('strip_boilerplate');
    } else {
      ignoredInstructions.push('No boilerplate patterns were found to strip.');
    }
  }

  if (!intent.preserveLinks) {
    const withoutLinks = removeMarkdownLinks(markdown);
    if (withoutLinks !== markdown) {
      markdown = withoutLinks;
      appliedActions.push('remove_links');
    }
  }

  if (!intent.preserveTables) {
    const withoutTables = removeMarkdownTables(markdown);
    if (withoutTables !== markdown) {
      markdown = withoutTables;
      appliedActions.push('remove_tables');
    }
  }

  if (intent.operation === 'extract_sections') {
    const hints = intent.notes
      .filter(note => note.startsWith(SECTION_NOTE_PREFIX))
      .map(note => note.slice(SECTION_NOTE_PREFIX.length).trim())
      .filter(Boolean);

    if (hints.length === 0) {
      ignoredInstructions.push('extract_sections requested without section names; document left unchanged.');
    } else {
      const extracted = extractSectionsByHeadings(markdown, hints);
      if (extracted) {
        markdown = extracted;
        appliedActions.push('extract_sections');
      } else {
        ignoredInstructions.push('Requested sections were not found in the document headings.');
      }
    }
  }

  if (intent.operation === 'summarize') {
    markdown = await summarizeWithLlm(markdown, intent.summaryStyle ?? 'short');
    appliedActions.push(`summarize:${intent.summaryStyle ?? 'short'}`);
  }

  if (intent.includeMetadata) {
    markdown = prependMetadata(markdown, base.sourceFormat, intent.operation);
    appliedActions.push('include_metadata');
  }

  const fileName = intent.outputFileName
    ? sanitizeOutputName(intent.outputFileName)
    : base.fileName;

  const dedupedIgnored = Array.from(new Set(ignoredInstructions));

  return {
    fileName,
    markdown: normalizeMarkdown(markdown),
    sourceFormat: base.sourceFormat,
    warnings: [...base.warnings, ...dedupedIgnored.map(note => `Ignored instruction: ${note}`)],
    appliedActions,
    ignoredInstructions: dedupedIgnored,
  };
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripBoilerplateLines(markdown: string): string {
  const patterns = [
    /^\s*(home|about|privacy|terms|cookie policy|all rights reserved)\s*$/i,
    /^\s*(copyright|©)\b/i,
    /^\s*(navigation|footer|legal notice)\s*$/i,
    /^\s*powered by\b/i,
  ];

  return markdown
    .split('\n')
    .filter(line => !patterns.some(pattern => pattern.test(line.trim())))
    .join('\n')
    .trim();
}

function removeMarkdownLinks(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

function removeMarkdownTables(markdown: string): string {
  return markdown
    .split('\n')
    .filter(line => !isTableLine(line))
    .join('\n')
    .trim();
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;

  const isMarkdownRow = /^\|.*\|$/.test(trimmed);
  const isDivider = /^\|?\s*[-:]+(\s*\|\s*[-:]+)+\s*\|?$/.test(trimmed);
  return isMarkdownRow || isDivider;
}

function extractSectionsByHeadings(markdown: string, sectionHints: string[]): string | null {
  const lines = markdown.split('\n');
  const headingIndices: Array<{ index: number; title: string; level: number }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match?.[1]) {
      headingIndices.push({
        index: i,
        level: match[1].length,
        title: match[2].trim(),
      });
    }
  }

  if (headingIndices.length === 0) {
    return null;
  }

  const selectedSections: string[] = [];
  const selectedStarts = new Set<number>();

  for (const hint of sectionHints) {
    const normalizedHint = hint.toLowerCase();
    const target = headingIndices.find(heading => heading.title.toLowerCase().includes(normalizedHint));
    if (!target || selectedStarts.has(target.index)) {
      continue;
    }

    selectedStarts.add(target.index);

    const startIndex = target.index;
    const currentHeadingPosition = headingIndices.findIndex(heading => heading.index === startIndex);
    let nextHeadingIndex = lines.length;

    if (currentHeadingPosition >= 0) {
      for (let i = currentHeadingPosition + 1; i < headingIndices.length; i += 1) {
        if (headingIndices[i].level <= target.level) {
          nextHeadingIndex = headingIndices[i].index;
          break;
        }
      }
    }

    selectedSections.push(lines.slice(startIndex, nextHeadingIndex).join('\n').trim());
  }

  if (selectedSections.length === 0) {
    return null;
  }

  return ['# Extracted Sections', '', ...selectedSections].join('\n\n').trim();
}

async function summarizeWithLlm(markdown: string, style: SummaryStyle): Promise<string> {
  try {
    const model = getChatModel();
    const maxInputChars = 14000;
    const truncated = markdown.length > maxInputChars
      ? `${markdown.slice(0, maxInputChars)}\n\n[truncated for summarization]`
      : markdown;

    const styleInstruction = style === 'bullets'
      ? 'Return a concise bullet list with key points.'
      : style === 'detailed'
        ? 'Return a detailed multi-paragraph summary.'
        : 'Return a brief summary in 3-5 sentences.';

    const prompt = [
      'Summarize the following markdown content.',
      styleInstruction,
      'Do not invent facts, and do not add source links.',
      'Return markdown only.',
      '',
      '--- BEGIN CONTENT ---',
      truncated,
      '--- END CONTENT ---',
    ].join('\n');

    const response = await model.invoke([{ role: 'user', content: prompt }]);
    return String(response.content).trim();
  } catch {
    return summarizeWithoutLlm(markdown, style);
  }
}

function summarizeWithoutLlm(markdown: string, style: SummaryStyle): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return '# Summary\n\nNo text content was available to summarize.';
  }

  if (style === 'bullets') {
    return ['# Summary', '', ...sentences.slice(0, 6).map(sentence => `- ${sentence}`)].join('\n');
  }

  if (style === 'detailed') {
    return ['# Summary', '', ...chunkSentences(sentences.slice(0, 12), 3)].join('\n\n');
  }

  return ['# Summary', '', sentences.slice(0, 4).join(' ')].join('\n\n');
}

function chunkSentences(sentences: string[], size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += size) {
    chunks.push(sentences.slice(i, i + size).join(' '));
  }
  return chunks;
}

function prependMetadata(markdown: string, sourceFormat: string, operation: ConversionIntent['operation']): string {
  const metadata = [
    '---',
    `source_format: ${sourceFormat}`,
    `operation: ${operation}`,
    `converted_at: ${new Date().toISOString()}`,
    '---',
    '',
  ];

  return `${metadata.join('\n')}${markdown}`;
}
