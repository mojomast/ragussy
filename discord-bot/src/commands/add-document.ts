import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { env, logger } from '../config/index.js';
import { ragApi, convertDocument, type ConflictStrategy } from '../services/index.js';

export const addDocumentCommand = {
  data: new SlashCommandBuilder()
    .setName('adddoc')
    .setDescription('Upload a file, convert it to markdown, and index it')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('Document to add (.md, .txt, .html, .docx, .pdf)')
        .setRequired(true)
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
        .setName('if_exists')
        .setDescription('What to do if a file with the same name already exists')
        .addChoices(
          { name: 'Replace existing', value: 'replace' },
          { name: 'Rename new file', value: 'rename' },
          { name: 'Skip upload', value: 'skip' }
        )
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const attachment = interaction.options.getAttachment('file', true);
    const ingestNow = interaction.options.getBoolean('ingest_now') ?? true;
    const isPrivate = interaction.options.getBoolean('private') ?? true;
    const conflictStrategy =
      (interaction.options.getString('if_exists') as ConflictStrategy | null) ?? 'replace';

    if (
      interaction.guildId &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.reply({
        content: 'You need the Manage Server permission to upload docs.',
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
          ingestNow,
          conflictStrategy,
          userId: interaction.user.id,
          channelId: interaction.channelId,
        },
        'Processing /adddoc upload'
      );

      const bytes = await downloadAttachment(attachment.url, env.ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
      if (bytes.byteLength > maxBytes) {
        throw new Error(`Downloaded file exceeded max size of ${env.MAX_DOC_UPLOAD_MB}MB.`);
      }
      const converted = await convertDocument({
        fileName: attachment.name,
        mimeType: attachment.contentType,
        bytes,
      });

      const uploadResult = await ragApi.uploadDocument(
        converted.fileName,
        converted.markdown,
        conflictStrategy
      );
      const storedFileName = uploadResult.files[0] ?? converted.fileName;

      let ingestDetails: string;
      if (uploadResult.filesAdded === 0) {
        ingestDetails = 'Upload skipped (file already exists)';
      } else if (ingestNow) {
        const ingestResponse = await ragApi.ingestDocuments(uploadResult.files);
        const chunks = ingestResponse.result?.chunksUpserted ?? 0;
        const errors = ingestResponse.result?.errors ?? [];
        ingestDetails = errors.length > 0
          ? `Ingested with ${errors.length} warning(s)`
          : `Ingested ${chunks} chunk${chunks === 1 ? '' : 's'}`;
      } else {
        ingestDetails = 'Uploaded only (ingest skipped)';
      }

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('✅ Document added to knowledge base')
        .addFields(
          { name: 'Original File', value: attachment.name, inline: false },
          { name: 'Stored As', value: storedFileName, inline: false },
          { name: 'Converted From', value: converted.sourceFormat.toUpperCase(), inline: true },
          { name: 'If Exists', value: conflictStrategy, inline: true },
          { name: 'Ingestion', value: ingestDetails, inline: true }
        )
        .setFooter({ text: env.BOT_NAME })
        .setTimestamp();

      if (uploadResult.renamedFiles && uploadResult.renamedFiles.length > 0) {
        const renamed = uploadResult.renamedFiles[0];
        embed.addFields({
          name: 'Renamed',
          value: `- ${renamed.from} -> ${renamed.to}`,
          inline: false,
        });
      }

      if (converted.warnings.length > 0) {
        embed.addFields({
          name: 'Conversion Notes',
          value: converted.warnings.slice(0, 3).map(w => `- ${w}`).join('\n'),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error({ error }, '/adddoc command failed');

      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('Could not add document')
        .setDescription(error instanceof Error ? error.message : 'Unknown error')
        .setFooter({ text: env.BOT_NAME })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
};

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
