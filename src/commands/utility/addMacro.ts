import {Message} from "discord.js";
import {handleInvalidParameters} from "../../handlers/commands/invalidCommandHandler";
import {handleFailedCommand} from "../../embeds/commands/commandExceptionEmbed";
import gb from "../../misc/Globals";
import {Help} from "../info/help/help.interface";
import {debug} from "../../utility/Logging";
import {Macro} from "../../database/models/macro";
const help: Help = require('../../commands/help.json');

export default async function addMacro(message: Message, input: [string, string]) {
    const [macroName, macroContent] = input;
    if (macroContent.length > 200) {
        return void handleFailedCommand(
            message.channel, `${gb.emojis.get('alexa_boi')} How do you expect me to remember all that? Try something shorter.`
        );
    }
    else if (help.commands.map(command => command.name).includes(macroName)) {
        return void handleFailedCommand(
            message.channel, "That macro is already a command name, try to pick something else."
        );
    }
    else if (message.mentions.users.size){
        return void handleFailedCommand(
            message.channel,
            `Mentions are not allowed in macros, do you know how annoying it is to get pinged by bots? (⁎˃ᆺ˂)`
        )
    }

    gb.instance.database.getMacroCount(message.guild.id).then(async (count: number) => {
        if (count >= 50) {
            return void handleFailedCommand(
                message.channel, "Whoa, you already have 50 macros saved, time to delete some"
            );
        }

        const found: Macro | undefined = await gb.instance.database.getMacro(message.guild.id, macroName);
        if (found) {
            (handleFailedCommand(
                message.channel, `A macro with the name **${macroName}** already exists in this server.`
                )
            );
            return Promise.reject(new Error('Duplicate macro'));
        }

        return gb.instance.database.addMacro(message, macroName, macroContent)
    }).then(async(macro: Partial<Macro>|undefined) => {
        const prefix = await gb.instance.database.getPrefix(message.guild.id);
        if (macro)
            message.channel.send(`From now on I'll respond to **${prefix}${macro.macro_name}** with:\n${macro.macro_content}`);
    }).catch((err: Error) => {
        if (err.message === 'Duplicate macro'){
            return debug.silly(`Duplicate macro ${macroName} entered in ${message.guild.name}`, 'addMacro');
        }
        return debug.error(err, 'addMacro')
    })
}
