import {Client, GuildMember, Message} from "discord.js";
import {Command} from "../../handlers/commands/Command";
import {Instance} from "../../misc/Globals";
import {ICleverbot} from "./cleverbot.interface";
import {MuteQueue} from "../../moderation/MuteQueue";
import {MessageQueue} from "../../moderation/MessageQueue";
import {Database} from "../../database/Database";
import {ArgOptions} from "../arg.interface";
import {UserPermissions} from "../command.interface";

export interface CommandParameters extends Instance {
    message:Message;
    bot: Client;
    alexa: ICleverbot;
    muteQueue: MuteQueue;
    messageQueue: MessageQueue;
    database : Database;
    args: string[];
    input: any[];
    expect: (ArgOptions | ArgOptions[])[];
    name: string;
}

export interface UserInputData {
    stealth: boolean;
    command: string;
    args: string[];
}

export abstract class ICommandHandler {
    commands: Command[];
    restarting: boolean;
    abstract glob(): void;
    abstract async parseInput(message: Message): Promise<UserInputData | undefined>;
    abstract async handler(message: Message): Promise<any>;

    //*Private*/ abstract async _run(message: Message, command: Command, params: CommandParameters){
    //*Private*/ static checkBrokenFunction(command: Command);
    abstract findCommand(targetName: string, excludeOwner: boolean): Command | undefined;
    abstract getMissingUserPermission(executor: GuildMember, command: Command): UserPermissions | false;
}
