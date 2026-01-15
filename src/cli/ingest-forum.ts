#!/usr/bin/env node
/**
 * Forum Ingestion CLI
 * 
 * Dedicated command for ingesting forum thread data.
 * Uses the forum ingestion pipeline optimized for threaded discussions.
 */

import chalk from 'chalk';
import { logger } from '../config/index.js';
import {
  runForumPipeline,
  getForumIngestionConfig,
  getAllForumConfig,
  generateForumEnvExample,
  type ForumIngestionReport,
} from '../ingestion/forum/index.js';

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');
const showConfig = args.includes('--config') || args.includes('-c');
const showEnvExample = args.includes('--env-example');
const sourcePath = args.find(a => !a.startsWith('-'));

function printHelp() {
  console.log(`
${chalk.bold('📚 Forum Ingestion')}

Ingest forum thread data for conversational retrieval.
Each post is treated as the primary ingestion unit.

${chalk.bold('Usage:')}
  npm run ingest:forum [options] [source-path]

${chalk.bold('Options:')}
  --help, -h       Show this help message
  --config, -c     Show current forum configuration
  --env-example    Print example .env configuration

${chalk.bold('Arguments:')}
  source-path      Path to forum JSON files (default: docs directory)

${chalk.bold('Examples:')}
  npm run ingest:forum                    # Ingest from default docs path
  npm run ingest:forum ./forum-data       # Ingest from specific directory
  npm run ingest:forum --config           # Show current configuration

${chalk.bold('Configuration:')}
  Forum mode is configured via environment variables.
  Run with --env-example to see all available options.
`);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function printReport(report: ForumIngestionReport) {
  console.log('\n' + chalk.green('✅ Forum Ingestion Complete!') + '\n');
  
  console.log(chalk.bold('Summary:'));
  console.log(`  Session ID:       ${report.sessionId}`);
  console.log(`  Duration:         ${formatDuration(report.durationMs)}`);
  console.log(`  Threads:          ${report.threadsProcessed}`);
  console.log(`  Posts processed:  ${report.postsProcessed}`);
  console.log(`  Posts skipped:    ${report.postsSkipped} (unchanged)`);
  console.log(`  Chunks embedded:  ${report.chunksEmbedded}`);
  
  if (report.diagnostics) {
    const vectorsPerSec = report.diagnostics.vectorsPerSecond;
    console.log(`  Throughput:       ${vectorsPerSec} vectors/sec`);
    
    console.log('\n' + chalk.bold('Parallelism Diagnostics:'));
    console.log(`  Peak embedding workers:  ${report.diagnostics.peakEmbeddingInFlight}`);
    console.log(`  Avg embedding latency:   ${report.diagnostics.avgEmbeddingLatencyMs}ms`);
    console.log(`  Rate limit hits:         ${report.diagnostics.rateLimitHits}`);
    
    if (report.diagnostics.peakEmbeddingInFlight <= 2) {
      console.log(chalk.yellow('  ⚠️  Warning: Peak in-flight ≤2, may not be truly parallel'));
    } else {
      console.log(chalk.green(`  ✓ True parallelism verified (peak ${report.diagnostics.peakEmbeddingInFlight} concurrent)`));
    }
  }
  
  if (report.failedPosts.length > 0) {
    console.log('\n' + chalk.yellow(`⚠️  Failed Posts (${report.failedPosts.length}):`));
    for (const failed of report.failedPosts.slice(0, 10)) {
      console.log(`  • Thread ${failed.threadId}, Post ${failed.postId}: ${failed.reason}`);
    }
    if (report.failedPosts.length > 10) {
      console.log(`  ... and ${report.failedPosts.length - 10} more`);
    }
  }
  
  const success = report.failedPosts.length === 0;
  console.log('\n' + chalk.bold('Status: ') + 
    (success ? chalk.green('SUCCESS') : chalk.yellow('COMPLETED WITH ERRORS')));
  console.log('');
}

async function printConfig() {
  const config = await getAllForumConfig();
  
  console.log('\n' + chalk.bold('📋 Forum Configuration') + '\n');
  
  console.log(chalk.bold('Mode:'));
  console.log(`  Enabled: ${config.enabled ? chalk.green('Yes') : chalk.dim('No')}`);
  
  console.log('\n' + chalk.bold('Ingestion Settings:'));
  console.log(`  Max tokens:           ${config.ingestion.maxTokens}`);
  console.log(`  Overlap tokens:       ${config.ingestion.overlapTokens}`);
  console.log(`  Absolute max tokens:  ${config.ingestion.absoluteMaxTokens}`);
  console.log(`  Embedding model:      ${config.ingestion.embeddingModel}`);
  console.log(`  Embed quoted content: ${config.ingestion.embedQuotedContent}`);
  console.log(`  Embedding threads:    ${config.ingestion.embeddingThreads}`);
  console.log(`  Upsert threads:       ${config.ingestion.upsertThreads}`);
  console.log(`  Skip unchanged:       ${config.ingestion.skipUnchangedPosts}`);
  
  console.log('\n' + chalk.bold('Retrieval Settings:'));
  console.log(`  Group by thread:      ${config.retrieval.groupByThreadOnRetrieval}`);
  console.log(`  Time decay:           ${config.retrieval.timeDecayWeighting}`);
  console.log(`  Time decay half-life: ${config.retrieval.timeDecayHalfLifeDays} days`);
  console.log(`  Max posts per thread: ${config.retrieval.maxPostsPerThreadInContext}`);
  console.log(`  Retrieval count:      ${config.retrieval.retrievalCount}`);
  
  console.log('');
}

async function main() {
  if (showHelp) {
    printHelp();
    process.exit(0);
  }
  
  if (showEnvExample) {
    console.log(generateForumEnvExample());
    process.exit(0);
  }
  
  if (showConfig) {
    await printConfig();
    process.exit(0);
  }
  
  console.log(`\n${chalk.bold('📚 Forum Ingestion')}\n`);
  
  if (sourcePath) {
    console.log(`Source: ${chalk.cyan(sourcePath)}\n`);
  } else {
    console.log(`Source: ${chalk.dim('default docs directory')}\n`);
  }
  
  try {
    const config = await getForumIngestionConfig();
    
    console.log(chalk.dim('Configuration:'));
    console.log(chalk.dim(`  Embedding model: ${config.embeddingModel}`));
    console.log(chalk.dim(`  Threads: ${config.embeddingThreads} embedding, ${config.upsertThreads} upsert`));
    console.log(chalk.dim(`  Embed quoted: ${config.embedQuotedContent}`));
    console.log('');
    
    let lastThread = '';
    const report = await runForumPipeline(
      {
        ...config,
        onProgress: (current, total, threadId, postId) => {
          if (threadId !== lastThread) {
            lastThread = threadId;
            process.stdout.write(`\r${chalk.dim(`Thread: ${threadId}`)}\x1b[K`);
          }
          if (current % 10 === 0 || current === total) {
            process.stdout.write(`\r${chalk.cyan(`Progress: ${current}/${total} chunks`)}\x1b[K`);
          }
        },
      },
      sourcePath
    );
    
    process.stdout.write('\r\x1b[K');
    printReport(report);
    
    process.exit(report.failedPosts.length === 0 ? 0 : 1);
  } catch (error) {
    logger.error({ error }, 'Forum ingestion failed');
    console.error('\n' + chalk.red('❌ Forum ingestion failed:'), error);
    process.exit(1);
  }
}

main();
