import {
    createConnection,
    ConnectionOptions,
    Connection,
    getConnection,
    DeleteResult,
    InsertResult,
    UpdateResult
} from 'typeorm'
import {IORMConfig} from "./ormconfig.interface";
import gb from "../misc/Globals";
import {Environments} from "../events/systemStartup";
import {debug} from "../utility/Logging";
import {User} from "./models/user";
import {Guild} from "./models/guild";
import {GuildMember, Message, Guild as DiscordGuild, GuildAuditLogsFetchOptions} from "discord.js";
import {Macro} from "./models/macro";
import {Note} from "./models/note";
import {arrayFromValues} from "../utility/Util";
import 'reflect-metadata';
import * as fs from 'fs'
import {Infraction} from "./models/infraction";
import moment = require("moment");
const rootConfig: IORMConfig = require('../../ormconfig.json');

interface IWelcomeMessage {
    message: Message;
    userId: string;
}
export class Database {
    env: Environments;
    connectionString: string;
    conn: Connection;
    /**
     * Tells when the database is ready for other instances to query
     * @type {boolean}
     */
    ready: boolean = false;
    welcomeMessages: {[id: string]: IWelcomeMessage[]} = {};
    constructor(url: string) {
        this.env = gb.ENV;
        this.connectionString = url;
        debug.info(`Logging into postgres in ${this.env === Environments.Development ? 'dev' : 'live'} mode.`, `Database`);
        this.connect(url).then(conn => {
            debug.info(`Logged into postgres`, `Database`);
            this.conn = conn;
            return this.sync();
        }).then(() => {
            this.ready = true;
        })
    }

    /**
     * Connects to postgres, returns connection on successful connections
     * @param {string} url
     * @returns {Promise<Connection>}
     */
    public connect(url: string): Promise<Connection> {
        return this.ormConfig(url).then(() => {
            return createConnection({
                type: 'postgres',
                url: url,
                entities: ['src/database/models/**/*.js'],
                migrations: ['src/database/migrations/**/*.js'],
                synchronize: this.env === Environments.Development,
                dropSchema: this.env === Environments.Development,
                cli: {
                    migrationsDir: 'migrations'
                },
                cache: {
                    type: 'redis',
                    duration: Infinity,
                    options: {
                        url: this.env === Environments.Development ? 'redis://localhost:6379' : process.env.REDISCLOUD_URL
                    }
                }
            }).catch(err => {
                debug.error(err, `Database`);
                return Promise.reject(err);
            });

        }).catch(err => {
            debug.error(err, `Database`);
            return Promise.reject(err);
        });
    }

    /**
     * Sets up the ormconfig.json file in the root folder.
     * We need this hack because of migrations which can only be set up
     * using these settings or environment variables which don't support URL types
     * @param {string} url
     * @returns {Promise<void>}
     */
    private ormConfig(url: string): Promise<void> {
        return new Promise((resolve, reject) => {
            rootConfig.url = url;
            fs.writeFile('ormconfig.json', JSON.stringify(rootConfig, null, '\t'), (err) => {
                if (err)
                    return reject();
                return resolve();
            });
        });
    }

    /**
     * Syncs the database with currently
     * @returns {Promise<void>}
     */
    public async sync(): Promise<void> {
        debug.silly(`Crosschecking database`, `Database`);
        const guilds = gb.instance.bot.guilds.array();
        for (let i in guilds) {
            const guild = guilds[i];
            // setting each server
            this.welcomeMessages[guilds[i].id] = [];

            await this.addGuild(guild);

            const users = guild.members.array();
            let targetArray: GuildMember[] = [];
            for (let i in users) {
                targetArray.push(users[i]);
            }
            const x = await this.addMembers(targetArray);
        }
        debug.silly(`Crosschecked db`,`Database`);
        return Promise.resolve();
    }

    public invalidateCache(table: string): Promise<void>{
        // always caching so we're force validating queryResultCache

        return this.conn.queryResultCache!.remove([table]);
    }

    public getUsers(guildId: string): Promise<User[]> {
        return this.conn.manager.find(User, {where: {guild_id: guildId}, cache: true});
    }

    public getUser(guildId: string, userId: string): Promise<User>  {
        return this.conn.manager.find(User, {where: {guild_id: guildId, id: userId}, cache: true}).then((r: User[]) => {
            if (r.length > 1) {
                debug.error(`Multiple instances of user ${userId} exists in the db.`, `Database`);
            }
            return r[0];
        }).catch((err: Error)=> {
            return Promise.reject(err);
        })
    }

    public getGuild(guildId: string): Promise<Guild> {
        return this.conn.manager.findOne(Guild, {where: {id: guildId}, cache: true}).then((r: Guild | undefined) => {
            if (!r)
                return Promise.reject('Guild not found');
            return Promise.resolve(r);
        }).catch((err: Error)=> {
            return Promise.reject(err);
        })
    }


    public getGuilds(): Promise<Guild[]>{
        return this.conn.manager.find(Guild, {cache: true});
    }

    public getMacros(guildId: string): Promise<Macro[]> {
        return this.conn.manager.find(Macro, {where: {guild_id: guildId}, cache: true}).then((r: Macro[]) => {
            return r;
        });
    }

    public getMacro(guildId: string, name: string): Promise<Macro|undefined> {
        return this.conn.manager.findOne(Macro, {where: {guild_id: guildId, macro_name: name}, cache: true});
    }

    public getMacroCount(guildId: string): Promise<number> {
        return this.getMacros(guildId).then((r: Macro[]) => {
            return r.length;
        });
    }

    public setPrefix(guildId: string, prefix: string) {
        if (prefix.length > 1) {
            return Promise.reject(`Prefix for ${guildId} must be a single character`);
        }
        return this.invalidateCache('guilds').then(() => {
            return this.conn.manager.save(Guild, {id: guildId, prefix: prefix});
        }).catch(err => {
            debug.error(`Error getting guild`, `Database`);
            return Promise.reject(err);
        })
    }

    public getPrefix(guildId: string): Promise<string> {
        return this.getGuild(guildId).then((guild: Guild) => {
            return guild.prefix;
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public addMember(target: GuildMember): Promise<Partial<User>> {
        return this.invalidateCache('users').then(() => {
            return this.conn.manager.save(User, {id: target.id, guild_id: target.guild.id}, );
        }).catch((err: Error)=> {
            if (err.message.indexOf('duplicate key') >= 0)
                return Promise.resolve(<Partial<User>> {
                    id: target.id,
                    guild_id: target.id
                });
            return Promise.reject(err);
        });
    }

    public addMembers(targets: GuildMember[]): Promise<InsertResult> {
        const final = targets.reduce((a: Partial<User>[], t: GuildMember) => {
            a.push({id: t.id, guild_id: t.guild.id});
            return a;
        }, <Partial<User>[]> []);

        return this.invalidateCache('users').then(() => {
            return this.conn.createQueryBuilder()
                .insert()
                .into(User)
                .values(final)
                .onConflict(`("id", "guild_id") DO NOTHING`)
                .execute();
        })
    }

    public addGuild(guild: DiscordGuild): Promise<Partial<Guild>>{
        // setting welcome messages to empty array
        this.welcomeMessages[guild.id] = [];
        return this.invalidateCache('guilds').then(() => {
            return this.conn.manager.save(Guild, {
                id: guild.id
            });
        }).catch(err => {
            return Promise.reject(err);
        })
    }

    public addMacro(message: Message, macroName: string, macroContent: string): Promise<Partial<Macro>> {
        return this.invalidateCache('macros').then(() => {
            return this.conn.manager.save(Macro, {
                creator_id: message.author.id,
                date_created: new Date(),
                guild_id: message.guild.id,
                macro_name: macroName,
                macro_content: macroContent
            });
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public deleteMacro(guild: DiscordGuild, macroName: string): Promise<DeleteResult>{
        return this.conn.manager.delete(Macro, {macro_name: macroName, guild_id: guild.id});
    }

    public addNote(guild: DiscordGuild, caller: GuildMember, target: GuildMember, noteContent: string): Promise<Partial<Note>> {
        return this.invalidateCache('notes').then(() => {
            return this.conn.manager.save(Note, {
                guild_id: guild.id,
                staff_id: caller.id,
                target_id: target.id,
                staff_name: caller.user.username,
                guild_name: guild.name,
                note_date: new Date(),
                note_content: noteContent
            });
        });
    }

    public deleteNote(guild: DiscordGuild, noteId: string): Promise<DeleteResult> {
        return this.invalidateCache('notes').then(() => {
            return this.conn.createQueryBuilder()
                .delete()
                .from(Note)
                .where('note_id = :note_id AND guild_id = :guild_id', {note_id: noteId, guild_id: guild.id})
                .execute();
        })
    }

    public getNotes(memberId: string, guildId: string){
        return this.conn.manager.find(Note, {where: {target_id: memberId, guild_id: guildId}, cache: true});
    }

    public cacheWelcomeMessage(member: GuildMember, welcomeMessage: Message)    {
        this.welcomeMessages[member.guild.id].push({userId: member.id, message: welcomeMessage});
    }

    public unCacheWelcomeMessage(member: GuildMember): Message | undefined {
        const target = this.welcomeMessages[member.guild.id];
        if(!target || !target.length){
            const err = `A welcome message in ${member.guild.id} could not be removed because the list is empty`
            return void debug.error(err, `Database`);
        }
        const out = target.find(t => t.userId === member.id);
        return out ? out.message : undefined;
    }

    public setAllowGuildInvites(guildId: string, state: boolean): Promise<Partial<Guild>> {
        return this.invalidateCache('guilds').then(() => {
            return this.conn.manager.save(Guild, {id: guildId, allows_invites: state});
        }).catch(err => {
            return Promise.reject(err);
        })
    }

    public getAllowGuildInvites(guildId: string): Promise<boolean> {
        return this.getGuild(guildId).then((r: Guild) => {
            return r.allows_invites;
        }).catch(err => {
            return Promise.reject(err);
        })
    }

    public setWelcomeChannel(guildId: string, channelId: string): Promise<Partial<Guild>> {
        return this.invalidateCache('guilds').then(() => {
            return this.conn.manager.save(Guild, {id: guildId, welcome_channel: channelId});
        }).catch(err => {
            return Promise.reject(err);
        })
    }

    public setLogsChannel(guildId: string, channelId: string): Promise<Partial<Guild>> {
        return this.getGuild(guildId).then((r: Guild) => {
            if (!r.warnings_channel) {
                return void this.setWarningsChannel(guildId, channelId);
            }
        }).then(() => {
            return this.invalidateCache('guilds');
        }).then(() => {
            return this.conn.manager.save(Guild, {id: guildId, logs_channel: channelId});
        }).catch((err: Error) => {
            return Promise.reject(err);
        });
    }


    public setWarningsChannel(guildId: string, channelId: string): Promise<Partial<Guild>> {
        return this.invalidateCache('guilds').then(() => {
            return this.conn.manager.save(Guild, {id: guildId, warnings_channel: channelId});
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public setChatChannel(guildId: string, channelId:string): Promise<Partial<Guild>> {
        return this.invalidateCache('guildss').then(() => {
            return this.conn.manager.save(Guild, {id: guildId, chat_channel: channelId});
        }).catch(err => {
            return Promise.reject(err);
        })
    }

    public getWelcomeChannel(guildId: string): Promise<string> {
        return this.getGuild(guildId).then((r: Guild) => {
            return r.welcome_channel;
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public getLogsChannel(guildId: string): Promise<string> {
        return this.getGuild(guildId).then((r: Guild) => {
            return r.logs_channel;
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public getWarningsChannel(guildId: string): Promise<string> {
        return this.getGuild(guildId).then((r: Guild) => {
            return r.warnings_channel;
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public getChatChannel(guildId: string): Promise<string> {
        return this.getGuild(guildId).then((r: Guild) => {
            return r.chat_channel;
        }).catch(err => {
            return Promise.reject(err);
        })
    }

    public setUserIgnore(member: GuildMember, state: boolean): Promise<UpdateResult> {

        return this.invalidateCache('users').then(() => {
            // return this.conn.manager.save(User, {guild_id: member.guild.id, id: member.user.id, ignoring: state});
            return this.conn.manager.createQueryBuilder()
                .update(User)
                .set({ignoring: state})
                .where(`guild_id = :guild_id AND id = :id`, {guild_id: member.guild.id, id: member.id})
                .execute();
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public isUserIgnored(member: GuildMember): Promise<boolean> {
        return this.getUser(member.guild.id, member.id).then((r: User) => {
            return r.ignoring;
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public getIgnoredUsers(guildId: string): Promise<User[]>{
        return this.getUsers(guildId).then((r: User[]) => {
            return r.filter(user => user.ignoring);
        });
    }
    public setCommandHints(guildId: string, state: boolean): Promise<Partial<Guild>> {
        return this.invalidateCache('guilds').then(() => {
            return this.conn.manager.save(Guild, {id: guildId, hints: state});
        });
    }

    public getCommandHints(guildId: string){
        return this.getGuild(guildId).then((r: Guild) => {
            return r.hints;
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public getReactions(guildId: string){
        return this.getGuild(guildId).then((r: Guild) => {
            return r.reactions;
        }).catch(err => {
            return Promise.reject(err);
        })
    }

    public incrementInviteStrike(member: GuildMember){
        const memberIdentity = {
            id: member.id,
            guild_id: member.guild.id
        };

        return this.conn.manager.increment(User, memberIdentity, 'invite_strikes', 1)
            .catch(err => Promise.reject(err))
            .then(() => {
                return this.conn.manager.findOne(User, memberIdentity)
            }).then((r: User|undefined) => {
                if (!r){
                    return Promise.reject(`Invite strike of user with ID ${member.id} could not be incremented, user not found.`);
                }
                return Promise.resolve(r.invite_strikes);
            }).catch(err =>  Promise.reject(err));
    }

    public setReactions(guildId: string, state: boolean){
        return this.invalidateCache('guilds').then(() => {
            return this.conn.manager.save(Guild, {
                id: guildId,
                reactions: state
            });
        }).catch(err => {
            return Promise.reject(err);
        });
    }

    public incrementCleverbotCalls(guildId: string){
        return this.invalidateCache('guilds').then(() => {
            return this.conn.manager.increment(Guild, {id: guildId}, 'cleverbot_calls', 1);
        });
    }

    public addInfraction(staff: GuildMember, target: GuildMember, reason: string, weight: number): Promise<Partial<Infraction>> {
        const expiration_date = moment(new Date()).add(2, 'w').toDate();
        return this.invalidateCache('infractions').then(() => {
            return this.conn.manager.save(Infraction, {
                target_id: target.id,
                guild_id: staff.guild.id,
                guild_name: staff.guild.name,
                staff_id: staff.id,
                staff_name: staff.user.username,
                infraction_reason: reason,
                infraction_weight: weight,
                infraction_date: new Date(),
                expiration_date: expiration_date
            });
        }).catch(err => Promise.reject(err));
    }

    public getInfractionLimit(guildId: string){
        return this.getGuild(guildId).then((r: Guild) => {
            return r.infraction_limit;
        }).catch(err => Promise.reject(err));
    }


    public getInfractions(guildId: string, targetId?: string): Promise<Infraction[]>{
        if (targetId){
            return this.conn.manager.find(Infraction, {where: {
                    guild_id: guildId,
                    target_id: targetId
                }, cache: true});
        }
        return this.conn.manager.find(Infraction, {where: {guild_id: guildId}, cache: true});
    }

    public getInfractionById(id: number){
        return this.conn.manager.findOne(Infraction, {where: {infraction_id: id},  cache: true});
    }

    public deleteInfractionById(id: number, guildId: string){
        return this.conn.createQueryBuilder()
            .delete()
            .from(Infraction)
            .where('infraction_id = :infraction_id AND guild_id = :guild_id', {infraction_id: id, guild_id: guildId})
            .execute();
    }
    public getTrackNewMembers(guildId: string){
        return this.getGuild(guildId).then((r: Guild) => {
            return r.tracking_new_members;
        }).catch(err => Promise.reject(err));
    }

    public setTrackNewMembers(guildId: string, state: boolean){
        return this.conn.manager.save(Guild, {
            id: guildId,
            track_new_members: state
        }).catch(err => Promise.reject(err));
    }

    public incrementBanCount(guildId: string){
        return this.conn.manager.increment(Guild, {id: guildId}, `users_banned`, 1);
    }
}

