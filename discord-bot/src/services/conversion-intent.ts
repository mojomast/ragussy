import path from 'node:path';
import { z } from 'zod';

export const targetFormatSchema = z.enum(['markdown']);
export const conversionOperationSchema = z.enum([
  'convert',
  'summarize',
  'extract_sections',
  'clean_markdown',
]);
export const summaryStyleSchema = z.enum(['short', 'detailed', 'bullets']);

export const conversionIntentSchema = z.object({
  targetFormat: targetFormatSchema.default('markdown'),
  operation: conversionOperationSchema.default('convert'),
  summaryStyle: summaryStyleSchema.optional(),
  includeMetadata: z.boolean().default(false),
  stripBoilerplate: z.boolean().default(false),
  preserveLinks: z.boolean().default(true),
  preserveTables: z.boolean().default(true),
  ingestNow: z.boolean().optional(),
  outputFileName: z.string().min(1).max(200).optional(),
  notes: z.array(z.string()).default([]),
});

export type ConversionIntent = z.infer<typeof conversionIntentSchema>;
export type ConversionOperation = z.infer<typeof conversionOperationSchema>;
export type SummaryStyle = z.infer<typeof summaryStyleSchema>;

export function normalizeOutputFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const base = path
    .basename(trimmed)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-');

  const withoutExt = base.replace(path.extname(base), '') || 'document';
  return `${withoutExt}.md`;
}

export function normalizeIntent(input: unknown): ConversionIntent {
  const parsed = conversionIntentSchema.parse(input);

  return {
    ...parsed,
    outputFileName: parsed.outputFileName
      ? normalizeOutputFileName(parsed.outputFileName)
      : undefined,
  };
}
