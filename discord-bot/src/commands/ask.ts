import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { env, logger } from '../config/index.js';
import { ragApi, type Source } from '../services/index.js';

const channelConversations = new Map<string, string>();

export const askCommand = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask a question about the documentation')
    .addStringOption(option =>
      option
        .setName('question')
        .setDescription('Your question')
        .setRequired(true)
        .setMaxLength(2000)
    )
    .addBooleanOption(option =>
      option
        .setName('private')
        .setDescription('Only you will see the response')
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const question = interaction.options.getString('question', true);
    const isPrivate = interaction.options.getBoolean('private') ?? false;
    const channelId = interaction.channelId;
    const userId = interaction.user.id;

    logger.info({ userId, channelId, questionLength: question.length }, 'Processing /ask command');

    await interaction.deferReply({ ephemeral: isPrivate });

    try {
      const existingConversationId = channelConversations.get(channelId);

      const response = await ragApi.chat({
        message: question,
        conversationId: existingConversationId,
      });

      channelConversations.set(channelId, response.conversationId);

      const embed = createResponseEmbed(question, response.answer, response.sources);
      const components = createSourceButtons(response.sources);

      await interaction.editReply({
        embeds: [embed],
        components: components.length > 0 ? components : undefined,
      });

      logger.info({ userId, channelId, sourceCount: response.sources.length }, '/ask command completed');
    } catch (error) {
      logger.error({ error, userId, channelId }, '/ask command failed');

      const errorEmbed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('❌ Error')
        .setDescription('Sorry, I encountered an error while processing your question. Please try again later.')
        .setFooter({ text: env.BOT_NAME })
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};

function createResponseEmbed(question: string, answer: string, sources: Source[]): EmbedBuilder {
  const maxAnswerLength = 3800;
  let truncatedAnswer = answer;
  
  if (answer.length > maxAnswerLength) {
    truncatedAnswer = answer.slice(0, maxAnswerLength) + '\n\n*...response truncated*';
  }

  const embed = new EmbedBuilder()
    .setColor(env.BOT_EMBED_COLOR)
    .setTitle(`📚 ${env.BOT_NAME}`)
    .setDescription(truncatedAnswer)
    .setFooter({ text: `Question: ${question.slice(0, 100)}${question.length > 100 ? '...' : ''}` })
    .setTimestamp();

  if (sources.length > 0) {
    const sourceList = sources
      .slice(0, 5)
      .map((s, i) => `${i + 1}. [${s.title}](${s.url})`)
      .join('\n');

    embed.addFields({
      name: '📖 Sources',
      value: sourceList,
      inline: false,
    });
  }

  return embed;
}

function createSourceButtons(sources: Source[]): ActionRowBuilder<ButtonBuilder>[] {
  if (sources.length === 0) return [];

  const buttons = sources.slice(0, 3).map((source) =>
    new ButtonBuilder()
      .setLabel(source.title.slice(0, 80))
      .setURL(source.url)
      .setStyle(ButtonStyle.Link)
      .setEmoji('📄')
  );

  if (buttons.length === 0) return [];

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}
