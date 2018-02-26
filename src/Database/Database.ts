import {
    getWhitelistedInvites, insertGuild, PreparedStatement, updateDefaultChannel,
    upsertPrefix
} from "./PreparedStatements";
import {IDatabase, IMain, IOptions, ITask} from 'pg-promise'
import {defaultTableTemplates, getPrefixes, testQuery} from "./QueryTemplates";
import {Collection, Guild} from "discord.js";
import {IGuild} from "./TableTypes";

import * as pgPromise from 'pg-promise'
import * as dbg from "debug";

export const debug = {
    silly  : dbg('Bot:Database:Silly'),
    info   : dbg('Bot:Database:Info'),
    warning: dbg('Bot:Database:Warning'),
    error  : dbg('Bot:Database:Error')
};

interface ICachedGuild {
    prefix: string;
    blacklistedLinks: string[];
    whitelistedInvites: string[];
}

export interface PostgresDevLoginConfig {
    type: string;
    host: string;
    port: number;
    database: string;
    user: string;
}

export interface PostgresLiveLoginConfig {
    type: string;
    connectionString: string;
    ssl: boolean;
}

export type DatabaseConfig = PostgresLiveLoginConfig|PostgresDevLoginConfig;
export type Query = string;
function isDeployementLogin(object: any) : object is PostgresLiveLoginConfig {
    return 'ssl' in object;
}

function getDatabaseType(url : DatabaseConfig){
    return isDeployementLogin(url) ? 'heroku' : 'localhost';
}

export class Database {
    // variable login based on environment
    readonly initOptions = {
        // global event notification;
        error: ((error: any, e :any) => {
            if (e.cn) {
                // A connection-related error;
                //
                // Connections are reported back with the password hashed,
                // for safe errors logging, without exposing passwords.
                console.log('CN:', e.cn);
                console.log('EVENT:', error.message || error);
            }
        })
    };
    config : DatabaseConfig;

    pgp = pgPromise(this.initOptions);
    db : IDatabase<any>;
    guilds : Record<string, ICachedGuild> = {};


    constructor(url : DatabaseConfig){
        this.config = url;
        debug.info("Logging into Postgres on " + getDatabaseType(url));
        this.db = this.pgp(this.config);
        this.checkTables();
        // we don't want to query the db every message so
        // we're caching the prefixes instead
        this.cacheGuilds();
        debug.info('Database is connected.');
    }

    private testDB(){
        this.db.any(testQuery).then(q => {
            console.log("TEST QUERY:");
            console.log(q);
        })
    }

    private initializeGuildIfNone(guildId : string) : boolean{
        if (this.guilds[guildId] === undefined){
            this.guilds[guildId] = <ICachedGuild>{};
            return false;
        }
        else {
            return true;
        }
    }

    private async cacheGuilds() : Promise<void> {
        this.db.any(getPrefixes).then(fields => {
            // returning id, prefix
            fields.forEach(async(guild : IGuild) => {
                this.initializeGuildIfNone(guild.id);

                const whitelistedInvites = await this.db.any(getWhitelistedInvites(guild.id));
                if (whitelistedInvites.length > 0)
                    this.guilds[guild.id].whitelistedInvites = whitelistedInvites.map(item => item.link);

                this.guilds[guild.id].prefix  = guild.prefix;

                //debug.info(this.guilds);
            });
        });
    }

    private async cacheNewGuild(guild : IGuild){
        this.guilds[guild.id].prefix = guild.prefix;
        this.guilds[guild.id].whitelistedInvites = [];
        this.guilds[guild.id].blacklistedLinks = [];
    }

    private checkTables() : Promise<any> {
        return this.db.task(t => {
            let queries : string[] = [];
            defaultTableTemplates.forEach(query => {
                queries.push(t.none(query));
            });
            return t.batch(queries);
        });
    }

    public setPrefix(guild_id : string, prefix : string) : Promise<IGuild|Error|-1> {
        if (prefix.length > 1) // this could change later on where we support up to 3 but na
            // have to Promise.reject outside the promise chain
            return Promise.reject(-1);

        const prepStatement : PreparedStatement = upsertPrefix(guild_id, prefix);
        return this.db.one(prepStatement).then((res: IGuild)=> {
            // changing our cached value as well
            this.guilds[res.id].prefix = res.prefix;
            return res;
        }).catch((err : Error) => {
            debug.error("Error while updating prefix.", err);
            return err;
        });
    }

    public getPrefix(guildId : string) {
        return this.guilds[guildId];
    }

    public addGuild(guild : Guild){
        this.db.one(insertGuild(guild.id, guild.name)).then((guild : IGuild)=> {
            this.cacheNewGuild(guild);
        });
    }

    public addBlacklistedLink(link : string){

    }

    public removeBlacklistedLink(link : string){

    }

    public addWhitelistedInvite(invite : string){
        // we need to make sure we're only matching the
        // invite part of this and not the whole link itself
    }

    public removeWhitelistedInvite(invite : string){

    }

    public updateDefaultChannel(guildId : string, channelId : string) : Promise<string>{
        return this.db.oneOrNone(updateDefaultChannel(guildId, channelId)).then((r: IGuild)=> {
            return r.default_channel;
        });
    }
}