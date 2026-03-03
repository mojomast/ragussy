import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_BOT_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client-id';
process.env.RAG_API_KEY ??= 'test-api-key';
process.env.RAG_API_URL ??= 'http://localhost:3001/api';
process.env.INSTRUCTION_PARSE_TIMEOUT_MS ??= '500';

const parserModulePromise = import('./instruction-parser.js');

test('rule parser extracts summarize intent options', async () => {
  const { parseConversionInstructions } = await parserModulePromise;
  const result = await parseConversionInstructions(
    'summarize in bullets, keep tables, remove boilerplate, do not ingest'
  );

  assert.equal(result.parseMethod, 'rules');
  assert.equal(result.intent.operation, 'summarize');
  assert.equal(result.intent.summaryStyle, 'bullets');
  assert.equal(result.intent.preserveTables, true);
  assert.equal(result.intent.stripBoilerplate, true);
  assert.equal(result.intent.ingestNow, false);
});

test('parser raises clarification error for conflicting ingest instructions', async () => {
  const { parseConversionInstructions, IntentClarificationError } = await parserModulePromise;

  await assert.rejects(
    () => parseConversionInstructions('ingest now and do not ingest'),
    (error: unknown) => error instanceof IntentClarificationError
  );
});

test('parser records unsupported output format requests', async () => {
  const { parseConversionInstructions, getIgnoredInstructionNotes } = await parserModulePromise;
  const result = await parseConversionInstructions('convert this to html and keep links');

  const ignored = getIgnoredInstructionNotes(result.intent);
  assert.equal(result.intent.targetFormat, 'markdown');
  assert.equal(result.intent.preserveLinks, true);
  assert.ok(ignored.some(note => note.includes('not supported')));
});
