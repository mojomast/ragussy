import { QdrantClient } from '@qdrant/js-client-rest';
import { env, logger } from '../config/index.js';

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY || undefined,
    });
    logger.info({ url: env.QDRANT_URL }, 'Qdrant client initialized');
  }
  return client;
}

export async function ensureCollection(): Promise<void> {
  const qdrant = getQdrantClient();
  const collectionName = env.QDRANT_COLLECTION;
  
  // Retry logic for when Qdrant is still starting up
  const maxRetries = 30;
  const retryDelay = 2000; // 2 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const collections = await qdrant.getCollections();
      const exists = collections.collections.some((c: any) => c.name === collectionName);

      if (!exists) {
        logger.info({ collection: collectionName, vectorDim: env.VECTOR_DIM }, 'Creating Qdrant collection');
        await qdrant.createCollection(collectionName, {
          vectors: {
            size: env.VECTOR_DIM,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });

        // Create payload indexes for filtering
        await qdrant.createPayloadIndex(collectionName, {
          field_name: 'source_file',
          field_schema: 'keyword',
        });
        await qdrant.createPayloadIndex(collectionName, {
          field_name: 'doc_category',
          field_schema: 'keyword',
        });

        logger.info({ collection: collectionName }, 'Collection created with indexes');
      } else {
        const info = await getCollectionInfo();
        const existingSize = (info?.config?.params?.vectors as any)?.size;
        if (existingSize && existingSize !== env.VECTOR_DIM) {
          throw new Error(
            `Existing collection '${collectionName}' has vector size ${existingSize}, but VECTOR_DIM is ${env.VECTOR_DIM}. ` +
            'Either update VECTOR_DIM or run ingest:full to recreate the collection.'
          );
        }
        logger.debug({ collection: collectionName }, 'Collection already exists');
      }
      return; // Success, exit the retry loop
    } catch (error) {
      if (attempt < maxRetries) {
        logger.warn({ attempt, maxRetries, error: String(error) }, 'Qdrant not ready, retrying...');
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        logger.error({ error, collection: collectionName }, 'Failed to ensure collection after all retries');
        throw error;
      }
    }
  }
}

export async function checkQdrantHealth(): Promise<boolean> {
  try {
    const qdrant = getQdrantClient();
    await qdrant.getCollections();
    return true;
  } catch (error) {
    logger.error({ error }, 'Qdrant health check failed');
    return false;
  }
}

export interface SearchResult {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
}

export async function searchVectors(
  embedding: number[],
  topK: number = env.RETRIEVAL_TOP_K,
  filter?: Record<string, unknown>
): Promise<SearchResult[]> {
  const qdrant = getQdrantClient();

  const results = await qdrant.search(env.QDRANT_COLLECTION, {
    vector: embedding,
    limit: topK,
    with_payload: true,
    filter: filter,
  });

  return results.map((r: any) => ({
    id: r.id,
    score: r.score,
    payload: r.payload as Record<string, unknown>,
  }));
}

export async function upsertVectors(
  points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }>
): Promise<void> {
  const qdrant = getQdrantClient();

  await qdrant.upsert(env.QDRANT_COLLECTION, {
    wait: true,
    points: points.map(p => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload,
    })),
  });
}

export async function deleteVectorsByFilter(
  filter: Record<string, unknown>
): Promise<void> {
  const qdrant = getQdrantClient();

  await qdrant.delete(env.QDRANT_COLLECTION, {
    wait: true,
    filter: filter,
  });
}

export async function getCollectionInfo() {
  const qdrant = getQdrantClient();
  try {
    return await qdrant.getCollection(env.QDRANT_COLLECTION);
  } catch {
    return null;
  }
}
