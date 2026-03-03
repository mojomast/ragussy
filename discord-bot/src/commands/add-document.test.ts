import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_BOT_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client-id';
process.env.RAG_API_KEY ??= 'test-api-key';
process.env.RAG_API_URL ??= 'http://localhost:3001/api';
process.env.MAX_DOC_UPLOAD_MB ??= '15';

const commandModulePromise = import('./add-document.js');
const servicesModulePromise = import('../services/index.js');

test('/adddoc skip strategy avoids ingest when file exists', async () => {
  const { addDocumentCommand } = await commandModulePromise;
  const { ragApi } = await servicesModulePromise;

  const originalFetch = globalThis.fetch;
  const originalUpload = ragApi.uploadDocument;
  const originalIngest = ragApi.ingestDocuments;

  let uploadStrategy: string | undefined;
  let ingestCalled = false;

  globalThis.fetch = async () => {
    return new Response('# Existing\n\nSame doc', {
      status: 200,
      headers: { 'content-type': 'text/markdown' },
    });
  };

  ragApi.uploadDocument = async (_fileName: string, _markdown: string, strategy) => {
    uploadStrategy = strategy;
    return {
      success: true,
      filesAdded: 0,
      files: [],
      skippedFiles: ['existing.md'],
    };
  };

  ragApi.ingestDocuments = async () => {
    ingestCalled = true;
    return {
      success: true,
      result: {
        filesScanned: 0,
        filesUpdated: 0,
        filesDeleted: 0,
        chunksUpserted: 0,
        chunksDeleted: 0,
        errors: [],
      },
    };
  };

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
        url: 'https://example.com/existing.md',
        name: 'existing.md',
        size: 1024,
        contentType: 'text/markdown',
      }),
      getBoolean: (name: string) => {
        if (name === 'ingest_now') return true;
        if (name === 'private') return true;
        return null;
      },
      getString: (name: string) => {
        if (name === 'if_exists') return 'skip';
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
    await addDocumentCommand.execute(interaction as never);

    assert.equal(uploadStrategy, 'skip');
    assert.equal(ingestCalled, false);
    assert.equal(edits[0].embeds?.[0]?.data?.title, '✅ Document added to knowledge base');
  } finally {
    globalThis.fetch = originalFetch;
    ragApi.uploadDocument = originalUpload;
    ragApi.ingestDocuments = originalIngest;
  }
});
