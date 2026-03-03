import { Collection, SlashCommandOptionsOnlyBuilder, ChatInputCommandInteraction } from 'discord.js';
import { askCommand } from './ask.js';
import { statusCommand } from './status.js';
import { helpCommand } from './help.js';
import { imagesCommand } from './images.js';
import { addDocumentCommand } from './add-document.js';
import { convertDocumentCommand } from './convert-document.js';

export interface Command {
  data: SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands = new Collection<string, Command>();

commands.set(askCommand.data.name, askCommand);
commands.set(statusCommand.data.name, statusCommand);
commands.set(helpCommand.data.name, helpCommand);
commands.set(imagesCommand.data.name, imagesCommand);
commands.set(addDocumentCommand.data.name, addDocumentCommand);
commands.set(convertDocumentCommand.data.name, convertDocumentCommand);

export {
  askCommand,
  statusCommand,
  helpCommand,
  imagesCommand,
  addDocumentCommand,
  convertDocumentCommand,
};
