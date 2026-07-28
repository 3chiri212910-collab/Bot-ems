// index.js – Bot Discord + API REST pour panel RP (système de tickets avec salons)
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
const DATA_DIR = __dirname;
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const GIVEAWAYS_FILE = path.join(DATA_DIR, 'giveaways.json');
const CLOSED_TICKETS_FILE = path.join(DATA_DIR, 'closed-tickets.json');
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
const CANDIDATURES_DEFAUT = {
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
};

const TICKET_CATEGORIES_DEFAUT = [
  {
    id: 'recrutement',
    name: 'Recrutement',
    emoji: '📩',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'recrutement-{number}',
    autoReplyEmbed: {
      title: '✅ Ticket créé',
      description: 'Merci pour votre message.\n\nVotre ticket a bien été créé.\nUn membre de notre équipe prendra votre demande en charge dans les plus brefs délais.\n\nMerci de patienter.',
      color: '#5865F2'
    }
  },
  {
    id: 'suggestion',
    name: 'Suggestion / Idée',
    emoji: '💡',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'suggestion-{number}',
    autoReplyEmbed: {
      title: '💡 Suggestion reçue',
      description: 'Nous étudierons votre proposition.\n\nMerci de votre contribution.',
      color: '#f59e0b'
    }
  },
  {
    id: 'support',
    name: 'Support',
    emoji: '🛠️',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'support-{number}',
    autoReplyEmbed: {
      title: '🛠️ Support',
      description: 'Un membre du staff va vous assister.',
      color: '#3b82f6'
    }
  },
  {
    id: 'bug',
    name: 'Signalement de bug',
    emoji: '🐞',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'bug-{number}',
    autoReplyEmbed: {
      title: '🐞 Bug signalé',
      description: 'Nous allons investiguer.',
      color: '#ef4444'
    }
  },
  {
    id: 'joueur',
    name: 'Signalement joueur',
    emoji: '🚨',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'joueur-{number}',
    autoReplyEmbed: {
      title: '🚨 Signalement joueur',
      description: 'Nous allons examiner la situation.',
      color: '#fb7185'
    }
  },
  {
    id: 'staff',
    name: 'Signalement staff',
    emoji: '👮',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'staff-{number}',
    autoReplyEmbed: {
      title: '👮 Signalement staff',
      description: 'Nous allons traiter en interne.',
      color: '#8b5cf6'
    }
  },
  {
    id: 'admin',
    name: 'Demande administrative',
    emoji: '⚖️',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'admin-{number}',
    autoReplyEmbed: {
      title: '⚖️ Demande administrative',
      description: 'Nous vous répondrons dès que possible.',
      color: '#14b8a6'
    }
  },
  {
    id: 'partenariat',
    name: 'Partenariat',
    emoji: '🤝',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'partenariat-{number}',
    autoReplyEmbed: {
      title: '🤝 Partenariat',
      description: 'Un membre du staff vous contactera.',
      color: '#8b5cf6'
    }
  },
  {
    id: 'autre',
    name: 'Autre demande',
    emoji: '🌐',
    active: true,
    destinationCategoryId: '',
    channelNameFormat: 'autre-{number}',
    autoReplyEmbed: {
      title: '🌐 Autre demande',
      description: 'Nous vous répondrons rapidement.',
      color: '#94a3b8'
    }
  }
];

let config = lire(CONFIG_FILE, {
  autoRoleIds: [],
  welcomeChannelId: null,
  welcomeMessage: 'Bienvenue {user} sur **{server}** ! Tu es le membre **#{count}**.',
  ticketStaffChannelId: null,
  ticketLogsChannelId: null,
  modLogsChannelId: null,
  leaveLogsChannelId: null,
  ticketAutoCloseHours: 0,
  ticketCounter: 0,
  candidatures: { ...CANDIDATURES_DEFAUT },
  ticketCategories: [...TICKET_CATEGORIES_DEFAUT],
  ticketStaffRoleIds: [],
  ticketTranscriptChannelId: null,
  ticketSendTranscriptToUser: false,
  ticketTranscriptFormat: 'both', // 'html', 'txt', 'both'
  ticketLogsEnabled: true,
});

config.candidatures = { ...CANDIDATURES_DEFAUT, ...(config.candidatures || {}) };
if (!Array.isArray(config.candidatures.rolesValid)) config.candidatures.rolesValid = [];
if (!Array.isArray(config.candidatures.rolesRefus)) config.candidatures.rolesRefus = [];
if (!Array.isArray(config.candidatures.rolesAttribution)) config.candidatures.rolesAttribution = [];
if (!Array.isArray(config.autoRoleIds)) config.autoRoleIds = [];
if (!Array.isArray(config.ticketCategories)) config.ticketCategories = [...TICKET_CATEGORIES_DEFAUT];
if (!Array.isArray(config.ticketStaffRoleIds)) config.ticketStaffRoleIds = [];
if (config.ticketTranscriptFormat === undefined) config.ticketTranscriptFormat = 'both';
if (config.ticketLogsEnabled === undefined) config.ticketLogsEnabled = true;

let tickets = lire(TICKETS_FILE, {});
let giveaways = lire(GIVEAWAYS_FILE, {});
let closedTickets = lire(CLOSED_TICKETS_FILE, {});
let warns = lire(WARNS_FILE, {});
let candHistory = lire(CAND_HISTORY_FILE, []);

function sauverConfig() { ecrire(CONFIG_FILE, config); }
function sauverTickets() { ecrire(TICKETS_FILE, tickets); }
function sauverGiveaways() { ecrire(GIVEAWAYS_FILE, giveaways); }
function sauverClosedTickets() { ecrire(CLOSED_TICKETS_FILE, closedTickets); }
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

function prochainNumeroTicket() {
  config.ticketCounter = (config.ticketCounter || 0) + 1;
  sauverConfig();
  return String(config.ticketCounter).padStart(4, '0');
}

function getGuild(res) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    res.status(500).json({ erreur: 'Le bot n\'est pas sur le serveur configuré (GUILD_ID)' });
    return null;
  }
  return guild;
}

function trouverUserIdParSalon(channelId) {
  for (const [userId, t] of Object.entries(tickets)) {
    if (t.channelId === channelId) return userId;
  }
  return null;
}

// ---- Validation des emojis (correction de l'erreur COMPONENT_INVALID_EMOJI) ----
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

// ---- Fonctions Tickets (nouvelle version avec salons) ----

function boutonsTicket() {
  const ligne1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('Unclaim').setEmoji('🙅').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_rename').setLabel('Renommer').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_add').setLabel('Ajouter').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_remove').setLabel('Retirer').setEmoji('➖').setStyle(ButtonStyle.Secondary)
  );
  const ligne2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_transcript').setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_transfer').setLabel('Transférer').setEmoji('🔄').setStyle(ButtonStyle.Primary)
  );
  return [ligne1, ligne2];
}

function boutonReprise() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reprendre le ticket').setEmoji('♻️').setStyle(ButtonStyle.Success)
  );
}

// Génération de transcript en HTML
async function genererTranscriptHTML(channel) {
  let toutMessages = [];
  let avant = undefined;
  for (let i = 0; i < 10; i++) {
    const lot = await channel.messages.fetch({ limit: 100, before: avant });
    if (!lot.size) break;
    toutMessages.push(...lot.values());
    avant = lot.last().id;
    if (lot.size < 100) break;
  }
  toutMessages.reverse();

  const echapper = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const guild = client.guilds.cache.get(GUILD_ID);
  const guildIcon = guild?.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
  const userId = trouverUserIdParSalon(channel.id);
  const user = userId ? await client.users.fetch(userId).catch(() => null) : null;

  const lignes = toutMessages.map(m => {
    const date = new Date(m.createdTimestamp).toLocaleString('fr-FR');
    const pieces = [...m.attachments.values()].map(a => `<div class="piece"><a href="${a.url}" target="_blank">${echapper(a.name)}</a></div>`).join('');
    return `<div class="msg">
      <img class="avatar" src="${m.author.displayAvatarURL({ extension: 'png', size: 64 })}" />
      <div class="contenu">
        <div class="entete"><span class="auteur">${echapper(m.author.tag)}</span><span class="date">${date}</span></div>
        <div class="texte">${echapper(m.content).replace(/\n/g, '<br>')}</div>
        ${pieces}
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Transcript - ${echapper(channel.name)}</title>
<style>
  body { background:#313338; color:#dbdee1; font-family: Arial, sans-serif; margin:0; padding:0; }
  .header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; background:#1e1f22; border-bottom:2px solid #5865F2; }
  .header-left { display:flex; align-items:center; gap:12px; }
  .header-left img { height:40px; border-radius:50%; }
  .header-left span { font-weight:bold; font-size:20px; color:#fff; }
  .header-right { font-weight:600; color:#5865F2; }
  .content { padding:20px 24px; }
  h1 { color:#5865F2; margin:0 0 12px; }
  .msg { display:flex; gap:12px; padding:8px 0; border-bottom:1px solid #3f4147; }
  .avatar { width:40px; height:40px; border-radius:50%; }
  .entete { font-size:14px; margin-bottom:2px; }
  .auteur { font-weight:bold; color:#f2f3f5; margin-right:8px; }
  .date { color:#949ba4; font-size:12px; }
  .texte { white-space:pre-wrap; word-wrap:break-word; }
  .piece a { color:#00a8fc; }
</style></head>
<body>
  <div class="header">
    <div class="header-left">
      <img src="${guildIcon}" alt="Logo serveur" />
      <span>${echapper(NOM_SERVEUR)}</span>
    </div>
    <div class="header-right">${user ? echapper(user.tag) : 'Utilisateur inconnu'}</div>
  </div>
  <div class="content">
    <h1>🎫 Transcript — ${echapper(channel.name)}</h1>
    <p>Généré le ${new Date().toLocaleString('fr-FR')} — ${toutMessages.length} message(s)</p>
    ${lignes || '<p><i>Aucun message.</i></p>'}
  </div>
</body></html>`;
}

// Génération de transcript en TXT
async function genererTranscriptTXT(channel) {
  let toutMessages = [];
  let avant = undefined;
  for (let i = 0; i < 10; i++) {
    const lot = await channel.messages.fetch({ limit: 100, before: avant });
    if (!lot.size) break;
    toutMessages.push(...lot.values());
    avant = lot.last().id;
    if (lot.size < 100) break;
  }
  toutMessages.reverse();

  const lignes = toutMessages.map(m => {
    const date = new Date(m.createdTimestamp).toLocaleString('fr-FR');
    const pieces = [...m.attachments.values()].map(a => ` [Pièce jointe: ${a.name} (${a.url})]`).join('');
    return `[${date}] ${m.author.tag} : ${m.content}${pieces}`;
  }).join('\n');

  return `Transcript - ${channel.name}\nGénéré le ${new Date().toLocaleString('fr-FR')}\n${'='.repeat(40)}\n\n${lignes}`;
}

// Envoyer un transcript dans le salon de logs et éventuellement en DM
async function envoyerTranscripts(channel, action, staffTag) {
  const transcriptChannelId = config.ticketTranscriptChannelId || config.ticketLogsChannelId;
  if (!transcriptChannelId) return;

  const transcriptChannel = await client.channels.fetch(transcriptChannelId).catch(() => null);
  if (!transcriptChannel) return;

  const userId = trouverUserIdParSalon(channel.id);
  const ticket = userId ? tickets[userId] : null;
  const username = ticket ? ticket.username : 'inconnu';
  const numero = ticket ? ticket.number : '?';

  const embed = new EmbedBuilder()
    .setColor(COULEUR_EMBED)
    .setTitle(`📄 Transcript — Ticket #${numero}`)
    .setDescription(`Action : ${action}\nUtilisateur : ${username}\nStaff : ${staffTag}`)
    .setTimestamp();

  const files = [];

  const format = config.ticketTranscriptFormat || 'both';
  if (format === 'html' || format === 'both') {
    const html = await genererTranscriptHTML(channel);
    const bufferHtml = Buffer.from(html, 'utf8');
    const nomHtml = `ticket-${username}-${numero}.html`.replace(/[^a-zA-Z0-9-_.]/g, '_');
    files.push({ attachment: bufferHtml, name: nomHtml });
  }
  if (format === 'txt' || format === 'both') {
    const txt = await genererTranscriptTXT(channel);
    const bufferTxt = Buffer.from(txt, 'utf8');
    const nomTxt = `ticket-${username}-${numero}.txt`.replace(/[^a-zA-Z0-9-_.]/g, '_');
    files.push({ attachment: bufferTxt, name: nomTxt });
  }

  await transcriptChannel.send({ embeds: [embed], files }).catch(() => {});

  // Envoyer au créateur si activé
  if (config.ticketSendTranscriptToUser && userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
      const dmEmbed = new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle(`📄 Transcript de votre ticket #${numero}`)
        .setDescription(`Votre ticket a été ${action}. Retrouvez le transcript ci-joint.`)
        .setTimestamp();
      await user.send({ embeds: [dmEmbed], files }).catch(() => {});
    }
  }
}

// Fermer un ticket (salon)
async function fermerTicketParSalon(channelId, fermePar, raison = '') {
  const userId = trouverUserIdParSalon(channelId);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  const infosTicket = userId ? tickets[userId] : null;

  if (channel) {
    await envoyerTranscripts(channel, 'fermé', fermePar);
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle('🔒 Ticket fermé')
        .setDescription(`Fermé par **${fermePar}**.${raison ? `\nRaison : ${raison}` : ''}\nLe transcript a été envoyé dans le salon de logs.`)
        .setTimestamp()
      ],
      components: [boutonReprise()],
    }).catch(() => {});
    await channel.permissionOverwrites.edit(userId, { ViewChannel: false }).catch(() => {});
    await channel.setName(`🔒-${channel.name}`.slice(0, 100)).catch(() => {});
  }

  if (userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
      await user.send({
        embeds: [new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle('🔒 Ticket fermé')
          .setDescription('Ton ticket a été fermé par l\'équipe. Si tu as besoin d\'aide, renvoie-moi un message pour en ouvrir un nouveau.')
          .setTimestamp()
        ]
      }).catch(() => {});
    }
    if (channel) {
      closedTickets[channel.id] = { userId, username: infosTicket?.username || 'inconnu', number: infosTicket?.number || '?', closedAt: new Date().toISOString(), categoryId: infosTicket?.categoryId || '' };
      sauverClosedTickets();
    }
    delete tickets[userId];
    sauverTickets();
  }
}

// Réouvrir un ticket
async function reouvrirTicketParSalon(channelId, rouvertPar) {
  const infos = closedTickets[channelId];
  if (!infos) throw new Error('Aucun ticket fermé trouvé pour ce salon.');

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error('Salon introuvable.');

  await channel.permissionOverwrites.edit(infos.userId, { ViewChannel: true }).catch(() => {});
  const nomOriginal = channel.name.replace(/^🔒-/, '');
  await channel.setName(nomOriginal.slice(0, 100)).catch(() => {});

  tickets[infos.userId] = {
    channelId: channel.id,
    username: infos.username,
    number: infos.number,
    categoryId: infos.categoryId || '',
    claimedBy: null,
    priority: 'normale',
    note: '',
    lastActivity: new Date().toISOString(),
  };
  sauverTickets();
  delete closedTickets[channelId];
  sauverClosedTickets();

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle('♻️ Ticket rouvert')
      .setDescription(`Rouvert par **${rouvertPar}**.`)
      .setTimestamp()
    ],
    components: boutonsTicket(),
  });

  const user = await client.users.fetch(infos.userId).catch(() => null);
  if (user) {
    await user.send({
      embeds: [new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle('♻️ Ticket rouvert')
        .setDescription('Ton ticket a été rouvert par l\'équipe, tu peux continuer à discuter ici.')
        .setTimestamp()
      ]
    }).catch(() => {});
  }
  return channel;
}

// Créer un ticket (salon) pour un utilisateur avec une catégorie
async function creerTicketSalon(user, categoryId) {
  const category = config.ticketCategories.find(c => c.id === categoryId);
  if (!category) throw new Error('Catégorie inconnue ou désactivée');
  if (!category.destinationCategoryId) throw new Error('Catégorie Discord de destination non définie');

  const numero = prochainNumeroTicket();
  const nomSalon = category.channelNameFormat.replace('{number}', numero);
  const nomFinal = nomSalon.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) throw new Error('Serveur introuvable');

  const parent = guild.channels.cache.get(category.destinationCategoryId);
  if (!parent) throw new Error('Catégorie Discord de destination introuvable');

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

  // Ajouter les rôles staff
  for (const roleId of config.ticketStaffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
    });
  }

  const channel = await guild.channels.create({
    name: nomFinal,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites: overwrites,
  });

  // Enregistrer le ticket
  tickets[user.id] = {
    channelId: channel.id,
    username: user.username,
    number: numero,
    categoryId: category.id,
    claimedBy: null,
    priority: 'normale',
    note: '',
    lastActivity: new Date().toISOString(),
  };
  sauverTickets();

  // Envoyer les boutons
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`🎫 Nouveau ticket #${numero}`)
      .setDescription(`Ouvert par **${user.tag}** (\`${user.id}\`)\nCatégorie : ${category.emoji} ${category.name}\n\nRépondez directement dans ce salon.`)
      .setTimestamp()
    ],
    components: boutonsTicket(),
  });

  // Log
  if (config.ticketLogsEnabled) {
    const logChannelId = config.ticketLogsChannelId;
    if (logChannelId) {
      const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
      if (logChannel) {
        const embedLog = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle('🎫 Ticket créé')
          .setDescription(`Ticket **#${numero}** ouvert par **${user.tag}** (\`${user.id}\`)\nCatégorie : ${category.emoji} ${category.name}`)
          .setTimestamp();
        await logChannel.send({ embeds: [embedLog] });
      }
    }
  }

  return { channel, numero, category };
}

// Vérifier si un utilisateur a déjà un ticket ouvert
function aTicketOuvert(userId) {
  return !!tickets[userId];
}

// Auto-fermeture (à garder)
async function verifierTicketsInactifs() {
  const heures = parseFloat(config.ticketAutoCloseHours) || 0;
  if (heures <= 0) return;
  const seuilMs = heures * 60 * 60 * 1000;
  const maintenant = Date.now();

  for (const [userId, t] of Object.entries(tickets)) {
    const derniereActivite = t.lastActivity ? new Date(t.lastActivity).getTime() : 0;
    if (!derniereActivite) continue;
    if (maintenant - derniereActivite >= seuilMs) {
      console.log(`⏰ Auto-fermeture du ticket #${t.number} (${t.username}) pour inactivité.`);
      await fermerTicketParSalon(t.channelId, 'Système (auto-fermeture inactivité)').catch(e => console.error('Erreur auto-fermeture:', e));
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

function planifierFinGiveaway(g) {
  const delai = new Date(g.endsAt).getTime() - Date.now();
  setTimeout(() => terminerGiveaway(g.id), Math.max(delai, 0));
}

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

// ---- Commandes slash ----
const commands = [
  new SlashCommandBuilder().setName('rename').setDescription('Renommer le ticket en cours')
    .addStringOption(o => o.setName('nom').setDescription('Nouveau nom').setRequired(true)),
  new SlashCommandBuilder().setName('claim').setDescription('Prendre en charge le ticket en cours'),
  new SlashCommandBuilder().setName('unclaim').setDescription('Libérer le ticket en cours'),
  new SlashCommandBuilder().setName('add').setDescription('Ajouter un membre au ticket en cours')
    .addUserOption(o => o.setName('membre').setDescription('Membre à ajouter').setRequired(true)),
  new SlashCommandBuilder().setName('remove').setDescription('Retirer un membre du ticket en cours')
    .addUserOption(o => o.setName('membre').setDescription('Membre à retirer').setRequired(true)),
  new SlashCommandBuilder().setName('priority').setDescription('Définir la priorité du ticket en cours')
    .addStringOption(o => o.setName('niveau').setDescription('Niveau de priorité').setRequired(true)
      .addChoices({ name: '🟢 Basse', value: 'basse' }, { name: '🟡 Normale', value: 'normale' }, { name: '🟠 Haute', value: 'haute' }, { name: '🔴 Urgente', value: 'urgente' })),
  new SlashCommandBuilder().setName('reopen').setDescription('Rouvrir un ticket fermé (à utiliser dans le salon fermé)'),
  new SlashCommandBuilder().setName('transcript').setDescription('Générer le transcript du ticket en cours'),
  new SlashCommandBuilder().setName('clear').setDescription('Supprimer des messages')
    .addIntegerOption(o => o.setName('nombre').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName('lock').setDescription('Verrouiller le salon ou ticket'),
  new SlashCommandBuilder().setName('unlock').setDescription('Déverrouiller le salon ou ticket'),
  new SlashCommandBuilder().setName('slowmode').setDescription('Définir le mode lent')
    .addIntegerOption(o => o.setName('secondes').setDescription('Délai en secondes (0 = désactivé)').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('nuke').setDescription('Purger tous les messages du salon'),
  new SlashCommandBuilder().setName('valid').setDescription('Valider la candidature du ticket en cours')
    .addStringOption(o => o.setName('raison').setDescription('Commentaire (optionnel)').setRequired(false)),
  new SlashCommandBuilder().setName('refuser').setDescription('Refuser la candidature du ticket en cours')
    .addStringOption(o => o.setName('raison').setDescription('Raison du refus (optionnel)').setRequired(false)),
  new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre')
    .addUserOption(o => o.setName('membre').setDescription('Membre à avertir').setRequired(true))
    .addStringOption(o => o.setName('raison').setDescription('Raison').setRequired(true)),
  new SlashCommandBuilder().setName('warns').setDescription('Voir les avertissements d\'un membre')
    .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commandes slash enregistrées avec succès.');
  } catch (error) { console.error(error); }

  // Planifier les giveaways
  for (const g of Object.values(giveaways)) {
    if (!g.ended) planifierFinGiveaway(g);
  }

  // Vérification périodique des tickets inactifs
  setInterval(verifierTicketsInactifs, 15 * 60 * 1000);
  verifierTicketsInactifs();

  console.log('✅ Bot prêt.');
});

// ---- Événements Discord ----
client.on('guildMemberAdd', async (member) => {
  try {
    if (config.autoRoleIds?.length) {
      for (const roleId of config.autoRoleIds) {
        await member.roles.add(roleId).catch(() => {});
      }
    }
    if (!config.welcomeChannelId) return;
    const salon = member.guild.channels.cache.get(config.welcomeChannelId);
    if (!salon) return;
    const texte = config.welcomeMessage
      .replaceAll('{user}', `<@${member.id}>`)
      .replaceAll('{server}', member.guild.name)
      .replaceAll('{count}', member.guild.memberCount);
    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`👋 Bienvenue sur ${NOM_SERVEUR} !`)
      .setDescription(texte)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: NOM_SERVEUR })
      .setTimestamp();
    await salon.send({ embeds: [embed] });
  } catch (e) { console.error('Erreur guildMemberAdd:', e); }
});

client.on('guildMemberRemove', async (member) => {
  if (!config.leaveLogsChannelId) return;
  try {
    const channel = await client.channels.fetch(config.leaveLogsChannelId);
    if (!channel) return;
    let raison = 'Départ volontaire ou kick sans raison.';
    try {
      const fetchedLogs = await member.guild.fetchAuditLogs({ limit: 1, type: 20 });
      const kickLog = fetchedLogs.entries.first();
      if (kickLog && kickLog.target.id === member.id && Date.now() - kickLog.createdTimestamp < 5000) {
        raison = `Kick par ${kickLog.executor.tag}`;
        if (kickLog.reason) raison += ` – Raison : ${kickLog.reason}`;
      }
    } catch (e) {}
    const embed = embedLogDepart({
      titre: '👋 Membre quitté le serveur',
      couleur: '#fb7185',
      membreTag: member.user.tag,
      membreId: member.user.id,
      raison,
      timestamp: Date.now(),
    });
    await channel.send({ embeds: [embed] });
  } catch (e) { console.error('Erreur log départ:', e); }
});

client.on('guildBanAdd', async (ban) => {
  if (!config.leaveLogsChannelId) return;
  try {
    const channel = await client.channels.fetch(config.leaveLogsChannelId);
    if (!channel) return;
    const embed = embedLogDepart({
      titre: '⛔ Membre banni',
      couleur: '#ef4444',
      membreTag: ban.user.tag,
      membreId: ban.user.id,
      raison: `Ban – Raison : ${ban.reason || 'Aucune raison'}`,
      timestamp: Date.now(),
    });
    await channel.send({ embeds: [embed] });
  } catch (e) { console.error('Erreur log ban:', e); }
});

// Gestion des messages : DM -> ticket, ticket -> DM
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ---- DM reçu ----
  if (message.channel.type === ChannelType.DM) {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) { await message.author.send('❌ Le bot n\'est pas sur le serveur.'); return; }
      const member = await guild.members.fetch(message.author.id).catch(() => null);
      if (!member) { await message.author.send('❌ Tu n\'es pas membre du serveur.'); return; }

      // Vérifier si déjà un ticket ouvert
      if (aTicketOuvert(message.author.id)) {
        // Rediriger vers le salon existant
        const ticket = tickets[message.author.id];
        const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
        if (channel) {
          await channel.send({
            content: `**${message.author.tag}** :\n${message.content || '*(pièce jointe / message vide)*'}`,
            files: [...message.attachments.values()],
          });
          ticket.lastActivity = new Date().toISOString();
          sauverTickets();
          return;
        } else {
          delete tickets[message.author.id];
          sauverTickets();
        }
      }

      // Pas de ticket ouvert : envoyer le sélecteur de catégorie
      const categories = config.ticketCategories.filter(c => c.active && c.destinationCategoryId);
      if (!categories.length) {
        await message.author.send('❌ Aucune catégorie de ticket disponible. Contactez un administrateur.');
        return;
      }

      // Construire les options avec validation de l'emoji
      const options = categories.map(c => {
        const option = { label: c.name, value: c.id };
        if (c.emoji && isValidEmoji(c.emoji)) {
          option.emoji = c.emoji;
        }
        return option;
      });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('ticket_category_select')
          .setPlaceholder('Choisissez une catégorie')
          .addOptions(options)
      );

      const embed = new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle('📩 Ouverture d\'un ticket')
        .setDescription('Merci de sélectionner le sujet de votre demande ci-dessous.')
        .setTimestamp();

      await message.author.send({ embeds: [embed], components: [row] });
    } catch (e) {
      console.error('Erreur DM->ticket:', e);
      await message.author.send('⚠️ Une erreur est survenue.').catch(() => {});
    }
    return;
  }

  // ---- Message dans un salon de ticket ----
  if (message.channel.type === ChannelType.GuildText) {
    const userId = trouverUserIdParSalon(message.channel.id);
    if (!userId) return;

    const staffRoles = config.ticketStaffRoleIds || [];
    const isStaff = message.member.roles.cache.some(r => staffRoles.includes(r.id)) || message.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isCreator = message.author.id === userId;

    if (!isCreator && isStaff) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        await user.send({
          content: `**${message.author.tag} (Staff)** :\n${message.content || '*(pièce jointe)*'}`,
          files: [...message.attachments.values()],
        }).catch(() => {});
      }
    } else if (isCreator) {
      const ticket = tickets[userId];
      if (ticket) {
        ticket.lastActivity = new Date().toISOString();
        sauverTickets();

        if (!ticket.autoReplySent) {
          ticket.autoReplySent = true;
          sauverTickets();
          const category = config.ticketCategories.find(c => c.id === ticket.categoryId);
          if (category && category.autoReplyEmbed) {
            const embedReply = new EmbedBuilder()
              .setColor(category.autoReplyEmbed.color || COULEUR_EMBED)
              .setTitle(category.autoReplyEmbed.title || '✅ Ticket créé')
              .setDescription(category.autoReplyEmbed.description || 'Votre message a bien été reçu.')
              .setTimestamp();
            await message.channel.send({ embeds: [embedReply] });
          }
        }
      }
    }
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) try { await reaction.fetch(); } catch { return; }
  const giveaway = Object.values(giveaways).find(g => g.messageId === reaction.message.id && !g.ended);
  if (!giveaway) return;
  if (!giveaway.participants.includes(user.id)) {
    giveaway.participants.push(user.id);
    sauverGiveaways();
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) try { await reaction.fetch(); } catch { return; }
  const giveaway = Object.values(giveaways).find(g => g.messageId === reaction.message.id && !g.ended);
  if (!giveaway) return;
  const idx = giveaway.participants.indexOf(user.id);
  if (idx !== -1) {
    giveaway.participants.splice(idx, 1);
    sauverGiveaways();
  }
});

// ---- Interactions ----
client.on('interactionCreate', async (interaction) => {
  if (interaction.replied || interaction.deferred) return;

  try {
    // ---- MENU DE SÉLECTION DE CATÉGORIE ----
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
      const categoryId = interaction.values[0];
      const category = config.ticketCategories.find(c => c.id === categoryId);
      if (!category || !category.active) {
        return interaction.reply({ content: '❌ Cette catégorie n\'est pas disponible.', flags: 64 });
      }

      if (aTicketOuvert(interaction.user.id)) {
        return interaction.reply({ content: '❌ Tu as déjà un ticket ouvert. Utilise-le ou ferme-le avant d\'en ouvrir un nouveau.', flags: 64 });
      }

      try {
        await interaction.deferReply({ flags: 64 });
        const { channel, numero } = await creerTicketSalon(interaction.user, categoryId);
        await interaction.editReply({
          content: `✅ Ton ticket a été créé : <#${channel.id}> (numéro #${numero}).\nTu peux maintenant envoyer ton message dans ce DM, il sera transmis.`
        });
        await channel.send({
          content: `👋 ${interaction.user}, tu peux maintenant envoyer ton message ici ou continuer en DM.`
        });
      } catch (e) {
        console.error('Erreur création ticket:', e);
        await interaction.editReply({ content: `❌ Erreur lors de la création du ticket : ${e.message}` });
      }
      return;
    }

    // ---- BOUTONS TICKET ----
    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (['ticket_claim', 'ticket_unclaim', 'ticket_rename', 'ticket_add', 'ticket_remove', 'ticket_transcript', 'ticket_close', 'ticket_delete', 'ticket_reopen', 'ticket_transfer'].includes(customId)) {
        const userId = trouverUserIdParSalon(interaction.channel.id);
        if (!userId) {
          if (customId === 'ticket_reopen') {
            // on autorise
          } else {
            return interaction.reply({ content: '❌ Cette commande n\'est disponible que dans un ticket.', flags: 64 });
          }
        }
        const ticket = userId ? tickets[userId] : null;

        if (customId === 'ticket_claim') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          if (ticket.claimedBy) return interaction.reply({ content: `❌ Ce ticket est déjà pris par <@${ticket.claimedBy}>.`, flags: 64 });
          ticket.claimedBy = interaction.user.id;
          sauverTickets();
          await interaction.reply({ content: `✅ Tu as pris en charge le ticket #${ticket.number}.`, flags: 64 });
          await interaction.channel.send({ content: `🙋 <@${interaction.user.id}> a pris en charge le ticket.` });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('📌 Ticket claim').setDescription(`Ticket #${ticket.number} claim par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } else if (customId === 'ticket_unclaim') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          if (!ticket.claimedBy) return interaction.reply({ content: '❌ Ce ticket n\'est pas pris en charge.', flags: 64 });
          if (ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Tu n\'as pas pris ce ticket.', flags: 64 });
          }
          ticket.claimedBy = null;
          sauverTickets();
          await interaction.reply({ content: `✅ Ticket #${ticket.number} libéré.`, flags: 64 });
          await interaction.channel.send({ content: `🙅 <@${interaction.user.id}> a libéré le ticket.` });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('📌 Ticket unclaim').setDescription(`Ticket #${ticket.number} libéré par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } else if (customId === 'ticket_rename') {
          const modal = new ModalBuilder().setCustomId('ticket_rename_modal').setTitle('Renommer le ticket');
          const input = new TextInputBuilder().setCustomId('new_name').setLabel('Nouveau nom').setStyle(TextInputStyle.Short).setValue(interaction.channel.name);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await interaction.showModal(modal);
        } else if (customId === 'ticket_add') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('ticket_add_user').setPlaceholder('Choisis un membre à ajouter')
          );
          await interaction.reply({ content: 'Sélectionne le membre à ajouter :', components: [row], flags: 64 });
        } else if (customId === 'ticket_remove') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('ticket_remove_user').setPlaceholder('Choisis un membre à retirer')
          );
          await interaction.reply({ content: 'Sélectionne le membre à retirer :', components: [row], flags: 64 });
        } else if (customId === 'ticket_transcript') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          await interaction.deferReply({ flags: 64 });
          await envoyerTranscripts(interaction.channel, 'transcript demandé', interaction.user.tag);
          await interaction.editReply({ content: '✅ Le transcript a été envoyé dans le salon de logs.' });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('📄 Transcript généré').setDescription(`Ticket #${ticket.number} par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } else if (customId === 'ticket_close') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          await fermerTicketParSalon(interaction.channel.id, interaction.user.tag);
          await interaction.reply({ content: '🔒 Ticket fermé.', flags: 64 });
        } else if (customId === 'ticket_delete') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Seuls les administrateurs peuvent supprimer un ticket.', flags: 64 });
          }
          await interaction.reply({ content: '🗑️ Suppression du ticket...', flags: 64 });
          await envoyerTranscripts(interaction.channel, 'supprimé', interaction.user.tag);
          await interaction.channel.delete().catch(() => {});
          if (userId) { delete tickets[userId]; sauverTickets(); }
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('🗑️ Ticket supprimé').setDescription(`Ticket #${ticket.number} supprimé par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } else if (customId === 'ticket_reopen') {
          await interaction.deferReply({ flags: 64 });
          await reouvrirTicketParSalon(interaction.channel.id, interaction.user.tag);
          await interaction.editReply({ content: '♻️ Ticket rouvert !' });
        } else if (customId === 'ticket_transfer') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          const categories = config.ticketCategories.filter(c => c.active && c.destinationCategoryId && c.id !== ticket.categoryId);
          if (!categories.length) {
            return interaction.reply({ content: '❌ Aucune autre catégorie disponible.', flags: 64 });
          }
          const options = categories.map(c => {
            const option = { label: c.name, value: c.id };
            if (c.emoji && isValidEmoji(c.emoji)) {
              option.emoji = c.emoji;
            }
            return option;
          });
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('ticket_transfer_select')
              .setPlaceholder('Choisissez la nouvelle catégorie')
              .addOptions(options)
          );
          await interaction.reply({ content: 'Sélectionnez la nouvelle catégorie :', components: [row], flags: 64 });
        }
        return;
      }
    }

    // ---- USER SELECT MENUS ----
    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'ticket_add_user') {
        const user = interaction.users.first();
        if (!user) return interaction.update({ content: '❌ Aucun membre sélectionné.', components: [] });
        const userId = trouverUserIdParSalon(interaction.channel.id);
        if (!userId) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });
        try {
          await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
          await interaction.update({ content: `✅ ${user.tag} a été ajouté au ticket.`, components: [] });
          await interaction.channel.send({ content: `➕ <@${user.id}> a été ajouté au ticket par <@${interaction.user.id}>.` });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('➕ Membre ajouté').setDescription(`${user.tag} ajouté au ticket par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } catch (e) { await interaction.update({ content: `❌ Échec : ${e.message}`, components: [] }); }
        return;
      }
      if (interaction.customId === 'ticket_remove_user') {
        const user = interaction.users.first();
        if (!user) return interaction.update({ content: '❌ Aucun membre sélectionné.', components: [] });
        const userId = trouverUserIdParSalon(interaction.channel.id);
        if (!userId) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });
        try {
          await interaction.channel.permissionOverwrites.delete(user.id);
          await interaction.update({ content: `✅ ${user.tag} a été retiré du ticket.`, components: [] });
          await interaction.channel.send({ content: `➖ <@${user.id}> a été retiré du ticket par <@${interaction.user.id}>.` });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('➖ Membre retiré').setDescription(`${user.tag} retiré du ticket par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } catch (e) { await interaction.update({ content: `❌ Échec : ${e.message}`, components: [] }); }
        return;
      }
    }

    // ---- TRANSFER SELECT MENU ----
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_transfer_select') {
      const newCategoryId = interaction.values[0];
      const userId = trouverUserIdParSalon(interaction.channel.id);
      if (!userId) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });
      const ticket = tickets[userId];
      if (!ticket) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });
      const oldCategory = config.ticketCategories.find(c => c.id === ticket.categoryId);
      const newCategory = config.ticketCategories.find(c => c.id === newCategoryId);
      if (!newCategory || !newCategory.active) return interaction.update({ content: '❌ Catégorie invalide.', components: [] });

      try {
        const parent = await client.channels.fetch(newCategory.destinationCategoryId);
        if (parent) {
          await interaction.channel.setParent(parent.id);
        }
        const nouveauNom = newCategory.channelNameFormat.replace('{number}', ticket.number);
        await interaction.channel.setName(nouveauNom.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
        ticket.categoryId = newCategory.id;
        sauverTickets();
        await interaction.update({ content: `✅ Ticket transféré vers la catégorie **${newCategory.emoji} ${newCategory.name}**.`, components: [] });
        await interaction.channel.send({ content: `🔄 Le ticket a été transféré vers la catégorie ${newCategory.emoji} ${newCategory.name} par ${interaction.user.tag}.` });
        if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
          const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
          if (logChannel) {
            const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('🔄 Ticket transféré').setDescription(`Ticket #${ticket.number} transféré de ${oldCategory?.name || 'inconnu'} vers ${newCategory.name} par ${interaction.user.tag}`).setTimestamp();
            await logChannel.send({ embeds: [embed] });
          }
        }
      } catch (e) {
        console.error('Erreur transfert:', e);
        await interaction.update({ content: `❌ Erreur lors du transfert : ${e.message}`, components: [] });
      }
      return;
    }

    // ---- MODAL TICKET RENAME ----
    if (interaction.isModalSubmit() && interaction.customId === 'ticket_rename_modal') {
      const newName = interaction.fields.getTextInputValue('new_name');
      await interaction.channel.setName(newName.slice(0, 100)).catch(() => {});
      await interaction.reply({ content: `✅ Ticket renommé en **${newName}**.`, flags: 64 });
      const userId = trouverUserIdParSalon(interaction.channel.id);
      if (userId && config.ticketLogsEnabled && config.ticketLogsChannelId) {
        const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
        if (logChannel) {
          const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('✏️ Ticket renommé').setDescription(`Nouveau nom : ${newName} par ${interaction.user.tag}`).setTimestamp();
          await logChannel.send({ embeds: [embed] });
        }
      }
      return;
    }

    // ---- COMMANDES SLASH ----
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;
      const opts = interaction.options;

      // Tickets (commandes compatibles avec les salons)
      if (['rename', 'claim', 'unclaim', 'add', 'remove', 'priority', 'reopen', 'transcript'].includes(cmd)) {
        const userId = trouverUserIdParSalon(interaction.channel.id);
        if (!userId) {
          if (cmd === 'reopen') {
            // on autorise
          } else {
            return interaction.reply({ content: '❌ Cette commande n\'est disponible que dans un ticket.', flags: 64 });
          }
        }
        const ticket = userId ? tickets[userId] : null;

        if (cmd === 'rename') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          const nouveauNom = opts.getString('nom');
          await interaction.channel.setName(nouveauNom.slice(0, 100)).catch(() => {});
          await interaction.reply({ content: `✅ Ticket renommé en **${nouveauNom}**.`, flags: 64 });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('✏️ Ticket renommé').setDescription(`Nouveau nom : ${nouveauNom} par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } else if (cmd === 'claim') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          if (ticket.claimedBy) return interaction.reply({ content: `❌ Déjà pris par <@${ticket.claimedBy}>.`, flags: 64 });
          ticket.claimedBy = interaction.user.id;
          sauverTickets();
          await interaction.reply({ content: `✅ Tu as pris en charge le ticket #${ticket.number}.`, flags: 64 });
          await interaction.channel.send({ content: `🙋 <@${interaction.user.id}> a pris en charge le ticket.` });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('📌 Ticket claim').setDescription(`Ticket #${ticket.number} claim par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } else if (cmd === 'unclaim') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          if (!ticket.claimedBy) return interaction.reply({ content: '❌ Pas pris en charge.', flags: 64 });
          if (ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Tu n\'as pas pris ce ticket.', flags: 64 });
          }
          ticket.claimedBy = null;
          sauverTickets();
          await interaction.reply({ content: `✅ Ticket #${ticket.number} libéré.`, flags: 64 });
          await interaction.channel.send({ content: `🙅 <@${interaction.user.id}> a libéré le ticket.` });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('📌 Ticket unclaim').setDescription(`Ticket #${ticket.number} libéré par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        } else if (cmd === 'add') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          const membre = opts.getUser('membre');
          try {
            await interaction.channel.permissionOverwrites.edit(membre.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            await interaction.reply({ content: `✅ ${membre.tag} ajouté.`, flags: 64 });
            await interaction.channel.send({ content: `➕ <@${membre.id}> ajouté par <@${interaction.user.id}>.` });
            if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
              const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
              if (logChannel) {
                const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('➕ Membre ajouté').setDescription(`${membre.tag} ajouté au ticket par ${interaction.user.tag}`).setTimestamp();
                await logChannel.send({ embeds: [embed] });
              }
            }
          } catch (e) { await interaction.reply({ content: `❌ Échec : ${e.message}`, flags: 64 }); }
        } else if (cmd === 'remove') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          const membre = opts.getUser('membre');
          try {
            await interaction.channel.permissionOverwrites.delete(membre.id);
            await interaction.reply({ content: `✅ ${membre.tag} retiré.`, flags: 64 });
            await interaction.channel.send({ content: `➖ <@${membre.id}> retiré par <@${interaction.user.id}>.` });
            if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
              const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
              if (logChannel) {
                const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('➖ Membre retiré').setDescription(`${membre.tag} retiré du ticket par ${interaction.user.tag}`).setTimestamp();
                await logChannel.send({ embeds: [embed] });
              }
            }
          } catch (e) { await interaction.reply({ content: `❌ Échec : ${e.message}`, flags: 64 }); }
        } else if (cmd === 'priority') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          const niveau = opts.getString('niveau');
          ticket.priority = niveau;
          sauverTickets();
          const emojis = { basse: '🟢', normale: '🟡', haute: '🟠', urgente: '🔴' };
          await interaction.reply({ content: `✅ Priorité définie sur **${emojis[niveau] || ''} ${niveau}**.`, flags: 64 });
        } else if (cmd === 'reopen') {
          await interaction.deferReply({ flags: 64 });
          const closedInfo = closedTickets[interaction.channel.id];
          if (!closedInfo) return interaction.editReply({ content: '❌ Ce ticket n\'est pas fermé ou n\'existe pas dans les archives.' });
          await reouvrirTicketParSalon(interaction.channel.id, interaction.user.tag);
          await interaction.editReply({ content: '♻️ Ticket rouvert !' });
        } else if (cmd === 'transcript') {
          if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
          await interaction.deferReply({ flags: 64 });
          await envoyerTranscripts(interaction.channel, 'transcript demandé', interaction.user.tag);
          await interaction.editReply({ content: '✅ Le transcript a été envoyé dans le salon de logs.' });
          if (config.ticketLogsEnabled && config.ticketLogsChannelId) {
            const logChannel = await client.channels.fetch(config.ticketLogsChannelId).catch(() => null);
            if (logChannel) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle('📄 Transcript généré').setDescription(`Ticket #${ticket.number} par ${interaction.user.tag}`).setTimestamp();
              await logChannel.send({ embeds: [embed] });
            }
          }
        }
        return;
      }

      // Modération (inchangé)
      if (['clear', 'lock', 'unlock', 'slowmode', 'nuke'].includes(cmd)) {
        const channel = interaction.channel;
        if (cmd === 'clear') {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
          }
          const nb = opts.getInteger('nombre');
          const messages = await channel.messages.fetch({ limit: nb });
          await channel.bulkDelete(messages, true);
          await interaction.reply({ content: `✅ ${messages.size} messages supprimés.`, flags: 64 });
        } else if (cmd === 'lock') {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
          }
          await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: false });
          await interaction.reply({ content: '🔒 Salon verrouillé.', flags: 64 });
        } else if (cmd === 'unlock') {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
          }
          await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: null });
          await interaction.reply({ content: '🔓 Salon déverrouillé.', flags: 64 });
        } else if (cmd === 'slowmode') {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
          }
          const sec = opts.getInteger('secondes');
          await channel.setRateLimitPerUser(sec);
          await interaction.reply({ content: `✅ Mode lent défini sur ${sec} secondes.`, flags: 64 });
        } else if (cmd === 'nuke') {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
          }
          await interaction.deferReply({ flags: 64 });
          let all = [], last = undefined;
          for (let i = 0; i < 5; i++) {
            const batch = await channel.messages.fetch({ limit: 100, before: last });
            if (!batch.size) break;
            all.push(...batch.values());
            last = batch.last().id;
          }
          if (!all.length) return interaction.editReply({ content: '⚠️ Aucun message.' });
          await channel.bulkDelete(all, true);
          await interaction.editReply({ content: `✅ ${all.length} messages supprimés (nuke).` });
        }
        return;
      }

      // Candidatures (inchangé)
      if (['valid', 'refuser'].includes(cmd)) {
        const userId = trouverUserIdParSalon(interaction.channel.id) || (interaction.channel.isThread() ? trouverUserIdParThread(interaction.channel.id) : null);
        if (!userId) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
        const ticket = tickets[userId];
        if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });

        const raison = opts.getString('raison') || 'Sans commentaire';
        const cfg = config.candidatures || {};
        if (!cfg.actif) return interaction.reply({ content: '❌ Système de candidatures désactivé.', flags: 64 });

        const shouldMention = cfg.mentionUser !== false;
        const mention = shouldMention ? `<@${userId}>` : '';

        if (cmd === 'valid') {
          if (!estAutoriseCandidature(interaction, cfg.rolesValid)) {
            return interaction.reply({ content: '❌ Tu n\'as pas la permission de valider.', flags: 64 });
          }
          if (cfg.rolesAttribution?.length) {
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (member) {
              for (const roleId of cfg.rolesAttribution) {
                await member.roles.add(roleId).catch(() => {});
              }
            }
          }
          const vars = {
            user: `<@${userId}>`, mention, username: ticket.username,
            server: interaction.guild.name, staff: interaction.user.tag,
            ticket: `#${ticket.number}`, date: new Date().toLocaleString('fr-FR'), raison,
          };
          const msgVal = remplacerVariables(cfg.messageValidation, vars);
          await interaction.channel.send({ content: msgVal });
          if (cfg.salonValidation) {
            const salon = await interaction.guild.channels.fetch(cfg.salonValidation).catch(() => null);
            if (salon) {
              const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle(`✅ Candidature validée - #${ticket.number}`).setDescription(msgVal).setTimestamp();
              await salon.send({ embeds: [embed] });
            }
          }
          if (cfg.mpActif) {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) {
              const mpMsg = remplacerVariables(cfg.mpValidation, vars);
              await user.send(mpMsg).catch(() => {});
            }
          }
          candHistory.push({ userId, username: ticket.username, ticketNumber: ticket.number, result: 'validee', staffTag: interaction.user.tag, raison, date: new Date().toISOString() });
          sauverCandHistory();
          if (cfg.fermetureAuto) {
            const delai = parseInt(cfg.fermetureDelai) || 10;
            setTimeout(() => fermerTicketParSalon(interaction.channel.id, 'Auto-fermeture après validation'), delai * 1000);
          }
          await interaction.reply({ content: '✅ Candidature validée.', flags: 64 });
        } else if (cmd === 'refuser') {
          if (!estAutoriseCandidature(interaction, cfg.rolesRefus)) {
            return interaction.reply({ content: '❌ Tu n\'as pas la permission de refuser.', flags: 64 });
          }
          const vars = {
            user: `<@${userId}>`, mention, username: ticket.username,
            server: interaction.guild.name, staff: interaction.user.tag,
            ticket: `#${ticket.number}`, date: new Date().toLocaleString('fr-FR'), raison,
          };
          const msgRef = remplacerVariables(cfg.messageRefus, vars);
          await interaction.channel.send({ content: msgRef });
          const salonRefus = cfg.salonRefus || cfg.salonValidation;
          if (salonRefus) {
            const salon = await interaction.guild.channels.fetch(salonRefus).catch(() => null);
            if (salon) {
              const embed = new EmbedBuilder().setColor('#fb7185').setTitle(`❌ Candidature refusée - #${ticket.number}`).setDescription(msgRef).setTimestamp();
              await salon.send({ embeds: [embed] });
            }
          }
          if (cfg.mpActif) {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) {
              const mpMsg = remplacerVariables(cfg.mpRefus, vars);
              await user.send(mpMsg).catch(() => {});
            }
          }
          candHistory.push({ userId, username: ticket.username, ticketNumber: ticket.number, result: 'refusee', staffTag: interaction.user.tag, raison, date: new Date().toISOString() });
          sauverCandHistory();
          if (cfg.fermetureAuto) {
            const delai = parseInt(cfg.fermetureDelai) || 10;
            setTimeout(() => fermerTicketParSalon(interaction.channel.id, 'Auto-fermeture après refus'), delai * 1000);
          }
          await interaction.reply({ content: '❌ Candidature refusée.', flags: 64 });
        }
        return;
      }

      // Warn / Warns (inchangé)
      if (cmd === 'warn') {
        const membre = opts.getUser('membre');
        const raison = opts.getString('raison');
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
        }
        if (!warns[membre.id]) warns[membre.id] = [];
        warns[membre.id].push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          reason: raison,
          staffId: interaction.user.id,
          staffTag: interaction.user.tag,
          date: new Date().toISOString(),
        });
        sauverWarns();
        const embed = embedLogModeration({
          action: 'Avertissement', couleur: '#f59e0b', emoji: '⚠️',
          cibleTag: membre.tag, cibleId: membre.id, parTag: interaction.user.tag, raison,
        });
        await envoyerLogModeration(embed);
        await interaction.reply({ content: `⚠️ ${membre.tag} a été averti pour : ${raison}`, flags: 64 });
        return;
      }

      if (cmd === 'warns') {
        const membre = opts.getUser('membre');
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
        }
        const liste = warns[membre.id] || [];
        if (!liste.length) return interaction.reply({ content: `${membre.tag} n'a aucun avertissement.`, flags: 64 });
        const desc = liste.map((w, i) => `**${i+1}.** ${w.reason} (par ${w.staffTag} le ${new Date(w.date).toLocaleString('fr-FR')})`).join('\n');
        const embed = new EmbedBuilder().setColor(COULEUR_EMBED).setTitle(`⚠️ Avertissements de ${membre.tag}`).setDescription(desc).setTimestamp();
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
      }

      console.log(`Commande non implémentée : ${cmd}`);
      await interaction.reply({ content: '❌ Commande inconnue.', flags: 64 });
    }
  } catch (error) {
    console.error('❌ Erreur interaction:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: '❌ Erreur, réessaye.', flags: 64 }).catch(() => {});
    } else {
      await interaction.reply({ content: '❌ Erreur, réessaye.', flags: 64 }).catch(() => {});
    }
  }
});

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
    const aRoleAutorise = membre.roles.cache.some(role => ROLES_AUTORISES.includes(role.id));
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

// ---- Routes API ----
app.get('/api/stats', authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  res.json({
    memberCount: guild.memberCount,
    channelCount: guild.channels.cache.size,
    roleCount: guild.roles.cache.size,
    ping: client.ws.ping,
    uptime: Math.floor(process.uptime()),
    ticketsOuverts: Object.keys(tickets).length,
    giveawaysActifs: Object.values(giveaways).filter(g => !g.ended).length,
    warnsTotal: Object.values(warns).reduce((sum, arr) => sum + arr.length, 0),
    candValidees: candHistory.filter(h => h.result === 'validee').length,
    candRefusees: candHistory.filter(h => h.result === 'refusee').length,
  });
});

app.get('/api/settings', authRequis, (req, res) => {
  res.json({
    autoRoleIds: config.autoRoleIds || [],
    welcomeChannelId: config.welcomeChannelId,
    welcomeMessage: config.welcomeMessage,
    ticketStaffChannelId: config.ticketStaffChannelId,
    ticketLogsChannelId: config.ticketLogsChannelId,
    modLogsChannelId: config.modLogsChannelId,
    leaveLogsChannelId: config.leaveLogsChannelId,
    ticketAutoCloseHours: config.ticketAutoCloseHours || 0,
    ticketStaffRoleIds: config.ticketStaffRoleIds || [],
    ticketTranscriptChannelId: config.ticketTranscriptChannelId || null,
    ticketSendTranscriptToUser: config.ticketSendTranscriptToUser || false,
    ticketTranscriptFormat: config.ticketTranscriptFormat || 'both',
    ticketLogsEnabled: config.ticketLogsEnabled !== undefined ? config.ticketLogsEnabled : true,
  });
});

app.post('/api/settings', authRequis, (req, res) => {
  const { autoRoleIds, welcomeChannelId, welcomeMessage, ticketStaffChannelId, ticketLogsChannelId, modLogsChannelId, leaveLogsChannelId, ticketAutoCloseHours, ticketStaffRoleIds, ticketTranscriptChannelId, ticketSendTranscriptToUser, ticketTranscriptFormat, ticketLogsEnabled } = req.body;
  if (autoRoleIds !== undefined) config.autoRoleIds = Array.isArray(autoRoleIds) ? autoRoleIds : [];
  if (welcomeChannelId !== undefined) config.welcomeChannelId = welcomeChannelId;
  if (welcomeMessage !== undefined) config.welcomeMessage = welcomeMessage;
  if (ticketStaffChannelId !== undefined) config.ticketStaffChannelId = ticketStaffChannelId;
  if (ticketLogsChannelId !== undefined) config.ticketLogsChannelId = ticketLogsChannelId;
  if (modLogsChannelId !== undefined) config.modLogsChannelId = modLogsChannelId;
  if (leaveLogsChannelId !== undefined) config.leaveLogsChannelId = leaveLogsChannelId;
  if (ticketAutoCloseHours !== undefined) config.ticketAutoCloseHours = parseFloat(ticketAutoCloseHours) || 0;
  if (ticketStaffRoleIds !== undefined) config.ticketStaffRoleIds = Array.isArray(ticketStaffRoleIds) ? ticketStaffRoleIds : [];
  if (ticketTranscriptChannelId !== undefined) config.ticketTranscriptChannelId = ticketTranscriptChannelId;
  if (ticketSendTranscriptToUser !== undefined) config.ticketSendTranscriptToUser = !!ticketSendTranscriptToUser;
  if (ticketTranscriptFormat !== undefined) config.ticketTranscriptFormat = ticketTranscriptFormat;
  if (ticketLogsEnabled !== undefined) config.ticketLogsEnabled = !!ticketLogsEnabled;
  sauverConfig();
  res.json({ succes: true });
});

app.get('/api/settings/candidatures', authRequis, (req, res) => {
  res.json(config.candidatures || { ...CANDIDATURES_DEFAUT });
});

app.post('/api/settings/candidatures', authRequis, (req, res) => {
  const data = req.body;
  config.candidatures = { ...CANDIDATURES_DEFAUT, ...config.candidatures, ...data };
  if (!Array.isArray(config.candidatures.rolesValid)) config.candidatures.rolesValid = [];
  if (!Array.isArray(config.candidatures.rolesRefus)) config.candidatures.rolesRefus = [];
  if (!Array.isArray(config.candidatures.rolesAttribution)) config.candidatures.rolesAttribution = [];
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

// ---- Routes pour les tickets (adaptées aux salons) ----
app.get('/api/tickets', authRequis, (req, res) => {
  const liste = Object.entries(tickets).map(([userId, t]) => ({
    userId, username: t.username, number: t.number, claimedBy: t.claimedBy,
    priority: t.priority, note: t.note || '', lastActivity: t.lastActivity, channelId: t.channelId,
    categoryId: t.categoryId,
  }));
  res.json(liste);
});

app.post('/api/tickets/:userId/reply', authRequis, async (req, res) => {
  const { userId } = req.params;
  const { message } = req.body;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  try {
    const channel = await client.channels.fetch(ticket.channelId);
    await channel.send({ content: `**${req.session.user.username} (Panel)** :\n${message}` });
    const user = await client.users.fetch(userId);
    await user.send({ content: `**${req.session.user.username} (Staff)** :\n${message}` }).catch(() => {});
    ticket.lastActivity = new Date().toISOString();
    sauverTickets();
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur réponse ticket:', e);
    res.status(500).json({ erreur: 'Erreur lors de l\'envoi' });
  }
});

app.post('/api/tickets/:userId/note', authRequis, (req, res) => {
  const { userId } = req.params;
  const { note } = req.body;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  ticket.note = note;
  sauverTickets();
  res.json({ succes: true });
});

app.post('/api/tickets/:userId/close', authRequis, async (req, res) => {
  const { userId } = req.params;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  try {
    await fermerTicketParSalon(ticket.channelId, req.session.user.username);
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur fermeture ticket:', e);
    res.status(500).json({ erreur: 'Erreur lors de la fermeture' });
  }
});

// ---- Routes pour les catégories de tickets ----
app.get('/api/ticket-categories', authRequis, (req, res) => {
  res.json(config.ticketCategories || []);
});

app.post('/api/ticket-categories', authRequis, (req, res) => {
  const { name, emoji, active, destinationCategoryId, channelNameFormat, autoReplyEmbed } = req.body;
  if (!name || !destinationCategoryId) {
    return res.status(400).json({ erreur: 'Nom et catégorie Discord requis' });
  }
  const newCategory = {
    id: name.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-' + Date.now().toString(36),
    name,
    emoji: emoji || '📌',
    active: active !== undefined ? !!active : true,
    destinationCategoryId,
    channelNameFormat: channelNameFormat || `${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-{number}`,
    autoReplyEmbed: autoReplyEmbed || { title: '✅ Ticket créé', description: 'Votre message a bien été reçu.', color: '#5865F2' }
  };
  config.ticketCategories.push(newCategory);
  sauverConfig();
  res.json({ succes: true, category: newCategory });
});

app.put('/api/ticket-categories/:id', authRequis, (req, res) => {
  const { id } = req.params;
  const { name, emoji, active, destinationCategoryId, channelNameFormat, autoReplyEmbed } = req.body;
  const index = config.ticketCategories.findIndex(c => c.id === id);
  if (index === -1) return res.status(404).json({ erreur: 'Catégorie introuvable' });
  const cat = config.ticketCategories[index];
  if (name !== undefined) cat.name = name;
  if (emoji !== undefined) cat.emoji = emoji;
  if (active !== undefined) cat.active = !!active;
  if (destinationCategoryId !== undefined) cat.destinationCategoryId = destinationCategoryId;
  if (channelNameFormat !== undefined) cat.channelNameFormat = channelNameFormat;
  if (autoReplyEmbed !== undefined) cat.autoReplyEmbed = autoReplyEmbed;
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

// ---- Giveaways (inchangé) ----
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
    planifierFinGiveaway(giveaways[id]);
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

// ---- Embed (inchangé) ----
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

// ---- Backup (inchangé) ----
app.get('/api/backup', authRequis, (req, res) => {
  const backup = { config, tickets, giveaways, closedTickets, warns, candHistory, date: new Date().toISOString() };
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
    if (data.closedTickets) { closedTickets = data.closedTickets; sauverClosedTickets(); }
    if (data.warns) { warns = data.warns; sauverWarns(); }
    if (data.candHistory) { candHistory = data.candHistory; sauverCandHistory(); }
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur import backup:', e);
    res.status(500).json({ erreur: 'Erreur lors de l\'import' });
  }
});

// ---- Routes pour les salons et rôles (inchangé) ----
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

// ---- Démarrage du serveur Express ----
server.listen(PORT, () => {
  console.log(`✅ Serveur web + bot actif sur le port ${PORT}`);
});

// ---- Connexion à Discord avec gestion d'erreur ----
client.login(TOKEN).catch(error => {
  console.error('❌ Échec de la connexion à Discord :', error);
  console.error('👉 Vérifie ton TOKEN, CLIENT_ID, GUILD_ID et les intents Discord.');
  process.exit(1);
});

// ---- Gestion des erreurs non capturées ----
process.on('unhandledRejection', error => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Uncaught Exception:', error);
});

// ---- Nettoyage à l'arrêt ----
let cleanupDone = false;
function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log('🛑 Arrêt en cours...');
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
