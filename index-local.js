// index.js – Bot Discord + API REST pour panel RP (sans EMS)
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
});

config.candidatures = { ...CANDIDATURES_DEFAUT, ...(config.candidatures || {}) };
if (!Array.isArray(config.candidatures.rolesValid)) config.candidatures.rolesValid = [];
if (!Array.isArray(config.candidatures.rolesRefus)) config.candidatures.rolesRefus = [];
if (!Array.isArray(config.candidatures.rolesAttribution)) config.candidatures.rolesAttribution = [];
if (!Array.isArray(config.autoRoleIds)) config.autoRoleIds = [];

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

function trouverUserIdParThread(threadId) {
  for (const [userId, t] of Object.entries(tickets)) {
    if (t.threadId === threadId) return userId;
  }
  return null;
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

// ---- Fonctions Tickets ----
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
    new ButtonBuilder().setCustomId('ticket_delete').setLabel('Supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
  );
  return [ligne1, ligne2];
}

function boutonReprise() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reprendre le ticket').setEmoji('♻️').setStyle(ButtonStyle.Success)
  );
}

async function genererTranscriptHTML(thread) {
  let toutMessages = [];
  let avant = undefined;
  for (let i = 0; i < 10; i++) {
    const lot = await thread.messages.fetch({ limit: 100, before: avant });
    if (!lot.size) break;
    toutMessages.push(...lot.values());
    avant = lot.last().id;
    if (lot.size < 100) break;
  }
  toutMessages.reverse();

  const echapper = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const guild = client.guilds.cache.get(GUILD_ID);
  const guildIcon = guild?.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
  const user = await client.users.fetch(thread.ownerId).catch(() => null);

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
<title>Transcript - ${echapper(thread.name)}</title>
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
    <h1>🎫 Transcript — ${echapper(thread.name)}</h1>
    <p>Généré le ${new Date().toLocaleString('fr-FR')} — ${toutMessages.length} message(s)</p>
    ${lignes || '<p><i>Aucun message.</i></p>'}
  </div>
</body></html>`;
}

function getSalonLogsTickets() { return config.ticketLogsChannelId || config.ticketStaffChannelId; }

async function envoyerLogTicket(embed, fichier) {
  const salonId = getSalonLogsTickets();
  if (!salonId) return;
  const salon = await client.channels.fetch(salonId).catch(() => null);
  if (!salon) return;
  const options = { embeds: [embed] };
  if (fichier) options.files = [fichier];
  await salon.send(options).catch(() => {});
}

async function envoyerTranscript(thread, titreLog, description) {
  const html = await genererTranscriptHTML(thread);
  const buffer = Buffer.from(html, 'utf8');
  const nomFichier = `transcript-${thread.name}.html`.replace(/[^a-zA-Z0-9-_.]/g, '_');
  const embed = new EmbedBuilder()
    .setColor(COULEUR_EMBED)
    .setTitle(titreLog)
    .setDescription(description)
    .setTimestamp();
  await envoyerLogTicket(embed, { attachment: buffer, name: nomFichier });
  return { buffer, nomFichier };
}

async function fermerTicketParThread(threadId, fermePar) {
  const userId = trouverUserIdParThread(threadId);
  const thread = await client.channels.fetch(threadId).catch(() => null);
  const infosTicket = userId ? tickets[userId] : null;

  if (thread) {
    await envoyerTranscript(
      thread,
      '📄 Transcript — Ticket fermé',
      `Ticket **#${infosTicket?.number || '?'}** fermé par **${fermePar}**.`
    ).catch(() => {});
    await thread.send({
      embeds: [new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle('🔒 Ticket fermé')
        .setDescription(`Fermé par **${fermePar}**.\nLe transcript a été envoyé dans le salon de logs.`)
        .setTimestamp()
      ],
      components: [boutonReprise()],
    }).catch(() => {});
    await thread.setName(`Fermé - ${thread.name}`.slice(0, 100)).catch(() => {});
    await thread.setArchived(false).catch(() => {});
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});
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
    if (thread && infosTicket) {
      closedTickets[thread.id] = { userId, username: infosTicket.username, number: infosTicket.number, closedAt: new Date().toISOString() };
      sauverClosedTickets();
    }
    delete tickets[userId];
    sauverTickets();
  }
}

async function reouvrirTicketParThread(threadId, rouvertPar) {
  const infos = closedTickets[threadId];
  if (!infos) throw new Error('Aucun ticket fermé trouvé pour ce fil.');

  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread) throw new Error('Fil introuvable.');

  await thread.setArchived(false).catch(() => {});
  await thread.setLocked(false).catch(() => {});
  const nomOriginal = thread.name.replace(/^Fermé - /, '');
  await thread.setName(nomOriginal.slice(0, 100)).catch(() => {});

  tickets[infos.userId] = {
    threadId,
    username: infos.username,
    number: infos.number,
    claimedBy: null,
    priority: 'normale',
    note: '',
    lastActivity: new Date().toISOString(),
  };
  sauverTickets();
  delete closedTickets[threadId];
  sauverClosedTickets();

  await thread.send({
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
  return thread;
}

async function obtenirOuCreerThread(user) {
  if (!config.ticketStaffChannelId) throw new Error('Salon staff tickets non configuré');
  const staffChannel = await client.channels.fetch(config.ticketStaffChannelId).catch(() => null);
  if (!staffChannel) throw new Error('Salon staff tickets introuvable');

  const existant = tickets[user.id];
  if (existant) {
    const thread = await client.channels.fetch(existant.threadId).catch(() => null);
    if (thread) {
      if (thread.archived) await thread.setArchived(false).catch(() => {});
      return { thread, nouveau: false };
    }
  }

  const numero = prochainNumeroTicket();
  const thread = await staffChannel.threads.create({
    name: `ticket-${numero}`,
    autoArchiveDuration: 10080,
    type: ChannelType.PublicThread,
    reason: `Nouveau ticket de ${user.tag}`,
  });

  tickets[user.id] = {
    threadId: thread.id,
    username: user.username,
    number: numero,
    claimedBy: null,
    priority: 'normale',
    note: '',
    lastActivity: new Date().toISOString(),
  };
  sauverTickets();

  await thread.send({
    embeds: [new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`🎫 Nouveau ticket #${numero}`)
      .setDescription(`Ouvert par **${user.tag}** (\`${user.id}\`)\n\nRépondez directement dans ce fil.`)
      .setTimestamp()
    ],
    components: boutonsTicket(),
  });

  await envoyerLogTicket(
    new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle('🎫 Ticket créé')
      .setDescription(`Ticket **#${numero}** ouvert par **${user.tag}** (\`${user.id}\`).`)
      .setTimestamp()
  );

  return { thread, nouveau: true };
}

// ---- Giveaways ----
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

// ---- Auto-fermeture tickets ----
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
      await fermerTicketParThread(t.threadId, 'Système (auto-fermeture inactivité)').catch(e => console.error('Erreur auto-fermeture:', e));
    }
  }
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
  new SlashCommandBuilder().setName('reopen').setDescription('Rouvrir un ticket fermé (à utiliser dans le fil fermé)'),
  new SlashCommandBuilder().setName('transcript').setDescription('Générer le transcript HTML du ticket en cours'),
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

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // DM → Ticket
  if (message.channel.type === ChannelType.DM) {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) { await message.author.send('❌ Le bot n\'est pas sur le serveur.'); return; }
      const member = await guild.members.fetch(message.author.id).catch(() => null);
      if (!member) { await message.author.send('❌ Tu n\'es pas membre du serveur.'); return; }

      const { thread, nouveau } = await obtenirOuCreerThread(message.author);
      await thread.send({
        content: `**${message.author.tag}** :\n${message.content || '*(pièce jointe / message vide)*'}`,
        files: [...message.attachments.values()],
      });

      if (tickets[message.author.id]) {
        tickets[message.author.id].lastActivity = new Date().toISOString();
        sauverTickets();
      }

      if (nouveau) {
        await message.author.send({
          embeds: [new EmbedBuilder()
            .setColor(COULEUR_EMBED)
            .setTitle('🎫 Ticket ouvert')
            .setDescription('Ton message a bien été transmis à l\'équipe. Tu peux continuer à écrire ici.')
            .setTimestamp()
          ]
        }).catch(() => {});
      }
    } catch (e) {
      console.error('Erreur DM->ticket:', e);
      await message.author.send('⚠️ Le système de tickets n\'est pas encore configuré.').catch(() => {});
    }
    return;
  }

  // Threads de tickets → DM
  if (message.channel.isThread && message.channel.isThread()) {
    if (message.channel.parentId !== config.ticketStaffChannelId) return;
    const userId = trouverUserIdParThread(message.channel.id);
    if (!userId) return;
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        content: message.content || undefined,
        files: [...message.attachments.values()],
      });
      if (tickets[userId]) {
        tickets[userId].lastActivity = new Date().toISOString();
        sauverTickets();
      }
    } catch (e) {
      console.error('Erreur thread->DM:', e);
      await message.reply('⚠️ Impossible d\'envoyer le DM (DMs fermés ?).');
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
    // ---- BOUTONS TICKET ----
    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (['ticket_claim', 'ticket_unclaim', 'ticket_rename', 'ticket_add', 'ticket_remove', 'ticket_transcript', 'ticket_close', 'ticket_delete', 'ticket_reopen'].includes(customId)) {
        if (!interaction.channel.isThread() || interaction.channel.parentId !== config.ticketStaffChannelId) {
          return interaction.reply({ content: '❌ Cette commande n\'est disponible que dans un ticket.', flags: 64 });
        }
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
        const ticket = tickets[userId];
        if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });

        if (customId === 'ticket_claim') {
          if (ticket.claimedBy) return interaction.reply({ content: `❌ Ce ticket est déjà pris par <@${ticket.claimedBy}>.`, flags: 64 });
          ticket.claimedBy = interaction.user.id;
          sauverTickets();
          await interaction.reply({ content: `✅ Tu as pris en charge le ticket #${ticket.number}.`, flags: 64 });
          await interaction.channel.send({ content: `🙋 <@${interaction.user.id}> a pris en charge le ticket.` });
        } else if (customId === 'ticket_unclaim') {
          if (!ticket.claimedBy) return interaction.reply({ content: '❌ Ce ticket n\'est pas pris en charge.', flags: 64 });
          if (ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Tu n\'as pas pris ce ticket.', flags: 64 });
          }
          ticket.claimedBy = null;
          sauverTickets();
          await interaction.reply({ content: `✅ Ticket #${ticket.number} libéré.`, flags: 64 });
          await interaction.channel.send({ content: `🙅 <@${interaction.user.id}> a libéré le ticket.` });
        } else if (customId === 'ticket_rename') {
          const modal = new ModalBuilder().setCustomId('ticket_rename_modal').setTitle('Renommer le ticket');
          const input = new TextInputBuilder().setCustomId('new_name').setLabel('Nouveau nom').setStyle(TextInputStyle.Short).setValue(interaction.channel.name);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await interaction.showModal(modal);
        } else if (customId === 'ticket_add') {
          const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('ticket_add_user').setPlaceholder('Choisis un membre à ajouter')
          );
          await interaction.reply({ content: 'Sélectionne le membre à ajouter :', components: [row], flags: 64 });
        } else if (customId === 'ticket_remove') {
          const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder().setCustomId('ticket_remove_user').setPlaceholder('Choisis un membre à retirer')
          );
          await interaction.reply({ content: 'Sélectionne le membre à retirer :', components: [row], flags: 64 });
        } else if (customId === 'ticket_transcript') {
          await interaction.deferReply({ flags: 64 });
          await envoyerTranscript(interaction.channel, '📄 Transcript du ticket', `Ticket **#${ticket.number}** demandé par **${interaction.user.tag}**.`);
          await interaction.editReply({ content: '✅ Le transcript a été envoyé dans le salon de logs.' });
        } else if (customId === 'ticket_close') {
          await fermerTicketParThread(interaction.channel.id, interaction.user.tag);
          await interaction.reply({ content: '🔒 Ticket fermé.', flags: 64 });
        } else if (customId === 'ticket_delete') {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Seuls les administrateurs peuvent supprimer un ticket.', flags: 64 });
          }
          await interaction.reply({ content: '🗑️ Suppression du ticket...', flags: 64 });
          await interaction.channel.delete().catch(() => {});
          if (userId) { delete tickets[userId]; sauverTickets(); }
        } else if (customId === 'ticket_reopen') {
          await interaction.deferReply({ flags: 64 });
          await reouvrirTicketParThread(interaction.channel.id, interaction.user.tag);
          await interaction.editReply({ content: '♻️ Ticket rouvert !' });
        }
        return;
      }
    }

    // ---- USER SELECT MENUS ----
    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'ticket_add_user') {
        const user = interaction.users.first();
        if (!user) return interaction.update({ content: '❌ Aucun membre sélectionné.', components: [] });
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });
        try {
          await interaction.channel.members.add(user.id);
          await interaction.update({ content: `✅ ${user.tag} a été ajouté au ticket.`, components: [] });
          await interaction.channel.send({ content: `➕ <@${user.id}> a été ajouté au ticket par <@${interaction.user.id}>.` });
        } catch (e) { await interaction.update({ content: `❌ Échec : ${e.message}`, components: [] }); }
        return;
      }
      if (interaction.customId === 'ticket_remove_user') {
        const user = interaction.users.first();
        if (!user) return interaction.update({ content: '❌ Aucun membre sélectionné.', components: [] });
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.update({ content: '❌ Ticket introuvable.', components: [] });
        try {
          await interaction.channel.members.remove(user.id);
          await interaction.update({ content: `✅ ${user.tag} a été retiré du ticket.`, components: [] });
          await interaction.channel.send({ content: `➖ <@${user.id}> a été retiré du ticket par <@${interaction.user.id}>.` });
        } catch (e) { await interaction.update({ content: `❌ Échec : ${e.message}`, components: [] }); }
        return;
      }
    }

    // ---- MODAL TICKET RENAME ----
    if (interaction.isModalSubmit() && interaction.customId === 'ticket_rename_modal') {
      const newName = interaction.fields.getTextInputValue('new_name');
      await interaction.channel.setName(newName.slice(0, 100)).catch(() => {});
      await interaction.reply({ content: `✅ Ticket renommé en **${newName}**.`, flags: 64 });
      return;
    }

    // ---- COMMANDES SLASH ----
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;
      const opts = interaction.options;

      // Tickets
      if (['rename', 'claim', 'unclaim', 'add', 'remove', 'priority', 'reopen', 'transcript'].includes(cmd)) {
        if (!interaction.channel.isThread() || interaction.channel.parentId !== config.ticketStaffChannelId) {
          return interaction.reply({ content: '❌ Cette commande n\'est disponible que dans un ticket.', flags: 64 });
        }
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });
        const ticket = tickets[userId];
        if (!ticket) return interaction.reply({ content: '❌ Ticket introuvable.', flags: 64 });

        if (cmd === 'rename') {
          const nouveauNom = opts.getString('nom');
          await interaction.channel.setName(nouveauNom.slice(0, 100)).catch(() => {});
          await interaction.reply({ content: `✅ Ticket renommé en **${nouveauNom}**.`, flags: 64 });
        } else if (cmd === 'claim') {
          if (ticket.claimedBy) return interaction.reply({ content: `❌ Déjà pris par <@${ticket.claimedBy}>.`, flags: 64 });
          ticket.claimedBy = interaction.user.id;
          sauverTickets();
          await interaction.reply({ content: `✅ Tu as pris en charge le ticket #${ticket.number}.`, flags: 64 });
          await interaction.channel.send({ content: `🙋 <@${interaction.user.id}> a pris en charge le ticket.` });
        } else if (cmd === 'unclaim') {
          if (!ticket.claimedBy) return interaction.reply({ content: '❌ Pas pris en charge.', flags: 64 });
          if (ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Tu n\'as pas pris ce ticket.', flags: 64 });
          }
          ticket.claimedBy = null;
          sauverTickets();
          await interaction.reply({ content: `✅ Ticket #${ticket.number} libéré.`, flags: 64 });
          await interaction.channel.send({ content: `🙅 <@${interaction.user.id}> a libéré le ticket.` });
        } else if (cmd === 'add') {
          const membre = opts.getUser('membre');
          try {
            await interaction.channel.members.add(membre.id);
            await interaction.reply({ content: `✅ ${membre.tag} ajouté.`, flags: 64 });
            await interaction.channel.send({ content: `➕ <@${membre.id}> ajouté par <@${interaction.user.id}>.` });
          } catch (e) { await interaction.reply({ content: `❌ Échec : ${e.message}`, flags: 64 }); }
        } else if (cmd === 'remove') {
          const membre = opts.getUser('membre');
          try {
            await interaction.channel.members.remove(membre.id);
            await interaction.reply({ content: `✅ ${membre.tag} retiré.`, flags: 64 });
            await interaction.channel.send({ content: `➖ <@${membre.id}> retiré par <@${interaction.user.id}>.` });
          } catch (e) { await interaction.reply({ content: `❌ Échec : ${e.message}`, flags: 64 }); }
        } else if (cmd === 'priority') {
          const niveau = opts.getString('niveau');
          ticket.priority = niveau;
          sauverTickets();
          const emojis = { basse: '🟢', normale: '🟡', haute: '🟠', urgente: '🔴' };
          await interaction.reply({ content: `✅ Priorité définie sur **${emojis[niveau] || ''} ${niveau}**.`, flags: 64 });
        } else if (cmd === 'reopen') {
          await interaction.deferReply({ flags: 64 });
          const closedInfo = closedTickets[interaction.channel.id];
          if (!closedInfo) return interaction.editReply({ content: '❌ Ce ticket n\'est pas fermé ou n\'existe pas dans les archives.' });
          await reouvrirTicketParThread(interaction.channel.id, interaction.user.tag);
          await interaction.editReply({ content: '♻️ Ticket rouvert !' });
        } else if (cmd === 'transcript') {
          await interaction.deferReply({ flags: 64 });
          await envoyerTranscript(interaction.channel, '📄 Transcript du ticket', `Ticket **#${ticket.number}** demandé par **${interaction.user.tag}**.`);
          await interaction.editReply({ content: '✅ Le transcript a été envoyé dans le salon de logs.' });
        }
        return;
      }

      // Modération
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
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads)) {
            return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
          }
          if (channel.isThread()) await channel.setLocked(true);
          else await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: false });
          await interaction.reply({ content: '🔒 Salon verrouillé.', flags: 64 });
        } else if (cmd === 'unlock') {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads)) {
            return interaction.reply({ content: '❌ Permission manquante.', flags: 64 });
          }
          if (channel.isThread()) await channel.setLocked(false);
          else await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: null });
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

      // Candidatures
      if (['valid', 'refuser'].includes(cmd)) {
        if (!interaction.channel.isThread() || interaction.channel.parentId !== config.ticketStaffChannelId) {
          return interaction.reply({ content: '❌ Cette commande n\'est disponible que dans un ticket.', flags: 64 });
        }
        const userId = trouverUserIdParThread(interaction.channel.id);
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
            setTimeout(() => fermerTicketParThread(interaction.channel.id, 'Auto-fermeture après validation'), delai * 1000);
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
            setTimeout(() => fermerTicketParThread(interaction.channel.id, 'Auto-fermeture après refus'), delai * 1000);
          }
          await interaction.reply({ content: '❌ Candidature refusée.', flags: 64 });
        }
        return;
      }

      // Warn / Warns
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
      }),
    });
    
const tokenData = await tokenRes.json();
    console.error('Réponse Discord OAuth:', tokenData);
    if (!tokenData.access_token) throw new Error('Pas de token');
    
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
    console.error('Erreur OAuth:', e);
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
  });
});

app.post('/api/settings', authRequis, (req, res) => {
  const { autoRoleIds, welcomeChannelId, welcomeMessage, ticketStaffChannelId, ticketLogsChannelId, modLogsChannelId, leaveLogsChannelId, ticketAutoCloseHours } = req.body;
  if (autoRoleIds !== undefined) config.autoRoleIds = Array.isArray(autoRoleIds) ? autoRoleIds : [];
  if (welcomeChannelId !== undefined) config.welcomeChannelId = welcomeChannelId;
  if (welcomeMessage !== undefined) config.welcomeMessage = welcomeMessage;
  if (ticketStaffChannelId !== undefined) config.ticketStaffChannelId = ticketStaffChannelId;
  if (ticketLogsChannelId !== undefined) config.ticketLogsChannelId = ticketLogsChannelId;
  if (modLogsChannelId !== undefined) config.modLogsChannelId = modLogsChannelId;
  if (leaveLogsChannelId !== undefined) config.leaveLogsChannelId = leaveLogsChannelId;
  if (ticketAutoCloseHours !== undefined) config.ticketAutoCloseHours = parseFloat(ticketAutoCloseHours) || 0;
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

app.get('/api/tickets', authRequis, (req, res) => {
  const liste = Object.entries(tickets).map(([userId, t]) => ({
    userId, username: t.username, number: t.number, claimedBy: t.claimedBy,
    priority: t.priority, note: t.note || '', lastActivity: t.lastActivity, threadId: t.threadId,
  }));
  res.json(liste);
});

app.post('/api/tickets/:userId/reply', authRequis, async (req, res) => {
  const { userId } = req.params;
  const { message } = req.body;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: 'Ticket introuvable' });
  try {
    const thread = await client.channels.fetch(ticket.threadId);
    await thread.send({ content: `**${req.session.user.username} (Panel)** :\n${message}` });
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
    await fermerTicketParThread(ticket.threadId, req.session.user.username);
    res.json({ succes: true });
  } catch (e) {
    console.error('Erreur fermeture ticket:', e);
    res.status(500).json({ erreur: 'Erreur lors de la fermeture' });
  }
});

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

// ---- Gestion des erreurs Express ----
app.use((err, req, res, next) => {
  console.error('❌ Erreur Express:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ erreur: 'Erreur upload: ' + err.message });
  }
  res.status(500).json({ erreur: 'Erreur serveur interne' });
});

// ---- Démarrage ----
server.listen(PORT, () => console.log(`✅ Serveur web + bot actif sur le port ${PORT}`));

// Gestion des signaux d'arrêt
process.on('unhandledRejection', error => console.error('❌ Unhandled Rejection:', error));
process.on('uncaughtException', error => console.error('❌ Uncaught Exception:', error));

// Nettoyage à l'arrêt
let cleanupDone = false;
function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  console.log('🛑 Arrêt en cours...');
  // Pas de timers persistants supplémentaires
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
