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
  REST,
  Routes,
} = require("discord.js");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { trouverSituation } = require("./situations.js");

// Upload en mémoire
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ==============================
// CONFIGURATION
// ==============================
const TOKEN = process.env.TOKEN || "TON_TOKEN_DISCORD_ICI";
const CLIENT_ID = process.env.CLIENT_ID || "TON_CLIENT_ID_ICI";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "TON_CLIENT_SECRET_ICI";
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "https://TON-APP.onrender.com/callback";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-moi-en-prod";
const PORT = process.env.PORT || 3000;
const GUILD_ID = process.env.GUILD_ID || "TON_GUILD_ID_ICI";

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const REDIS_ACTIF = !!(UPSTASH_URL && UPSTASH_TOKEN);

const ROLES_AUTORISES = ["1524935532914933837", "1524975599460814888"];

const NOM_SERVEUR = "EMS";
const COULEUR_EMBED = "#ff2d78";

// ==============================
// STOCKAGE
// ==============================
const DATA_DIR = __dirname;
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const GIVEAWAYS_FILE = path.join(DATA_DIR, "giveaways.json");
const CLOSED_TICKETS_FILE = path.join(DATA_DIR, "closed-tickets.json");
const WARNS_FILE = path.join(DATA_DIR, "warns.json");
const CAND_HISTORY_FILE = path.join(DATA_DIR, "candidatures-history.json");
const INTERVENTIONS_FILE = path.join(DATA_DIR, "interventions.json");
const XP_FILE = path.join(DATA_DIR, "xp_data.json");
const GRADES_FILE = path.join(DATA_DIR, "grades.json");
const XP_LOGS_FILE = path.join(DATA_DIR, "xp_logs.json");
const SERVICE_FILE = path.join(DATA_DIR, "service.json");

// ==============================
// SYSTÈME DE GRADES & XP
// ==============================
const GRADES_DEFAUT = {
  grades: [
    { id: "stagiaire", name: "Stagiaire EMS", level: 1, xpRequired: 0, icon: "🟢", color: "#34d399", perks: [], notifications: true },
    { id: "ambulancier", name: "Ambulancier", level: 2, xpRequired: 100, icon: "🚑", color: "#3b82f6", perks: ["Accès interventions"], notifications: true },
    { id: "infirmier", name: "Infirmier d'urgence", level: 3, xpRequired: 300, icon: "💉", color: "#8b5cf6", perks: ["Peut valider des rapports"], notifications: true },
    { id: "medecin", name: "Médecin urgentiste", level: 4, xpRequired: 800, icon: "⚕️", color: "#f59e0b", perks: ["Peut former"], notifications: true },
    { id: "chef_service", name: "Chef de service", level: 5, xpRequired: 2000, icon: "⭐", color: "#ef4444", perks: ["Gestion d'équipe"], notifications: true }
  ],
  settings: {
    xpPerMinute: 1,
    xpPerIntervention: 50,
    xpPerMessage: 0.5,
    xpPerVoiceMinute: 2,
    xpPerWarn: -25,
    xpPerKick: -50,
    xpPerBan: -100,
    xpBoosts: { weekend: 1.5, event: 2.0 },
    cooldowns: { message: 60, voice: 300 },
    notifications: true,
    levelUpMessage: "🎉 Félicitations {user} ! Tu es passé **{grade}** (Niveau {level}) !",
    xpMessage: "📊 {user} - Niveau {level} | {xp}/{nextXp} XP | Grade : {grade}"
  }
};

function lire(fichier, defaut) {
  try {
    return JSON.parse(fs.readFileSync(fichier, "utf8"));
  } catch {
    return defaut;
  }
}
function ecrire(fichier, data) {
  try {
    fs.writeFileSync(fichier, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Erreur écriture ${fichier}:`, e);
  }
  redisSet(path.basename(fichier, ".json"), data);
}

async function redisGet(cle) {
  if (!REDIS_ACTIF) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${cle}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await res.json();
    return data && data.result ? JSON.parse(data.result) : null;
  } catch (e) {
    console.error(`Erreur lecture Redis (${cle}):`, e.message);
    return null;
  }
}

async function redisSet(cle, valeur) {
  if (!REDIS_ACTIF) return;
  try {
    await fetch(`${UPSTASH_URL}/set/${cle}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      body: JSON.stringify(valeur),
    });
  } catch (e) {
    console.error(`Erreur écriture Redis (${cle}):`, e.message);
  }
}

const CANDIDATURES_DEFAUT = {
  actif: false,
  salonValidation: null,
  salonRefus: null,
  roleValid: null,
  roleRefus: null,
  roleAValider: null,
  mpActif: true,
  mentionUser: true,
  fermetureAuto: false,
  fermetureDelai: 10,
  messageValidation: "✅ {mention} Ta candidature (**{ticket}**) a été **validée** par {staff}.",
  messageRefus: "❌ {mention} Ta candidature (**{ticket}**) a été **refusée** par {staff}.",
  mpValidation: "Bonjour **{username}**,\nTa candidature sur **{server}** a été **validée** par {staff}.\n📅 {date}",
  mpRefus: "Bonjour **{username}**,\nTa candidature sur **{server}** a été **refusée** par {staff}.\n📅 {date}",
};

let config = lire(CONFIG_FILE, {
  autoRoleId: null,
  welcomeChannelId: null,
  welcomeMessage: "Bienvenue {user} sur **{server}** ! Tu es le membre **#{count}**.",
  ticketStaffChannelId: null,
  ticketLogsChannelId: null,
  modLogsChannelId: null,
  interventionsChannelId: null,
  ticketAutoCloseHours: 0,
  ticketCounter: 0,
  serviceChannelId: null,
  serviceMessageId: null,
  candidatures: { ...CANDIDATURES_DEFAUT },
});

config.candidatures = { ...CANDIDATURES_DEFAUT, ...(config.candidatures || {}) };
if (config.modLogsChannelId === undefined) config.modLogsChannelId = null;
if (config.ticketAutoCloseHours === undefined) config.ticketAutoCloseHours = 0;
if (config.interventionsChannelId === undefined) config.interventionsChannelId = null;
if (config.serviceChannelId === undefined) config.serviceChannelId = null;
if (config.serviceMessageId === undefined) config.serviceMessageId = null;

let tickets = lire(TICKETS_FILE, {});
let giveaways = lire(GIVEAWAYS_FILE, {});
let closedTickets = lire(CLOSED_TICKETS_FILE, {});
let warns = lire(WARNS_FILE, {});
let candHistory = lire(CAND_HISTORY_FILE, []);
let interventions = lire(INTERVENTIONS_FILE, []);
let xpData = lire(XP_FILE, {});
let gradesConfig = lire(GRADES_FILE, GRADES_DEFAUT);
let xpLogs = lire(XP_LOGS_FILE, []);
let serviceData = lire(SERVICE_FILE, {});

function sauverConfig() { ecrire(CONFIG_FILE, config); }
function sauverTickets() { ecrire(TICKETS_FILE, tickets); }
function sauverGiveaways() { ecrire(GIVEAWAYS_FILE, giveaways); }
function sauverClosedTickets() { ecrire(CLOSED_TICKETS_FILE, closedTickets); }
function sauverWarns() { ecrire(WARNS_FILE, warns); }
function sauverCandHistory() { ecrire(CAND_HISTORY_FILE, candHistory); }
function sauverInterventions() { ecrire(INTERVENTIONS_FILE, interventions); }
function sauverXp() { ecrire(XP_FILE, xpData); }
function sauverGrades() { ecrire(GRADES_FILE, gradesConfig); }
function sauverXpLogs() { ecrire(XP_LOGS_FILE, xpLogs); }
function sauverService() { ecrire(SERVICE_FILE, serviceData); }

// ==============================
// FONCTIONS XP
// ==============================
function getGradeForXp(xp) {
  const sorted = [...gradesConfig.grades].sort((a, b) => b.xpRequired - a.xpRequired);
  for (const grade of sorted) {
    if (xp >= grade.xpRequired) return grade;
  }
  return sorted[sorted.length - 1];
}

function getLevelFromXp(xp) {
  let level = 1;
  let xpNeeded = 100;
  let totalXp = 0;
  while (totalXp + xpNeeded <= xp) {
    totalXp += xpNeeded;
    level++;
    xpNeeded = Math.floor(xpNeeded * 1.2);
  }
  return { level, currentXp: xp - totalXp, nextXp: xpNeeded };
}

function logXp(userId, username, amount, type, reason) {
  xpLogs.unshift({
    userId,
    username,
    amount,
    type,
    reason: reason || '',
    date: new Date().toISOString()
  });
  if (xpLogs.length > 1000) xpLogs = xpLogs.slice(0, 1000);
  sauverXpLogs();
}

async function addXp(userId, amount, source, reason) {
  if (!xpData[userId]) {
    xpData[userId] = {
      xp: 0,
      serviceTime: 0,
      interventions: 0,
      messages: 0,
      voiceTime: 0,
      lastActivity: new Date().toISOString()
    };
  }
  
  const oldGrade = getGradeForXp(xpData[userId].xp);
  xpData[userId].xp = Math.max(0, (xpData[userId].xp || 0) + amount);
  xpData[userId].lastActivity = new Date().toISOString();
  
  if (source === 'intervention') xpData[userId].interventions = (xpData[userId].interventions || 0) + 1;
  if (source === 'message') xpData[userId].messages = (xpData[userId].messages || 0) + 1;
  if (source === 'voice') xpData[userId].voiceTime = (xpData[userId].voiceTime || 0) + Math.abs(amount) / 2;
  if (source === 'service') xpData[userId].serviceTime = (xpData[userId].serviceTime || 0) + Math.abs(amount);
  
  sauverXp();
  
  const user = await client.users.fetch(userId).catch(() => null);
  logXp(userId, user?.username || userId, amount, source, reason);
  
  const newGrade = getGradeForXp(xpData[userId].xp);
  if (newGrade.id !== oldGrade.id && gradesConfig.settings.notifications) {
    if (user) {
      const { level } = getLevelFromXp(xpData[userId].xp);
      const msg = gradesConfig.settings.levelUpMessage
        .replaceAll("{user}", `<@${userId}>`)
        .replaceAll("{grade}", newGrade.name)
        .replaceAll("{level}", level);
      await user.send(msg).catch(() => {});
    }
  }
  
  return { oldGrade, newGrade, xp: xpData[userId].xp };
}

// ==============================
// FONCTIONS SERVICE
// ==============================
function getServiceStatus(userId) {
  const data = serviceData[userId];
  if (!data || !data.active) return null;
  return data;
}

async function startService(userId) {
  const now = new Date();
  if (!serviceData[userId]) {
    serviceData[userId] = {
      totalTime: 0,
      sessions: [],
      active: false
    };
  }
  
  serviceData[userId].active = true;
  serviceData[userId].startTime = now.toISOString();
  serviceData[userId].sessionStart = now.toISOString();
  serviceData[userId].lastPing = now.toISOString();
  
  sauverService();
  return serviceData[userId];
}

async function stopService(userId) {
  const data = serviceData[userId];
  if (!data || !data.active) return null;
  
  const now = new Date();
  const start = new Date(data.startTime);
  const duration = Math.floor((now - start) / 1000); // en secondes
  
  data.active = false;
  data.endTime = now.toISOString();
  data.totalTime = (data.totalTime || 0) + duration;
  
  if (!data.sessions) data.sessions = [];
  data.sessions.push({
    start: data.startTime,
    end: now.toISOString(),
    duration: duration
  });
  
  sauverService();
  
  // Donner l'XP pour le temps de service
  const xpPerMinute = gradesConfig.settings.xpPerMinute || 1;
  const minutes = Math.floor(duration / 60);
  const xpGain = minutes * xpPerMinute;
  
  if (xpGain > 0) {
    await addXp(userId, xpGain, "service", `${minutes} minutes de service`);
  }
  
  return { duration, xpGain };
}

async function updateServicePing(userId) {
  const data = serviceData[userId];
  if (!data || !data.active) return null;
  data.lastPing = new Date().toISOString();
  sauverService();
  return data;
}

function getActiveServices() {
  const active = [];
  for (const [userId, data] of Object.entries(serviceData)) {
    if (data.active) {
      active.push({
        userId,
        startTime: data.startTime,
        lastPing: data.lastPing,
        totalTime: data.totalTime || 0
      });
    }
  }
  return active;
}

// ==============================
// FONCTIONS UTILES
// ==============================
function remplacerVariables(texte, vars) {
  return String(texte || "")
    .replaceAll("{user}", vars.user ?? "")
    .replaceAll("{mention}", vars.mention ?? "")
    .replaceAll("{username}", vars.username ?? "")
    .replaceAll("{server}", vars.server ?? "")
    .replaceAll("{staff}", vars.staff ?? "")
    .replaceAll("{ticket}", vars.ticket ?? "")
    .replaceAll("{date}", vars.date ?? "")
    .replaceAll("{raison}", vars.raison ?? "");
}

function estAutoriseCandidature(interaction, roleId) {
  if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (!roleId) return false;
  return interaction.member.roles.cache.has(roleId);
}

function trouverUserIdParThread(threadId) {
  for (const [userId, t] of Object.entries(tickets)) {
    if (t.threadId === threadId) return userId;
  }
  return null;
}

function prochainNumeroTicket() {
  config.ticketCounter = (config.ticketCounter || 0) + 1;
  sauverConfig();
  return String(config.ticketCounter).padStart(4, "0");
}

const EMOJIS_PRIORITE = { basse: "🟢", normale: "🟡", haute: "🟠", urgente: "🔴" };

const LABELS_TYPE_INTERVENTION = {
  accident_circulation: "🚗 Accident de circulation",
  arme: "🔫 Arme à feu / arme blanche",
  agression: "🥊 Bagarre / agression",
  overdose: "💊 Overdose / intoxication",
  noyade: "🌊 Noyade",
  chute: "🤕 Chute",
  malaise: "😵 Malaise",
  autre: "❓ Autre",
};
const LABELS_GRAVITE_INTERVENTION = {
  legere: "🟢 Légère",
  moyenne: "🟡 Moyenne",
  critique: "🟠 Critique",
  deces: "⚫ Décès",
};

function statsInterventions() {
  const parType = {};
  const parGravite = {};
  const parMois = {};
  for (const iv of interventions) {
    parType[iv.type] = (parType[iv.type] || 0) + 1;
    parGravite[iv.gravite] = (parGravite[iv.gravite] || 0) + 1;
    const mois = iv.date.slice(0, 7);
    parMois[mois] = (parMois[mois] || 0) + 1;
  }
  return { total: interventions.length, parType, parGravite, parMois };
}

async function envoyerLogModeration(embed) {
  if (!config.modLogsChannelId) return;
  const salon = await client.channels.fetch(config.modLogsChannelId).catch(() => null);
  if (!salon) return;
  await salon.send({ embeds: [embed] }).catch(() => {});
}

function embedLogModeration({ action, couleur, emoji, cibleTag, cibleId, parTag, raison }) {
  return new EmbedBuilder()
    .setColor(couleur)
    .setTitle(`${emoji} ${action}`)
    .addFields(
      { name: "Membre", value: `${cibleTag} (\`${cibleId}\`)`, inline: true },
      { name: "Par", value: parTag, inline: true },
      { name: "Raison", value: raison || "Aucune raison fournie", inline: false }
    )
    .setTimestamp();
}

// ==============================
// CLIENT DISCORD
// ==============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ==============================
// COMMANDES SLASH
// ==============================
const commands = [
  // Rapport médical
  new SlashCommandBuilder()
    .setName("rapport")
    .setDescription("Générer un rapport médical d'intervention"),

  // Intervention
  new SlashCommandBuilder()
    .setName("intervention")
    .setDescription("Logger une intervention pour les statistiques")
    .addStringOption((o) =>
      o.setName("type").setDescription("Type d'intervention").setRequired(true).addChoices(
        { name: "🚗 Accident de circulation", value: "accident_circulation" },
        { name: "🔫 Arme à feu / arme blanche", value: "arme" },
        { name: "🥊 Bagarre / agression", value: "agression" },
        { name: "💊 Overdose / intoxication", value: "overdose" },
        { name: "🌊 Noyade", value: "noyade" },
        { name: "🤕 Chute", value: "chute" },
        { name: "😵 Malaise", value: "malaise" },
        { name: "❓ Autre", value: "autre" }
      )
    )
    .addStringOption((o) =>
      o.setName("gravite").setDescription("Gravité").setRequired(true).addChoices(
        { name: "🟢 Légère", value: "legere" },
        { name: "🟡 Moyenne", value: "moyenne" },
        { name: "🟠 Critique", value: "critique" },
        { name: "⚫ Décès", value: "deces" }
      )
    )
    .addStringOption((o) => o.setName("patient").setDescription("Nom du patient (optionnel)").setRequired(false)),

  // Tickets
  new SlashCommandBuilder()
    .setName("rename")
    .setDescription("Renommer le ticket en cours")
    .addStringOption((o) => o.setName("nom").setDescription("Nouveau nom").setRequired(true)),
  new SlashCommandBuilder().setName("claim").setDescription("Prendre en charge le ticket en cours"),
  new SlashCommandBuilder().setName("unclaim").setDescription("Libérer le ticket en cours"),
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Ajouter un membre au ticket en cours")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à ajouter").setRequired(true)),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Retirer un membre du ticket en cours")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à retirer").setRequired(true)),
  new SlashCommandBuilder()
    .setName("priority")
    .setDescription("Définir la priorité du ticket en cours")
    .addStringOption((o) =>
      o
        .setName("niveau")
        .setDescription("Niveau de priorité")
        .setRequired(true)
        .addChoices(
          { name: "🟢 Basse", value: "basse" },
          { name: "🟡 Normale", value: "normale" },
          { name: "🟠 Haute", value: "haute" },
          { name: "🔴 Urgente", value: "urgente" }
        )
    ),
  new SlashCommandBuilder().setName("reopen").setDescription("Rouvrir un ticket fermé (à utiliser dans le fil fermé)"),
  new SlashCommandBuilder().setName("transcript").setDescription("Générer le transcript HTML du ticket en cours"),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Supprimer des messages dans le ticket en cours")
    .addIntegerOption((o) => o.setName("nombre").setDescription("Nombre de messages (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName("lock").setDescription("Verrouiller le ticket en cours"),
  new SlashCommandBuilder().setName("unlock").setDescription("Déverrouiller le ticket en cours"),
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Définir le mode lent du ticket en cours")
    .addIntegerOption((o) => o.setName("secondes").setDescription("Délai en secondes (0 = désactivé)").setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName("nuke").setDescription("Purger tous les messages du ticket en cours"),

  // Candidatures
  new SlashCommandBuilder()
    .setName("valid")
    .setDescription("Valider la candidature du ticket en cours")
    .addStringOption((o) => o.setName("raison").setDescription("Commentaire (optionnel)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("refuser")
    .setDescription("Refuser la candidature du ticket en cours")
    .addStringOption((o) => o.setName("raison").setDescription("Raison du refus (optionnel)").setRequired(false)),

  // Modération
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Avertir un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à avertir").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison de l'avertissement").setRequired(true)),
  new SlashCommandBuilder()
    .setName("warns")
    .setDescription("Voir les avertissements d'un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à consulter").setRequired(true)),

  // XP & Grades
  new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Voir ton profil XP")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à consulter").setRequired(false)),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Voir le classement des membres"),
  new SlashCommandBuilder()
    .setName("givexp")
    .setDescription("Donner de l'XP à un membre (staff)")
    .addUserOption((o) => o.setName("membre").setDescription("Membre").setRequired(true))
    .addIntegerOption((o) => o.setName("quantite").setDescription("XP à donner").setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName("raison").setDescription("Raison").setRequired(false)),
  new SlashCommandBuilder()
    .setName("grade")
    .setDescription("Gérer les grades d'un membre (admin)")
    .addSubcommand((sub) => 
      sub.setName("set")
        .setDescription("Définir le grade d'un membre")
        .addUserOption((o) => o.setName("membre").setDescription("Membre").setRequired(true))
        .addStringOption((o) => 
          o.setName("grade")
            .setDescription("Grade à attribuer")
            .setRequired(true)
            .addChoices(
              ...GRADES_DEFAUT.grades.map(g => ({ name: `${g.icon} ${g.name}`, value: g.id }))
            )
        )
    )
    .addSubcommand((sub) => 
      sub.setName("reset")
        .setDescription("Réinitialiser l'XP d'un membre")
        .addUserOption((o) => o.setName("membre").setDescription("Membre").setRequired(true))
    ),

  // Service
  new SlashCommandBuilder()
    .setName("service")
    .setDescription("Gérer ton service")
    .addSubcommand((sub) =>
      sub.setName("start")
        .setDescription("Prendre ton service")
    )
    .addSubcommand((sub) =>
      sub.setName("stop")
        .setDescription("Déposer ton service")
    )
    .addSubcommand((sub) =>
      sub.setName("status")
        .setDescription("Voir ton statut de service")
    ),
  new SlashCommandBuilder()
    .setName("services")
    .setDescription("Voir les membres en service (staff)"),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ==============================
// CHARGEMENT REDIS
// ==============================
async function chargerDepuisRedis() {
  if (!REDIS_ACTIF) {
    console.log("⚠️ UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN non configurés.");
    return;
  }
  const [c, t, g, ct, w, ch, iv, xp, gr, xl, sv] = await Promise.all([
    redisGet("config"),
    redisGet("tickets"),
    redisGet("giveaways"),
    redisGet("closed-tickets"),
    redisGet("warns"),
    redisGet("candidatures-history"),
    redisGet("interventions"),
    redisGet("xp_data"),
    redisGet("grades"),
    redisGet("xp_logs"),
    redisGet("service"),
  ]);
  if (c) {
    config = { ...config, ...c, candidatures: { ...CANDIDATURES_DEFAUT, ...(c.candidatures || {}) } };
    if (config.modLogsChannelId === undefined) config.modLogsChannelId = null;
    if (config.ticketAutoCloseHours === undefined) config.ticketAutoCloseHours = 0;
    if (config.interventionsChannelId === undefined) config.interventionsChannelId = null;
    if (config.serviceChannelId === undefined) config.serviceChannelId = null;
    if (config.serviceMessageId === undefined) config.serviceMessageId = null;
  }
  if (t) tickets = t;
  if (g) giveaways = g;
  if (ct) closedTickets = ct;
  if (w) warns = w;
  if (ch) candHistory = ch;
  if (iv) interventions = iv;
  if (xp) xpData = xp;
  if (gr) gradesConfig = { ...GRADES_DEFAUT, ...gr, grades: gr.grades || GRADES_DEFAUT.grades };
  if (xl) xpLogs = xl;
  if (sv) serviceData = sv;
  console.log("✅ Toutes les données rechargées depuis Upstash Redis.");
}

(async () => {
  await chargerDepuisRedis();
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Commandes slash enregistrées avec succès.");
  } catch (error) {
    console.error(error);
  }
  client.login(TOKEN);
})();

// ==============================
// READY
// ==============================
client.once("ready", async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  
  // Giveaways
  for (const g of Object.values(giveaways)) {
    if (!g.ended) planifierFinGiveaway(g);
  }
  
  // Tickets inactifs
  setInterval(verifierTicketsInactifs, 15 * 60 * 1000);
  verifierTicketsInactifs();

  // Envoyer le message de service si configuré
  await envoyerMessageService();

  // XP temps de service (toutes les minutes)
  setInterval(async () => {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;
      
      const members = await guild.members.fetch();
      const now = new Date();
      const isWeekend = now.getDay() === 0 || now.getDay() === 6;
      const boost = isWeekend ? (gradesConfig.settings.xpBoosts?.weekend || 1.5) : 1;
      
      // XP pour les membres en service
      const activeServices = getActiveServices();
      for (const service of activeServices) {
        const start = new Date(service.startTime);
        const minutes = Math.floor((Date.now() - start) / 60000);
        const xpGain = Math.round((gradesConfig.settings.xpPerMinute || 1) * boost);
        if (xpGain > 0) {
          await addXp(service.userId, xpGain, "service", "Temps en service");
        }
      }
    } catch (e) {
      console.error("Erreur gain XP service:", e);
    }
  }, 60000);

  // Vérifier les services orphelins (membres offline)
  setInterval(async () => {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;
      
      const activeServices = getActiveServices();
      for (const service of activeServices) {
        const member = await guild.members.fetch(service.userId).catch(() => null);
        if (!member || member.presence?.status === 'offline') {
          console.log(`🛑 Service arrêté automatiquement pour ${member?.user?.username || service.userId} (offline)`);
          await stopService(service.userId);
        }
      }
    } catch (e) {
      console.error("Erreur vérification services orphelins:", e);
    }
  }, 300000); // toutes les 5 minutes
});

// ==============================
// MESSAGE DE SERVICE
// ==============================
async function envoyerMessageService() {
  if (!config.serviceChannelId) return;
  
  try {
    const channel = await client.channels.fetch(config.serviceChannelId);
    if (!channel || !channel.isTextBased()) return;
    
    // Supprimer l'ancien message si existant
    if (config.serviceMessageId) {
      try {
        const oldMsg = await channel.messages.fetch(config.serviceMessageId);
        if (oldMsg) await oldMsg.delete();
      } catch (e) {}
    }
    
    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle("🟢 Prise de service")
      .setDescription("Clique sur le bouton ci-dessous pour prendre ou déposer ton service.")
      .addFields(
        { name: "📊 En service actuellement", value: "Aucun membre", inline: false }
      )
      .setFooter({ text: NOM_SERVEUR })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("service_toggle")
        .setLabel("🟢 Prendre mon service")
        .setStyle(ButtonStyle.Success)
    );

    const message = await channel.send({ embeds: [embed], components: [row] });
    config.serviceMessageId = message.id;
    sauverConfig();
    
    // Mettre à jour le message périodiquement
    setInterval(() => mettreAJourMessageService(message), 60000);
    await mettreAJourMessageService(message);
    
  } catch (e) {
    console.error("Erreur envoi message service:", e);
  }
}

async function mettreAJourMessageService(message) {
  try {
    const activeServices = getActiveServices();
    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle("🟢 Prise de service")
      .setDescription("Clique sur le bouton ci-dessous pour prendre ou déposer ton service.")
      .setFooter({ text: NOM_SERVEUR })
      .setTimestamp();

    if (activeServices.length === 0) {
      embed.addFields({ name: "📊 En service actuellement", value: "Aucun membre", inline: false });
    } else {
      const liste = await Promise.all(activeServices.map(async (s) => {
        const user = await client.users.fetch(s.userId).catch(() => null);
        const start = new Date(s.startTime);
        const duration = Math.floor((Date.now() - start) / 60000);
        const hours = Math.floor(duration / 60);
        const minutes = duration % 60;
        return `${user?.username || s.userId} — ⏱️ ${hours}h${minutes}m`;
      }));
      embed.addFields({ name: "📊 En service actuellement", value: liste.join('\n') || "Aucun", inline: false });
    }

    await message.edit({ embeds: [embed] });
  } catch (e) {
    console.error("Erreur mise à jour message service:", e);
  }
}

// ==============================
// AUTO-FERMETURE TICKETS
// ==============================
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
      await fermerTicketParThread(t.threadId, "Système (auto-fermeture inactivité)").catch((e) =>
        console.error("Erreur auto-fermeture:", e)
      );
    }
  }
}

// ==============================
// AUTO-ROLE + BIENVENUE
// ==============================
client.on("guildMemberAdd", async (member) => {
  try {
    if (config.autoRoleId) {
      await member.roles.add(config.autoRoleId).catch((e) =>
        console.error("Erreur attribution rôle auto:", e.message)
      );
    }

    if (!config.welcomeChannelId) return;
    const salon = member.guild.channels.cache.get(config.welcomeChannelId);
    if (!salon) return;

    const texte = config.welcomeMessage
      .replaceAll("{user}", `<@${member.id}>`)
      .replaceAll("{server}", member.guild.name)
      .replaceAll("{count}", member.guild.memberCount);

    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`👋 Bienvenue sur ${NOM_SERVEUR} !`)
      .setDescription(texte)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: NOM_SERVEUR })
      .setTimestamp();

    await salon.send({ embeds: [embed] });
  } catch (e) {
    console.error("Erreur guildMemberAdd:", e);
  }
});

// ==============================
// SYSTEME DE TICKETS
// ==============================
function boutonsTicket() {
  const ligne1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_claim").setLabel("Claim").setEmoji("🙋").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket_unclaim").setLabel("Unclaim").setEmoji("🙅").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_rename").setLabel("Renommer").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_add").setLabel("Ajouter").setEmoji("➕").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_remove").setLabel("Retirer").setEmoji("➖").setStyle(ButtonStyle.Secondary)
  );
  const ligne2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_transcript").setLabel("Transcript").setEmoji("📄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_delete").setLabel("Supprimer").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
  );
  return [ligne1, ligne2];
}

function boutonReprise() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_reopen").setLabel("Reprendre le ticket").setEmoji("♻️").setStyle(ButtonStyle.Success)
  );
}

function estStaffTicket(interaction) {
  return interaction.member && interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads);
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

  const echapper = (s) =>
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lignes = toutMessages
    .map((m) => {
      const date = new Date(m.createdTimestamp).toLocaleString("fr-FR");
      const pieces = [...m.attachments.values()]
        .map((a) => `<div class="piece"><a href="${a.url}" target="_blank">${echapper(a.name)}</a></div>`)
        .join("");
      return `<div class="msg">
        <img class="avatar" src="${m.author.displayAvatarURL({ extension: "png", size: 64 })}" />
        <div class="contenu">
          <div class="entete"><span class="auteur">${echapper(m.author.tag)}</span><span class="date">${date}</span></div>
          <div class="texte">${echapper(m.content).replace(/\n/g, "<br>")}</div>
          ${pieces}
        </div>
      </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Transcript - ${echapper(thread.name)}</title>
<style>
  body { background:#313338; color:#dbdee1; font-family: Arial, sans-serif; margin:0; padding:20px; }
  h1 { color:#ff2d78; }
  .msg { display:flex; gap:12px; padding:8px 0; border-bottom:1px solid #3f4147; }
  .avatar { width:40px; height:40px; border-radius:50%; }
  .entete { font-size:14px; margin-bottom:2px; }
  .auteur { font-weight:bold; color:#f2f3f5; margin-right:8px; }
  .date { color:#949ba4; font-size:12px; }
  .texte { white-space:pre-wrap; word-wrap:break-word; }
  .piece a { color:#00a8fc; }
</style></head>
<body>
  <h1>🎫 Transcript — ${echapper(thread.name)}</h1>
  <p>Généré le ${new Date().toLocaleString("fr-FR")} — ${toutMessages.length} message(s)</p>
  ${lignes || "<p><i>Aucun message.</i></p>"}
</body></html>`;
}

function getSalonLogsTickets() {
  return config.ticketLogsChannelId || config.ticketStaffChannelId;
}

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
  const buffer = Buffer.from(html, "utf8");
  const nomFichier = `transcript-${thread.name}.html`.replace(/[^a-zA-Z0-9-_.]/g, "_");
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
      "📄 Transcript — Ticket fermé",
      `Ticket **#${infosTicket?.number || "?"}** fermé par **${fermePar}**.`
    ).catch((e) => console.error("Erreur génération transcript à la fermeture:", e));

    await thread
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COULEUR_EMBED)
            .setTitle("🔒 Ticket fermé")
            .setDescription(`Fermé par **${fermePar}**.\nLe transcript a été envoyé dans le salon de logs.`)
            .setTimestamp(),
        ],
        components: [boutonReprise()],
      })
      .catch(() => {});
    await thread.setName(`Fermé - ${thread.name}`.slice(0, 100)).catch(() => {});
    await thread.setArchived(false).catch(() => {});
    await thread.setLocked(true).catch(() => {});
    await thread.setArchived(true).catch(() => {});
  }

  if (userId) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
      await user
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(COULEUR_EMBED)
              .setTitle("🔒 Ticket fermé")
              .setDescription("Ton ticket a été fermé par l'équipe. Si tu as besoin d'aide à nouveau, renvoie-moi simplement un message ici pour en ouvrir un nouveau.")
              .setTimestamp(),
          ],
        })
        .catch(() => {});
    }
    if (thread && infosTicket) {
      closedTickets[thread.id] = {
        userId,
        username: infosTicket.username,
        number: infosTicket.number,
        closedAt: new Date().toISOString(),
      };
      sauverClosedTickets();
    }
    delete tickets[userId];
    sauverTickets();
  }
}

async function reouvrirTicketParThread(threadId, rouvertPar) {
  const infos = closedTickets[threadId];
  if (!infos) throw new Error("Aucun ticket fermé trouvé pour ce fil (utilise /reopen dans le fil concerné).");

  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread) throw new Error("Fil introuvable.");

  await thread.setArchived(false).catch(() => {});
  await thread.setLocked(false).catch(() => {});
  const nomOriginal = thread.name.replace(/^Fermé - /, "");
  await thread.setName(nomOriginal.slice(0, 100)).catch(() => {});

  tickets[infos.userId] = {
    threadId,
    username: infos.username,
    number: infos.number,
    claimedBy: null,
    priority: "normale",
    note: "",
    lastActivity: new Date().toISOString(),
  };
  sauverTickets();
  delete closedTickets[threadId];
  sauverClosedTickets();

  await thread.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle("♻️ Ticket rouvert")
        .setDescription(`Rouvert par **${rouvertPar}**.`)
        .setTimestamp(),
    ],
    components: boutonsTicket(),
  });

  const user = await client.users.fetch(infos.userId).catch(() => null);
  if (user) {
    await user
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COULEUR_EMBED)
            .setTitle("♻️ Ticket rouvert")
            .setDescription("Ton ticket a été rouvert par l'équipe, tu peux continuer à discuter ici.")
            .setTimestamp(),
        ],
      })
      .catch(() => {});
  }

  return thread;
}

async function obtenirOuCreerThread(user) {
  if (!config.ticketStaffChannelId) throw new Error("Salon staff tickets non configuré (voir panel > Bienvenue)");
  const staffChannel = await client.channels.fetch(config.ticketStaffChannelId).catch(() => null);
  if (!staffChannel) throw new Error("Salon staff tickets introuvable");

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
    priority: "normale",
    note: "",
    lastActivity: new Date().toISOString(),
  };
  sauverTickets();

  await thread.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle(`🎫 Nouveau ticket #${numero}`)
        .setDescription(`Ouvert par **${user.tag}** (\`${user.id}\`)\n\nRépondez directement dans ce fil, ça part en DM à la personne.`)
        .setTimestamp(),
    ],
    components: boutonsTicket(),
  });

  await envoyerLogTicket(
    new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle("🎫 Ticket créé")
      .setDescription(`Ticket **#${numero}** ouvert par **${user.tag}** (\`${user.id}\`).`)
      .setTimestamp()
  );

  return { thread, nouveau: true };
}

// ==============================
// MESSAGE CREATE
// ==============================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.channel.type === ChannelType.DM) {
    try {
      const { thread, nouveau } = await obtenirOuCreerThread(message.author);
      await thread.send({
        content: `**${message.author.tag}** :\n${message.content || "*(pièce jointe / message vide)*"}`,
        files: [...message.attachments.values()],
      });

      if (tickets[message.author.id]) {
        tickets[message.author.id].lastActivity = new Date().toISOString();
        sauverTickets();
      }

      if (nouveau) {
        await message.author.send({
          embeds: [
            new EmbedBuilder()
              .setColor(COULEUR_EMBED)
              .setTitle("🎫 Ticket ouvert")
              .setDescription("Ton message a bien été transmis à l'équipe. Ton ticket va être pris en charge, tu peux continuer à écrire ici, ça arrive directement au staff.")
              .setTimestamp(),
          ],
        }).catch(() => {});
      }
    } catch (e) {
      console.error("Erreur relais DM->thread:", e);
      await message.author.send(
        "⚠️ Désolé, le système de tickets n'est pas encore configuré côté serveur. Contacte le staff autrement en attendant."
      ).catch(() => {});
    }
    return;
  }

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
      console.error("Erreur relais thread->DM:", e);
      await message.reply("⚠️ Impossible d'envoyer le DM (DMs fermés par l'utilisateur ?).");
    }
    return;
  }

  // Gain d'XP pour les messages
  if (message.guild && !message.author.bot) {
    const userId = message.author.id;
    const lastMsg = xpData[userId]?.lastMessage || 0;
    const cooldown = gradesConfig.settings.cooldowns?.message || 60;
    
    if (Date.now() - lastMsg > cooldown * 1000) {
      const boost = (new Date().getDay() === 0 || new Date().getDay() === 6) 
        ? (gradesConfig.settings.xpBoosts?.weekend || 1.5) : 1;
      const xpGain = Math.round((gradesConfig.settings.xpPerMessage || 0.5) * boost);
      
      if (xpGain > 0) {
        if (!xpData[userId]) {
          xpData[userId] = { xp: 0, serviceTime: 0, interventions: 0, messages: 0, voiceTime: 0, lastActivity: new Date().toISOString() };
        }
        xpData[userId].lastMessage = Date.now();
        await addXp(userId, xpGain, "message", "Message envoyé");
      }
    }
  }
});

// ==============================
// GIVEAWAYS
// ==============================
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
    const texteGagnants = gagnants.length
      ? gagnants.map((id) => `<@${id}>`).join(", ")
      : "Personne n'a participé 😢";

    const embedFin = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`🎉 Giveaway terminé : ${g.prize}`)
      .setDescription(`Gagnant(s) : ${texteGagnants}`)
      .setTimestamp();

    if (message) await message.edit({ embeds: [embedFin], components: [] });
    await channel.send({ content: `🎉 Félicitations ${texteGagnants} ! Vous remportez **${g.prize}**.` });
  } catch (e) {
    console.error("Erreur fin giveaway:", e);
  }
}

function planifierFinGiveaway(g) {
  const delai = new Date(g.endsAt).getTime() - Date.now();
  setTimeout(() => terminerGiveaway(g.id), Math.max(delai, 0));
}

// ==============================
// INTERACTIONS
// ==============================
client.on("interactionCreate", async (interaction) => {
  // ---- Bouton SERVICE ----
  if (interaction.isButton() && interaction.customId === "service_toggle") {
    await interaction.deferReply({ ephemeral: true });
    
    const userId = interaction.user.id;
    const status = getServiceStatus(userId);
    
    if (status) {
      // Arrêter le service
      const result = await stopService(userId);
      if (result) {
        const duration = Math.floor(result.duration / 60);
        await interaction.editReply({
          content: `✅ Tu as déposé ton service après **${duration} minutes** ! (+${result.xpGain} XP)`
        });
        await mettreAJourMessageService(await interaction.channel.messages.fetch(config.serviceMessageId).catch(() => null));
      }
    } else {
      // Démarrer le service
      await startService(userId);
      await interaction.editReply({
        content: "✅ Tu as pris ton service ! 🟢"
      });
      await mettreAJourMessageService(await interaction.channel.messages.fetch(config.serviceMessageId).catch(() => null));
    }
    return;
  }

  // ---- Boutons ticket ----
  if (interaction.isButton() && interaction.customId === "ticket_claim") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    const userId = trouverUserIdParThread(interaction.channel.id);
    if (userId) { tickets[userId].claimedBy = interaction.user.id; sauverTickets(); }
    await interaction.channel.send({
      embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`🙋 Ticket pris en charge par <@${interaction.user.id}>`)],
    });
    return interaction.reply({ content: "Tu as pris ce ticket en charge.", ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === "ticket_unclaim") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    const userId = trouverUserIdParThread(interaction.channel.id);
    if (userId) { tickets[userId].claimedBy = null; sauverTickets(); }
    await interaction.channel.send({
      embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`🙅 Ticket libéré par <@${interaction.user.id}>`)],
    });
    return interaction.reply({ content: "Tu as libéré ce ticket.", ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === "ticket_rename") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    const modal = new ModalBuilder().setCustomId("ticket_rename_modal").setTitle("Renommer le ticket");
    const nomInput = new TextInputBuilder()
      .setCustomId("nouveau_nom")
      .setLabel("Nouveau nom du ticket")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Ex: ticket-0001-urgent")
      .setMaxLength(90)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(nomInput));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === "ticket_rename_modal") {
    const nouveauNom = interaction.fields.getTextInputValue("nouveau_nom");
    if (interaction.channel && interaction.channel.isThread && interaction.channel.isThread()) {
      await interaction.channel.setName(nouveauNom.slice(0, 100)).catch(() => {});
    }
    return interaction.reply({ content: `✅ Ticket renommé en **${nouveauNom}**.`, ephemeral: true });
  }

  if (interaction.isButton() && (interaction.customId === "ticket_add" || interaction.customId === "ticket_remove")) {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    const action = interaction.customId === "ticket_add" ? "add" : "remove";
    const select = new UserSelectMenuBuilder()
      .setCustomId(`ticket_${action}_select`)
      .setPlaceholder(action === "add" ? "Choisis un membre à ajouter" : "Choisis un membre à retirer")
      .setMinValues(1)
      .setMaxValues(1);
    return interaction.reply({
      content: action === "add" ? "Qui veux-tu ajouter au ticket ?" : "Qui veux-tu retirer du ticket ?",
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true,
    });
  }

  if (interaction.isUserSelectMenu() && (interaction.customId === "ticket_add_select" || interaction.customId === "ticket_remove_select")) {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    const cible = interaction.values[0];
    const thread = interaction.channel;
    try {
      if (interaction.customId === "ticket_add_select") {
        await thread.members.add(cible);
        await thread.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`➕ <@${cible}> a été ajouté au ticket par <@${interaction.user.id}>`)] });
        await interaction.update({ content: `✅ <@${cible}> ajouté.`, components: [] });
      } else {
        await thread.members.remove(cible);
        await thread.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`➖ <@${cible}> a été retiré du ticket par <@${interaction.user.id}>`)] });
        await interaction.update({ content: `✅ <@${cible}> retiré.`, components: [] });
      }
    } catch (e) {
      console.error("Erreur add/remove membre ticket:", e);
      await interaction.update({ content: "⚠️ Échec de l'opération.", components: [] });
    }
    return;
  }

  if (interaction.isButton() && interaction.customId === "ticket_transcript") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const { buffer, nomFichier } = await envoyerTranscript(
      interaction.channel,
      "📄 Transcript demandé",
      `Transcript généré manuellement par <@${interaction.user.id}>.`
    );
    return interaction.editReply({ content: "✅ Transcript généré et envoyé dans le salon de logs.", files: [{ attachment: buffer, name: nomFichier }] });
  }

  if (interaction.isButton() && interaction.customId === "ticket_close") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    await interaction.reply({ content: "🔒 Fermeture du ticket en cours...", ephemeral: true });
    await fermerTicketParThread(interaction.channel.id, interaction.user.tag);
    return;
  }

  if (interaction.isButton() && interaction.customId === "ticket_delete") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    await interaction.reply({ content: "🗑️ Suppression du ticket (transcript sauvegardé dans les logs)...", ephemeral: true });
    const thread = interaction.channel;
    const userId = trouverUserIdParThread(thread.id);
    await envoyerTranscript(thread, "🗑️ Transcript — Ticket supprimé", `Ticket supprimé par **${interaction.user.tag}**.`).catch(() => {});
    if (userId) { delete tickets[userId]; sauverTickets(); }
    delete closedTickets[thread.id]; sauverClosedTickets();
    await thread.delete().catch(() => {});
    return;
  }

  if (interaction.isButton() && interaction.customId === "ticket_reopen") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    try {
      await interaction.reply({ content: "♻️ Réouverture du ticket...", ephemeral: true });
      await reouvrirTicketParThread(interaction.channel.id, interaction.user.tag);
    } catch (e) {
      await interaction.followUp({ content: `⚠️ ${e.message}`, ephemeral: true }).catch(() => {});
    }
    return;
  }

  // ---- Bouton giveaway ----
  if (interaction.isButton() && interaction.customId.startsWith("giveaway_")) {
    const id = interaction.customId.replace("giveaway_", "");
    const g = giveaways[id];
    if (!g || g.ended) {
      return interaction.reply({ content: "Ce giveaway est terminé.", ephemeral: true });
    }
    if (g.participants.includes(interaction.user.id)) {
      g.participants = g.participants.filter((u) => u !== interaction.user.id);
      sauverGiveaways();
      return interaction.reply({ content: "❌ Tu ne participes plus.", ephemeral: true });
    }
    g.participants.push(interaction.user.id);
    sauverGiveaways();
    return interaction.reply({ content: "✅ Tu participes au giveaway !", ephemeral: true });
  }

  // ---- Commandes slash "générales" ----
  const commandesGenerales = ["rename", "transcript", "clear", "lock", "unlock", "slowmode", "nuke"];
  if (interaction.isChatInputCommand() && commandesGenerales.includes(interaction.commandName)) {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }

    const salon = interaction.channel;

    switch (interaction.commandName) {
      case "rename": {
        const nom = interaction.options.getString("nom");
        await salon.setName(nom.slice(0, 100)).catch(() => {});
        return interaction.reply({ content: `✅ Salon renommé en **${nom}**.`, ephemeral: true });
      }
      case "transcript": {
        await interaction.deferReply({ ephemeral: true });
        const { buffer, nomFichier } = await envoyerTranscript(salon, "📄 Transcript demandé", `Transcript généré manuellement par <@${interaction.user.id}> dans <#${salon.id}>.`);
        return interaction.editReply({ content: "✅ Transcript généré et envoyé dans le salon de logs.", files: [{ attachment: buffer, name: nomFichier }] });
      }
      case "clear": {
        const nombre = interaction.options.getInteger("nombre");
        await interaction.deferReply({ ephemeral: true });
        const supprimes = await salon.bulkDelete(nombre, true).catch(() => null);
        return interaction.editReply({ content: supprimes ? `✅ ${supprimes.size} message(s) supprimé(s).` : "⚠️ Échec (messages de plus de 14 jours ?)." });
      }
      case "lock": {
        if (salon.isThread && salon.isThread()) {
          await salon.setLocked(true).catch(() => {});
        } else {
          await salon.permissionOverwrites.edit(salon.guild.roles.everyone, { SendMessages: false }).catch(() => {});
        }
        await salon.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`🔒 Salon verrouillé par <@${interaction.user.id}>`)] }).catch(() => {});
        return interaction.reply({ content: "✅ Salon verrouillé.", ephemeral: true });
      }
      case "unlock": {
        if (salon.isThread && salon.isThread()) {
          await salon.setLocked(false).catch(() => {});
        } else {
          await salon.permissionOverwrites.edit(salon.guild.roles.everyone, { SendMessages: null }).catch(() => {});
        }
        await salon.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`🔓 Salon déverrouillé par <@${interaction.user.id}>`)] }).catch(() => {});
        return interaction.reply({ content: "✅ Salon déverrouillé.", ephemeral: true });
      }
      case "slowmode": {
        const secondes = interaction.options.getInteger("secondes");
        await salon.setRateLimitPerUser(secondes).catch(() => {});
        return interaction.reply({ content: `✅ Mode lent défini sur ${secondes}s.`, ephemeral: true });
      }
      case "nuke": {
        await interaction.deferReply({ ephemeral: true });
        await envoyerTranscript(salon, "💣 Transcript — Avant nuke", `Purge complète effectuée par <@${interaction.user.id}> dans <#${salon.id}>.`).catch(() => {});
        let total = 0;
        while (true) {
          const lot = await salon.messages.fetch({ limit: 100 }).catch(() => null);
          if (!lot || !lot.size) break;
          const supprimables = lot.filter((m) => Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000);
          if (!supprimables.size) break;
          const res = await salon.bulkDelete(supprimables, true).catch(() => null);
          if (!res || !res.size) break;
          total += res.size;
        }
        return interaction.editReply({ content: `💣 ${total} message(s) purgé(s). Transcript sauvegardé dans les logs.` });
      }
    }
    return;
  }

  // ---- Commandes slash propres aux TICKETS ----
  const commandesTicket = ["claim", "unclaim", "add", "remove", "priority", "reopen"];
  if (interaction.isChatInputCommand() && commandesTicket.includes(interaction.commandName)) {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }

    const thread = interaction.channel;
    const estThread = thread && thread.isThread && thread.isThread();

    if (interaction.commandName === "reopen") {
      if (!estThread || !closedTickets[thread.id]) {
        return interaction.reply({ content: "⚠️ Cette commande doit être utilisée dans un fil de ticket fermé.", ephemeral: true });
      }
      try {
        await interaction.reply({ content: "♻️ Réouverture du ticket...", ephemeral: true });
        await reouvrirTicketParThread(thread.id, interaction.user.tag);
      } catch (e) {
        await interaction.followUp({ content: `⚠️ ${e.message}`, ephemeral: true }).catch(() => {});
      }
      return;
    }

    const userId = estThread ? trouverUserIdParThread(thread.id) : null;
    if (!estThread || !userId) {
      return interaction.reply({ content: "⚠️ Cette commande doit être utilisée dans un fil de ticket ouvert.", ephemeral: true });
    }

    switch (interaction.commandName) {
      case "claim": {
        tickets[userId].claimedBy = interaction.user.id;
        sauverTickets();
        await thread.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`🙋 Ticket pris en charge par <@${interaction.user.id}>`)] });
        return interaction.reply({ content: "Tu as pris ce ticket en charge.", ephemeral: true });
      }
      case "unclaim": {
        tickets[userId].claimedBy = null;
        sauverTickets();
        await thread.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`🙅 Ticket libéré par <@${interaction.user.id}>`)] });
        return interaction.reply({ content: "Tu as libéré ce ticket.", ephemeral: true });
      }
      case "add": {
        const membre = interaction.options.getUser("membre");
        await thread.members.add(membre.id).catch(() => {});
        await thread.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`➕ <@${membre.id}> a été ajouté au ticket par <@${interaction.user.id}>`)] });
        return interaction.reply({ content: `✅ ${membre.tag} ajouté au ticket.`, ephemeral: true });
      }
      case "remove": {
        const membre = interaction.options.getUser("membre");
        await thread.members.remove(membre.id).catch(() => {});
        await thread.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`➖ <@${membre.id}> a été retiré du ticket par <@${interaction.user.id}>`)] });
        return interaction.reply({ content: `✅ ${membre.tag} retiré du ticket.`, ephemeral: true });
      }
      case "priority": {
        const niveau = interaction.options.getString("niveau");
        tickets[userId].priority = niveau;
        sauverTickets();
        const emoji = EMOJIS_PRIORITE[niveau] || "🟡";
        const nomSansEmoji = thread.name.replace(/^[🟢🟡🟠🔴]\s*/, "");
        await thread.setName(`${emoji} ${nomSansEmoji}`.slice(0, 100)).catch(() => {});
        await thread.send({ embeds: [new EmbedBuilder().setColor(COULEUR_EMBED).setDescription(`${emoji} Priorité définie sur **${niveau}** par <@${interaction.user.id}>`)] });
        return interaction.reply({ content: `✅ Priorité définie sur **${niveau}**.`, ephemeral: true });
      }
    }
    return;
  }

  // ---- Commandes /valid et /refuser ----
  if (interaction.isChatInputCommand() && (interaction.commandName === "valid" || interaction.commandName === "refuser")) {
    const cfg = config.candidatures;
    const estValidation = interaction.commandName === "valid";

    if (!cfg.actif) {
      return interaction.reply({ content: "⛔ Le système de validation des candidatures est désactivé (panel web).", ephemeral: true });
    }

    const roleAutorise = estValidation ? cfg.roleValid : cfg.roleRefus;
    if (!estAutoriseCandidature(interaction, roleAutorise)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }

    const thread = interaction.channel;
    const estThread = thread && thread.isThread && thread.isThread();
    const userId = estThread ? trouverUserIdParThread(thread.id) : null;

    if (!estThread || !userId) {
      return interaction.reply({ content: "⚠️ Cette commande doit être utilisée dans un fil de ticket ouvert.", ephemeral: true });
    }

    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
      return interaction.reply({ content: "⚠️ Impossible de retrouver le créateur de ce ticket.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    let roleAttribue = false;
    if (estValidation && cfg.roleAValider) {
      const membreCible = await interaction.guild.members.fetch(userId).catch(() => null);
      if (membreCible) {
        roleAttribue = await membreCible.roles
          .add(cfg.roleAValider)
          .then(() => true)
          .catch((e) => {
            console.error("Erreur attribution rôle validation:", e.message);
            return false;
          });
      }
    }

    const raison = interaction.options.getString("raison") || "";
    const maintenant = new Date();
    const dateStr = `${maintenant.toLocaleDateString("fr-FR")} ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

    const vars = {
      user: user.tag,
      mention: `<@${user.id}>`,
      username: user.username,
      server: interaction.guild.name,
      staff: interaction.user.tag,
      ticket: thread.name,
      date: dateStr,
      raison,
    };

    const salonId = (estValidation ? cfg.salonValidation : cfg.salonRefus) || cfg.salonValidation;
    const messageTemplate = estValidation ? cfg.messageValidation : cfg.messageRefus;
    const mpTemplate = estValidation ? cfg.mpValidation : cfg.mpRefus;
    const couleur = estValidation ? "#2ecc71" : "#e74c3c";

    let texteResultat = remplacerVariables(messageTemplate, vars);
    if (raison) texteResultat += `\n**Raison :** ${raison}`;

    if (salonId) {
      const salonResultat = await client.channels.fetch(salonId).catch(() => null);
      if (salonResultat) {
        await salonResultat
          .send({
            content: cfg.mentionUser ? vars.mention : undefined,
            embeds: [
              new EmbedBuilder()
                .setColor(couleur)
                .setDescription(texteResultat)
                .setFooter({ text: `Par ${interaction.user.tag}` })
                .setTimestamp(),
            ],
          })
          .catch((e) => console.error("Erreur envoi salon résultat candidature:", e));
      }
    }

    let mpEnvoye = false;
    if (cfg.mpActif) {
      let texteMp = remplacerVariables(mpTemplate, vars);
      if (raison) texteMp += `\n**Raison :** ${raison}`;
      mpEnvoye = await user
        .send({ embeds: [new EmbedBuilder().setColor(couleur).setDescription(texteMp).setTimestamp()] })
        .then(() => true)
        .catch(() => false);
    }

    candHistory.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      userId,
      username: user.tag,
      ticketNumber: tickets[userId]?.number || null,
      threadName: thread.name,
      result: estValidation ? "validee" : "refusee",
      staffId: interaction.user.id,
      staffTag: interaction.user.tag,
      raison,
      date: new Date().toISOString(),
    });
    if (candHistory.length > 500) candHistory = candHistory.slice(0, 500);
    sauverCandHistory();

    const suffixeMp = cfg.mpActif ? (mpEnvoye ? " (MP envoyé ✅)" : " (⚠️ MP non envoyé, DMs fermés ?)") : "";
    const suffixeRole = estValidation && cfg.roleAValider ? (roleAttribue ? " (rôle attribué ✅)" : " (⚠️ rôle non attribué)") : "";
    await interaction.editReply({
      content: `${estValidation ? "✅" : "❌"} Candidature de <@${userId}> ${estValidation ? "validée" : "refusée"}.${suffixeMp}${suffixeRole}`,
    });

    if (cfg.fermetureAuto) {
      const delaiMs = Math.max(0, parseInt(cfg.fermetureDelai, 10) || 0) * 1000;
      setTimeout(() => {
        fermerTicketParThread(thread.id, `${interaction.user.tag} (${estValidation ? "validation" : "refus"} auto)`).catch((e) =>
          console.error("Erreur fermeture auto ticket:", e)
        );
      }, delaiMs);
    }

    return;
  }

  // ---- Commande /warn ----
  if (interaction.isChatInputCommand() && interaction.commandName === "warn") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    const membre = interaction.options.getUser("membre");
    const raison = interaction.options.getString("raison");

    if (!warns[membre.id]) warns[membre.id] = [];
    warns[membre.id].push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      reason: raison,
      staffId: interaction.user.id,
      staffTag: interaction.user.tag,
      date: new Date().toISOString(),
    });
    sauverWarns();

    const penalty = gradesConfig.settings.xpPerWarn || -25;
    await addXp(membre.id, penalty, "penalty", "Avertissement reçu");

    await envoyerLogModeration(
      embedLogModeration({
        action: "Avertissement",
        couleur: "#f59e0b",
        emoji: "⚠️",
        cibleTag: membre.tag,
        cibleId: membre.id,
        parTag: interaction.user.tag,
        raison,
      })
    );

    await membre
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor("#f59e0b")
            .setTitle(`⚠️ Tu as reçu un avertissement sur ${NOM_SERVEUR}`)
            .setDescription(`**Raison :** ${raison}`)
            .setTimestamp(),
        ],
      })
      .catch(() => {});

    return interaction.reply({
      content: `⚠️ ${membre.tag} a été averti (${warns[membre.id].length} avertissement(s) au total). Raison : ${raison}`,
      ephemeral: true,
    });
  }

  // ---- Commande /warns ----
  if (interaction.isChatInputCommand() && interaction.commandName === "warns") {
    const membre = interaction.options.getUser("membre");
    const liste = warns[membre.id] || [];
    if (!liste.length) {
      return interaction.reply({ content: `${membre.tag} n'a aucun avertissement.`, ephemeral: true });
    }
    const texte = liste
      .map((w, i) => `**${i + 1}.** ${w.reason} — *par ${w.staffTag}, le ${new Date(w.date).toLocaleDateString("fr-FR")}*`)
      .join("\n");
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor("#f59e0b")
          .setTitle(`⚠️ Avertissements de ${membre.tag}`)
          .setDescription(texte)
          .setFooter({ text: `${liste.length} avertissement(s) au total` }),
      ],
      ephemeral: true,
    });
  }

  // ---- Commande /intervention ----
  if (interaction.isChatInputCommand() && interaction.commandName === "intervention") {
    const type = interaction.options.getString("type");
    const gravite = interaction.options.getString("gravite");
    const patient = interaction.options.getString("patient") || null;

    const entree = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type,
      gravite,
      patient,
      staffId: interaction.user.id,
      staffTag: interaction.user.tag,
      date: new Date().toISOString(),
    };
    interventions.push(entree);
    sauverInterventions();

    const xpGain = gradesConfig.settings.xpPerIntervention || 50;
    await addXp(interaction.user.id, xpGain, "intervention", `Intervention ${LABELS_TYPE_INTERVENTION[type]}`);

    if (config.interventionsChannelId) {
      const salon = await client.channels.fetch(config.interventionsChannelId).catch(() => null);
      if (salon) {
        await salon.send({
          embeds: [
            new EmbedBuilder()
              .setColor(COULEUR_EMBED)
              .setTitle("🚑 Intervention loggée")
              .addFields(
                { name: "Type", value: LABELS_TYPE_INTERVENTION[type] || type, inline: true },
                { name: "Gravité", value: LABELS_GRAVITE_INTERVENTION[gravite] || gravite, inline: true },
                { name: "Intervenant", value: `<@${interaction.user.id}>`, inline: true },
                { name: "Patient", value: patient || "Non précisé", inline: false }
              )
              .setTimestamp(),
          ],
        }).catch(() => {});
      }
    }

    return interaction.reply({
      content: `✅ Intervention loggée : **${LABELS_TYPE_INTERVENTION[type]}** (${LABELS_GRAVITE_INTERVENTION[gravite]})${patient ? ` — patient : ${patient}` : ""}`,
      ephemeral: true,
    });
  }

  // ---- Commande /rapport ----
  if (interaction.isChatInputCommand() && interaction.commandName === "rapport") {
    const modal = new ModalBuilder()
      .setCustomId("rapportModal")
      .setTitle("Rapport d'intervention médicale");

    const patientInput = new TextInputBuilder()
      .setCustomId("patient")
      .setLabel("Nom et prénom du patient")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Ex: Angel Santiago")
      .setRequired(true);

    const situationInput = new TextInputBuilder()
      .setCustomId("situation")
      .setLabel("Ce qui s'est passé")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Ex: Accident de moto, jambe cassée...")
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(patientInput),
      new ActionRowBuilder().addComponents(situationInput)
    );

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === "rapportModal") {
    const patient = interaction.fields.getTextInputValue("patient");
    const situation = interaction.fields.getTextInputValue("situation");

    const rapport = trouverSituation(situation);

    const maintenant = new Date();
    const dateStr = maintenant.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const heureStr = maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    const diagnosticTexte = rapport.diagnostic.map((d) => `• ${d}`).join("\n");
    const soinsTexte = rapport.prise_en_charge.map((s) => `• ${s}`).join("\n");

    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`📋 Rapport Médical - ${NOM_SERVEUR}`)
      .addFields(
        { name: "👤 Patient", value: patient, inline: true },
        { name: "🩺 Intervenant", value: `<@${interaction.user.id}>`, inline: true },
        { name: "🕒 Date et heure", value: `${dateStr} - ${heureStr}`, inline: false },
        { name: "📌 Motif de prise en charge", value: situation, inline: false },
        { name: "🔍 Examen réalisé", value: rapport.examen, inline: false },
        { name: "🩹 Diagnostic", value: diagnosticTexte, inline: false },
        { name: "💉 Prise en charge", value: soinsTexte, inline: false },
        { name: "📝 Observations", value: rapport.observations, inline: false }
      )
      .setFooter({ text: `Rapport généré par ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ---- Commande /service ----
  if (interaction.isChatInputCommand() && interaction.commandName === "service") {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === "start") {
      const status = getServiceStatus(userId);
      if (status) {
        return interaction.reply({ content: "❌ Tu es déjà en service !", ephemeral: true });
      }
      await startService(userId);
      await interaction.reply({ content: "✅ Tu as pris ton service ! 🟢", ephemeral: true });
      
      // Mettre à jour le message de service
      if (config.serviceChannelId) {
        const channel = await client.channels.fetch(config.serviceChannelId).catch(() => null);
        if (channel && config.serviceMessageId) {
          const msg = await channel.messages.fetch(config.serviceMessageId).catch(() => null);
          if (msg) await mettreAJourMessageService(msg);
        }
      }
    }

    else if (sub === "stop") {
      const status = getServiceStatus(userId);
      if (!status) {
        return interaction.reply({ content: "❌ Tu n'es pas en service !", ephemeral: true });
      }
      const result = await stopService(userId);
      const duration = Math.floor(result.duration / 60);
      await interaction.reply({ 
        content: `✅ Tu as déposé ton service après **${duration} minutes** ! (+${result.xpGain} XP)`,
        ephemeral: true 
      });
      
      if (config.serviceChannelId) {
        const channel = await client.channels.fetch(config.serviceChannelId).catch(() => null);
        if (channel && config.serviceMessageId) {
          const msg = await channel.messages.fetch(config.serviceMessageId).catch(() => null);
          if (msg) await mettreAJourMessageService(msg);
        }
      }
    }

    else if (sub === "status") {
      const status = getServiceStatus(userId);
      if (!status) {
        return interaction.reply({ 
          embeds: [new EmbedBuilder()
            .setColor(COULEUR_EMBED)
            .setDescription("❌ Tu n'es pas en service.")
          ],
          ephemeral: true 
        });
      }
      const start = new Date(status.startTime);
      const duration = Math.floor((Date.now() - start) / 60000);
      const hours = Math.floor(duration / 60);
      const minutes = duration % 60;
      
      const embed = new EmbedBuilder()
        .setColor("#34d399")
        .setTitle("🟢 En service")
        .setDescription(`Tu es en service depuis **${hours}h${minutes}**`)
        .addFields(
          { name: "Heure de début", value: start.toLocaleTimeString("fr-FR"), inline: true },
          { name: "Temps total", value: `${hours}h${minutes}`, inline: true }
        )
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // ---- Commande /services ----
  if (interaction.isChatInputCommand() && interaction.commandName === "services") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }

    const active = getActiveServices();
    if (active.length === 0) {
      return interaction.reply({ 
        embeds: [new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setDescription("Aucun membre en service.")
        ],
        ephemeral: true 
      });
    }

    const liste = await Promise.all(active.map(async (s) => {
      const user = await client.users.fetch(s.userId).catch(() => null);
      const start = new Date(s.startTime);
      const duration = Math.floor((Date.now() - start) / 60000);
      const hours = Math.floor(duration / 60);
      const minutes = duration % 60;
      return `• ${user?.username || s.userId} — ⏱️ ${hours}h${minutes}`;
    }));

    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle("🟢 Membres en service")
      .setDescription(liste.join('\n'))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ---- Commande /profile ----
  if (interaction.isChatInputCommand() && interaction.commandName === "profile") {
    const target = interaction.options.getUser("membre") || interaction.user;
    const data = xpData[target.id];
    
    if (!data) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setDescription(`❌ ${target.username} n'a pas encore d'XP.`)
        ],
        ephemeral: true
      });
    }
    
    const grade = getGradeForXp(data.xp || 0);
    const { level, currentXp, nextXp } = getLevelFromXp(data.xp || 0);
    const progress = nextXp ? Math.round((currentXp / nextXp) * 100) : 100;
    const serviceStatus = getServiceStatus(target.id);
    
    const embed = new EmbedBuilder()
      .setColor(grade.color || COULEUR_EMBED)
      .setTitle(`${grade.icon} ${grade.name}`)
      .setDescription(`Profil de **${target.username}**`)
      .addFields(
        { name: "📊 Niveau", value: String(level), inline: true },
        { name: "🏆 XP total", value: String(data.xp), inline: true },
        { name: "🎯 Progression", value: nextXp ? `${progress}% (${currentXp}/${nextXp})` : "🏆 Max", inline: true },
        { name: "🚑 Interventions", value: String(data.interventions || 0), inline: true },
        { name: "⏱️ Temps de service", value: `${Math.floor((data.serviceTime || 0) / 3600)}h`, inline: true },
        { name: "📝 Messages", value: String(data.messages || 0), inline: true },
        { name: "🟢 Statut", value: serviceStatus ? "En service" : "Hors service", inline: true }
      )
      .setTimestamp();
    
    if (grade.perks && grade.perks.length) {
      embed.addFields({ name: "🔓 Privilèges", value: grade.perks.map(p => `• ${p}`).join('\n'), inline: false });
    }
    
    await interaction.reply({ embeds: [embed] });
  }

  // ---- Commande /leaderboard ----
  if (interaction.isChatInputCommand() && interaction.commandName === "leaderboard") {
    await interaction.deferReply();
    
    const sorted = Object.entries(xpData)
      .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
      .slice(0, 10)
      .map(([userId, data], i) => {
        const grade = getGradeForXp(data.xp || 0);
        const user = client.users.cache.get(userId);
        return `**${i+1}.** ${user?.username || userId} — ${grade.icon} ${grade.name} (Niv. ${getLevelFromXp(data.xp || 0).level}) — ${data.xp || 0} XP`;
      });
    
    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle("🏆 Classement des membres")
      .setDescription(sorted.join('\n') || "Aucun membre")
      .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
  }

  // ---- Commande /givexp ----
  if (interaction.isChatInputCommand() && interaction.commandName === "givexp") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "⛔ Seuls les administrateurs peuvent utiliser cette commande.", ephemeral: true });
    }
    
    const membre = interaction.options.getUser("membre");
    const quantite = interaction.options.getInteger("quantite");
    const raison = interaction.options.getString("raison") || "Don manuel";
    
    await addXp(membre.id, quantite, "manual", raison);
    
    await interaction.reply({
      content: `✅ ${quantite} XP ont été donnés à ${membre.tag}. Raison : ${raison}`,
      ephemeral: true
    });
  }

  // ---- Commande /grade ----
  if (interaction.isChatInputCommand() && interaction.commandName === "grade") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "⛔ Seuls les administrateurs peuvent utiliser cette commande.", ephemeral: true });
    }
    
    const subcommand = interaction.options.getSubcommand();
    const membre = interaction.options.getUser("membre");
    
    if (subcommand === "set") {
      const gradeId = interaction.options.getString("grade");
      const grade = gradesConfig.grades.find(g => g.id === gradeId);
      
      if (!grade) {
        return interaction.reply({ content: "❌ Grade invalide.", ephemeral: true });
      }
      
      if (!xpData[membre.id]) {
        xpData[membre.id] = { xp: 0, serviceTime: 0, interventions: 0, messages: 0, voiceTime: 0, lastActivity: new Date().toISOString() };
      }
      
      xpData[membre.id].xp = grade.xpRequired;
      sauverXp();
      
      await interaction.reply({
        content: `✅ ${membre.tag} a été promu au grade **${grade.name}** (${grade.xpRequired} XP).`,
        ephemeral: true
      });
    }
    
    if (subcommand === "reset") {
      if (!xpData[membre.id]) {
        return interaction.reply({ content: `❌ ${membre.tag} n'a pas d'XP.`, ephemeral: true });
      }
      
      delete xpData[membre.id];
      sauverXp();
      
      await interaction.reply({
        content: `✅ L'XP de ${membre.tag} a été réinitialisée.`,
        ephemeral: true
      });
    }
  }
});

// ==================================================================
// PANEL WEB (Express)
// ==================================================================
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 12 },
  })
);

app.get("/", (req, res) => res.send("Le bot est en ligne !"));

function authRequis(req, res, next) {
  if (req.session.user) return next();
  return res.status(401).json({ erreur: "Non authentifié" });
}

function getGuild(res) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    res.status(500).json({ erreur: "Le bot n'est pas sur le serveur configuré (GUILD_ID)" });
    return null;
  }
  return guild;
}

// ---- Auth Discord OAuth2 ----
app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/panel");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/auth/discord", (req, res) => {
  const url =
    `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/login");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Pas de token reçu");

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userRes.json();

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return res.status(500).send("Le bot n'est pas sur le serveur configuré (GUILD_ID).");

    const membre = await guild.members.fetch(discordUser.id).catch(() => null);
    if (!membre) return res.status(403).send("Tu n'es pas membre du serveur.");

    const estAdmin = membre.permissions.has(PermissionsBitField.Flags.Administrator);
    const aRoleAutorise = membre.roles.cache.some((role) => ROLES_AUTORISES.includes(role.id));
    if (!estAdmin && !aRoleAutorise) return res.status(403).send("Accès refusé : tu n'as pas le rôle requis pour accéder au panel.");

    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      avatar: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null,
    };

    res.redirect("/panel");
  } catch (e) {
    console.error("Erreur OAuth callback:", e);
    res.status(500).send("Erreur lors de la connexion Discord.");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/panel", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "public", "panel.html"));
});

app.get("/api/me", authRequis, (req, res) => res.json(req.session.user));

// ---- Dashboard ----
app.get("/api/stats", authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;

  res.json({
    memberCount: guild.memberCount,
    channelCount: guild.channels.cache.size,
    roleCount: guild.roles.cache.size,
    ping: client.ws.ping,
    uptime: Math.floor(process.uptime()),
    ticketsOuverts: Object.keys(tickets).length,
    giveawaysActifs: Object.values(giveaways).filter((g) => !g.ended).length,
    servicesActifs: getActiveServices().length,
  });
});

// ---- Salons ----
app.get("/api/channels", authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;

  const salons = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
    .map((c) => ({ id: c.id, name: c.name, type: c.type }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json(salons);
});

app.get("/api/channels/all", authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;

  const salons = guild.channels.cache
    .map((c) => ({ id: c.id, name: c.name, type: c.type }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json(salons);
});

app.post("/api/channels", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const { name, type } = req.body;
  if (!name) return res.status(400).json({ erreur: "name requis" });

  try {
    const channel = await guild.channels.create({
      name,
      type: type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText,
    });
    res.json({ succes: true, id: channel.id });
  } catch (e) {
    console.error("Erreur création salon:", e);
    res.status(500).json({ erreur: "Échec de la création" });
  }
});

app.delete("/api/channels/:id", authRequis, async (req, res) => {
  try {
    const channel = await client.channels.fetch(req.params.id);
    await channel.delete();
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur suppression salon:", e);
    res.status(500).json({ erreur: "Échec de la suppression" });
  }
});

// ---- Rôles ----
app.get("/api/roles", authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;

  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
    .sort((a, b) => b.position - a.position);

  res.json(roles);
});

app.post("/api/roles", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const { name, color, hoist, mentionable } = req.body;
  if (!name) return res.status(400).json({ erreur: "name requis" });

  try {
    const role = await guild.roles.create({
      name,
      color: color ? parseInt(color.replace("#", ""), 16) : undefined,
      hoist: !!hoist,
      mentionable: !!mentionable,
    });
    res.json({ succes: true, id: role.id });
  } catch (e) {
    console.error("Erreur création rôle:", e);
    res.status(500).json({ erreur: "Échec de la création" });
  }
});

app.delete("/api/roles/:id", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const role = await guild.roles.fetch(req.params.id);
    await role.delete();
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur suppression rôle:", e);
    res.status(500).json({ erreur: "Échec de la suppression" });
  }
});

// ---- Membres / Modération ----
app.get("/api/members/search", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const q = req.query.q || "";
  if (!q) return res.json([]);

  try {
    const resultats = await guild.members.fetch({ query: q, limit: 15 });
    res.json(
      resultats.map((m) => ({
        id: m.id,
        username: m.user.username,
        tag: m.user.tag,
        avatar: m.user.displayAvatarURL(),
        roles: m.roles.cache.filter((r) => r.id !== guild.id).map((r) => ({ id: r.id, name: r.name })),
        joinedAt: m.joinedAt,
        warnCount: (warns[m.id] || []).length,
        isOnService: !!getServiceStatus(m.id),
      }))
    );
  } catch (e) {
    console.error("Erreur recherche membre:", e);
    res.status(500).json({ erreur: "Échec de la recherche" });
  }
});

app.post("/api/members/:id/kick", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const membre = await guild.members.fetch(req.params.id);
    const raison = req.body.reason || "Aucune raison fournie";
    const tag = membre.user.tag;
    await membre.kick(raison);
    
    const penalty = gradesConfig.settings.xpPerKick || -50;
    await addXp(req.params.id, penalty, "penalty", "Kick reçu");
    
    await envoyerLogModeration(
      embedLogModeration({
        action: "Kick",
        couleur: "#fb923c",
        emoji: "👢",
        cibleTag: tag,
        cibleId: req.params.id,
        parTag: req.session.user.username + " (panel)",
        raison,
      })
    );
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur kick:", e);
    res.status(500).json({ erreur: "Échec du kick" });
  }
});

app.post("/api/members/:id/ban", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const raison = req.body.reason || "Aucune raison fournie";
    let tag = req.params.id;
    const membre = await guild.members.fetch(req.params.id).catch(() => null);
    if (membre) tag = membre.user.tag;
    await guild.members.ban(req.params.id, { reason: raison });
    
    const penalty = gradesConfig.settings.xpPerBan || -100;
    await addXp(req.params.id, penalty, "penalty", "Ban reçu");
    
    await envoyerLogModeration(
      embedLogModeration({
        action: "Ban",
        couleur: "#ef4444",
        emoji: "🔨",
        cibleTag: tag,
        cibleId: req.params.id,
        parTag: req.session.user.username + " (panel)",
        raison,
      })
    );
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur ban:", e);
    res.status(500).json({ erreur: "Échec du ban" });
  }
});

app.post("/api/members/:id/timeout", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const membre = await guild.members.fetch(req.params.id);
    const minutes = parseInt(req.body.minutes, 10) || 10;
    const raison = req.body.reason || "Aucune raison fournie";
    await membre.timeout(minutes * 60 * 1000, raison);
    await envoyerLogModeration(
      embedLogModeration({
        action: `Timeout (${minutes} min)`,
        couleur: "#facc15",
        emoji: "⏱️",
        cibleTag: membre.user.tag,
        cibleId: req.params.id,
        parTag: req.session.user.username + " (panel)",
        raison,
      })
    );
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur timeout:", e);
    res.status(500).json({ erreur: "Échec du timeout" });
  }
});

app.post("/api/members/:id/roles/:roleId", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const membre = await guild.members.fetch(req.params.id);
    if (req.body.action === "remove") {
      await membre.roles.remove(req.params.roleId);
    } else {
      await membre.roles.add(req.params.roleId);
    }
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur rôle membre:", e);
    res.status(500).json({ erreur: "Échec de la modification du rôle" });
  }
});

// ---- Warns ----
app.get("/api/members/:id/warns", authRequis, (req, res) => {
  res.json(warns[req.params.id] || []);
});

app.post("/api/members/:id/warn", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const raison = (req.body.reason || "").trim();
  if (!raison) return res.status(400).json({ erreur: "reason requis" });

  try {
    const membre = await guild.members.fetch(req.params.id).catch(() => null);
    if (!warns[req.params.id]) warns[req.params.id] = [];
    warns[req.params.id].push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      reason: raison,
      staffId: req.session.user.id,
      staffTag: req.session.user.username + " (panel)",
      date: new Date().toISOString(),
    });
    sauverWarns();

    const penalty = gradesConfig.settings.xpPerWarn || -25;
    await addXp(req.params.id, penalty, "penalty", "Avertissement reçu");

    await envoyerLogModeration(
      embedLogModeration({
        action: "Avertissement",
        couleur: "#f59e0b",
        emoji: "⚠️",
        cibleTag: membre ? membre.user.tag : req.params.id,
        cibleId: req.params.id,
        parTag: req.session.user.username + " (panel)",
        raison,
      })
    );

    if (membre) {
      await membre.user
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor("#f59e0b")
              .setTitle(`⚠️ Tu as reçu un avertissement sur ${NOM_SERVEUR}`)
              .setDescription(`**Raison :** ${raison}`)
              .setTimestamp(),
          ],
        })
        .catch(() => {});
    }

    res.json({ succes: true, warns: warns[req.params.id] });
  } catch (e) {
    console.error("Erreur ajout warn:", e);
    res.status(500).json({ erreur: "Échec de l'ajout de l'avertissement" });
  }
});

app.delete("/api/members/:id/warns/:warnId", authRequis, (req, res) => {
  const liste = warns[req.params.id] || [];
  const avant = liste.length;
  warns[req.params.id] = liste.filter((w) => w.id !== req.params.warnId);
  sauverWarns();
  res.json({ succes: true, supprime: avant !== warns[req.params.id].length });
});

// ---- Paramètres ----
app.get("/api/settings", authRequis, (req, res) => res.json(config));

app.post("/api/settings", authRequis, (req, res) => {
  const {
    autoRoleId,
    welcomeChannelId,
    welcomeMessage,
    ticketStaffChannelId,
    ticketLogsChannelId,
    modLogsChannelId,
    interventionsChannelId,
    ticketAutoCloseHours,
    serviceChannelId,
  } = req.body;
  config.autoRoleId = autoRoleId || null;
  config.welcomeChannelId = welcomeChannelId || null;
  config.welcomeMessage = welcomeMessage || config.welcomeMessage;
  config.ticketStaffChannelId = ticketStaffChannelId || null;
  config.ticketLogsChannelId = ticketLogsChannelId || null;
  config.modLogsChannelId = modLogsChannelId || null;
  config.interventionsChannelId = interventionsChannelId || null;
  config.ticketAutoCloseHours = Math.max(0, parseFloat(ticketAutoCloseHours) || 0);
  config.serviceChannelId = serviceChannelId || null;
  sauverConfig();
  
  // Réenvoyer le message de service si le salon a changé
  if (config.serviceChannelId) {
    envoyerMessageService();
  }
  
  res.json({ succes: true });
});

// ---- Candidatures ----
app.get("/api/settings/candidatures", authRequis, (req, res) => {
  res.json(config.candidatures);
});

app.post("/api/settings/candidatures", authRequis, (req, res) => {
  const {
    actif,
    salonValidation,
    salonRefus,
    roleValid,
    roleRefus,
    roleAValider,
    mpActif,
    mentionUser,
    fermetureAuto,
    fermetureDelai,
    messageValidation,
    messageRefus,
    mpValidation,
    mpRefus,
  } = req.body;

  config.candidatures = {
    actif: !!actif,
    salonValidation: salonValidation || null,
    salonRefus: salonRefus || null,
    roleValid: roleValid || null,
    roleRefus: roleRefus || null,
    roleAValider: roleAValider || null,
    mpActif: mpActif !== undefined ? !!mpActif : config.candidatures.mpActif,
    mentionUser: mentionUser !== undefined ? !!mentionUser : config.candidatures.mentionUser,
    fermetureAuto: !!fermetureAuto,
    fermetureDelai: Math.max(0, parseInt(fermetureDelai, 10) || 0),
    messageValidation: messageValidation || CANDIDATURES_DEFAUT.messageValidation,
    messageRefus: messageRefus || CANDIDATURES_DEFAUT.messageRefus,
    mpValidation: mpValidation || CANDIDATURES_DEFAUT.mpValidation,
    mpRefus: mpRefus || CANDIDATURES_DEFAUT.mpRefus,
  };
  sauverConfig();
  res.json({ succes: true, candidatures: config.candidatures });
});

// ---- Historique candidatures ----
app.get("/api/candidatures/history", authRequis, (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  let liste = candHistory;
  if (q) {
    liste = liste.filter(
      (h) =>
        h.username.toLowerCase().includes(q) ||
        (h.threadName || "").toLowerCase().includes(q) ||
        (h.staffTag || "").toLowerCase().includes(q)
    );
  }
  res.json(liste.slice(0, 200));
});

// ---- Interventions ----
app.get("/api/interventions/stats", authRequis, (req, res) => {
  res.json(statsInterventions());
});

app.get("/api/interventions", authRequis, (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  let liste = [...interventions].reverse();
  if (q) {
    liste = liste.filter(
      (iv) =>
        (iv.patient || "").toLowerCase().includes(q) ||
        (iv.staffTag || "").toLowerCase().includes(q) ||
        iv.type.toLowerCase().includes(q)
    );
  }
  res.json(liste.slice(0, 200));
});

app.delete("/api/interventions/:id", authRequis, (req, res) => {
  const avant = interventions.length;
  interventions = interventions.filter((iv) => iv.id !== req.params.id);
  sauverInterventions();
  res.json({ succes: true, supprime: avant !== interventions.length });
});

// ---- Annonces ----
app.post("/api/send-embed", authRequis, upload.single("imageFile"), async (req, res) => {
  const { channelId, title, description, color, imageUrl, footer } = req.body;
  if (!channelId || !title) return res.status(400).json({ erreur: "channelId et title sont requis" });

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return res.status(400).json({ erreur: "Salon invalide" });

    const embed = new EmbedBuilder().setTitle(title).setColor(color || COULEUR_EMBED).setTimestamp();
    if (description) embed.setDescription(description);
    if (footer) embed.setFooter({ text: footer });

    const options = { embeds: [embed] };

    if (req.file) {
      const nomFichier = "image" + path.extname(req.file.originalname || "").slice(0, 10) || "image.png";
      embed.setImage(`attachment://${nomFichier}`);
      options.files = [{ attachment: req.file.buffer, name: nomFichier }];
    } else if (imageUrl) {
      embed.setImage(imageUrl);
    }

    await channel.send(options);
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur envoi embed:", e);
    res.status(500).json({ erreur: "Échec de l'envoi" });
  }
});

// ---- Tickets ----
app.get("/api/tickets", authRequis, (req, res) => {
  res.json(
    Object.entries(tickets).map(([userId, t]) => ({
      userId,
      username: t.username,
      threadId: t.threadId,
      number: t.number,
      priority: t.priority,
      note: t.note || "",
      lastActivity: t.lastActivity || null,
    }))
  );
});

app.post("/api/tickets/:userId/reply", authRequis, async (req, res) => {
  const { userId } = req.params;
  const { message } = req.body;
  if (!message) return res.status(400).json({ erreur: "message requis" });

  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: "Ticket introuvable" });

  try {
    const user = await client.users.fetch(userId);
    await user.send(`**[Staff - ${req.session.user.username}]** : ${message}`);

    const thread = await client.channels.fetch(ticket.threadId).catch(() => null);
    if (thread) await thread.send(`**${req.session.user.username} (panel)** : ${message}`);

    ticket.lastActivity = new Date().toISOString();
    sauverTickets();

    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur réponse ticket:", e);
    res.status(500).json({ erreur: "Échec de l'envoi (DM peut-être fermés)" });
  }
});

app.post("/api/tickets/:userId/note", authRequis, (req, res) => {
  const { userId } = req.params;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: "Ticket introuvable" });
  ticket.note = (req.body.note || "").slice(0, 2000);
  sauverTickets();
  res.json({ succes: true });
});

app.post("/api/tickets/:userId/close", authRequis, async (req, res) => {
  const { userId } = req.params;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: "Ticket introuvable" });

  try {
    await fermerTicketParThread(ticket.threadId, req.session.user.username + " (panel)");
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur fermeture ticket:", e);
    res.status(500).json({ erreur: "Échec de la fermeture" });
  }
});

// ---- Giveaways ----
app.get("/api/giveaways", authRequis, (req, res) => {
  res.json(Object.values(giveaways).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post("/api/giveaways", authRequis, async (req, res) => {
  const { channelId, prize, durationMinutes, winnersCount } = req.body;
  if (!channelId || !prize) return res.status(400).json({ erreur: "channelId et prize requis" });

  try {
    const channel = await client.channels.fetch(channelId);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const endsAt = new Date(Date.now() + (parseInt(durationMinutes, 10) || 60) * 60 * 1000);

    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`🎉 Giveaway : ${prize}`)
      .setDescription(`Clique sur le bouton pour participer !\nFin <t:${Math.floor(endsAt.getTime() / 1000)}:R>`)
      .setFooter({ text: `${parseInt(winnersCount, 10) || 1} gagnant(s)` })
      .setTimestamp();

    const bouton = new ButtonBuilder()
      .setCustomId(`giveaway_${id}`)
      .setLabel("🎉 Participer")
      .setStyle(ButtonStyle.Success);

    const message = await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(bouton)] });

    const giveaway = {
      id,
      channelId,
      messageId: message.id,
      prize,
      winnersCount: parseInt(winnersCount, 10) || 1,
      endsAt: endsAt.toISOString(),
      createdAt: new Date().toISOString(),
      participants: [],
      ended: false,
    };
    giveaways[id] = giveaway;
    sauverGiveaways();
    planifierFinGiveaway(giveaway);

    res.json({ succes: true, id });
  } catch (e) {
    console.error("Erreur création giveaway:", e);
    res.status(500).json({ erreur: "Échec de la création" });
  }
});

app.post("/api/giveaways/:id/end", authRequis, async (req, res) => {
  try {
    await terminerGiveaway(req.params.id);
    res.json({ succes: true });
  } catch (e) {
    res.status(500).json({ erreur: "Échec" });
  }
});

// ---- XP & GRADES API ----
app.get('/api/xp/stats', authRequis, (req, res) => {
  const totalXp = Object.values(xpData).reduce((sum, d) => sum + (d.xp || 0), 0);
  const activeMembers = Object.keys(xpData).length;
  const totalInterventions = Object.values(xpData).reduce((sum, d) => sum + (d.interventions || 0), 0);
  
  const grades = Object.values(xpData).map(d => getGradeForXp(d.xp || 0).name);
  const gradeCounts = {};
  grades.forEach(g => gradeCounts[g] = (gradeCounts[g] || 0) + 1);
  let averageGrade = 'N/A';
  if (grades.length) {
    const sorted = Object.entries(gradeCounts).sort((a, b) => b[1] - a[1]);
    averageGrade = sorted[0][0];
  }
  
  res.json({ totalXp, activeMembers, totalInterventions, averageGrade });
});

app.get('/api/xp/top5', authRequis, (req, res) => {
  const sorted = Object.entries(xpData)
    .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
    .slice(0, 5)
    .map(([userId, data]) => {
      const grade = getGradeForXp(data.xp || 0);
      const user = client.users.cache.get(userId);
      return {
        userId,
        username: user?.username || userId,
        xp: data.xp || 0,
        level: getLevelFromXp(data.xp || 0).level,
        grade: grade.name,
        interventions: data.interventions || 0
      };
    });
  res.json(sorted);
});

app.get('/api/grades', authRequis, (req, res) => {
  res.json(gradesConfig);
});

app.post('/api/grades', authRequis, (req, res) => {
  const { id, name, level, xpRequired, icon, color, perks, notifications } = req.body;
  
  if (gradesConfig.grades.some(g => g.id === id)) {
    return res.status(400).json({ erreur: 'Un grade avec cet ID existe déjà' });
  }
  
  gradesConfig.grades.push({
    id, name, level, xpRequired, icon, color,
    perks: perks || [],
    notifications: notifications !== false
  });
  
  gradesConfig.grades.sort((a, b) => a.xpRequired - b.xpRequired);
  sauverGrades();
  res.json({ succes: true });
});

app.delete('/api/grades/:id', authRequis, (req, res) => {
  gradesConfig.grades = gradesConfig.grades.filter(g => g.id !== req.params.id);
  sauverGrades();
  res.json({ succes: true });
});

app.get('/api/xp/settings', authRequis, (req, res) => {
  res.json(gradesConfig.settings);
});

app.post('/api/xp/settings', authRequis, (req, res) => {
  gradesConfig.settings = { ...gradesConfig.settings, ...req.body };
  sauverGrades();
  res.json({ succes: true });
});

app.get('/api/xp/leaderboard', authRequis, (req, res) => {
  let members = Object.entries(xpData)
    .map(([userId, data]) => {
      const grade = getGradeForXp(data.xp || 0);
      const user = client.users.cache.get(userId);
      return {
        userId,
        username: user?.username || userId,
        xp: data.xp || 0,
        level: getLevelFromXp(data.xp || 0).level,
        grade: grade.name,
        gradeId: grade.id,
        gradeIcon: grade.icon,
        gradeColor: grade.color,
        interventions: data.interventions || 0,
        serviceTime: data.serviceTime || 0,
        messages: data.messages || 0,
        voiceTime: data.voiceTime || 0
      };
    });

  if (req.query.grade && req.query.grade !== 'all') {
    members = members.filter(m => m.gradeId === req.query.grade);
  }
  if (req.query.search) {
    const s = req.query.search.toLowerCase();
    members = members.filter(m => m.username.toLowerCase().includes(s));
  }

  const sortField = req.query.sort || 'xp';
  members.sort((a, b) => (b[sortField] || 0) - (a[sortField] || 0));

  res.json(members);
});

app.get('/api/xp/profile', authRequis, (req, res) => {
  const search = req.query.search || '';
  let userId = search;
  
  if (!Object.keys(xpData).includes(search)) {
    const found = client.users.cache.find(u => 
      u.username.toLowerCase().includes(search.toLowerCase())
    );
    if (found) userId = found.id;
  }
  
  if (!userId || !xpData[userId]) {
    return res.status(404).json({ erreur: 'Membre non trouvé' });
  }
  
  const data = xpData[userId];
  const grade = getGradeForXp(data.xp || 0);
  const user = client.users.cache.get(userId);
  const serviceStatus = getServiceStatus(userId);
  
  res.json({
    userId,
    username: user?.username || userId,
    xp: data.xp || 0,
    level: getLevelFromXp(data.xp || 0).level,
    grade: grade.name,
    gradeIcon: grade.icon,
    gradeColor: grade.color,
    perks: grade.perks || [],
    interventions: data.interventions || 0,
    serviceTime: data.serviceTime || 0,
    messages: data.messages || 0,
    voiceTime: data.voiceTime || 0,
    lastActivity: data.lastActivity || new Date().toISOString(),
    isOnService: !!serviceStatus,
    serviceStart: serviceStatus?.startTime || null
  });
});

app.get('/api/xp/logs', authRequis, (req, res) => {
  let logs = [...xpLogs];
  if (req.query.type && req.query.type !== 'all') {
    logs = logs.filter(l => l.type === req.query.type);
  }
  if (req.query.search) {
    const s = req.query.search.toLowerCase();
    logs = logs.filter(l => l.username.toLowerCase().includes(s));
  }
  res.json(logs);
});

// ---- SERVICE API ----
app.get('/api/service/active', authRequis, (req, res) => {
  const active = getActiveServices();
  res.json(active);
});

app.get('/api/service/member/:id', authRequis, (req, res) => {
  const data = serviceData[req.params.id];
  if (!data) return res.json({ active: false });
  res.json({
    active: data.active || false,
    startTime: data.startTime || null,
    totalTime: data.totalTime || 0,
    sessions: data.sessions || []
  });
});

app.post('/api/service/config', authRequis, (req, res) => {
  const { channelId } = req.body;
  config.serviceChannelId = channelId || null;
  sauverConfig();
  
  if (config.serviceChannelId) {
    envoyerMessageService();
  }
  
  res.json({ succes: true });
});

// ---- BACKUP ----
app.get("/api/backup", authRequis, (req, res) => {
  const backup = {
    generatedAt: new Date().toISOString(),
    config,
    tickets,
    giveaways,
    closedTickets,
    warns,
    candHistory,
    interventions,
    xpData,
    gradesConfig,
    xpLogs,
    serviceData,
  };
  const nomFichier = `backup-ems-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(backup, null, 2));
});

app.post("/api/backup/import", authRequis, (req, res) => {
  try {
    const data = req.body || {};
    if (data.config) {
      config = { ...config, ...data.config, candidatures: { ...CANDIDATURES_DEFAUT, ...(data.config.candidatures || {}) } };
      sauverConfig();
    }
    if (data.tickets) { tickets = data.tickets; sauverTickets(); }
    if (data.giveaways) { giveaways = data.giveaways; sauverGiveaways(); }
    if (data.closedTickets) { closedTickets = data.closedTickets; sauverClosedTickets(); }
    if (data.warns) { warns = data.warns; sauverWarns(); }
    if (data.candHistory) { candHistory = data.candHistory; sauverCandHistory(); }
    if (data.interventions) { interventions = data.interventions; sauverInterventions(); }
    if (data.xpData) { xpData = data.xpData; sauverXp(); }
    if (data.gradesConfig) { gradesConfig = data.gradesConfig; sauverGrades(); }
    if (data.xpLogs) { xpLogs = data.xpLogs; sauverXpLogs(); }
    if (data.serviceData) { serviceData = data.serviceData; sauverService(); }
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur import backup:", e);
    res.status(500).json({ erreur: "Fichier de backup invalide" });
  }
});

app.listen(PORT, () => console.log(`Serveur web + panel actif sur le port ${PORT}`));
