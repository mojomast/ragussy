import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { env } from '../config/index.js';

export const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Learn how to use the docs bot'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(env.BOT_EMBED_COLOR)
      .setTitle(`📚 ${env.BOT_NAME} Help`)
      .setDescription('I can help you find information from the documentation!')
      .addFields(
        {
          name: '`/ask <question>`',
          value: 'Ask any question about the documentation. I\'ll search and give you an answer with sources.',
          inline: false,
        },
        {
          name: '`/status`',
          value: 'Check if the bot and its services are running properly.',
          inline: false,
        },
        {
          name: '`/help`',
          value: 'Show this help message.',
          inline: false,
        },
        {
          name: `\`${env.BOT_COMMAND_PREFIX} <question>\``,
          value: 'Alternative message command for quick questions.',
          inline: false,
        }
      )
      .addFields({
        name: '💡 Tips',
        value: [
          '• Be specific in your questions for better answers',
          '• Use the `private` option if you only want to see the response',
          '• Click on source links to read the full documentation',
        ].join('\n'),
        inline: false,
      })
      .setFooter({ text: `${env.BOT_NAME} • Powered by Ragussy` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
