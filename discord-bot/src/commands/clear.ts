import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { env, logger } from '../config/index.js';
import { ragApi } from '../services/index.js';
import { channelConversations } from '../state.js';

export const clearCommand = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear the conversation context for this channel'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.channelId;
    const conversationId = channelConversations.get(channelId);

    if (!conversationId) {
      await interaction.reply({
        content: 'No active conversation context to clear.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      await ragApi.clearConversation(conversationId);
      channelConversations.delete(channelId);

      const embed = new EmbedBuilder()
        .setColor(env.BOT_EMBED_COLOR)
        .setDescription('🧹 **Context cleared!** Started a fresh conversation.')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      logger.info({ channelId, conversationId }, 'Conversation context cleared');
    } catch (error) {
      logger.error({ error, channelId, conversationId }, 'Failed to clear context');
      await interaction.editReply({
        content: 'Failed to clear context. Please try again later.',
      });
    }
  },
};
