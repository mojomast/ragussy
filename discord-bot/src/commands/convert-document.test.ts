import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_BOT_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client-id';
process.env.RAG_API_KEY ??= 'test-api-key';
process.env.RAG_API_URL ??= 'http://localhost:3001/api';
process.env.MAX_DOC_UPLOAD_MB ??= '15';

const commandModulePromise = import('./convert-document.js');
const servicesModulePromise = import('../services/index.js');

test('/convertdoc happy path uploads and ingests document', async () => {
  const { convertDocumentCommand } = await commandModulePromise;
  const { ragApi } = await servicesModulePromise;

  const originalFetch = globalThis.fetch;
  const originalUpload = ragApi.uploadDocument;
  const originalIngest = ragApi.ingestDocuments;
  const originalSummarize = ragApi.summarizeMarkdown;

  let uploadCalled = false;
  let ingestCalled = false;

  globalThis.fetch = async () => {
    return new Response('# Title\n\nHello world', {
      status: 200,
      headers: { 'content-type': 'text/markdown' },
    });
  };

  ragApi.uploadDocument = async () => {
    uploadCalled = true;
    return {
      success: true,
      filesAdded: 1,
      files: ['notes.md'],
    };
  };

  ragApi.ingestDocuments = async () => {
    ingestCalled = true;
    return {
      success: true,
      result: {
        filesScanned: 1,
        filesUpdated: 1,
        filesDeleted: 0,
        chunksUpserted: 2,
        chunksDeleted: 0,
        errors: [],
      },
    };
  };

  ragApi.summarizeMarkdown = async () => '# Summary\n\nsummary';

  const edits: Array<{ embeds?: Array<{ data?: { title?: string } }> }> = [];
  const interaction = {
    guildId: 'guild-1',
    memberPermissions: {
      has: () => true,
    },
    user: { id: 'user-1' },
    channelId: 'channel-1',
    options: {
      getAttachment: () => ({
        url: 'https://example.com/uploaded.md',
        name: 'uploaded.md',
        size: 1024,
        contentType: 'text/markdown',
      }),
      getString: (name: string) => {
        if (name === 'instructions') return 'clean markdown';
        if (name === 'target_name') return null;
        return null;
      },
      getBoolean: (name: string) => {
        if (name === 'ingest_now') return true;
        if (name === 'private') return true;
        return null;
      },
    },
    deferReply: async () => undefined,
    editReply: async (payload: { embeds?: Array<{ data?: { title?: string } }> }) => {
      edits.push(payload);
    },
    reply: async () => undefined,
  };

  try {
    await convertDocumentCommand.execute(interaction as never);

    assert.equal(uploadCalled, true);
    assert.equal(ingestCalled, true);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].embeds?.[0]?.data?.title, '✅ Document converted and uploaded');
  } finally {
    globalThis.fetch = originalFetch;
    ragApi.uploadDocument = originalUpload;
    ragApi.ingestDocuments = originalIngest;
    ragApi.summarizeMarkdown = originalSummarize;
  }
});
