import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
} from 'discord.js';
import { env, logger } from '../config/index.js';
import {
  convertDocumentWithIntent,
  parseConversionInstructions,
  normalizeIntent,
  IntentClarificationError,
  ragApi,
} from '../services/index.js';

export const docPreviewCommand = {
  data: new SlashCommandBuilder()
    .setName('docpreview')
    .setDescription('Preview converted markdown before upload/ingest')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addAttachmentOption(option =>
      option
        .setName('file')
        .setDescription('Document to preview (.md, .txt, .html, .docx, .pdf)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('instructions')
        .setDescription('Optional transform instructions (same format as /convertdoc)')
        .setRequired(false)
        .setMaxLength(1000)
    )
    .addStringOption(option =>
      option
        .setName('target_name')
        .setDescription('Optional output file name override')
        .setRequired(false)
        .setMaxLength(120)
    )
    .addBooleanOption(option =>
      option
        .setName('private')
        .setDescription('Only you can see the response')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const attachment = interaction.options.getAttachment('file', true);
    const instructions = interaction.options.getString('instructions');
    const targetName = interaction.options.getString('target_name') ?? undefined;
    const isPrivate = interaction.options.getBoolean('private') ?? true;

    if (
      interaction.guildId &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      await interaction.reply({
        content: 'You need the Manage Server permission to preview conversions.',
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

      const parsed = instructions
        ? await parseConversionInstructions(instructions, {
            defaultIngestNow: false,
            defaultOutputFileName: targetName,
            timeoutMs: env.INSTRUCTION_PARSE_TIMEOUT_MS,
          })
        : {
            intent: normalizeIntent({ ingestNow: false, outputFileName: targetName }),
            parseMethod: 'rules' as const,
          };

      const bytes = await downloadAttachment(attachment.url, env.ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
      if (bytes.byteLength > maxBytes) {
        throw new Error(`Downloaded file exceeded max size of ${env.MAX_DOC_UPLOAD_MB}MB.`);
      }

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

      const snippet = converted.markdown.length > 1200
        ? `${converted.markdown.slice(0, 1200)}\n\n...`
        : converted.markdown;

      const embed = new EmbedBuilder()
        .setColor(0x0ea5e9)
        .setTitle('Preview ready: converted markdown')
        .setDescription(`\`\`\`md\n${snippet}\n\`\`\``)
        .addFields(
          { name: 'Original File', value: attachment.name, inline: false },
          { name: 'Preview File', value: converted.fileName, inline: false },
          { name: 'Operation', value: parsed.intent.operation, inline: true },
          { name: 'Parse Method', value: parsed.parseMethod, inline: true },
          { name: 'Length', value: `${converted.markdown.length.toLocaleString()} chars`, inline: true }
        )
        .setFooter({ text: `${env.BOT_NAME} • Preview only (not uploaded)` })
        .setTimestamp();

      if (converted.warnings.length > 0) {
        embed.addFields({
          name: 'Conversion Notes',
          value: converted.warnings.slice(0, 4).map(note => `- ${note}`).join('\n'),
          inline: false,
        });
      }

      const previewAttachment = new AttachmentBuilder(Buffer.from(converted.markdown, 'utf-8'), {
        name: converted.fileName,
      });

      await interaction.editReply({
        embeds: [embed],
        files: [previewAttachment],
      });
    } catch (error) {
      logger.error({ error }, '/docpreview command failed');

      const description = error instanceof IntentClarificationError
        ? `${error.message}\n\nTry a clearer instruction set, for example: \`summarize in bullets, keep tables\`.`
        : error instanceof Error
          ? error.message
          : 'Unknown error';

      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('Could not preview document')
        .setDescription(description)
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
