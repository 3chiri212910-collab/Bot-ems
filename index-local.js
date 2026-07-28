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

// ---- Fonctions de lecture/écriture ----
function lire(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
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
  ticketLogsChannelId: null,        // salon pour les logs d'actions
  ticketTranscriptChannelId: null,  // salon pour les exports
  ticketAutoCloseHours: 0,          // 0 = désactivé
  ticketStaffRoleIds: [],
  ticketCategories: [],
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
  // Blacklist
  blacklist: [],
};

let config = lire(CONFIG_FILE, CONFIG_DEFAUT);
let tickets = lire(TICKETS_FILE, {});
let logs = lire(LOGS_FILE, []);
let giveaways = lire(GIVEAWAYS_FILE, {});
let warns = lire(WARNS_FILE, {});
let candHistory = lire(CAND_HISTORY_FILE, []);

function sauverConfig() { ecrire(CONFIG_FILE, config); }
function sauverTickets() { ecrire(TICKETS_FILE, tickets); }
function sauverLogs() { ecrire(LOGS_FILE, logs); }
function sauverGiveaways() { ecrire(GIVEAWAYS_FILE, giveaways); }
function sauverWarns() { ecrire(WARNS_FILE, warns); }
function sauverCandHistory() { ecrire(CAND_HISTORY_FILE, candHistory); }

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
const ROLES_AUTORISES = ['1524935532914933837', '1524975599460814888']; // à adapter
const NOM_SERVEUR = 'Mon Serveur RP';
const COULEUR_EMBED = '#5865F2';

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
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function getTicketByChannelId(channelId) {
  return Object.values(tickets).find(t => t.channelId === channelId);
}

function getTicketByUserId(userId) {
  // Un utilisateur ne peut avoir qu'un ticket ouvert à la fois (on vérifie le status 'open')
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
  // Envoyer dans le salon de logs si configuré
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
  // Vérifier si l'utilisateur a déjà un ticket ouvert
  const existing = getTicketByUserId(user.id);
  if (existing) {
    throw new Error('Vous avez déjà un ticket ouvert. Veuillez le fermer avant d\'en ouvrir un nouveau.');
  }
  if (isUserBlacklisted(user.id)) {
    throw new Error('Vous êtes blacklisté et ne pouvez pas ouvrir de ticket.');
  }

  const category = config.ticketCategories.find(c => c.id === categoryId);
  if (!category) throw new Error('Catégorie inconnue ou désactivée.');
  if (!category.categoryId) throw new Error('La catégorie Discord de destination n\'est pas définie.');

  // Générer un nom de salon
  const baseName = sanitizeChannelName(`${category.name}-${user.username}`);
  const ticketId = generateTicketId();
  const channelName = `${baseName}-${ticketId.slice(0, 4)}`; // ajouter un suffixe pour éviter les collisions

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) throw new Error('Serveur introuvable.');

  const parent = guild.channels.cache.get(category.categoryId);
  if (!parent) throw new Error('Catégorie Discord de destination introuvable.');

  // Permissions
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: user.id,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
    }
  ];
  // Ajouter les rôles staff ayant accès (config.ticketStaffRoleIds)
  for (const roleId of config.ticketStaffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
    });
  }

  // Créer le salon
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites: overwrites,
  });

  // Enregistrer le ticket
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
  };
  tickets[ticketId] = ticket;
  sauverTickets();

  // Ajouter le message initial (les réponses du formulaire)
  const embedFields = [];
  if (formData && Object.keys(formData).length > 0) {
    for (const [key, value] of Object.entries(formData)) {
      embedFields.push({ name: key, value: value || 'Non renseigné', inline: false });
    }
  }

  // Embed du ticket
  const embed = new EmbedBuilder()
    .setColor(category.color || COULEUR_EMBED)
    .setTitle(`🎫 Ticket #${ticketId.slice(0, 6)} - ${category.emoji} ${category.name}`)
    .setDescription(`Créé par **${user.tag}** (\`${user.id}\`)`)
    .addFields(
      { name: '📅 Date', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
      { name: '🕒 Heure', value: `<t:${Math.floor(Date.now()/1000)}:T>`, inline: true },
      { name: '📌 Priorité', value: `${getPriorityEmoji(ticket.priority)} ${ticket.priority}`, inline: true },
      { name: '👤 Assigné à', value: ticket.assignedTo ? `<@${ticket.assignedTo}>` : 'Personne', inline: true },
      ...embedFields
    )
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  // Ping des rôles
  let pingContent = '';
  if (category.pingRoles && category.pingRoles.length > 0) {
    pingContent = category.pingRoles.map(id => `<@&${id}>`).join(' ');
  }

  // Envoyer le message dans le salon
  const components = createTicketActionRows(ticket.id);
  const messageOptions = {
    embeds: [embed],
    components: components,
  };
  if (pingContent) messageOptions.content = pingContent;

  await channel.send(messageOptions);

  // Envoyer le message automatique si configuré
  if (category.autoReply) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(category.color || COULEUR_EMBED)
        .setDescription(category.autoReply)
        .setTimestamp()]
    });
  }

  // Notifier l'utilisateur en DM
  try {
    await user.send({
      embeds: [new EmbedBuilder()
        .setColor(category.color || COULEUR_EMBED)
        .setTitle('✅ Ticket créé')
        .setDescription(`Votre ticket **#${ticketId.slice(0, 6)}** a été ouvert.\nUn membre de l'équipe vous répondra dans les plus brefs délais.\n\nVous pouvez continuer à envoyer des messages ici, ils seront transmis.`)
        .setTimestamp()]
    });
  } catch (e) {}

  // Log
  await addLog('Création ticket', user.id, user.tag, ticketId, `Catégorie: ${category.name}`);

  return ticket;
}

// ---- Récupérer l'emoji de priorité ----
function getPriorityEmoji(priority) {
  const map = {
    low: '🟢',
    normal: '🟡',
    high: '🟠',
    urgent: '🔴'
  };
  return map[priority] || '🟡';
}

// ---- Boutons d'actions pour les tickets ----
function createTicketActionRows(ticketId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_close_${ticketId}`).setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ticket_reopen_${ticketId}`).setLabel('Réouvrir').setEmoji('🔓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ticket_rename_${ticketId}`).setLabel('Renommer').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
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

// ---- Mise à jour de l'embed du ticket ----
async function updateTicketEmbed(channelId) {
  const ticket = getTicketByChannelId(channelId);
  if (!ticket) return;
  const category = config.ticketCategories.find(c => c.id === ticket.categoryId);
  if (!category) return;
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) return;

  // Récupérer le message principal (le premier) pour le mettre à jour
  // On va chercher le message d'embed original (on suppose qu'il est le premier message du salon)
  const messages = await channelId.messages?.fetch({ limit: 10 }).catch(() => null);
  // En réalité, on ne peut pas facilement retrouver le message d'embed. On pourrait stocker son ID dans le ticket.
  // Pour simplifier, on va supprimer l'embed précédent et en renvoyer un nouveau, ou on utilise une approche avec un message pin.
  // Nous allons plutôt ajouter un embed de mise à jour.
  // Mais pour une solution robuste, on peut stocker l'ID du message d'embed dans le ticket.
  // Je vais ajouter un champ `embedMessageId` dans le ticket.
  if (!ticket.embedMessageId) {
    // On crée un nouveau message d'embed
    const channel = await client.channels.fetch(channelId);
    const embed = buildTicketEmbed(ticket, user, category);
    const msg = await channel.send({ embeds: [embed] });
    ticket.embedMessageId = msg.id;
    sauverTickets();
  } else {
    // Mettre à jour l'embed existant
    const channel = await client.channels.fetch(channelId);
    const embed = buildTicketEmbed(ticket, user, category);
    const msg = await channel.messages.fetch(ticket.embedMessageId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed] });
    } else {
      // Si le message a été supprimé, en créer un nouveau
      const newMsg = await channel.send({ embeds: [embed] });
      ticket.embedMessageId = newMsg.id;
      sauverTickets();
    }
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

// ---- Fermeture d'un ticket ----
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
    // Verrouiller le salon
    await channel.permissionOverwrites.edit(ticket.userId, { ViewChannel: false }).catch(() => {});
    // Envoyer un message de fermeture
    const embed = new EmbedBuilder()
      .setColor('#fb7185')
      .setTitle('🔒 Ticket fermé')
      .setDescription(`Fermé par **${staffTag}**${reason ? `\nRaison: ${reason}` : ''}\nMerci d'avoir utilisé notre support.`)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    // Proposer une évaluation
    const evalRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`eval_1_${ticketId}`).setLabel('⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`eval_2_${ticketId}`).setLabel('⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`eval_3_${ticketId}`).setLabel('⭐⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`eval_4_${ticketId}`).setLabel('⭐⭐⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`eval_5_${ticketId}`).setLabel('⭐⭐⭐⭐⭐').setStyle(ButtonStyle.Success),
    );
    await channel.send({ components: [evalRow] });
  }

  // Notifier l'utilisateur en DM
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (user) {
    const dmEmbed = new EmbedBuilder()
      .setColor('#fb7185')
      .setTitle('🔒 Ticket fermé')
      .setDescription(`Votre ticket **#${ticket.id.slice(0, 6)}** a été fermé par **${staffTag}**.${reason ? `\nRaison: ${reason}` : ''}\nMerci de votre confiance.`)
      .setTimestamp();
    await user.send({ embeds: [dmEmbed] }).catch(() => {});
  }

  // Log
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

// ---- Changer priorité ----
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

  // Déplacer le salon
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

  // Récupérer tous les messages du salon
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
  allMessages.reverse(); // du plus ancien au plus récent

  // Générer le HTML
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  const category = config.ticketCategories.find(c => c.id === ticket.categoryId);
  const guild = client.guilds.cache.get(GUILD_ID);

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

  // Envoyer le fichier dans le salon de transcript
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

  // Fermer le ticket
  await closeTicket(ticketId, staffId, staffTag, 'Utilisateur blacklisté');

  await addLog('Blacklist utilisateur', staffId, staffTag, ticketId, `Utilisateur <@${userId}> blacklisté.`);
}

// ---- Gestion des messages en DM ----
async function handleDM(message) {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.DM) return;

  const user = message.author;

  // Vérifier si l'utilisateur a un ticket ouvert
  const existingTicket = getTicketByUserId(user.id);
  if (existingTicket) {
    // Transférer le message dans le salon
    const channel = await client.channels.fetch(existingTicket.channelId).catch(() => null);
    if (channel) {
      // Ajouter le message au ticket
      existingTicket.messages.push({
        authorId: user.id,
        authorTag: user.tag,
        content: message.content || '',
        attachments: message.attachments.map(a => a.url),
        timestamp: new Date().toISOString(),
      });
      sauverTickets();

      // Envoyer dans le salon
      const files = [];
      for (const att of message.attachments.values()) {
        files.push({ attachment: att.url, name: att.name });
      }
      await channel.send({
        content: `**${user.tag}** : ${message.content || ''}`,
        files: files.length ? files : undefined,
      });
    }
    return;
  }

  // Pas de ticket ouvert : proposer les catégories
  const categories = config.ticketCategories.filter(c => c.categoryId && c.active !== false);
  if (!categories.length) {
    await message.reply('❌ Aucune catégorie de ticket disponible pour le moment. Contactez un administrateur.');
    return;
  }

  // Construire le menu
  const options = categories.map(c => ({
    label: c.name,
    value: c.id,
    description: c.description || '',
    emoji: isValidEmoji(c.emoji) ? c.emoji : undefined,
  }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('Choisissez une catégorie')
      .addOptions(options)
  );

  // Message de bienvenue
  const embed = new EmbedBuilder()
    .setColor(COULEUR_EMBED)
    .setTitle('📩 Ouverture d\'un ticket')
    .setDescription('Bienvenue ! Veuillez sélectionner la catégorie correspondant à votre demande.')
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
    // Boutons d'évaluation
    if (customId.startsWith('eval_')) {
      await handleEvaluation(interaction);
      return;
    }
    // Actions de tickets
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
  await interaction.deferReply({ ephemeral: true });
  const categoryId = interaction.values[0];
  const category = config.ticketCategories.find(c => c.id === categoryId);
  if (!category) {
    return interaction.editReply('❌ Catégorie invalide.');
  }

  // Vérifier si un formulaire est configuré
  if (category.form && category.form.fields && category.form.fields.length > 0) {
    // Ouvrir un modal
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
  } else {
    // Créer directement le ticket
    try {
      const ticket = await createTicket(interaction.user, categoryId, {});
      await interaction.editReply(`✅ Votre ticket a été créé : <#${ticket.channelId}> (ID: #${ticket.id.slice(0, 6)})`);
    } catch (error) {
      await interaction.editReply(`❌ Erreur: ${error.message}`);
    }
  }
}

// ---- Gestion du formulaire modal ----
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
    const ticket = await createTicket(interaction.user, categoryId, formData);
    await interaction.editReply(`✅ Votre ticket a été créé : <#${ticket.channelId}> (ID: #${ticket.id.slice(0, 6)})`);
  } catch (error) {
    await interaction.editReply(`❌ Erreur: ${error.message}`);
  }
}

// ---- Gestion des boutons de ticket ----
async function handleTicketButton(interaction) {
  // Extraire l'action et l'ID du ticket
  const parts = interaction.customId.split('_');
  const action = parts[1];
  const ticketId = parts.slice(2).join('_');

  const ticket = tickets[ticketId];
  if (!ticket) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }

  // Vérifier que l'utilisateur a le droit d'agir sur ce ticket (staff)
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
      // Stocker temporairement l'ID du ticket dans la session (ou dans un cache)
      // On va utiliser un cache simple
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
      const options = categories.map(c => ({
        label: c.name,
        value: c.id,
        description: c.description || '',
        emoji: isValidEmoji(c.emoji) ? c.emoji : undefined,
      }));
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
      // Stocker l'ID du ticket
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

// ---- Gestion des sélecteurs d'assignation ----
async function handleAssignSelect(interaction) {
  const userId = interaction.values[0];
  const ticketId = getTicketByChannelId(interaction.channel.id)?.id;
  if (!ticketId) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }
  await assignTicket(ticketId, userId, interaction.user.id, interaction.user.tag);
  await interaction.reply({ content: `✅ Ticket assigné à <@${userId}>.`, ephemeral: true });
}

// ---- Gestion du transfert ----
async function handleTransferSelect(interaction) {
  const targetId = interaction.values[0];
  const ticketId = getTicketByChannelId(interaction.channel.id)?.id;
  if (!ticketId) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }
  // On va simplement assigner le ticket au nouveau staff
  await assignTicket(ticketId, targetId, interaction.user.id, interaction.user.tag);
  await interaction.reply({ content: `✅ Ticket transféré à <@${targetId}>.`, ephemeral: true });
}

// ---- Gestion de la priorité ----
async function handlePrioritySelect(interaction) {
  const priority = interaction.values[0];
  const ticketId = getTicketByChannelId(interaction.channel.id)?.id;
  if (!ticketId) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }
  await setPriority(ticketId, priority, interaction.user.id, interaction.user.tag);
  await interaction.reply({ content: `✅ Priorité définie sur ${priority}.`, ephemeral: true });
}

// ---- Gestion du changement de catégorie (déplacement) ----
async function handleCategorySelectMove(interaction) {
  const newCategoryId = interaction.values[0];
  const ticketId = getTicketByChannelId(interaction.channel.id)?.id;
  if (!ticketId) {
    return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });
  }
  await changeCategory(ticketId, newCategoryId, interaction.user.id, interaction.user.tag);
  await interaction.reply({ content: `✅ Catégorie changée.`, ephemeral: true });
}

// ---- Gestion des modals de renommage ----
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

// ---- Gestion des modals de note ----
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

// ---- Gestion de l'évaluation ----
async function handleEvaluation(interaction) {
  const parts = interaction.customId.split('_');
  const rating = parseInt(parts[1]);
  const ticketId = parts[2];
  const ticket = tickets[ticketId];
  if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', ephemeral: true });

  ticket.evaluation = rating;
  sauverTickets();

  await interaction.reply({ content: `⭐ Merci pour votre évaluation de ${rating}/5 !`, ephemeral: true });
  // Envoyer un message de remerciement dans le salon
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

// ---- Synchronisation des messages du salon vers DM ----
async function handleChannelMessage(message) {
  if (message.author.bot) return;
  if (message.channel.type !== ChannelType.GuildText) return;

  const ticket = getTicketByChannelId(message.channel.id);
  if (!ticket) return;

  // Vérifier si l'auteur est staff ou l'utilisateur
  const isStaff = message.member.roles.cache.some(r => config.ticketStaffRoleIds.includes(r.id)) ||
                  message.member.permissions.has(PermissionsBitField.Flags.Administrator);
  const isUser = message.author.id === ticket.userId;

  if (isUser) {
    // L'utilisateur envoie un message dans le salon => le transmettre en DM (déjà fait via la synchronisation inverse)
    // On va juste l'ajouter aux messages du ticket
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
    // Envoyer le message en DM à l'utilisateur
    const user = await client.users.fetch(ticket.userId).catch(() => null);
    if (user) {
      const files = [];
      for (const att of message.attachments.values()) {
        files.push({ attachment: att.url, name: att.name });
      }
      await user.send({
        content: `**${message.author.tag} (Staff)** : ${message.content || ''}`,
        files: files.length ? files : undefined,
      }).catch(() => {});
    }
    // Ajouter aux messages
    ticket.messages.push({
      authorId: message.author.id,
      authorTag: message.author.tag,
      content: message.content || '',
      attachments: message.attachments.map(a => a.url),
      timestamp: new Date().toISOString(),
    });
    sauverTickets();
  }
}

// ---- Commande slash pour fermer un ticket (staff) ----
const closeCommand = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Fermer le ticket actuel')
  .addStringOption(option =>
    option.setName('raison')
      .setDescription('Raison de la fermeture (optionnelle)')
      .setRequired(false)
  );

// ---- Commande slash pour réouvrir un ticket (staff) ----
const reopenCommand = new SlashCommandBuilder()
  .setName('reopen')
  .setDescription('Réouvrir le ticket actuel');

// ---- Commande slash pour renommer un ticket (staff) ----
const renameCommand = new SlashCommandBuilder()
  .setName('rename')
  .setDescription('Renommer le ticket actuel')
  .addStringOption(option =>
    option.setName('nom')
      .setDescription('Nouveau nom')
      .setRequired(true)
  );

// ---- Commande slash pour assigner un ticket (staff) ----
const assignCommand = new SlashCommandBuilder()
  .setName('assign')
  .setDescription('Assigner un staff au ticket actuel')
  .addUserOption(option =>
    option.setName('staff')
      .setDescription('Staff à assigner')
      .setRequired(true)
  );

// ---- Commande slash pour changer la priorité (staff) ----
const priorityCommand = new SlashCommandBuilder()
  .setName('priority')
  .setDescription('Changer la priorité du ticket actuel')
  .addStringOption(option =>
    option.setName('niveau')
      .setDescription('Priorité')
      .setRequired(true)
      .addChoices(
        { name: '🟢 Faible', value: 'low' },
        { name: '🟡 Normale', value: 'normal' },
        { name: '🟠 Haute', value: 'high' },
        { name: '🔴 Urgente', value: 'urgent' }
      )
  );

// ---- Commande slash pour changer la catégorie (staff) ----
const categoryCommand = new SlashCommandBuilder()
  .setName('category')
  .setDescription('Changer la catégorie du ticket actuel')
  .addStringOption(option =>
    option.setName('categorie')
      .setDescription('ID de la catégorie')
      .setRequired(true)
  );

// ---- Commande slash pour ajouter une note privée (staff) ----
const noteCommand = new SlashCommandBuilder()
  .setName('note')
  .setDescription('Ajouter une note privée au ticket actuel')
  .addStringOption(option =>
    option.setName('contenu')
      .setDescription('Note')
      .setRequired(true)
  );

// ---- Commande slash pour exporter le ticket (staff) ----
const exportCommand = new SlashCommandBuilder()
  .setName('export')
  .setDescription('Exporter le ticket actuel en HTML');

// ---- Commande slash pour blacklister (staff) ----
const blacklistCommand = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Blacklister l\'utilisateur du ticket actuel');

// ---- Enregistrement des commandes ----
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
  // Garder les commandes de modération existantes (warn, warns, clear, etc.)
  // On va les ajouter plus tard, elles sont déjà définies ailleurs.
].map(cmd => cmd.toJSON());

// ---- Intégration avec le reste du bot ----
// On va garder les autres commandes (modération, candidatures) mais on les adapte.

// ============================================================
//  FIN NOUVEAU SYSTÈME DE TICKETS
// ============================================================

// ---- Client Discord ----
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

// ---- REST pour les commandes ----
const rest = new REST({ version: '10' }).setToken(TOKEN);

// ---- Événements Discord ----
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  try {
    // Enregistrer les commandes slash (on fusionne avec les existantes)
    const allCommands = [
      ...slashCommands,
      // Ajouter les autres commandes (warn, warns, clear, lock, unlock, slowmode, nuke, valid, refuser)
      // On va les définir plus bas, mais pour l'instant on les garde telles quelles
    ];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: allCommands });
    console.log('Commandes slash enregistrées avec succès.');
  } catch (error) { console.error(error); }

  // Planifier les giveaways (si existants)
  // ... (code existant)
  console.log('✅ Bot prêt.');
});

// ---- Gestion des messages (DM et salon) ----
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Gestion des DM
  if (message.channel.type === ChannelType.DM) {
    await handleDM(message);
    return;
  }

  // Gestion des messages dans les salons de tickets
  if (message.channel.type === ChannelType.GuildText) {
    await handleChannelMessage(message);
  }
});

// ---- Gestion des interactions ----
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    // Gérer les nouvelles commandes slash
    const cmd = interaction.commandName;
    if (['close', 'reopen', 'rename', 'assign', 'priority', 'category', 'note', 'export', 'blacklist'].includes(cmd)) {
      await handleSlashCommand(interaction);
      return;
    }
    // Autres commandes (modération, candidatures) - on les garde
    // ...
    return;
  }

  // Gérer les interactions de tickets (boutons, menus, modals)
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

  // Vérifier les permissions staff
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
// ... (le code des giveaways reste inchangé, je le laisse)

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
    const aRoleAutorise = member.roles.cache.some(role => ROLES_AUTORISES.includes(role.id));
    if (!estAdmin && !aRoleAutorise) { req.session.destroy(); return res.status(403).json({ erreur: 'Rôle insuffisant' }); }
    next();
  }).catch(() => { req.session.destroy(); res.status(401).json({ erreur: 'Erreur de vérification' }); });
}

// ---- Routes d'authentification (inchangées) ----
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
// ... (autres routes d'auth)

// ---- Routes API pour le nouveau système de tickets ----
// Statistiques
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

// Récupérer tous les tickets
app.get('/api/tickets', authRequis, (req, res) => {
  const list = Object.values(tickets);
  // On peut filtrer par statut si besoin
  const { status } = req.query;
  const filtered = status ? list.filter(t => t.status === status) : list;
  res.json(filtered);
});

// Récupérer un ticket spécifique
app.get('/api/tickets/:id', authRequis, (req, res) => {
  const ticket = tickets[req.params.id];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  res.json(ticket);
});

// Répondre à un ticket (envoyer un message dans le salon et en DM)
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
    // Ajouter aux messages
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

// Mettre à jour la note privée
app.post('/api/tickets/:id/note', authRequis, (req, res) => {
  const ticket = tickets[req.params.id];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  ticket.notes = req.body.note || '';
  sauverTickets();
  res.json({ succes: true });
});

// Fermer un ticket
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

// ---- Routes pour les catégories de tickets ----
app.get('/api/ticket-categories', authRequis, (req, res) => {
  res.json(config.ticketCategories || []);
});

app.post('/api/ticket-categories', authRequis, (req, res) => {
  const { name, emoji, description, categoryId, color, defaultPriority, pingRoles, staffRoles, form, autoReply, autoCloseAfter } = req.body;
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
    active: true,
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

// ---- Routes pour les statistiques des tickets ----
app.get('/api/tickets/stats', authRequis, (req, res) => {
  const total = Object.keys(tickets).length;
  const open = Object.values(tickets).filter(t => t.status === 'open').length;
  const closed = Object.values(tickets).filter(t => t.status === 'closed').length;
  const avgRating = Object.values(tickets)
    .filter(t => t.evaluation !== null)
    .reduce((acc, t) => acc + t.evaluation, 0) / (Object.values(tickets).filter(t => t.evaluation !== null).length || 1);
  res.json({ total, open, closed, avgRating: avgRating.toFixed(1) });
});

// ---- Sauvegarde (backup) ----
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
// ... (je garde les routes existantes pour les salons, rôles, membres, etc.)

// ---- Démarrage du serveur Express ----
server.listen(PORT, () => {
  console.log(`✅ Serveur web + bot actif sur le port ${PORT}`);
});

// ---- Connexion à Discord ----
client.login(TOKEN).catch(error => {
  console.error('❌ Échec de la connexion à Discord :', error);
  process.exit(1);
});

// ---- Gestion des erreurs non capturées ----
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught Exception:', error);
});

// ---- Nettoyage ----
let cleanupDone = false;
function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log('🛑 Arrêt en cours...');
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ---- Fin du fichier ----
