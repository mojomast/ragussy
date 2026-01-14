import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { env, logger } from '../config/index.js';
import { ragApi } from '../services/index.js';

export const statusCommand = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the status of the docs bot'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const startTime = Date.now();
      const health = await ragApi.health();
      const latency = Date.now() - startTime;

      const isHealthy = health.status === 'healthy' && 
                       health.services.api === 'ok' && 
                       health.services.qdrant === 'ok';

      const embed = new EmbedBuilder()
        .setColor(isHealthy ? 0x22c55e : 0xff4444)
        .setTitle(isHealthy ? '✅ Bot Status: Online' : '⚠️ Bot Status: Degraded')
        .addFields(
          { name: 'API', value: health.services.api === 'ok' ? '✅ OK' : '❌ Error', inline: true },
          { name: 'Qdrant', value: health.services.qdrant === 'ok' ? '✅ OK' : '❌ Error', inline: true },
          { name: 'Latency', value: `${latency}ms`, inline: true }
        )
        .setFooter({ text: env.BOT_NAME })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error({ error }, 'Status check failed');

      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('❌ Bot Status: Offline')
        .setDescription('Unable to connect to the RAG backend.')
        .setFooter({ text: env.BOT_NAME })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  },
};
