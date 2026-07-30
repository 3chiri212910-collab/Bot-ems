// ============================================================
// index.js – Bot Discord + Panel RP (système de tickets nouvelle génération)
// ============================================================

const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  REST,
  Routes,
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// ---- Variables d'environnement ----
const requiredEnv = ['TOKEN', 'CLIENT_ID', 'GUILD_ID', 'CLIENT_SECRET', 'DISCORD_REDIRECT_URI'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Variable d'environnement ${key} manquante !`);
    process.exit(1);
  }
}
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const PORT = process.env.PORT || 3000;
const GUILD_ID = process.env.GUILD_ID;

let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  const secretFile = path.join(__dirname, '.secret');
  if (fs.existsSync(secretFile)) {
    SESSION_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } else {
    SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, SESSION_SECRET);
  }
}

// ---- Upload ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// ---- Fichiers de données ----
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const GIVEAWAYS_FILE = path.join(DATA_DIR, 'giveaways.json');
const WARNS_FILE = path.join(DATA_DIR, 'warns.json');
const CAND_HISTORY_FILE = path.join(DATA_DIR, 'candidatures-history.json');
const EVALUATIONS_FILE = path.join(DATA_DIR, 'evaluations.json');

// ---- Fonctions de lecture/écriture ----
function lire(fichier, defaut) {
  try {
    const raw = fs.readFileSync(fichier, 'utf8');
    const data = JSON.parse(raw);
    if (fichier === CONFIG_FILE) {
      data.ticketCategories = Array.isArray(data.ticketCategories) ? data.ticketCategories : [];
    }
    return data;
  } catch (e) {
    if (fs.existsSync(fichier)) {
      console.warn(`⚠️ Lecture impossible de ${fichier}, utilisation des valeurs par défaut :`, e.message);
    }
    return defaut;
  }
}
function ecrire(fichier, data) {
  try { fs.writeFileSync(fichier, JSON.stringify(data, null, 2)); } catch (e) { console.error(`Erreur écriture ${fichier}:`, e); }
}

// ---- Données initiales ----
const CONFIG_DEFAUT = {
  autoRoleIds: [],
  welcomeChannelId: null,
  welcomeMessage: 'Bienvenue {user} sur **{server}** ! Tu es le membre **#{count}**.',
  modLogsChannelId: null,
  leaveLogsChannelId: null,
  // Tickets
  ticketLogsChannelId: null,
  ticketTranscriptChannelId: null,
  ticketAutoCloseHours: 0,
  ticketStaffRoleIds: [],
  ticketCategories: [],
  ticketClaimPingEnabled: false,
  ticketClaimPingRoleId: null,
  ticketClaimPingDelay: 5,
  // Candidatures
  candidatures: {
    actif: false,
    salonValidation: null,
    salonRefus: null,
    rolesValid: [],
    rolesRefus: [],
    rolesAttribution: [],
    mpActif: true,
    mentionUser: true,
    fermetureAuto: false,
    fermetureDelai: 10,
    messageValidation: '✅ {mention} Ta candidature (**{ticket}**) a été **validée** par {staff}.',
    messageRefus: '❌ {mention} Ta candidature (**{ticket}**) a été **refusée** par {staff}.',
    mpValidation: 'Bonjour **{username}**,\nTa candidature sur **{server}** a été **validée** par {staff}.\n📅 {date}',
    mpRefus: 'Bonjour **{username}**,\nTa candidature sur **{server}** a été **refusée** par {staff}.\n📅 {date}',
  },
  blacklist: [],
};

let config = lire(CONFIG_FILE, CONFIG_DEFAUT);
config.ticketCategories = Array.isArray(config.ticketCategories) ? config.ticketCategories : [];
let tickets = lire(TICKETS_FILE, {});
let logs = lire(LOGS_FILE, []);
let giveaways = lire(GIVEAWAYS_FILE, {});
let warns = lire(WARNS_FILE, []);
let candHistory = lire(CAND_HISTORY_FILE, []);
let evaluations = lire(EVALUATIONS_FILE, []);

function sauverConfig() { ecrire(CONFIG_FILE, config); }
function sauverTickets() { ecrire(TICKETS_FILE, tickets); }
function sauverLogs() { ecrire(LOGS_FILE, logs); }
function sauverGiveaways() { ecrire(GIVEAWAYS_FILE, giveaways); }
function sauverWarns() { ecrire(WARNS_FILE, warns); }
function sauverCandHistory() { ecrire(CAND_HISTORY_FILE, candHistory); }
function sauverEvaluations() { ecrire(EVALUATIONS_FILE, evaluations); }

// ---- Cache utilisateurs ----
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
async function fetchUserWithCache(userId) {
  if (userCache.has(userId)) {
    const entry = userCache.get(userId);
    if (Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  }
  try {
    const user = await client.users.fetch(userId);
    const data = {
      username: user.username,
      displayName: user.username,
      avatar: user.displayAvatarURL(),
      guildId: GUILD_ID,
    };
    userCache.set(userId, { data, timestamp: Date.now() });
    return data;
  } catch {
    const fallback = { username: userId, displayName: userId, avatar: null, guildId: GUILD_ID };
    userCache.set(userId, { data: fallback, timestamp: Date.now() });
    return fallback;
  }
}

// ---- Utilitaires ----
const ROLES_AUTORISES = ['1524935532914933837', '1524975599460814888']; // À adapter (fallback)
const NOM_SERVEUR = 'Mon Serveur RP';
const COULEUR_EMBED = '#5865F2';

function getModerationRoleIds() {
  return Array.isArray(config.moderationRoleIds) && config.moderationRoleIds.length
    ? config.moderationRoleIds
    : ROLES_AUTORISES;
}

function remplacerVariables(texte, vars) {
  return String(texte || '')
    .replaceAll('{user}', vars.user ?? '')
    .replaceAll('{mention}', vars.mention ?? '')
    .replaceAll('{username}', vars.username ?? '')
    .replaceAll('{server}', vars.server ?? '')
    .replaceAll('{staff}', vars.staff ?? '')
    .replaceAll('{ticket}', vars.ticket ?? '')
    .replaceAll('{date}', vars.date ?? '')
    .replaceAll('{raison}', vars.raison ?? '');
}

function estAutoriseCandidature(interaction, roleIds) {
  if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (!roleIds || roleIds.length === 0) return false;
  return roleIds.some(id => interaction.member.roles.cache.has(id));
}

function getGuild(res) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    res.status(500).json({ erreur: 'Le bot n\'est pas sur le serveur configuré (GUILD_ID)' });
    return null;
  }
  return guild;
}

// ---- Validation des emojis ----
function isValidEmoji(emoji) {
  if (!emoji || typeof emoji !== 'string' || emoji.trim() === '') return false;
  const emojiRegex = /\p{Extended_Pictographic}/u;
  return emojiRegex.test(emoji);
}

// ---- Logs modération / départ ----
async function envoyerLogModeration(embed) {
  if (!config.modLogsChannelId) return;
  const salon = await client.channels.fetch(config.modLogsChannelId).catch(() => null);
  if (!salon) return;
  await salon.send({ embeds: [embed] }).catch(() => {});
}

async function envoyerLogDepart(embed) {
  if (!config.leaveLogsChannelId) return;
  const salon = await client.channels.fetch(config.leaveLogsChannelId).catch(() => null);
  if (!salon) return;
  await salon.send({ embeds: [embed] }).catch(() => {});
}

function embedLogModeration({ action, couleur, emoji, cibleTag, cibleId, parTag, raison }) {
  return new EmbedBuilder()
    .setColor(couleur)
    .setTitle(`${emoji} ${action}`)
    .addFields(
      { name: 'Membre', value: `${cibleTag} (\`${cibleId}\`)`, inline: true },
      { name: 'Par', value: parTag, inline: true },
      { name: 'Raison', value: raison || 'Aucune raison fournie', inline: false }
    )
    .setTimestamp();
}

function embedLogDepart({ titre, couleur, membreTag, membreId, raison, timestamp }) {
  const embed = new EmbedBuilder()
    .setColor(couleur)
    .setTitle(titre)
    .addFields(
      { name: 'Membre', value: `${membreTag} (\`${membreId}\`)`, inline: true },
      { name: 'ID', value: membreId, inline: true },
      { name: 'Date / Heure', value: `<t:${Math.floor(timestamp / 1000)}:F>`, inline: true }
    )
    .setTimestamp();
  if (raison) embed.addFields({ name: 'Raison', value: raison, inline: false });
  return embed;
}

// ============================================================
//  NOUVEAU SYSTÈME DE TICKETS
// ============================================================

// ---- Helpers pour les tickets ----
function generateTicketId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function sanitizeChannelName(name) {
  const cleaned = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'ticket';
}

function getTicketByChannelId(channelId) {
  return Object.values(tickets).find(t => t.channelId === channelId);
}

function getTicketByUserId(userId) {
  return Object.values(tickets).find(t => t.userId === userId && t.status === 'open');
}

function isUserBlacklisted(userId) {
  return config.blacklist && config.blacklist.includes(userId);
}

async function addLog(action, staffId, staffTag, ticketId, details = '') {
  logs.push({
    action,
    staffId,
    staffTag,
    ticketId,
    details,
    timestamp: new Date().toISOString(),
  });
  sauverLogs();
  if (config.ticketLogsChannelId) {
    const channel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle(`📋 Log: ${action}`)
        .setDescription(`Staff: ${staffTag}\nTicket: ${ticketId}\n${details}`)
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

// ---- Création d'un ticket ----
async function createTicket(user, categoryId, formData = {}) {
  const existing = getTicketByUserId(user.id);
  if (existing) {
    throw new Error('Vous avez déjà un ticket ouvert. Veuillez le fermer avant d\'en ouvrir un nouveau.');
  }
  if (isUserBlacklisted(user.id)) {
    throw new Error('Vous êtes blacklisté et ne pouvez pas ouvrir de ticket.');
  }

  const category = config.ticketCategories.find(c => c.id === categoryId);
  if (!category || category.active === false) throw new Error('Catégorie inconnue ou désactivée.');
  if (!category.categoryId) throw new Error('La catégorie Discord de destination n\'est pas définie.');

  const baseName = sanitizeChannelName(`${category.name}-${user.username}`);
  const ticketId = generateTicketId();
  const channelName = `${baseName}-${ticketId.slice(0, 4)}`;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) throw new Error('Serveur introuvable.');

  const parent = guild.channels.cache.get(category.categoryId);
  if (!parent) throw new Error('Catégorie Discord de destination introuvable.');

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    }
  ];

  const supportRoleIds = new Set([...(config.ticketStaffRoleIds || []), ...(category.staffRoles || [])]);
  for (const roleId of supportRoleIds) {
    if (!roleId) continue;
    overwrites.push({
      id: roleId,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites: overwrites,
  });

  const ticket = {
    id: ticketId,
    userId: user.id,
    channelId: channel.id,
    categoryId: category.id,
    status: 'open',
    title: channelName,
    priority: category.defaultPriority || 'normal',
    assignedTo: null,
    notes: '',
    messages: [],
    createdAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
    evaluation: null,
    embedMessageId: null,
    claimAt: null,
    claimedBy: null,
    pingSent: false,
    pingTimerId: null,
  };
  tickets[ticketId] = ticket;
  sauverTickets();

  const embedFields = [];
  if (formData && Object.keys(formData).length > 0) {
    for (const [key, value] of Object.entries(formData)) {
      embedFields.push({ name: key, value: value || 'Non renseigné', inline: false });
    }
  }

  const staffEmbed = new EmbedBuilder()
    .setColor(category.color || '#2E8BFF')
    .setTitle(`🎫 Ticket #${ticketId.slice(0, 6)} - ${category.emoji || ''} ${category.name}`)
    .setDescription(`Nouveau ticket ouvert par **${user.tag}**`)
    .addFields(
      { name: '🆔 ID du ticket', value: `\`${ticketId}\``, inline: true },
      { name: '📂 Catégorie', value: category.name, inline: true },
      { name: '📅 Date d\'ouverture', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
      { name: '⏳ Statut', value: 'Ouvert', inline: true },
      { name: '👤 Utilisateur', value: user.tag, inline: true },
      ...embedFields
    )
    .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `${guild.name} • Ticket privé`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();

  let pingContent = '';
  if (category.pingRoles && category.pingRoles.length > 0) {
    pingContent = category.pingRoles.map(id => `<@&${id}>`).join(' ');
  }

  const components = createTicketActionRows(ticketId, ticket);
  const messageOptions = {
    embeds: [staffEmbed],
    components,
  };
  if (pingContent) messageOptions.content = pingContent;

  const sentMsg = await channel.send(messageOptions);
  ticket.embedMessageId = sentMsg.id;
  tickets[ticketId] = ticket;
  sauverTickets();
  scheduleClaimPing(ticket);

  if (category.autoReply) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(category.color || '#2E8BFF')
        .setDescription(category.autoReply)
        .setTimestamp()]
    });
  }

function scheduleClaimPing(ticket) {
  if (!config.ticketClaimPingEnabled || !config.ticketClaimPingRoleId) return;
  if (ticket.pingTimerId) return;

  const delay = (parseInt(config.ticketClaimPingDelay, 10) || 5) * 60 * 1000;
  ticket.pingTimerId = setTimeout(async () => {
    try {
      if (ticket.status !== 'open' || ticket.claimedBy || ticket.pingSent) return;
      const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
      if (!channel) return;
      await channel.send({ content: `⚠️ Ce ticket est toujours en attente de prise en charge.

<@&${config.ticketClaimPingRoleId}>, merci de prendre ce ticket dès que possible.` });
      ticket.pingSent = true;
      ticket.pingTimerId = null;
      tickets[ticket.id] = ticket;
      sauverTickets();
      await addLog('Ping claim envoyé', 'system', 'Système', ticket.id, `Ping rôle ${config.ticketClaimPingRoleId}`);
    } catch (e) {
      console.error('Erreur ping claim:', e);
    }
  }, delay);
}

function clearClaimPing(ticket) {
  if (!ticket || !ticket.pingTimerId) return;
  clearTimeout(ticket.pingTimerId);
  ticket.pingTimerId = null;
  ticket.pingSent = false;
}

  const userEmbed = new EmbedBuilder()
    .setColor('#2E8BFF')
    .setTitle('📩 Nouveau Ticket')
    .setDescription(`Bonjour **${user.username}**,\n\nVotre demande a bien été prise en compte.\n\nUn membre du staff va vous répondre dès que possible.\n\nContinuez simplement à envoyer vos messages ici.\n\nTous vos messages seront automatiquement transmis à l'équipe du serveur.\n\nMerci de ne pas spam.`)
    .addFields(
      { name: '🆔 ID du ticket', value: `\`${ticketId}\``, inline: true },
      { name: '📂 Catégorie', value: category.name, inline: true },
      { name: '📅 Date d\'ouverture', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
      { name: '⏳ Statut', value: 'Ouvert', inline: true }
    )
    .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `${guild.name}`, iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();

  try {
    await user.send({ embeds: [userEmbed] });
  } catch (e) {}

  await addLog('Création ticket', user.id, user.tag, ticketId, `Catégorie: ${category.name}`);

  return ticket;
}

function getPriorityEmoji(priority) {
  const map = { low: '🟢', normal: '🟡', high: '🟠', urgent: '🔴' };
  return map[priority] || '🟡';
}

function createTicketActionRows(ticketId, ticket = null) {
  const claimButton = new ButtonBuilder()
    .setCustomId(`ticket_claim_${ticketId}`)
    .setLabel('📌 Claim')
    .setEmoji('📌')
    .setStyle(ButtonStyle.Primary);

  if (ticket && ticket.assignedTo) {
    claimButton.setLabel(`✅ Assigné à`).setStyle(ButtonStyle.Success).setDisabled(true);
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_close_${ticketId}`).setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ticket_reopen_${ticketId}`).setLabel('Réouvrir').setEmoji('🔓').setStyle(ButtonStyle.Success),
    claimButton,
    new ButtonBuilder().setCustomId(`ticket_assign_${ticketId}`).setLabel('Assigner').setEmoji('👤').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_priority_${ticketId}`).setLabel('Priorité').setEmoji('📌').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket_category_${ticketId}`).setLabel('Catégorie').setEmoji('🏷️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket_transfer_${ticketId}`).setLabel('Transférer').setEmoji('🔄').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket_note_${ticketId}`).setLabel('Note privée').setEmoji('📝').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_export_${ticketId}`).setLabel('Export HTML').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket_blacklist_${ticketId}`).setLabel('Blacklist').setEmoji('🚫').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2, row3];
}

// ---- Mise à jour de l'embed ----
async function updateTicketEmbed(channelId) {
  const ticket = getTicketByChannelId(channelId);
  if (!ticket) return;
  const category = config.ticketCategories.find(c => c.id === ticket.categoryId);
  if (!category) return;
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;

  const embed = buildTicketEmbed(ticket, user, category);
  const components = createTicketActionRows(ticket.id, ticket);
  const channel = await client.channels.fetch(channelId);
  if (ticket.embedMessageId) {
    const msg = await channel.messages.fetch(ticket.embedMessageId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed] });
    } else {
      const newMsg = await channel.send({ embeds: [embed] });
      ticket.embedMessageId = newMsg.id;
      tickets[ticket.id] = ticket;
      sauverTickets();
    }
  } else {
    const newMsg = await channel.send({ embeds: [embed] });
    ticket.embedMessageId = newMsg.id;
    tickets[ticket.id] = ticket;
    sauverTickets();
  }
}

function buildTicketEmbed(ticket, user, category) {
  const embed = new EmbedBuilder()
    .setColor(category.color || COULEUR_EMBED)
    .setTitle(`🎫 Ticket #${ticket.id.slice(0, 6)} - ${category.emoji} ${category.name}`)
    .setDescription(`Créé par **${user.tag}** (\`${user.id}\`)`)
    .addFields(
      { name: '📅 Date', value: `<t:${Math.floor(new Date(ticket.createdAt).getTime()/1000)}:F>`, inline: true },
      { name: '📌 Priorité', value: `${getPriorityEmoji(ticket.priority)} ${ticket.priority}`, inline: true },
      { name: '👤 Assigné à', value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : 'Personne', inline: true },
      { name: '📝 Note privée', value: ticket.notes || 'Aucune', inline: false }
    )
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  return embed;
}

// ---- Fermeture ----
async function closeTicket(ticketId, staffId, staffTag, reason = '') {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');
  if (ticket.status === 'closed') throw new Error('Ce ticket est déjà fermé.');

  ticket.status = 'closed';
  ticket.closedAt = new Date().toISOString();
  ticket.closedBy = staffId;
  sauverTickets();

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false }).catch(() => {});
    const embed = new EmbedBuilder()
      .setColor('#fb7185')
      .setTitle('🔒 Ticket fermé')
      .setDescription(`Fermé par **${staffTag}**${reason ? `\nRaison: ${reason}` : ''}\nMerci d'avoir utilisé notre support.`)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  }

  if (config.ticketTranscriptChannelId || config.ticketLogsChannelId) {
    await exportTicketHTML(ticketId, staffId, staffTag).catch(() => {});
  }

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dmEmbed = new EmbedBuilder()
      .setColor('#0d6efd')
      .setTitle('⭐ Évaluez votre expérience')
      .setDescription('Merci d\'avoir utilisé notre support.\n\nVotre ticket est maintenant fermé.\n\nVotre avis nous aide à améliorer la qualité du support.\n\nVeuillez attribuer une note de **1 à 5 étoiles**.')
      .setTimestamp();

    const evalRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rating_1_${ticketId}`).setLabel('⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rating_2_${ticketId}`).setLabel('⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rating_3_${ticketId}`).setLabel('⭐⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rating_4_${ticketId}`).setLabel('⭐⭐⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rating_5_${ticketId}`).setLabel('⭐⭐⭐⭐⭐').setStyle(ButtonStyle.Success),
    );
    await user.send({ embeds: [dmEmbed], components: [evalRow] }).catch(() => {});
  }

  if (config.ticketTranscriptChannelId || config.ticketLogsChannelId) {
    await exportTicketHTML(ticketId, staffId, staffTag).catch(() => {});
  }

  await addLog('Fermeture ticket', staffId, staffTag, ticketId, `Raison: ${reason || 'Aucune'}`);
}

// ---- Réouverture ----
async function reopenTicket(ticketId, staffId, staffTag) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');
  if (ticket.status !== 'closed') throw new Error('Ce ticket n\'est pas fermé.');

  ticket.status = 'open';
  ticket.closedAt = null;
  ticket.closedBy = null;
  sauverTickets();

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: true }).catch(() => {});
    const embed = new EmbedBuilder()
      .setColor('#34d399')
      .setTitle('🔓 Ticket réouvert')
      .setDescription(`Réouvert par **${staffTag}**.`)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  }

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dmEmbed = new EmbedBuilder()
      .setColor('#34d399')
      .setTitle('🔓 Ticket réouvert')
      .setDescription(`Votre ticket **#${ticket.id.slice(0, 6)}** a été réouvert par **${staffTag}**.`)
      .setTimestamp();
    await user.send({ embeds: [dmEmbed] }).catch(() => {});
  }

  await addLog('Réouverture ticket', staffId, staffTag, ticketId);
}

// ---- Renommer ----
async function renameTicket(ticketId, newName, staffId, staffTag) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');
  const sanitized = sanitizeChannelName(newName);
  if (!sanitized) throw new Error('Nom invalide.');

  ticket.title = sanitized;
  sauverTickets();

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    await channel.setName(sanitized.slice(0, 100));
  }

  await addLog('Renommage ticket', staffId, staffTag, ticketId, `Nouveau nom: ${sanitized}`);
  await updateTicketEmbed(ticket.channelId);
}

// ---- Assigner ----
async function assignTicket(ticketId, assigneeId, staffId, staffTag) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');
  ticket.assignedTo = assigneeId;
  sauverTickets();

  await addLog('Assignation ticket', staffId, staffTag, ticketId, `Assigné à <@${assigneeId}>`);
  await updateTicketEmbed(ticket.channelId);
}

// ---- Priorité ----
async function setPriority(ticketId, priority, staffId, staffTag) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');
  const valid = ['low', 'normal', 'high', 'urgent'];
  if (!valid.includes(priority)) throw new Error('Priorité invalide.');
  ticket.priority = priority;
  sauverTickets();

  await addLog('Changement priorité', staffId, staffTag, ticketId, `Priorité: ${priority}`);
  await updateTicketEmbed(ticket.channelId);
}

// ---- Changer catégorie ----
async function changeCategory(ticketId, newCategoryId, staffId, staffTag) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');
  const category = config.ticketCategories.find(c => c.id === newCategoryId);
  if (!category) throw new Error('Catégorie inconnue.');
  if (!category.categoryId) throw new Error('La catégorie Discord de destination n\'est pas définie.');

  const oldCategoryId = ticket.categoryId;
  ticket.categoryId = newCategoryId;
  sauverTickets();

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    const parent = await client.channels.fetch(category.categoryId).catch(() => null);
    if (parent) {
      await channel.setParent(parent.id);
    }
  }

  await addLog('Changement catégorie', staffId, staffTag, ticketId, `De ${oldCategoryId} vers ${newCategoryId}`);
  await updateTicketEmbed(ticket.channelId);
}

// ---- Note privée ----
async function setPrivateNote(ticketId, note, staffId, staffTag) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');
  ticket.notes = note;
  sauverTickets();

  await addLog('Note privée ajoutée', staffId, staffTag, ticketId, note);
  await updateTicketEmbed(ticket.channelId);
}

// ---- Export HTML ----
async function exportTicketHTML(ticketId, staffId, staffTag) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel) throw new Error('Salon introuvable.');

  let allMessages = [];
  let lastId = null;
  while (true) {
    const msgs = await channel.messages.fetch({ limit: 100, before: lastId });
    if (msgs.size === 0) break;
    allMessages.push(...msgs.values());
    lastId = msgs.last().id;
  }
  allMessages.reverse();

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  const category = config.ticketCategories.find(c => c.id === ticket.categoryId);

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Ticket #${ticket.id.slice(0, 6)}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #2f3136; color: #dcddde; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; background: #36393f; border-radius: 8px; padding: 20px; }
    .header { border-bottom: 2px solid #5865F2; padding-bottom: 10px; margin-bottom: 20px; }
    .header h1 { color: #fff; margin: 0; }
    .header .info { color: #b9bbbe; font-size: 14px; }
    .message { display: flex; gap: 10px; margin-bottom: 15px; align-items: flex-start; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
    .content { background: #40444b; padding: 10px 14px; border-radius: 8px; flex: 1; }
    .content .author { font-weight: bold; color: #fff; }
    .content .date { font-size: 12px; color: #72767d; margin-left: 10px; }
    .content .text { margin-top: 5px; white-space: pre-wrap; }
    .content .attachment { margin-top: 5px; }
    .content .attachment a { color: #00b0f4; }
  </style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🎫 Ticket #${ticket.id.slice(0, 6)}</h1>
    <div class="info">Créé par ${user ? user.tag : 'Inconnu'} · ${new Date(ticket.createdAt).toLocaleString('fr-FR')} · Catégorie: ${category ? category.name : 'Inconnue'}</div>
  </div>
  <div id="messages">`;

  for (const msg of allMessages) {
    const author = msg.author;
    const avatar = author.displayAvatarURL({ extension: 'png', size: 64 });
    const date = new Date(msg.createdTimestamp).toLocaleString('fr-FR');
    html += `
  <div class="message">
    <img class="avatar" src="${avatar}" alt="avatar">
    <div class="content">
      <div><span class="author">${author.tag}</span><span class="date">${date}</span></div>
      <div class="text">${msg.content || ''}</div>`;
    if (msg.attachments.size > 0) {
      html += `<div class="attachment">${msg.attachments.map(a => `<a href="${a.url}" target="_blank">${a.name}</a>`).join(' ')}</div>`;
    }
    html += `</div></div>`;
  }

  html += `
  </div>
</div>
</body>
</html>`;

  const transcriptChannelId = config.ticketTranscriptChannelId || config.ticketLogsChannelId;
  if (transcriptChannelId) {
    const transcriptChannel = await client.channels.fetch(transcriptChannelId).catch(() => null);
    if (transcriptChannel) {
      const buffer = Buffer.from(html, 'utf8');
      await transcriptChannel.send({
        content: `📄 Export du ticket #${ticket.id.slice(0, 6)} par ${staffTag}`,
        files: [{ attachment: buffer, name: `ticket-${ticket.id.slice(0, 6)}.html` }]
      });
    }
  }

  await addLog('Export HTML', staffId, staffTag, ticketId);
}

// ---- Blacklist ----
async function blacklistUser(ticketId, staffId, staffTag) {
  const ticket = tickets[ticketId];
  if (!ticket) throw new Error('Ticket introuvable.');
  const userId = ticket.userId;
  if (!config.blacklist) config.blacklist = [];
  if (config.blacklist.includes(userId)) throw new Error('Utilisateur déjà blacklisté.');
  config.blacklist.push(userId);
  sauverConfig();

  await closeTicket(ticketId, staffId, staffTag, 'Utilisateur blacklisté');

  await addLog('Blacklist utilisateur', staffId, staffTag, ticketId, `Utilisateur <@${userId}> blacklisté.`);
}

// ---- Gestion des messages en DM ----
async function handleDM(message) {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;

  const user = message.author;

  const existingTicket = getTicketByUserId(user.id);
  if (existingTicket) {
    const channel = await client.channels.fetch(existingTicket.channelId).catch(() => null);
    if (channel) {
      const stickers = message.stickers?.map(st => st.name || st.id) || [];
      existingTicket.messages.push({
        authorId: user.id,
        authorTag: user.tag,
        content: message.content || '',
        attachments: message.attachments.map(a => a.url),
        stickers,
        timestamp: new Date().toISOString(),
      });
      sauverTickets();

      const files = [];
      for (const att of message.attachments.values()) {
        files.push({ attachment: att.url, name: att.name });
      }
      let content = `**${user.tag}** : ${message.content || ''}`;
      if (stickers.length) content += `\nStickers: ${stickers.join(', ')}`;
      await channel.send({
        content,
        files: files.length ? files : undefined,
      });
    }
    return;
  }

  const categories = config.ticketCategories.filter(c => c.categoryId && c.active !== false);
  if (!categories.length) {
    await message.reply('❌ Aucune catégorie de ticket disponible pour le moment. Contactez un administrateur.');
    return;
  }

  const options = categories.map(c => {
    const option = {
      label: c.name,
      value: c.id,
    };
    if (c.description && c.description.length > 0) option.description = c.description;
    if (isValidEmoji(c.emoji)) option.emoji = c.emoji;
    return option;
  });
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('Choisissez une catégorie')
      .addOptions(options)
  );

  const embed = new EmbedBuilder()
    .setColor('#2E8BFF')
    .setTitle('📩 Ouvrir un ticket')
    .setDescription('Bienvenue sur le support. Sélectionnez la catégorie correspondant à votre demande pour ouvrir un ticket privé avec le staff.')
    .setFooter({ text: 'Northside Bot', iconURL: client.user.displayAvatarURL({ dynamic: true }) })
    .setTimestamp();

  await message.reply({ embeds: [embed], components: [row] });
}

// ---- Gestion des interactions ----
async function handleInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
    await handleCategorySelect(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('ticket_form_')) {
      await handleTicketForm(interaction);
      return;
    }
    if (interaction.customId === 'ticket_rename_modal') {
      await handleRenameModal(interaction);
      return;
    }
    if (interaction.customId === 'ticket_note_modal') {
      await handleNoteModal(interaction);
      return;
    }
  }

  if (interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith('eval_')) {
      await handleEvaluation(interaction);
      return;
    }
    if (customId.startsWith('ticket_')) {
      await handleTicketButton(interaction);
      return;
    }
  }

  if (interaction.isUserSelectMenu()) {
    if (interaction.customId === 'ticket_assign_select') {
      await handleAssignSelect(interaction);
      return;
    }
    if (interaction.customId === 'ticket_transfer_select') {
      await handleTransferSelect(interaction);
      return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'ticket_priority_select') {
      await handlePrioritySelect(interaction);
      return;
    }
    if (interaction.customId === 'ticket_category_select_move') {
      await handleCategorySelectMove(interaction);
      return;
    }
  }
}

// ---- Gestion des sélections de catégorie ----
async function handleCategorySelect(interaction) {
  const categoryId = interaction.values[0];
  const category = config.ticketCategories.find(c => c.id === categoryId);
  if (!category) {
    return interaction.reply({ content: '❌ Catégorie invalide.', ephemeral: true });
  }

  if (category.form && category.form.fields && category.form.fields.length > 0) {
    const modal = new ModalBuilder()
      .setCustomId(`ticket_form_${categoryId}`)
      .setTitle(`Formulaire: ${category.name}`);

    for (const field of category.form.fields) {
      const input = new TextInputBuilder()
        .setCustomId(`field_${field.label}`)
        .setLabel(field.label)
        .setStyle(field.type === 'textarea' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(field.required !== false)
        .setPlaceholder(field.placeholder || '');
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    }
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await createTicket(interaction.user, categoryId, {});
    const successEmbed = new EmbedBuilder()
      .setColor('#2E8BFF')
      .setTitle('✅ Ticket ouvert')
      .setDescription('Votre ticket a bien été ouvert. Continuez simplement à envoyer des messages ici, ils seront automatiquement transmis au staff.')
      .setTimestamp();
    await interaction.editReply({ embeds: [successEmbed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ Erreur: ${error.message}` });
  }
}

// ---- Formulaire modal ----
async function handleTicketForm(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const categoryId = interaction.customId.replace('ticket_form_', '');
  const category = config.ticketCategories.find(c => c.id === categoryId);
  if (!category) {
    return interaction.editReply('❌ Catégorie invalide.');
  }

  const formData = {};
  for (const field of category.form.fields) {
    const value = interaction.fields.getTextInputValue(`field_${field.label}`);
    formData[field.label] = value;
  }

  try {
    await createTicket(interaction.user, categoryId, formData);
    const successEmbed = new EmbedBuilder()
      .setColor('#2E8BFF')
      .setTitle('✅ Ticket ouvert')
      .setDescription('Votre ticket a bien été ouvert. Continuez simplement à envoyer des messages ici, ils seront automatiquement transmis au staff.')
      .setTimestamp();
    await interaction.editReply({ embeds: [successEmbed] });
  } catch (error) {
    await interaction.editReply({ content: `❌ Erreur: ${error.message}` });
  }
}

// ---- Boutons de ticket ----
async function handleTicketButton(interaction) {
  const parts = interaction.customId.split('_');
  const action = parts[1];
  const ticketId = parts.slice(2).join('_');

  const ticket = tickets[ticketId];
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }

  const member = interaction.member;
  const isStaff = member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                  member.roles.cache.some(r => config.ticketStaffRoleIds.includes(r.id));
  if (!isStaff) {
    return interaction.reply({ content: '❌ Vous n\'avez pas la permission d\'effectuer cette action.', ephemeral: true });
  }

  const staffId = interaction.user.id;
  const staffTag = interaction.user.tag;

  switch (action) {
    case 'close': {
      await interaction.reply({ content: '🔒 Fermeture du ticket...', ephemeral: true });
      await closeTicket(ticketId, staffId, staffTag, 'Fermé par staff');
      await interaction.editReply('✅ Ticket fermé.');
      break;
    }
    case 'reopen': {
      await interaction.reply({ content: '🔓 Réouverture du ticket...', ephemeral: true });
      await reopenTicket(ticketId, staffId, staffTag);
      await interaction.editReply('✅ Ticket réouvert.');
      break;
    }
    case 'rename': {
      const modal = new ModalBuilder()
        .setCustomId('ticket_rename_modal')
        .setTitle('Renommer le ticket');
      const input = new TextInputBuilder()
        .setCustomId('new_name')
        .setLabel('Nouveau nom')
        .setStyle(TextInputStyle.Short)
        .setValue(ticket.title || '');
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      if (!global.ticketRenameCache) global.ticketRenameCache = {};
      global.ticketRenameCache[interaction.user.id] = ticketId;
      await interaction.showModal(modal);
      break;
    }
    case 'assign': {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('ticket_assign_select')
          .setPlaceholder('Sélectionnez un membre du staff')
      );
      await interaction.reply({ content: 'Choisissez le staff à assigner :', components: [row], ephemeral: true });
      break;
    }
    case 'priority': {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ticket_priority_select')
          .setPlaceholder('Choisissez une priorité')
          .addOptions([
            { label: '🟢 Faible', value: 'low' },
            { label: '🟡 Normale', value: 'normal' },
            { label: '🟠 Haute', value: 'high' },
            { label: '🔴 Urgente', value: 'urgent' }
          ])
      );
      await interaction.reply({ content: 'Choisissez la priorité :', components: [row], ephemeral: true });
      break;
    }
    case 'category': {
      const categories = config.ticketCategories.filter(c => c.categoryId && c.id !== ticket.categoryId);
      if (!categories.length) {
        return interaction.reply({ content: '❌ Aucune autre catégorie disponible.', ephemeral: true });
      }
      const options = categories.map(c => {
        const option = {
          label: c.name,
          value: c.id,
        };
        if (c.description && c.description.length > 0) option.description = c.description;
        if (isValidEmoji(c.emoji)) option.emoji = c.emoji;
        return option;
      });
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ticket_category_select_move')
          .setPlaceholder('Choisissez une catégorie')
          .addOptions(options)
      );
      await interaction.reply({ content: 'Choisissez la nouvelle catégorie :', components: [row], ephemeral: true });
      break;
    }
    case 'transfer': {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('ticket_transfer_select')
          .setPlaceholder('Sélectionnez le staff destinataire')
      );
      await interaction.reply({ content: 'Choisissez le staff à qui transférer :', components: [row], ephemeral: true });
      break;
    }
    case 'note': {
      const modal = new ModalBuilder()
        .setCustomId('ticket_note_modal')
        .setTitle('Note privée');
      const input = new TextInputBuilder()
        .setCustomId('note_content')
        .setLabel('Contenu de la note')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(ticket.notes || '');
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      if (!global.ticketNoteCache) global.ticketNoteCache = {};
      global.ticketNoteCache[interaction.user.id] = ticketId;
      await interaction.showModal(modal);
      break;
    }
    case 'export': {
      await interaction.reply({ content: '📄 Export en cours...', ephemeral: true });
      await exportTicketHTML(ticketId, staffId, staffTag);
      await interaction.editReply('✅ Export HTML envoyé dans le salon de logs.');
      break;
    }
    case 'blacklist': {
      await interaction.reply({ content: '🚫 Blacklist de l\'utilisateur...', ephemeral: true });
      await blacklistUser(ticketId, staffId, staffTag);
      await interaction.editReply('✅ Utilisateur blacklisté et ticket fermé.');
      break;
    }
    default: {
      await interaction.reply({ content: '❌ Action inconnue.', ephemeral: true });
    }
  }
}

// ---- Sélecteurs ----
async function handleAssignSelect(interaction) {
  const userId = interaction.values[0];
  const ticket = getTicketByChannelId(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }
  await assignTicket(ticket.id, userId, interaction.user.id, interaction.user.tag);
  await interaction.reply({ content: `✅ Ticket assigné à <@${userId}>.`, ephemeral: true });
}

async function handleTransferSelect(interaction) {
  const targetId = interaction.values[0];
  const ticket = getTicketByChannelId(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }
  await assignTicket(ticket.id, targetId, interaction.user.id, interaction.user.tag);
  await interaction.reply({ content: `✅ Ticket transféré à <@${targetId}>.`, ephemeral: true });
}

async function handlePrioritySelect(interaction) {
  const priority = interaction.values[0];
  const ticket = getTicketByChannelId(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }
  await setPriority(ticket.id, priority, interaction.user.id, interaction.user.tag);
  await interaction.reply({ content: `✅ Priorité définie sur ${priority}.`, ephemeral: true });
}

async function handleCategorySelectMove(interaction) {
  const newCategoryId = interaction.values[0];
  const ticket = getTicketByChannelId(interaction.channel.id);
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }
  await changeCategory(ticket.id, newCategoryId, interaction.user.id, interaction.user.tag);
  await interaction.reply({ content: `✅ Catégorie changée.`, ephemeral: true });
}

// ---- Modals ----
async function handleRenameModal(interaction) {
  const newName = interaction.fields.getTextInputValue('new_name');
  const ticketId = global.ticketRenameCache?.[interaction.user.id];
  if (!ticketId) {
    return interaction.reply({ content: '❌ Erreur: session expirée.', ephemeral: true });
  }
  try {
    await renameTicket(ticketId, newName, interaction.user.id, interaction.user.tag);
    await interaction.reply({ content: `✅ Ticket renommé en **${newName}**.`, ephemeral: true });
  } catch (error) {
    await interaction.reply({ content: `❌ Erreur: ${error.message}`, ephemeral: true });
  }
  delete global.ticketRenameCache[interaction.user.id];
}

async function handleNoteModal(interaction) {
  const note = interaction.fields.getTextInputValue('note_content');
  const ticketId = global.ticketNoteCache?.[interaction.user.id];
  if (!ticketId) {
    return interaction.reply({ content: '❌ Erreur: session expirée.', ephemeral: true });
  }
  try {
    await setPrivateNote(ticketId, note, interaction.user.id, interaction.user.tag);
    await interaction.reply({ content: `✅ Note privée enregistrée.`, ephemeral: true });
  } catch (error) {
    await interaction.reply({ content: `❌ Erreur: ${error.message}`, ephemeral: true });
  }
  delete global.ticketNoteCache[interaction.user.id];
}

// ---- Évaluation ----
async function handleEvaluation(interaction) {
  const parts = interaction.customId.split('_');
  const rating = parseInt(parts[1]);
  const ticketId = parts[2];
  const ticket = tickets[ticketId];
  if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });

  ticket.evaluation = rating;
  sauverTickets();

  await interaction.reply({ content: `⭐ Merci pour votre évaluation de ${rating}/5 !`, ephemeral: true });
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor('#34d399')
      .setTitle('⭐ Évaluation reçue')
      .setDescription(`L'utilisateur a évalué le support à **${rating}/5**.`)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  }
}

// ---- Sync des messages du salon vers DM ----
async function handleChannelMessage(message) {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.GuildText) return;

  const ticket = getTicketByChannelId(message.channel.id);
  if (!ticket) return;
  if (ticket.status === 'closed') return;

  const isStaff = message.member.roles.cache.some(r => config.ticketStaffRoleIds.includes(r.id)) ||
                  message.member.permissions.has(PermissionsBitField.Flags.Administrator);
  const isUser = message.author.id === ticket.userId;

  if (isUser) {
    ticket.messages.push({
      authorId: message.author.id,
      authorTag: message.author.tag,
      content: message.content || '',
      attachments: message.attachments.map(a => a.url),
      timestamp: new Date().toISOString(),
    });
    sauverTickets();
  }

  if (isStaff) {
    const user = await client.users.fetch(ticket.userId).catch(() => null);
    if (user) {
      const files = [];
      for (const att of message.attachments.values()) {
        files.push({ attachment: att.url, name: att.name });
      }
      const stickers = message.stickers?.map(st => st.name || st.id) || [];
      let content = `**${message.author.tag} (Staff)** : ${message.content || ''}`;
      if (stickers.length) content += `\nStickers: ${stickers.join(', ')}`;
      await user.send({
        content,
        files: files.length ? files : undefined,
      }).catch(() => {});
    }
    ticket.messages.push({
      authorId: message.author.id,
      authorTag: message.author.tag,
      content: message.content || '',
      attachments: message.attachments.map(a => a.url),
      stickers: message.stickers?.map(st => st.name || st.id) || [],
      timestamp: new Date().toISOString(),
    });
    sauverTickets();
  }
}

// ---- Commandes slash ----
const closeCommand = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Fermer le ticket actuel')
  .addStringOption(option => option.setName('raison').setDescription('Raison de la fermeture').setRequired(false));
const reopenCommand = new SlashCommandBuilder()
  .setName('reopen')
  .setDescription('Réouvrir le ticket actuel');
const renameCommand = new SlashCommandBuilder()
  .setName('rename')
  .setDescription('Renommer le ticket actuel')
  .addStringOption(option => option.setName('nom').setDescription('Nouveau nom').setRequired(true));
const assignCommand = new SlashCommandBuilder()
  .setName('assign')
  .setDescription('Assigner un staff au ticket actuel')
  .addUserOption(option => option.setName('staff').setDescription('Staff à assigner').setRequired(true));
const priorityCommand = new SlashCommandBuilder()
  .setName('priority')
  .setDescription('Changer la priorité du ticket actuel')
  .addStringOption(option => option.setName('niveau').setDescription('Priorité').setRequired(true)
    .addChoices(
      { name: '🟢 Faible', value: 'low' },
      { name: '🟡 Normale', value: 'normal' },
      { name: '🟠 Haute', value: 'high' },
      { name: '🔴 Urgente', value: 'urgent' }
    ));
const categoryCommand = new SlashCommandBuilder()
  .setName('category')
  .setDescription('Changer la catégorie du ticket actuel')
  .addStringOption(option => option.setName('categorie').setDescription('ID de la catégorie').setRequired(true));
const noteCommand = new SlashCommandBuilder()
  .setName('note')
  .setDescription('Ajouter une note privée au ticket actuel')
  .addStringOption(option => option.setName('contenu').setDescription('Note').setRequired(true));
const exportCommand = new SlashCommandBuilder()
  .setName('export')
  .setDescription('Exporter le ticket actuel en HTML');
const blacklistCommand = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Blacklister l\'utilisateur du ticket actuel');

const slashCommands = [
  closeCommand,
  reopenCommand,
  renameCommand,
  assignCommand,
  priorityCommand,
  categoryCommand,
  noteCommand,
  exportCommand,
  blacklistCommand,
].map(cmd => cmd.toJSON());

// ============================================================
//  CLIENT DISCORD
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const rest = new REST({ version: '10' }).setToken(TOKEN);

function checkTicketAutoClose() {
  const now = Date.now();
  for (const ticket of Object.values(tickets)) {
    if (ticket.status !== 'open') continue;
    const category = config.ticketCategories.find(c => c.id === ticket.categoryId);
    if (!category) continue;
    const autoCloseHours = category.autoCloseAfter > 0 ? category.autoCloseAfter : (config.ticketAutoCloseHours || 0);
    if (!autoCloseHours) continue;
    const created = new Date(ticket.createdAt).getTime();
    if (isNaN(created)) continue;
    if (now - created >= autoCloseHours * 60 * 60 * 1000) {
      closeTicket(ticket.id, 'auto', 'Système', 'Fermeture automatique').catch(() => {});
    }
  }
}

client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: slashCommands });
    console.log('Commandes slash enregistrées avec succès.');
  } catch (error) { console.error(error); }

  // Giveaways (si existants)
  for (const g of Object.values(giveaways)) {
    if (!g.ended) {
      const delai = new Date(g.endsAt).getTime() - Date.now();
      setTimeout(() => terminerGiveaway(g.id), Math.max(delai, 0));
    }
  }

  setInterval(checkTicketAutoClose, 5 * 60 * 1000);
  checkTicketAutoClose();

  console.log('✅ Bot prêt.');
});

// ---- Événements ----
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.type === ChannelType.DM) {
    await handleDM(message);
    return;
  }
  if (message.channel.type === ChannelType.GuildText) {
    await handleChannelMessage(message);
  }
});

client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  if (Array.isArray(config.autoRoleIds) && config.autoRoleIds.length) {
    await member.roles.add(config.autoRoleIds.filter(Boolean)).catch(() => {});
  }
  if (config.welcomeChannelId) {
    const salon = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (salon) {
      const message = remplacerVariables(config.welcomeMessage || '', {
        user: `<@${member.id}>`,
        username: member.user.username,
        server: member.guild.name,
        count: member.guild.memberCount,
      });
      salon.send({ content: message }).catch(() => {});
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;
    if (['close', 'reopen', 'rename', 'assign', 'priority', 'category', 'note', 'export', 'blacklist'].includes(cmd)) {
      await handleSlashCommand(interaction);
      return;
    }
    // Autres commandes (modération, candidatures, etc.) – à conserver
    // ...
    return;
  }
  await handleInteraction(interaction);
});

// ---- Gestion des commandes slash de tickets ----
async function handleSlashCommand(interaction) {
  const channel = interaction.channel;
  if (channel.type !== ChannelType.GuildText) {
    return interaction.reply({ content: '❌ Cette commande n\'est disponible que dans un salon de ticket.', ephemeral: true });
  }

  const ticket = getTicketByChannelId(channel.id);
  if (!ticket) {
    return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket valide.', ephemeral: true });
  }

  const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                  interaction.member.roles.cache.some(r => config.ticketStaffRoleIds.includes(r.id));
  if (!isStaff) {
    return interaction.reply({ content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.', ephemeral: true });
  }

  const staffId = interaction.user.id;
  const staffTag = interaction.user.tag;
  const ticketId = ticket.id;

  switch (interaction.commandName) {
    case 'close': {
      const reason = interaction.options.getString('raison') || '';
      await closeTicket(ticketId, staffId, staffTag, reason);
      await interaction.reply({ content: '🔒 Ticket fermé.', ephemeral: true });
      break;
    }
    case 'reopen': {
      await reopenTicket(ticketId, staffId, staffTag);
      await interaction.reply({ content: '🔓 Ticket réouvert.', ephemeral: true });
      break;
    }
    case 'rename': {
      const newName = interaction.options.getString('nom');
      await renameTicket(ticketId, newName, staffId, staffTag);
      await interaction.reply({ content: `✅ Ticket renommé en **${newName}**.`, ephemeral: true });
      break;
    }
    case 'assign': {
      const user = interaction.options.getUser('staff');
      await assignTicket(ticketId, user.id, staffId, staffTag);
      await interaction.reply({ content: `✅ Ticket assigné à ${user.tag}.`, ephemeral: true });
      break;
    }
    case 'priority': {
      const level = interaction.options.getString('niveau');
      await setPriority(ticketId, level, staffId, staffTag);
      await interaction.reply({ content: `✅ Priorité définie sur ${level}.`, ephemeral: true });
      break;
    }
    case 'category': {
      const catId = interaction.options.getString('categorie');
      await changeCategory(ticketId, catId, staffId, staffTag);
      await interaction.reply({ content: `✅ Catégorie changée.`, ephemeral: true });
      break;
    }
    case 'note': {
      const content = interaction.options.getString('contenu');
      await setPrivateNote(ticketId, content, staffId, staffTag);
      await interaction.reply({ content: `✅ Note privée enregistrée.`, ephemeral: true });
      break;
    }
    case 'export': {
      await exportTicketHTML(ticketId, staffId, staffTag);
      await interaction.reply({ content: `📄 Export HTML envoyé dans le salon de logs.`, ephemeral: true });
      break;
    }
    case 'blacklist': {
      await blacklistUser(ticketId, staffId, staffTag);
      await interaction.reply({ content: `🚫 Utilisateur blacklisté et ticket fermé.`, ephemeral: true });
      break;
    }
    default: {
      await interaction.reply({ content: '❌ Commande inconnue.', ephemeral: true });
    }
  }
}

// ---- Giveaways (inchangé) ----
function tirerGagnants(participants, nombre) {
  const pool = [...participants];
  const gagnants = [];
  while (pool.length && gagnants.length < nombre) {
    const i = Math.floor(Math.random() * pool.length);
    gagnants.push(pool.splice(i, 1)[0]);
  }
  return gagnants;
}

async function terminerGiveaway(id) {
  const g = giveaways[id];
  if (!g || g.ended) return;
  g.ended = true;
  sauverGiveaways();

  try {
    const channel = await client.channels.fetch(g.channelId).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(g.messageId).catch(() => null);

    const gagnants = tirerGagnants(g.participants, g.winnersCount);
    const texteGagnants = gagnants.length ? gagnants.map(id => `<@${id}>`).join(', ') : 'Personne n\'a participé 😢';

    const embedFin = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`🎉 Giveaway terminé : ${g.prize}`)
      .setDescription(`Gagnant(s) : ${texteGagnants}`)
      .setTimestamp();

    if (message) await message.edit({ embeds: [embedFin], components: [] });
    await channel.send({ content: `🎉 Félicitations ${texteGagnants} ! Vous remportez **${g.prize}**.` });
  } catch (e) {
    console.error('Erreur fin giveaway:', e);
  }
}

// ---- Serveur Express + API ----
const app = express();
const http = require('http');
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12, sameSite: 'lax' },
}));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

// Middleware auth
function authRequis(req, res, next) {
  if (!req.session.user) return res.status(401).json({ erreur: 'Non authentifié' });
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return res.status(500).json({ erreur: 'Serveur introuvable' });
  guild.members.fetch(req.session.user.id).then(member => {
    if (!member) { req.session.destroy(); return res.status(401).json({ erreur: 'Membre non trouvé' }); }
    const estAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const aRoleAutorise = member.roles.cache.some(role => getModerationRoleIds().includes(role.id));
    if (!estAdmin && !aRoleAutorise) { req.session.destroy(); return res.status(403).json({ erreur: 'Rôle insuffisant' }); }
    next();
  }).catch(() => { req.session.destroy(); res.status(401).json({ erreur: 'Erreur de vérification' }); });
}

// ---- Routes d'authentification ----
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/panel');
  res.redirect('/login');
});
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/panel');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/panel', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'panel.html'));
});

app.get('/auth/discord', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/login');
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('Erreur OAuth Discord:', tokenData.error, tokenData.error_description);
      return res.redirect('/login?erreur=oauth_expire');
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userRes.json();

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return res.status(500).send('Bot pas sur le serveur.');

    const membre = await guild.members.fetch(discordUser.id).catch(() => null);
    if (!membre) return res.status(403).send('Tu n\'es pas membre du serveur.');

    const estAdmin = membre.permissions.has(PermissionsBitField.Flags.Administrator);
    const aRoleAutorise = membre.roles.cache.some(role => getModerationRoleIds().includes(role.id));
    if (!estAdmin && !aRoleAutorise) return res.status(403).send('Accès refusé : rôle insuffisant.');

    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null,
    };
    res.redirect('/panel');
  } catch (e) {
    console.error('Erreur OAuth:', e.message);
    res.status(500).send('Erreur lors de la connexion Discord.');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/api/me', authRequis, (req, res) => res.json(req.session.user));

// ---- Routes API pour les tickets ----
app.get('/api/stats', authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const openTickets = Object.values(tickets).filter(t => t.status === 'open').length;
  const closedTickets = Object.values(tickets).filter(t => t.status === 'closed').length;
  const totalTickets = Object.keys(tickets).length;
  const avgRating = Object.values(tickets)
    .filter(t => t.evaluation !== null)
    .reduce((acc, t) => acc + t.evaluation, 0) / (Object.values(tickets).filter(t => t.evaluation !== null).length || 1);

  res.json({
    memberCount: guild.memberCount,
    channelCount: guild.channels.cache.size,
    roleCount: guild.roles.cache.size,
    ping: client.ws.ping,
    uptime: Math.floor(process.uptime()),
    ticketsOuverts: openTickets,
    ticketsFermes: closedTickets,
    ticketsTotal: totalTickets,
    evaluationMoyenne: avgRating.toFixed(1),
    giveawaysActifs: Object.values(giveaways).filter(g => !g.ended).length,
    warnsTotal: Object.values(warns).reduce((sum, arr) => sum + arr.length, 0),
    candValidees: candHistory.filter(h => h.result === 'validee').length,
    candRefusees: candHistory.filter(h => h.result === 'refusee').length,
  });
});

app.get('/api/tickets', authRequis, (req, res) => {
  const { status } = req.query;
  const list = Object.values(tickets);
  const filtered = status ? list.filter(t => t.status === status) : list;
  res.json(filtered);
});

app.get('/api/tickets/:id', authRequis, (req, res) => {
  const ticket = tickets[req.params.id];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  res.json(ticket);
});

app.post('/api/tickets/:id/reply', authRequis, async (req, res) => {
  const ticket = tickets[req.params.id];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ erreur: 'Message requis' });

  try {
    const channel = await client.channels.fetch(ticket.channelId);
    await channel.send(`**${req.session.user.username} (Panel)** : ${message}`);
    const user = await client.users.fetch(ticket.userId);
    await user.send(`**${req.session.user.username} (Staff)** : ${message}`).catch(() => {});
    ticket.messages.push({
      authorId: req.session.user.id,
      authorTag: req.session.user.username,
      content: message,
      attachments: [],
      timestamp: new Date().toISOString(),
    });
    sauverTickets();
    res.json({ succes: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: 'Erreur lors de l\'envoi' });
  }
});

app.post('/api/tickets/:id/note', authRequis, (req, res) => {
  const ticket = tickets[req.params.id];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  ticket.notes = req.body.note || '';
  sauverTickets();
  res.json({ succes: true });
});

app.post('/api/tickets/:id/close', authRequis, async (req, res) => {
  const ticket = tickets[req.params.id];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  try {
    await closeTicket(req.params.id, req.session.user.id, req.session.user.username, req.body.reason || '');
    res.json({ succes: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: 'Erreur lors de la fermeture' });
  }
});

// ---- Routes pour les catégories ----
app.get('/api/ticket-categories', authRequis, (req, res) => {
  res.json(config.ticketCategories || []);
});

app.post('/api/ticket-categories', authRequis, (req, res) => {
  const { name, emoji, description, categoryId, color, defaultPriority, pingRoles, staffRoles, form, autoReply, autoCloseAfter, active } = req.body;
  if (!name || !categoryId) {
    return res.status(400).json({ erreur: 'Nom et catégorie Discord requis' });
  }
  const newCategory = {
    id: name.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-' + Date.now().toString(36),
    name,
    emoji: emoji || '📌',
    description: description || '',
    categoryId,
    color: color || '#5865F2',
    defaultPriority: defaultPriority || 'normal',
    pingRoles: pingRoles || [],
    staffRoles: staffRoles || [],
    form: form || null,
    autoReply: autoReply || '',
    autoCloseAfter: autoCloseAfter || 0,
    active: active !== false,
  };
  config.ticketCategories.push(newCategory);
  sauverConfig();
  res.json({ succes: true, category: newCategory });
});

app.put('/api/ticket-categories/:id', authRequis, (req, res) => {
  const { id } = req.params;
  const index = config.ticketCategories.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ erreur: 'Catégorie introuvable' });
  const cat = config.ticketCategories[index];
  const { name, emoji, description, categoryId, color, defaultPriority, pingRoles, staffRoles, form, autoReply, autoCloseAfter, active } = req.body;
  if (name !== undefined) cat.name = name;
  if (emoji !== undefined) cat.emoji = emoji;
  if (description !== undefined) cat.description = description;
  if (categoryId !== undefined) cat.categoryId = categoryId;
  if (color !== undefined) cat.color = color;
  if (defaultPriority !== undefined) cat.defaultPriority = defaultPriority;
  if (pingRoles !== undefined) cat.pingRoles = pingRoles;
  if (staffRoles !== undefined) cat.staffRoles = staffRoles;
  if (form !== undefined) cat.form = form;
  if (autoReply !== undefined) cat.autoReply = autoReply;
  if (autoCloseAfter !== undefined) cat.autoCloseAfter = autoCloseAfter;
  if (active !== undefined) cat.active = active;
  sauverConfig();
  res.json({ succes: true });
});

app.delete('/api/ticket-categories/:id', authRequis, (req, res) => {
  const { id } = req.params;
  const index = config.ticketCategories.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ erreur: 'Catégorie introuvable' });
  config.ticketCategories.splice(index, 1);
  sauverConfig();
  res.json({ succes: true });
});

// ---- Routes pour les logs ----
app.get('/api/logs', authRequis, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logsToSend = logs.slice(-limit).reverse();
  res.json(logsToSend);
});

// ---- Routes pour les giveaways ----
app.get('/api/giveaways', authRequis, (req, res) => {
  res.json(Object.values(giveaways));
});

app.post('/api/giveaways', authRequis, async (req, res) => {
  const { channelId, prize, durationMinutes, winnersCount } = req.body;
  if (!channelId || !prize) return res.status(400).json({ erreur: 'Paramètres manquants' });
  const duration = parseInt(durationMinutes);
  const winners = parseInt(winnersCount) || 1;
  if (isNaN(duration) || duration <= 0) return res.status(400).json({ erreur: 'Durée invalide' });
  if (isNaN(winners) || winners <= 0) return res.status(400).json({ erreur: 'Nombre de gagnants invalide' });

  try {
    const channel = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`🎉 Giveaway : ${prize}`)
      .setDescription(`Réagissez avec 🎉 pour participer !\nDurée : ${duration} min\nGagnants : ${winners}`)
      .setTimestamp();

    const message = await channel.send({ embeds: [embed] });
    await message.react('🎉');

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const endsAt = new Date(Date.now() + duration * 60 * 1000).toISOString();

    giveaways[id] = { id, channelId, messageId: message.id, prize, winnersCount: winners, endsAt, participants: [], ended: false };
    sauverGiveaways();
    const delai = duration * 60 * 1000;
    setTimeout(() => terminerGiveaway(id), delai);
    res.json({ succes: true, id });
  } catch (e) {
    console.error('Erreur création giveaway:', e);
    res.status(500).json({ erreur: 'Erreur lors de la création' });
  }
});

app.post('/api/giveaways/:id/end', authRequis, async (req, res) => {
  const id = req.params.id;
  const giveaway = giveaways[id];
  if (!giveaway) return res.status(404).json({ erreur: 'Giveaway introuvable' });
  try {
    await terminerGiveaway(id);
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur terminaison giveaway:', e);
    res.status(500).json({ erreur: 'Erreur lors de la terminaison' });
  }
});

// ---- Backup ----
app.get('/api/backup', authRequis, (req, res) => {
  const backup = {
    config,
    tickets,
    giveaways,
    warns,
    candHistory,
    logs,
    date: new Date().toISOString(),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=backup-${Date.now()}.json`);
  res.json(backup);
});

app.post('/api/backup/import', authRequis, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ erreur: 'Format invalide' });
  }
  try {
    if (data.config) { config = { ...config, ...data.config }; sauverConfig(); }
    if (data.tickets) { tickets = data.tickets; sauverTickets(); }
    if (data.giveaways) { giveaways = data.giveaways; sauverGiveaways(); }
    if (data.warns) { warns = data.warns; sauverWarns(); }
    if (data.candHistory) { candHistory = data.candHistory; sauverCandHistory(); }
    if (data.logs) { logs = data.logs; sauverLogs(); }
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur import backup:', e);
    res.status(500).json({ erreur: 'Erreur lors de l\'import' });
  }
});

// ---- Routes pour les salons et rôles (inchangées) ----
app.get('/api/channels', authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const salons = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .map(c => ({ id: c.id, name: c.name, type: c.type }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(salons);
});

app.get('/api/channels/all', authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const salons = guild.channels.cache
    .map(c => ({ id: c.id, name: c.name, type: c.type }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(salons);
});

app.post('/api/channels', authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const { name, type } = req.body;
  if (!name || name.length < 1 || name.length > 100) {
    return res.status(400).json({ erreur: 'nom requis (1-100 caractères)' });
  }
  try {
    const channel = await guild.channels.create({
      name,
      type: type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
    });
    res.json({ succes: true, id: channel.id });
  } catch (e) {
    console.error('Erreur création salon:', e);
    res.status(500).json({ erreur: 'Échec de la création' });
  }
});

app.delete('/api/channels/:id', authRequis, async (req, res) => {
  try {
    const channel = await client.channels.fetch(req.params.id);
    await channel.delete();
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur suppression salon:', e);
    res.status(500).json({ erreur: 'Échec de la suppression' });
  }
});

app.get('/api/roles', authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id)
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
    .sort((a, b) => b.position - a.position);
  res.json(roles);
});

app.post('/api/roles', authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const { name, color, hoist, mentionable } = req.body;
  if (!name || name.length < 1 || name.length > 100) {
    return res.status(400).json({ erreur: 'nom requis (1-100 caractères)' });
  }
  let colorNum;
  if (color) {
    const hex = color.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return res.status(400).json({ erreur: 'couleur hex invalide' });
    colorNum = parseInt(hex, 16);
  }
  try {
    const role = await guild.roles.create({ name, color: colorNum, hoist: !!hoist, mentionable: !!mentionable });
    res.json({ succes: true, id: role.id });
  } catch (e) {
    console.error('Erreur création rôle:', e);
    res.status(500).json({ erreur: 'Échec de la création' });
  }
});

app.delete('/api/roles/:id', authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const role = await guild.roles.fetch(req.params.id);
    await role.delete();
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur suppression rôle:', e);
    res.status(500).json({ erreur: 'Échec de la suppression' });
  }
});

app.get('/api/members/search', authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const q = req.query.q || '';
  if (!q) return res.json([]);
  try {
    let resultats;
    if (/^\d{17,20}$/.test(q)) {
      const member = await guild.members.fetch(q).catch(() => null);
      resultats = member ? [member] : [];
    } else {
      resultats = await guild.members.fetch({ query: q, limit: 15 });
    }
    res.json(resultats.map(m => ({
      id: m.id,
      username: m.user.username,
      tag: m.user.tag,
      avatar: m.user.displayAvatarURL(),
      roles: m.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name })),
      joinedAt: m.joinedAt,
      warnCount: (warns[m.id] || []).length,
      interventions: 0,
      rapports: 0,
    })));
  } catch (e) {
    console.error('Erreur recherche membre:', e);
    res.status(500).json({ erreur: 'Échec de la recherche' });
  }
});

app.get('/api/members/:id/warns', authRequis, (req, res) => {
  res.json(warns[req.params.id] || []);
});

app.post('/api/members/:id/warn', authRequis, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ erreur: 'Raison requise' });
  if (!warns[req.params.id]) warns[req.params.id] = [];
  warns[req.params.id].push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    reason,
    staffId: req.session.user.id,
    staffTag: req.session.user.username,
    date: new Date().toISOString(),
  });
  sauverWarns();

  const user = await client.users.fetch(req.params.id).catch(() => null);
  const embed = embedLogModeration({
    action: 'Avertissement', couleur: '#f59e0b', emoji: '⚠️',
    cibleTag: user?.tag || req.params.id, cibleId: req.params.id,
    parTag: req.session.user.username, raison,
  });
  await envoyerLogModeration(embed);
  res.json({ succes: true });
});

app.delete('/api/members/:userId/warns/:warnId', authRequis, (req, res) => {
  if (!warns[req.params.userId]) return res.status(404).json({ erreur: 'Aucun avertissement' });
  warns[req.params.userId] = warns[req.params.userId].filter(w => w.id !== req.params.warnId);
  sauverWarns();
  res.json({ succes: true });
});

app.post('/api/members/:userId/roles/:roleId', authRequis, async (req, res) => {
  const { userId, roleId } = req.params;
  const { action } = req.body;
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(userId);
    if (!member) return res.status(404).json({ erreur: 'Membre introuvable' });
    if (action === 'add') await member.roles.add(roleId);
    else if (action === 'remove') await member.roles.remove(roleId);
    else return res.status(400).json({ erreur: 'Action invalide (add/remove)' });
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur modification rôle:', e);
    res.status(500).json({ erreur: 'Erreur lors de la modification' });
  }
});

app.post('/api/members/:userId/kick', authRequis, async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(userId);
    await member.kick(reason || 'Aucune raison spécifiée');
    const user = await client.users.fetch(userId).catch(() => null);
    const embed = embedLogModeration({
      action: 'Kick', couleur: '#f59e0b', emoji: '👢',
      cibleTag: user?.tag || userId, cibleId: userId,
      parTag: req.session.user.username, raison: reason || 'Aucune raison',
    });
    await envoyerLogModeration(embed);
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur kick:', e);
    res.status(500).json({ erreur: 'Erreur lors du kick' });
  }
});

app.post('/api/members/:userId/ban', authRequis, async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(userId);
    await member.ban({ reason: reason || 'Aucune raison spécifiée' });
    const user = await client.users.fetch(userId).catch(() => null);
    const embed = embedLogModeration({
      action: 'Ban', couleur: '#ef4444', emoji: '⛔',
      cibleTag: user?.tag || userId, cibleId: userId,
      parTag: req.session.user.username, raison: reason || 'Aucune raison',
    });
    await envoyerLogModeration(embed);
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur ban:', e);
    res.status(500).json({ erreur: 'Erreur lors du ban' });
  }
});

app.post('/api/members/:userId/timeout', authRequis, async (req, res) => {
  const { userId } = req.params;
  const { minutes } = req.body;
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(userId);
    const duration = (parseInt(minutes) || 10) * 60 * 1000;
    await member.timeout(duration, 'Timeout via panel');
    const user = await client.users.fetch(userId).catch(() => null);
    const embed = embedLogModeration({
      action: 'Timeout', couleur: '#3b82f6', emoji: '⏰',
      cibleTag: user?.tag || userId, cibleId: userId,
      parTag: req.session.user.username, raison: `${minutes || 10} minutes`,
    });
    await envoyerLogModeration(embed);
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur timeout:', e);
    res.status(500).json({ erreur: 'Erreur lors du timeout' });
  }
});

// ---- Embed ----
app.post('/api/send-embed', authRequis, upload.single('imageFile'), async (req, res) => {
  const { channelId, title, description, color, imageUrl, footer } = req.body;
  if (!channelId) return res.status(400).json({ erreur: 'Salon requis' });
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return res.status(404).json({ erreur: 'Salon introuvable' });

    const embed = new EmbedBuilder()
      .setColor(color || COULEUR_EMBED)
      .setTitle(title || 'Annonce')
      .setDescription(description || '')
      .setTimestamp();
    if (footer) embed.setFooter({ text: footer });

    if (req.file) {
      const attachment = { attachment: req.file.buffer, name: req.file.originalname };
      embed.setImage(`attachment://${req.file.originalname}`);
      await channel.send({ embeds: [embed], files: [attachment] });
    } else if (imageUrl) {
      embed.setImage(imageUrl);
      await channel.send({ embeds: [embed] });
    } else {
      await channel.send({ embeds: [embed] });
    }
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur envoi embed:', e);
    res.status(500).json({ erreur: 'Erreur lors de l\'envoi' });
  }
});

// ---- Candidatures ----
app.get('/api/settings/candidatures', authRequis, (req, res) => {
  res.json(config.candidatures || {});
});

app.post('/api/settings/candidatures', authRequis, (req, res) => {
  const data = req.body;
  config.candidatures = { ...config.candidatures, ...data };
  sauverConfig();
  res.json({ succes: true });
});

app.get('/api/candidatures/history', authRequis, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let resultats = candHistory;
  if (q) {
    resultats = resultats.filter(h => h.username?.toLowerCase().includes(q) || h.staffTag?.toLowerCase().includes(q) || (h.ticketNumber && h.ticketNumber.includes(q)));
  }
  res.json(resultats.slice(0, 200));
});

// ---- Paramètres généraux ----
app.get('/api/settings', authRequis, (req, res) => {
  res.json({
    autoRoleIds: config.autoRoleIds || [],
    welcomeChannelId: config.welcomeChannelId,
    welcomeMessage: config.welcomeMessage,
    modLogsChannelId: config.modLogsChannelId,
    leaveLogsChannelId: config.leaveLogsChannelId,
    ticketLogsChannelId: config.ticketLogsChannelId,
    ticketTranscriptChannelId: config.ticketTranscriptChannelId,
    ticketAutoCloseHours: config.ticketAutoCloseHours || 0,
    ticketStaffRoleIds: config.ticketStaffRoleIds || [],
    moderationRoleIds: config.moderationRoleIds || [],
  });
});

app.post('/api/settings', authRequis, (req, res) => {
  const { autoRoleIds, welcomeChannelId, welcomeMessage, modLogsChannelId, leaveLogsChannelId, ticketLogsChannelId, ticketTranscriptChannelId, ticketAutoCloseHours, ticketStaffRoleIds, moderationRoleIds } = req.body;
  if (autoRoleIds !== undefined) config.autoRoleIds = Array.isArray(autoRoleIds) ? autoRoleIds : [];
  if (welcomeChannelId !== undefined) config.welcomeChannelId = welcomeChannelId;
  if (welcomeMessage !== undefined) config.welcomeMessage = welcomeMessage;
  if (modLogsChannelId !== undefined) config.modLogsChannelId = modLogsChannelId;
  if (leaveLogsChannelId !== undefined) config.leaveLogsChannelId = leaveLogsChannelId;
  if (ticketLogsChannelId !== undefined) config.ticketLogsChannelId = ticketLogsChannelId;
  if (ticketTranscriptChannelId !== undefined) config.ticketTranscriptChannelId = ticketTranscriptChannelId;
  if (ticketAutoCloseHours !== undefined) config.ticketAutoCloseHours = parseFloat(ticketAutoCloseHours) || 0;
  if (ticketStaffRoleIds !== undefined) config.ticketStaffRoleIds = Array.isArray(ticketStaffRoleIds) ? ticketStaffRoleIds : [];
  if (moderationRoleIds !== undefined) config.moderationRoleIds = Array.isArray(moderationRoleIds) ? moderationRoleIds : [];
  sauverConfig();
  res.json({ succes: true });
});

// ---- Démarrage ----
server.listen(PORT, () => {
  console.log(`✅ Serveur web + bot actif sur le port ${PORT}`);
});

client.login(TOKEN).catch(error => {
  console.error('❌ Échec de la connexion à Discord :', error);
  process.exit(1);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught Exception:', error);
});

let cleanupDone = false;
function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log('🛑 Arrêt en cours...');
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
