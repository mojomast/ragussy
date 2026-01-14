import {
  Client,
  GatewayIntentBits,
  Events,
  Interaction,
  ChatInputCommandInteraction,
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { env, logger } from './config/index.js';
import { commands } from './commands/index.js';
import { ragApi, type Source } from './services/index.js';

const userCooldowns = new Map<string, number>();
const channelConversations = new Map<string, string>();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, async (readyClient) => {
  logger.info(
    { username: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
    `🤖 ${env.BOT_NAME} is online!`
  );

  try {
    const health = await ragApi.health();
    logger.info({ health }, 'RAG backend connection verified');
  } catch (error) {
    logger.warn({ error }, 'RAG backend not reachable at startup - commands may fail');
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) {
    logger.warn({ commandName: interaction.commandName }, 'Unknown command received');
    return;
  }

  const userId = interaction.user.id;
  const now = Date.now();
  const lastUsed = userCooldowns.get(userId) || 0;
  const cooldownMs = env.COOLDOWN_SECONDS * 1000;

  if (now - lastUsed < cooldownMs) {
    const remainingSeconds = Math.ceil((cooldownMs - (now - lastUsed)) / 1000);
    await interaction.reply({
      content: `⏳ Please wait ${remainingSeconds} seconds before using another command.`,
      ephemeral: true,
    });
    return;
  }

  userCooldowns.set(userId, now);

  if (userCooldowns.size > 10000) {
    const cutoff = now - cooldownMs * 2;
    for (const [uid, time] of userCooldowns.entries()) {
      if (time < cutoff) userCooldowns.delete(uid);
    }
  }

  try {
    logger.debug(
      { commandName: interaction.commandName, userId, guildId: interaction.guildId },
      'Executing command'
    );
    await command.execute(interaction as ChatInputCommandInteraction);
  } catch (error) {
    logger.error({ error, commandName: interaction.commandName, userId }, 'Command execution failed');

    const errorMessage = 'There was an error executing this command.';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errorMessage, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
});

// Handle message commands (e.g., !docs)
client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;

  const prefix = env.BOT_COMMAND_PREFIX.toLowerCase();
  if (!message.content.toLowerCase().startsWith(prefix)) return;

  const userId = message.author.id;
  const now = Date.now();
  const lastUsed = userCooldowns.get(userId) || 0;
  const cooldownMs = env.COOLDOWN_SECONDS * 1000;

  if (now - lastUsed < cooldownMs) {
    const remainingSeconds = Math.ceil((cooldownMs - (now - lastUsed)) / 1000);
    await message.reply(`⏳ Please wait ${remainingSeconds} seconds before using another command.`);
    return;
  }

  userCooldowns.set(userId, now);

  const question = message.content.slice(prefix.length).trim();

  if (!question) {
    await message.reply(`❓ Please provide a question after \`${env.BOT_COMMAND_PREFIX}\`. Example: \`${env.BOT_COMMAND_PREFIX} How do I get started?\``);
    return;
  }

  if (question.length > 2000) {
    await message.reply('❌ Your question is too long. Please keep it under 2000 characters.');
    return;
  }

  const channelId = message.channelId;

  logger.info({ userId, channelId, questionLength: question.length }, `Processing ${env.BOT_COMMAND_PREFIX} message command`);

  try {
    const existingConversationId = channelConversations.get(channelId);

    const response = await ragApi.chat({
      message: question,
      conversationId: existingConversationId,
    });

    channelConversations.set(channelId, response.conversationId);

    const embed = createResponseEmbed(question, response.answer, response.sources);
    const components = createSourceButtons(response.sources);

    await message.reply({
      embeds: [embed],
      components: components.length > 0 ? components : undefined,
    });

    logger.info({ userId, channelId, sourceCount: response.sources.length }, 'Message command completed');
  } catch (error) {
    logger.error({ error, userId, channelId }, 'Message command failed');

    const errorEmbed = new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle('❌ Error')
      .setDescription('Sorry, I encountered an error while processing your question. Please try again later.')
      .setFooter({ text: env.BOT_NAME })
      .setTimestamp();

    await message.reply({ embeds: [errorEmbed] });
  }
});

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

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

logger.info('Starting Discord bot...');
client.login(env.DISCORD_BOT_TOKEN).catch((error) => {
  logger.error({ error }, 'Failed to login to Discord');
  process.exit(1);
});
