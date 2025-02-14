import { Socket } from 'socket.io';
import GuildMembers from '../../../data/guild-members';
import Guilds from '../../../data/guilds';
import Invites from '../../../data/invites';
import { InviteDocument } from '../../../data/models/invite';
import Users from '../../../data/users';
import Deps from '../../../utils/deps';
import { WSRooms } from '../modules/ws-rooms';
import { WebSocket } from '../websocket';
import { WSEvent, Args, Params } from './ws-event';

export default class implements WSEvent<'GUILD_MEMBER_ADD'> {
  on = 'GUILD_MEMBER_ADD' as const;

  constructor(
    private guilds = Deps.get<Guilds>(Guilds),
    private members = Deps.get<GuildMembers>(GuildMembers),
    private invites = Deps.get<Invites>(Invites),
    private rooms = Deps.get<WSRooms>(WSRooms),
    private users = Deps.get<Users>(Users),
  ) {}

  public async invoke(ws: WebSocket, client: Socket, { inviteCode }: Params.GuildMemberAdd) {
    const invite = await this.invites.get(inviteCode);
    const guild = await this.guilds.get(invite.guildId);
    const userId = ws.sessions.userId(client);

    const inGuild = guild.members.some(m => m.userId === userId);
    if (inGuild)
      throw new TypeError('User already in guild');
    
    const user = await this.users.getSelf(userId);
    if (inviteCode && user.bot)
      throw new TypeError('Bot users cannot accept invites');

    await this.handleInvite(invite);
    const member = await this.members.create(guild, user);
    await this.rooms.joinGuildRooms(user, client);
    
    ws.io
      .to(guild.id)
      .emit('GUILD_MEMBER_ADD', { guildId: guild.id, member } as Args.GuildMemberAdd);

    ws.io
      .to(user.id)
      .emit('GUILD_JOIN', { guild } as Args.GuildJoin);
  }

  private async handleInvite(invite: InviteDocument) {
    const inviteExpired = Number(invite.options?.expiresAt?.getTime()) < new Date().getTime();
    if (inviteExpired)
      throw new TypeError('Invite expired');
    
    invite.uses++;

    (invite.options?.maxUses && invite.uses >= invite.options.maxUses)
      ? await invite.deleteOne()
      : await invite.save();
  }
}
