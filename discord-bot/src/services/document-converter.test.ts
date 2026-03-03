import test from 'node:test';
import assert from 'node:assert/strict';
import { convertDocumentWithIntent } from './document-converter.js';
import { normalizeIntent } from './conversion-intent.js';

const encoder = new TextEncoder();

test('applies link and table removal during conversion', async () => {
  const markdown = [
    '# Doc',
    '',
    'Read [more here](https://example.com).',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
  ].join('\n');

  const result = await convertDocumentWithIntent(
    {
      fileName: 'sample.md',
      mimeType: 'text/markdown',
      bytes: encoder.encode(markdown),
    },
    normalizeIntent({
      operation: 'convert',
      preserveLinks: false,
      preserveTables: false,
      notes: [],
    })
  );

  assert.ok(result.appliedActions.includes('remove_links'));
  assert.ok(result.appliedActions.includes('remove_tables'));
  assert.ok(!result.markdown.includes('](https://example.com)'));
});

test('converts html input into markdown', async () => {
  const html = '<h1>Doc</h1><p>Paragraph</p>';
  const result = await convertDocumentWithIntent(
    {
      fileName: 'sample.html',
      mimeType: 'text/html',
      bytes: encoder.encode(html),
    },
    normalizeIntent({ operation: 'convert', notes: [] })
  );

  assert.equal(result.sourceFormat, 'html');
  assert.ok(result.markdown.includes('# Doc'));
});

test('extracts requested sections from markdown headings', async () => {
  const markdown = [
    '# Title',
    '',
    '## Intro',
    'One.',
    '',
    '## API',
    'Two.',
    '',
    '## Notes',
    'Three.',
  ].join('\n');

  const result = await convertDocumentWithIntent(
    {
      fileName: 'notes.md',
      mimeType: 'text/markdown',
      bytes: encoder.encode(markdown),
    },
    normalizeIntent({
      operation: 'extract_sections',
      notes: ['section_hint:API'],
    })
  );

  assert.ok(result.appliedActions.includes('extract_sections'));
  assert.ok(result.markdown.includes('## API'));
  assert.ok(!result.markdown.includes('## Intro'));
});

test('uses provided summarizer for summarize operation', async () => {
  let summarizeCalls = 0;
  const result = await convertDocumentWithIntent(
    {
      fileName: 'summary.md',
      mimeType: 'text/markdown',
      bytes: encoder.encode('# Title\n\nThis is a long document body.'),
    },
    normalizeIntent({
      operation: 'summarize',
      summaryStyle: 'short',
      notes: [],
    }),
    {
      summarizeText: async () => {
        summarizeCalls += 1;
        return '# Summary\n\nStubbed summary';
      },
    }
  );

  assert.equal(summarizeCalls, 1);
  assert.ok(result.markdown.includes('Stubbed summary'));
});
