import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { env, logger } from '../config/index.js';
import {
  ragApi,
  convertDocumentWithIntent,
  parseConversionInstructions,
  IntentClarificationError,
  type ConversionIntent,
} from '../services/index.js';

export const convertDocumentCommand = {
  data: new SlashCommandBuilder()
    .setName('convertdoc')
    .setDescription('Convert a document using custom instructions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('Document to convert (.md, .txt, .html, .docx, .pdf)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('instructions')
        .setDescription('How to transform the document (for example: summarize in bullets, keep tables)')
        .setRequired(true)
        .setMaxLength(1000)
    )
    .addBooleanOption(option =>
      option
        .setName('ingest_now')
        .setDescription('Immediately ingest this file after upload')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('private')
        .setDescription('Only you can see the response')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('target_name')
        .setDescription('Optional output file name')
        .setRequired(false)
        .setMaxLength(120)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const attachment = interaction.options.getAttachment('file', true);
    const instructions = interaction.options.getString('instructions', true);
    const ingestNowOption = interaction.options.getBoolean('ingest_now');
    const isPrivate = interaction.options.getBoolean('private') ?? true;
    const targetName = interaction.options.getString('target_name') ?? undefined;

    if (
      interaction.guildId &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.reply({
        content: 'You need the Manage Server permission to convert docs.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: isPrivate });

    try {
      if (!attachment.url || !attachment.name) {
        throw new Error('Discord attachment metadata is missing.');
      }

      const maxBytes = env.MAX_DOC_UPLOAD_MB * 1024 * 1024;
      if (attachment.size > maxBytes) {
        throw new Error(`File is too large. Max size is ${env.MAX_DOC_UPLOAD_MB}MB.`);
      }

      logger.info(
        {
          fileName: attachment.name,
          fileSize: attachment.size,
          mimeType: attachment.contentType,
          userId: interaction.user.id,
          channelId: interaction.channelId,
        },
        'Processing /convertdoc upload'
      );

      const parsed = await parseConversionInstructions(instructions, {
        defaultIngestNow: ingestNowOption ?? true,
        defaultOutputFileName: targetName,
        timeoutMs: env.INSTRUCTION_PARSE_TIMEOUT_MS,
      });

      const bytes = await downloadAttachment(attachment.url, env.ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
      if (bytes.byteLength > maxBytes) {
        throw new Error(`Downloaded file exceeded max size of ${env.MAX_DOC_UPLOAD_MB}MB.`);
      }
      const conversionStart = Date.now();

      const converted = await convertDocumentWithIntent(
        {
          fileName: attachment.name,
          mimeType: attachment.contentType,
          bytes,
        },
        parsed.intent,
        {
          summarizeText: async (text, style) =>
            ragApi.summarizeMarkdown(text, style ?? parsed.intent.summaryStyle ?? 'short'),
        }
      );

      const conversionMs = Date.now() - conversionStart;
      await ragApi.uploadDocument(converted.fileName, converted.markdown);

      const shouldIngest = parsed.intent.ingestNow ?? true;

      let ingestDetails: string;
      if (shouldIngest) {
        const ingestResponse = await ragApi.ingestDocuments([converted.fileName]);
        const chunks = ingestResponse.result?.chunksUpserted ?? 0;
        const errors = ingestResponse.result?.errors ?? [];
        ingestDetails = errors.length > 0
          ? `Ingested with ${errors.length} warning(s)`
          : `Ingested ${chunks} chunk${chunks === 1 ? '' : 's'}`;
      } else {
        ingestDetails = 'Uploaded only (ingest skipped)';
      }

      logger.info(
        {
          sourceFormat: converted.sourceFormat,
          intent: {
            operation: parsed.intent.operation,
            targetFormat: parsed.intent.targetFormat,
          },
          parseMethod: parsed.parseMethod,
          conversionMs,
          warningsCount: converted.warnings.length,
          ingested: shouldIngest,
        },
        '/convertdoc completed'
      );

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('✅ Document converted and uploaded')
        .addFields(
          { name: 'Original File', value: attachment.name, inline: false },
          { name: 'Stored As', value: converted.fileName, inline: false },
          { name: 'Parse Method', value: parsed.parseMethod, inline: true },
          { name: 'Ingestion', value: ingestDetails, inline: true },
          {
            name: 'Parsed Intent',
            value: formatIntent(parsed.intent),
            inline: false,
          },
          {
            name: 'Applied Actions',
            value: converted.appliedActions.map(action => `- ${action}`).join('\n') || '- convert',
            inline: false,
          }
        )
        .setFooter({ text: env.BOT_NAME })
        .setTimestamp();

      if (converted.ignoredInstructions.length > 0) {
        embed.addFields({
          name: 'Skipped / Unsupported Instructions',
          value: converted.ignoredInstructions.slice(0, 5).map(note => `- ${note}`).join('\n'),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error({ error }, '/convertdoc command failed');

      const description = error instanceof IntentClarificationError
        ? `${error.message}\n\nTry being explicit, for example: \`summarize in bullets, keep tables, do not ingest\`.`
        : error instanceof Error
          ? error.message
          : 'Unknown error';

      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('Could not convert document')
        .setDescription(description)
        .setFooter({ text: env.BOT_NAME })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
};

function formatIntent(intent: ConversionIntent): string {
  const lines = [
    `- operation: ${intent.operation}`,
    `- target format: ${intent.targetFormat}`,
    `- summary style: ${intent.summaryStyle ?? 'n/a'}`,
    `- strip boilerplate: ${intent.stripBoilerplate ? 'yes' : 'no'}`,
    `- preserve links: ${intent.preserveLinks ? 'yes' : 'no'}`,
    `- preserve tables: ${intent.preserveTables ? 'yes' : 'no'}`,
    `- include metadata: ${intent.includeMetadata ? 'yes' : 'no'}`,
  ];

  if (intent.ingestNow !== undefined) {
    lines.push(`- ingest now: ${intent.ingestNow ? 'yes' : 'no'}`);
  }

  if (intent.outputFileName) {
    lines.push(`- output file: ${intent.outputFileName}`);
  }

  return lines.join('\n');
}

async function downloadAttachment(url: string, timeoutMs: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to download attachment (${response.status})`);
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Attachment download timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
