import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { execFile } from 'node:child_process';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import TurndownService from 'turndown';
import { env, logger } from '../config/index.js';
import {
  normalizeIntent,
  type ConversionIntent,
  type SummaryStyle,
} from './document-conversion-intent.js';
import { getChatModel } from './llm.js';
import { convertWithConvertWasm } from './convert-wasm-adapter.js';
import { resolveConverterEngineForFormat, type SourceFormatClass } from './converter-engine.js';

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
  sourceFormat: SourceFormatClass;
  converter: 'node-native' | 'convert-wasm';
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

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      if (stderr && stderr.trim().length > 0) {
        logger.debug({ command, stderr }, 'Command wrote to stderr');
      }

      resolve(stdout);
    });
  });
}

async function runPdfOcrFallback(pdfBuffer: Buffer): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = [];

  if (!env.OCR_FALLBACK_ENABLED) {
    return { text: '', warnings };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ragussy-ocr-'));
  const inputPdfPath = path.join(tempDir, 'input.pdf');
  const pagePrefix = path.join(tempDir, 'page');

  try {
    await fs.writeFile(inputPdfPath, pdfBuffer);

    try {
      await runCommand(
        'pdftoppm',
        ['-f', '1', '-l', String(env.OCR_MAX_PAGES), '-png', inputPdfPath, pagePrefix],
        env.OCR_COMMAND_TIMEOUT_MS
      );
    } catch (error) {
      warnings.push('OCR fallback unavailable: pdftoppm command failed or is not installed.');
      return { text: '', warnings };
    }

    const files = await fs.readdir(tempDir);
    const pageImages = files
      .filter(file => /^page-\d+\.png$/i.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (pageImages.length === 0) {
      warnings.push('OCR fallback produced no page images from PDF.');
      return { text: '', warnings };
    }

    const textParts: string[] = [];
    for (const imageFile of pageImages) {
      const imagePath = path.join(tempDir, imageFile);
      try {
        const ocrText = await runCommand(
          'tesseract',
          [imagePath, 'stdout', '-l', 'eng'],
          env.OCR_COMMAND_TIMEOUT_MS
        );
        if (ocrText.trim().length > 0) {
          textParts.push(ocrText.trim());
        }
      } catch {
        warnings.push(`OCR failed for ${imageFile}.`);
      }
    }

    if (textParts.length === 0) {
      warnings.push('OCR fallback ran but extracted no text.');
      return { text: '', warnings };
    }

    return {
      text: textParts.join('\n\n'),
      warnings,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
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

function detectSourceFormat(fileName: string, mimeType?: string | null): SourceFormatClass | null {
  const ext = path.extname(fileName).toLowerCase();
  const normalizedMime = mimeType?.toLowerCase();

  if (MARKDOWN_EXTENSIONS.has(ext) || normalizedMime === 'text/markdown') {
    return 'md';
  }

  if (
    PLAINTEXT_EXTENSIONS.has(ext) ||
    (normalizedMime?.startsWith('text/') && normalizedMime !== 'text/html')
  ) {
    return 'txt';
  }

  if (ext === '.html' || ext === '.htm' || normalizedMime === 'text/html') {
    return 'html';
  }

  if (
    ext === '.docx' ||
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }

  if (ext === '.pdf' || normalizedMime === 'application/pdf') {
    return 'pdf';
  }

  return null;
}

async function convertDocumentNodeNative(
  input: RawDocumentInput,
  sourceFormat: SourceFormatClass,
  outputName: string,
  preWarnings: string[] = []
): Promise<ConvertedDocument> {
  if (sourceFormat === 'md') {
    return {
      fileName: outputName,
      markdown: decodeUtf8(input.bytes).trim(),
      sourceFormat: 'md',
      converter: 'node-native',
      warnings: preWarnings,
    };
  }

  if (sourceFormat === 'txt') {
    return {
      fileName: outputName,
      markdown: decodeUtf8(input.bytes).trim(),
      sourceFormat: 'txt',
      converter: 'node-native',
      warnings: preWarnings,
    };
  }

  if (sourceFormat === 'html') {
    const html = decodeUtf8(input.bytes);
    const markdown = turndown.turndown(html).trim();

    return {
      fileName: outputName,
      markdown,
      sourceFormat: 'html',
      converter: 'node-native',
      warnings: preWarnings,
    };
  }

  if (sourceFormat === 'docx') {
    const { value, messages } = await mammoth.convertToHtml({
      buffer: Buffer.from(input.bytes),
    });

    return {
      fileName: outputName,
      markdown: turndown.turndown(value).trim(),
      sourceFormat: 'docx',
      converter: 'node-native',
      warnings: [...preWarnings, ...messages.map(msg => msg.message)],
    };
  }

  const parsed = await pdfParse(Buffer.from(input.bytes));
  let markdown = parsed.text.trim();
  const warnings: string[] = [...preWarnings];

  if (!markdown) {
    const ocr = await runPdfOcrFallback(Buffer.from(input.bytes));
    warnings.push(...ocr.warnings);

    if (ocr.text.trim()) {
      markdown = ocr.text.trim();
      warnings.push('Used OCR fallback for PDF text extraction.');
    }
  }

  if (!markdown) {
    warnings.push('PDF text extraction returned empty content (possibly scanned/image-only PDF).');
    return {
      fileName: outputName,
      markdown: '',
      sourceFormat: 'pdf',
      converter: 'node-native',
      warnings,
    };
  }

  return {
    fileName: outputName,
    markdown,
    sourceFormat: 'pdf',
    converter: 'node-native',
    warnings,
  };
}

export async function convertDocument(input: RawDocumentInput): Promise<ConvertedDocument> {
  const mimeType = input.mimeType?.toLowerCase();
  const outputName = sanitizeOutputName(input.fileName);

  assertSupportedAttachmentType(input.fileName, mimeType);

  const sourceFormat = detectSourceFormat(input.fileName, mimeType);
  if (!sourceFormat) {
    unsupportedFormatError(path.extname(input.fileName).toLowerCase(), mimeType);
  }

  const resolution = resolveConverterEngineForFormat(sourceFormat);
  if (resolution.engine === 'convert-wasm') {
    try {
      return await convertWithConvertWasm(input, sourceFormat, outputName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown convert-wasm adapter error';
      logger.warn({ error: message, sourceFormat }, 'convert-wasm conversion failed, falling back to node-native');
      return await convertDocumentNodeNative(input, sourceFormat, outputName, [
        `Configured convert-wasm engine failed for ${sourceFormat}; fell back to node-native.`,
      ]);
    }
  }

  return await convertDocumentNodeNative(input, sourceFormat, outputName);
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
    converter: base.converter,
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
