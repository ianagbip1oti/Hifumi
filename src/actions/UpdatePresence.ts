import * as Discord from 'discord.js'
import {default as gb} from "../misc/Globals";
import {Guild} from "discord.js";

export default function updatePresence(bot : Discord.Client) : void {
    gb.allMembers = 0;
    bot.guilds.array().forEach(function (value: Guild) {
        gb.allMembers += value.memberCount;
    });

    bot.user.setActivity(`out for ${gb.allMembers} users`, {
        type: 'WATCHING'
    });
}
