import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { convertDocument, convertDocumentWithIntent } from './document-conversion.js';

const fixturesDir = path.join(process.cwd(), 'src', 'tests', 'fixtures');

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

async function readFixture(name: string): Promise<string> {
  return await fs.readFile(path.join(fixturesDir, name), 'utf-8');
}

function createMinimalDocxBuffer(): Buffer {
  const zip = new AdmZip();

  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    )
  );

  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    )
  );

  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Docx Fixture Title</w:t></w:r></w:p>
    <w:p><w:r><w:t>Docx fixture body paragraph.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    )
  );

  return zip.toBuffer();
}

async function createSimplePdfBuffer(text: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  page.drawText(text, {
    x: 72,
    y: 700,
    size: 18,
    font,
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

test('snapshot: markdown fixture stays stable', async () => {
  const input = await readFixture('markdown-basic.input.md');
  const expected = await readFixture('markdown-basic.expected.md');

  const result = await convertDocument({
    fileName: 'markdown-basic.md',
    mimeType: 'text/markdown',
    bytes: new Uint8Array(Buffer.from(input, 'utf-8')),
  });

  assert.equal(result.sourceFormat, 'md');
  assert.equal(normalize(result.markdown), normalize(expected));
});

test('snapshot: html fixture converts deterministically', async () => {
  const input = await readFixture('html-basic.input.html');
  const expected = await readFixture('html-basic.expected.md');

  const result = await convertDocument({
    fileName: 'html-basic.html',
    mimeType: 'text/html',
    bytes: new Uint8Array(Buffer.from(input, 'utf-8')),
  });

  assert.equal(result.sourceFormat, 'html');
  assert.equal(normalize(result.markdown), normalize(expected));
});

test('snapshot: text fixture converts deterministically', async () => {
  const input = await readFixture('text-basic.input.txt');
  const expected = await readFixture('text-basic.expected.md');

  const result = await convertDocument({
    fileName: 'text-basic.txt',
    mimeType: 'text/plain',
    bytes: new Uint8Array(Buffer.from(input, 'utf-8')),
  });

  assert.equal(result.sourceFormat, 'txt');
  assert.equal(normalize(result.markdown), normalize(expected));
});

test('snapshot: generated docx fixture is convertible', async () => {
  const result = await convertDocument({
    fileName: 'docx-basic.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: new Uint8Array(createMinimalDocxBuffer()),
  });

  assert.equal(result.sourceFormat, 'docx');
  assert.match(result.markdown, /Docx Fixture Title/i);
});

test('snapshot: generated pdf fixture is convertible', async () => {
  const pdfBuffer = await createSimplePdfBuffer('Hello PDF Fixture');

  const result = await convertDocument({
    fileName: 'pdf-basic.pdf',
    mimeType: 'application/pdf',
    bytes: new Uint8Array(pdfBuffer),
  });

  assert.equal(result.sourceFormat, 'pdf');
  assert.match(result.markdown, /Hello PDF Fixture/i);
});

test('snapshot: section extraction from fixture remains stable', async () => {
  const input = await readFixture('markdown-basic.input.md');
  const result = await convertDocumentWithIntent(
    {
      fileName: 'markdown-basic.md',
      mimeType: 'text/markdown',
      bytes: new Uint8Array(Buffer.from(input, 'utf-8')),
    },
    {
      operation: 'extract_sections',
      notes: ['section_hint:Endpoints'],
    }
  );

  assert.match(result.markdown, /# Extracted Sections/);
  assert.match(result.markdown, /## Endpoints/);
  assert.doesNotMatch(result.markdown, /## Intro/);
});
