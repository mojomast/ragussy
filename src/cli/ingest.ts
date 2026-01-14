#!/usr/bin/env node
import { ingestIncremental, ingestFull } from '../ingestion/index.js';
import { logger } from '../config/index.js';

const args = process.argv.slice(2);
const isFull = args.includes('--full') || args.includes('-f');

async function main() {
  console.log(`\n📚 Ragussy Document Ingestion\n`);
  console.log(`Mode: ${isFull ? 'Full rebuild' : 'Incremental update'}\n`);

  try {
    const result = isFull ? await ingestFull() : await ingestIncremental();

    console.log('\n✅ Ingestion complete!\n');
    console.log(`   Files scanned:  ${result.filesScanned}`);
    console.log(`   Files updated:  ${result.filesUpdated}`);
    console.log(`   Files deleted:  ${result.filesDeleted}`);
    console.log(`   Chunks added:   ${result.chunksUpserted}`);
    console.log(`   Chunks removed: ${result.chunksDeleted}`);

    if (result.errors.length > 0) {
      console.log(`\n⚠️  Errors (${result.errors.length}):`);
      result.errors.forEach(e => console.log(`   - ${e}`));
    }

    console.log('');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Ingestion failed');
    console.error('\n❌ Ingestion failed:', error);
    process.exit(1);
  }
}

main();
