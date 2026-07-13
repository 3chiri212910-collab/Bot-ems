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
} = require("discord.js");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// ==============================
// CHARGEMENT SITUATIONS AVEC GESTION D'ERREUR
// ==============================
let trouverSituation = (situation) => ({
  diagnostic: ["Non diagnostiqué"],
  prise_en_charge: ["Aucune prise en charge"],
  examen: "Examen non spécifié",
  observations: "Aucune observation"
});

try {
  const module = require("./situations.js");
  if (module.trouverSituation) {
    trouverSituation = module.trouverSituation;
    console.log("✅ situations.js chargé avec succès");
  }
} catch (e) {
  console.warn("⚠️ situations.js non trouvé, mode dégradé activé");
}

// ==============================
// CONFIGURATION
// ==============================
const requiredEnv = ['TOKEN', 'CLIENT_ID', 'GUILD_ID'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Variable d'environnement ${key} manquante !`);
    console.error(`   Veuillez définir ${key} dans votre fichier .env`);
    process.exit(1);
  }
}

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET || "";
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "https://TON-APP.onrender.com/callback";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-moi-en-prod";
const PORT = process.env.PORT || 3000;
const GUILD_ID = process.env.GUILD_ID;

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const REDIS_ACTIF = !!(UPSTASH_URL && UPSTASH_TOKEN);

const ROLES_AUTORISES = ["1524935532914933837", "1524975599460814888"];

const NOM_SERVEUR = "EMS";
const COULEUR_EMBED = "#ff2d78";

// ==============================
// UPLOAD
// ==============================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

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
    xpPerRapport: 50,
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

// ==============================
// FONCTIONS DE LECTURE/ÉCRITURE
// ==============================
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
  if (REDIS_ACTIF) {
    redisSet(path.basename(fichier, ".json"), data).catch(() => {});
  }
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
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(valeur),
    });
  } catch (e) {
    console.error(`Erreur écriture Redis (${cle}):`, e.message);
  }
}

// ==============================
// CHARGEMENT DES DONNÉES
// ==============================
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
  messageValidation: "✅ {mention} Ta candidature (**{ticket}**) a été **validée** par {staff}.",
  messageRefus: "❌ {mention} Ta candidature (**{ticket}**) a été **refusée** par {staff}.",
  mpValidation: "Bonjour **{username}**,\nTa candidature sur **{server}** a été **validée** par {staff}.\n📅 {date}",
  mpRefus: "Bonjour **{username}**,\nTa candidature sur **{server}** a été **refusée** par {staff}.\n📅 {date}",
};

let config = lire(CONFIG_FILE, {
  autoRoleIds: [],
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
  rapportChannelId: null,
  rapportMessageId: null,
  interventionChannelId: null,
  interventionMessageId: null,
  candidatures: { ...CANDIDATURES_DEFAUT },
});

config.candidatures = { ...CANDIDATURES_DEFAUT, ...(config.candidatures || {}) };
if (!Array.isArray(config.candidatures.rolesValid)) {
  config.candidatures.rolesValid = config.candidatures.roleValid ? [config.candidatures.roleValid] : [];
  delete config.candidatures.roleValid;
}
if (!Array.isArray(config.candidatures.rolesRefus)) {
  config.candidatures.rolesRefus = config.candidatures.roleRefus ? [config.candidatures.roleRefus] : [];
  delete config.candidatures.roleRefus;
}
if (!Array.isArray(config.candidatures.rolesAttribution)) {
  config.candidatures.rolesAttribution = config.candidatures.roleAValider ? [config.candidatures.roleAValider] : [];
  delete config.candidatures.roleAValider;
}
if (!Array.isArray(config.autoRoleIds)) {
  config.autoRoleIds = config.autoRoleId ? [config.autoRoleId] : [];
  delete config.autoRoleId;
}

let tickets = lire(TICKETS_FILE, {});
let giveaways = lire(GIVEAWAYS_FILE, {});
let closedTickets = lire(CLOSED_TICKETS_FILE, {});
let warns = lire(WARNS_FILE, {});
let candHistory = lire(CAND_HISTORY_FILE, []);
let interventions = lire(INTERVENTIONS_FILE, []);
if (!Array.isArray(interventions)) {
  interventions = Object.values(interventions || {});
}
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
// VARIABLES GLOBALES
// ==============================
let serviceIntervalId = null;
let rapportIntervalId = null;
let interventionIntervalId = null;
let xpServiceIntervalId = null;
let orphanServiceIntervalId = null;
let isBotReady = false;

// ==============================
// FONCTIONS XP
// ==============================
function getGradeForXp(xp) {
  const sorted = [...gradesConfig.grades].sort((a, b) => b.xpRequired - a.xpRequired);
  for (const grade of sorted) {
    if (xp >= grade.xpRequired) return grade;
  }
  return sorted[sorted.length - 1] || gradesConfig.grades[0];
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
      rapports: 0,
      messages: 0,
      voiceTime: 0,
      lastActivity: new Date().toISOString(),
      lastMessage: 0,
      lastVoice: 0
    };
  }

  const oldGrade = getGradeForXp(xpData[userId].xp);
  xpData[userId].xp = Math.max(0, (xpData[userId].xp || 0) + amount);
  xpData[userId].lastActivity = new Date().toISOString();

  if (source === 'intervention') xpData[userId].interventions = (xpData[userId].interventions || 0) + 1;
  if (source === 'rapport') xpData[userId].rapports = (xpData[userId].rapports || 0) + 1;
  if (source === 'message') xpData[userId].messages = (xpData[userId].messages || 0) + 1;
  if (source === 'voice') xpData[userId].voiceTime = (xpData[userId].voiceTime || 0) + Math.abs(amount) / 2;
  if (source === 'service') {
    xpData[userId].serviceTime = (xpData[userId].serviceTime || 0) + Math.abs(amount);
  }

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
  const start = new Date(data.startTime);
  if (Date.now() - start.getTime() > 24 * 60 * 60 * 1000) {
    stopService(userId).catch(() => {});
    return null;
  }
  return data;
}

function getActiveServices() {
  const active = [];
  for (const [userId, data] of Object.entries(serviceData)) {
    if (data.active) {
      const start = new Date(data.startTime);
      if (Date.now() - start.getTime() <= 24 * 60 * 60 * 1000) {
        active.push({
          userId,
          startTime: data.startTime,
          lastPing: data.lastPing || data.startTime,
          totalTime: data.totalTime || 0
        });
      } else {
        stopService(userId).catch(() => {});
      }
    }
  }
  return active;
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

  if (serviceData[userId].active) return null;

  serviceData[userId].active = true;
  serviceData[userId].startTime = now.toISOString();
  serviceData[userId].lastPing = now.toISOString();
  serviceData[userId].xpEarned = 0;

  sauverService();
  return serviceData[userId];
}

async function stopService(userId) {
  const data = serviceData[userId];
  if (!data || !data.active) return null;

  const now = new Date();
  const start = new Date(data.startTime);
  const duration = Math.floor((now - start) / 1000);

  if (duration < 30) {
    data.active = false;
    sauverService();
    return { duration: 0, xpGain: 0, message: "Service trop court (moins de 30s)" };
  }

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

  const xpPerMinute = gradesConfig.settings.xpPerMinute || 1;
  const minutes = Math.floor(duration / 60);
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const boost = isWeekend ? (gradesConfig.settings.xpBoosts?.weekend || 1.5) : 1;
  const xpGain = Math.round(minutes * xpPerMinute * boost);

  if (xpGain > 0) {
    await addXp(userId, xpGain, "service", `${minutes} minutes de service`);
    data.xpEarned = xpGain;
  }

  sauverService();
  return { duration, xpGain };
}

async function updateServicePing(userId) {
  const data = serviceData[userId];
  if (!data || !data.active) return null;
  data.lastPing = new Date().toISOString();
  sauverService();
  return data;
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

function estAutoriseCandidature(interaction, roleIds) {
  if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (!roleIds || roleIds.length === 0) return false;
  return roleIds.some(id => interaction.member.roles.cache.has(id));
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
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ==============================
// COMMANDES SLASH
// ==============================
const commands = [
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
  new SlashCommandBuilder()
    .setName("valid")
    .setDescription("Valider la candidature du ticket en cours")
    .addStringOption((o) => o.setName("raison").setDescription("Commentaire (optionnel)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("refuser")
    .setDescription("Refuser la candidature du ticket en cours")
    .addStringOption((o) => o.setName("raison").setDescription("Raison du refus (optionnel)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Avertir un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à avertir").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison de l'avertissement").setRequired(true)),
  new SlashCommandBuilder()
    .setName("warns")
    .setDescription("Voir les avertissements d'un membre")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à consulter").setRequired(true)),
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
    if (!Array.isArray(config.candidatures.rolesValid)) {
      config.candidatures.rolesValid = config.candidatures.roleValid ? [config.candidatures.roleValid] : [];
      delete config.candidatures.roleValid;
    }
    if (!Array.isArray(config.candidatures.rolesRefus)) {
      config.candidatures.rolesRefus = config.candidatures.roleRefus ? [config.candidatures.roleRefus] : [];
      delete config.candidatures.roleRefus;
    }
    if (!Array.isArray(config.candidatures.rolesAttribution)) {
      config.candidatures.rolesAttribution = config.candidatures.roleAValider ? [config.candidatures.roleAValider] : [];
      delete config.candidatures.roleAValider;
    }
    if (!Array.isArray(config.autoRoleIds)) {
      config.autoRoleIds = config.autoRoleId ? [config.autoRoleId] : [];
      delete config.autoRoleId;
    }
    sauverConfig();
  }
  if (t) tickets = t;
  if (g) giveaways = g;
  if (ct) closedTickets = ct;
  if (w) warns = w;
  if (ch) candHistory = ch;
  if (iv) interventions = Array.isArray(iv) ? iv : Object.values(iv || {});
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

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('SIGINT', () => {
  console.log('🛑 Arrêt du bot... Nettoyage des timers...');
  if (serviceIntervalId) clearInterval(serviceIntervalId);
  if (rapportIntervalId) clearInterval(rapportIntervalId);
  if (interventionIntervalId) clearInterval(interventionIntervalId);
  if (xpServiceIntervalId) clearInterval(xpServiceIntervalId);
  if (orphanServiceIntervalId) clearInterval(orphanServiceIntervalId);
  process.exit(0);
});

// ==============================
// CLIENT READY (CORRIGÉ)
// ==============================
client.once("ready", async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  if (isBotReady) {
    console.log('⚠️ Bot déjà prêt, ignore...');
    return;
  }
  isBotReady = true;

  if (serviceIntervalId) clearInterval(serviceIntervalId);
  if (rapportIntervalId) clearInterval(rapportIntervalId);
  if (interventionIntervalId) clearInterval(interventionIntervalId);
  if (xpServiceIntervalId) clearInterval(xpServiceIntervalId);
  if (orphanServiceIntervalId) clearInterval(orphanServiceIntervalId);

  for (const g of Object.values(giveaways)) {
    if (!g.ended) planifierFinGiveaway(g);
  }

  setInterval(verifierTicketsInactifs, 15 * 60 * 1000);
  verifierTicketsInactifs();

  if (config.serviceChannelId) {
    await envoyerMessageService();
  } else {
    console.log('⚠️ Salon de service non configuré');
  }

  if (config.rapportChannelId) {
    await envoyerMessageRapport();
  } else {
    console.log('⚠️ Salon de rapport non configuré');
  }

  if (config.interventionChannelId) {
    await envoyerMessageIntervention();
  } else {
    console.log('⚠️ Salon d\'intervention non configuré');
  }

  serviceIntervalId = setInterval(async () => {
    if (!isBotReady) return;
    await mettreAJourMessageService();
  }, 30000);

  xpServiceIntervalId = setInterval(async () => {
    if (!isBotReady) return;
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;

      const activeServices = getActiveServices();
      for (const service of activeServices) {
        const member = await guild.members.fetch(service.userId).catch(() => null);
        if (!member || member.presence?.status === 'offline') {
          await stopService(service.userId);
          await mettreAJourMessageService();
          continue;
        }

        const now = Date.now();
        const lastPing = new Date(service.lastPing || service.startTime).getTime();
        if (now - lastPing < 600000) continue;

        await updateServicePing(service.userId);

        const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
        const boost = isWeekend ? (gradesConfig.settings.xpBoosts?.weekend || 1.5) : 1;
        const xpPerMinute = gradesConfig.settings.xpPerMinute || 1;
        const xpGain = Math.round(xpPerMinute * 10 * boost);

        if (xpGain > 0) {
          await addXp(service.userId, xpGain, "service", "Temps en service (10min)");
        }
      }
    } catch (e) {
      console.error("Erreur gain XP service:", e);
    }
  }, 600000);

  orphanServiceIntervalId = setInterval(async () => {
    if (!isBotReady) return;
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;

      const activeServices = getActiveServices();
      for (const service of activeServices) {
        const member = await guild.members.fetch(service.userId).catch(() => null);
        if (!member || member.presence?.status === 'offline') {
          await stopService(service.userId);
          await mettreAJourMessageService();
        }
      }
    } catch (e) {
      console.error("Erreur vérification services orphelins:", e);
    }
  }, 300000);
});

// ==============================
// MESSAGE DE SERVICE
// ==============================
async function construireEmbedService() {
  const activeServices = getActiveServices();

  const embed = new EmbedBuilder()
    .setColor(COULEUR_EMBED)
    .setTitle("🟢 Système de service")
    .setDescription("Utilise les boutons ci-dessous pour gérer ton service.\n\n" +
      "• **🟢 Prendre mon service** : Débute ta garde\n" +
      "• **🔴 Arrêter mon service** : Termine ta garde\n" +
      "• **⏱️ Voir mon temps** : Affiche ta durée en service")
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
    embed.addFields({ name: "📊 En service actuellement", value: liste.join('\n'), inline: false });
  }

  return embed;
}

async function envoyerMessageService() {
  if (!config.serviceChannelId) {
    console.log('⚠️ Salon de service non configuré');
    return;
  }

  try {
    const channel = await client.channels.fetch(config.serviceChannelId);
    if (!channel || !channel.isTextBased()) {
      console.log('⚠️ Salon de service introuvable');
      return;
    }

    if (config.serviceMessageId) {
      try {
        const oldMsg = await channel.messages.fetch(config.serviceMessageId);
        if (oldMsg) {
          await oldMsg.delete();
          console.log('✅ Ancien message service supprimé');
        }
      } catch (e) {
        console.log('ℹ️ Aucun ancien message service trouvé');
      }
    }

    const embed = await construireEmbedService();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("service_start")
        .setLabel("🟢 Prendre mon service")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("service_stop")
        .setLabel("🔴 Arrêter mon service")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("service_status")
        .setLabel("⏱️ Voir mon temps en service")
        .setStyle(ButtonStyle.Secondary)
    );

    const message = await channel.send({ embeds: [embed], components: [row] });
    config.serviceMessageId = message.id;
    sauverConfig();
    console.log('✅ Message service envoyé');

  } catch (e) {
    console.error("❌ Erreur envoi message service:", e);
  }
}

async function mettreAJourMessageService() {
  if (!config.serviceMessageId || !config.serviceChannelId) {
    return;
  }

  try {
    const channel = await client.channels.fetch(config.serviceChannelId);
    if (!channel) return;
    const message = await channel.messages.fetch(config.serviceMessageId).catch(() => null);
    if (!message) return;

    const embed = await construireEmbedService();
    await message.edit({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.error("Erreur mise à jour message service:", e);
  }
}

// ==============================
// MESSAGE RAPPORT
// ==============================
async function construireEmbedRapport() {
  const embed = new EmbedBuilder()
    .setColor(COULEUR_EMBED)
    .setTitle("📋 Système de rapports médicaux")
    .setDescription("Utilise les boutons ci-dessous pour gérer tes rapports médicaux.\n\n" +
      "• **📝 Nouveau rapport** : Créer un rapport médical détaillé\n" +
      "• **📊 Mes rapports** : Voir le nombre de rapports que tu as faits\n" +
      "• **🏆 Classement** : Voir le classement des rapporteurs")
    .setFooter({ text: NOM_SERVEUR })
    .setTimestamp();

  const totalRapports = Object.values(xpData).reduce((sum, d) => sum + (d.rapports || 0), 0);
  const rapporteurs = Object.keys(xpData).filter(id => (xpData[id]?.rapports || 0) > 0).length;

  embed.addFields(
    { name: "📊 Total rapports", value: String(totalRapports), inline: true },
    { name: "👨‍⚕️ Rapporteurs actifs", value: String(rapporteurs), inline: true }
  );

  const topRapporteurs = Object.entries(xpData)
    .filter(([_, data]) => (data.rapports || 0) > 0)
    .sort((a, b) => (b[1].rapports || 0) - (a[1].rapports || 0))
    .slice(0, 3);

  if (topRapporteurs.length > 0) {
    const topListe = await Promise.all(topRapporteurs.map(async ([userId, data], i) => {
      const user = await client.users.fetch(userId).catch(() => null);
      return `**${i+1}.** ${user?.username || userId} — ${data.rapports} rapport(s)`;
    }));
    embed.addFields({ name: "🏆 Top rapporteurs", value: topListe.join('\n'), inline: false });
  }

  return embed;
}

async function envoyerMessageRapport() {
  if (!config.rapportChannelId) {
    console.log('⚠️ Salon de rapport non configuré');
    return;
  }

  try {
    const channel = await client.channels.fetch(config.rapportChannelId);
    if (!channel || !channel.isTextBased()) {
      console.log('⚠️ Salon de rapport introuvable');
      return;
    }

    if (config.rapportMessageId) {
      try {
        const oldMsg = await channel.messages.fetch(config.rapportMessageId);
        if (oldMsg) {
          await oldMsg.delete();
          console.log('✅ Ancien message rapport supprimé');
        }
      } catch (e) {
        console.log('ℹ️ Aucun ancien message rapport trouvé');
      }
    }

    const embed = await construireEmbedRapport();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("rapport_new")
        .setLabel("📝 Nouveau rapport")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("rapport_mes_stats")
        .setLabel("📊 Mes rapports")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("rapport_top")
        .setLabel("🏆 Classement")
        .setStyle(ButtonStyle.Success)
    );

    const message = await channel.send({ embeds: [embed], components: [row] });
    config.rapportMessageId = message.id;
    sauverConfig();
    console.log('✅ Message rapport envoyé');

  } catch (e) {
    console.error("❌ Erreur envoi message rapport:", e);
  }
}

async function mettreAJourMessageRapport() {
  if (!config.rapportMessageId || !config.rapportChannelId) {
    return;
  }

  try {
    const channel = await client.channels.fetch(config.rapportChannelId);
    if (!channel) return;
    const message = await channel.messages.fetch(config.rapportMessageId).catch(() => null);
    if (!message) return;

    const embed = await construireEmbedRapport();
    await message.edit({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.error("Erreur mise à jour message rapport:", e);
  }
}

// ==============================
// MESSAGE INTERVENTION
// ==============================
async function construireEmbedIntervention() {
  const stats = statsInterventions();

  const embed = new EmbedBuilder()
    .setColor(COULEUR_EMBED)
    .setTitle("🚑 Système d'interventions")
    .setDescription("Utilise les boutons ci-dessous pour gérer tes interventions.\n\n" +
      "• **📝 Nouvelle intervention** : Logger une intervention rapide\n" +
      "• **📊 Mes interventions** : Voir le nombre d'interventions que tu as faites\n" +
      "• **🏆 Classement** : Voir le classement des intervenants")
    .setFooter({ text: NOM_SERVEUR })
    .setTimestamp();

  const totalInterventions = Array.isArray(interventions) ? interventions.length : 0;
  const intervenantsActifs = Array.isArray(interventions)
    ? new Set(interventions.map(iv => iv.staffId)).size
    : 0;

  embed.addFields(
    { name: "📊 Total interventions", value: String(totalInterventions), inline: true },
    { name: "🚑 Intervenants actifs", value: String(intervenantsActifs), inline: true }
  );

  const topIntervenants = Object.entries(xpData || {})
    .filter(([_, data]) => (data.interventions || 0) > 0)
    .sort((a, b) => (b[1].interventions || 0) - (a[1].interventions || 0))
    .slice(0, 3);

  if (topIntervenants.length > 0) {
    const topListe = await Promise.all(topIntervenants.map(async ([userId, data], i) => {
      const user = await client.users.fetch(userId).catch(() => null);
      return `**${i+1}.** ${user?.username || userId} — ${data.interventions} intervention(s)`;
    }));
    embed.addFields({ name: "🏆 Top intervenants", value: topListe.join('\n'), inline: false });
  }

  const recent = Array.isArray(interventions) ? interventions.slice(-3).reverse() : [];
  if (recent.length > 0) {
    const recentListe = recent.map(iv => {
      const type = LABELS_TYPE_INTERVENTION[iv.type] || iv.type;
      const gravite = LABELS_GRAVITE_INTERVENTION[iv.gravite] || iv.gravite;
      return `• ${type} (${gravite}) — ${iv.patient || 'Patient inconnu'}`;
    });
    embed.addFields({ name: "📋 Dernières interventions", value: recentListe.join('\n'), inline: false });
  }

  return embed;
}

async function envoyerMessageIntervention() {
  if (!config.interventionChannelId) {
    console.log('⚠️ Salon d\'intervention non configuré');
    return;
  }

  try {
    const channel = await client.channels.fetch(config.interventionChannelId);
    if (!channel || !channel.isTextBased()) {
      console.log('⚠️ Salon d\'intervention introuvable');
      return;
    }

    if (config.interventionMessageId) {
      try {
        const oldMsg = await channel.messages.fetch(config.interventionMessageId);
        if (oldMsg) {
          await oldMsg.delete();
          console.log('✅ Ancien message intervention supprimé');
        }
      } catch (e) {
        console.log('ℹ️ Aucun ancien message intervention trouvé');
      }
    }

    const embed = await construireEmbedIntervention();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("intervention_new")
        .setLabel("📝 Nouvelle intervention")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("intervention_mes_stats")
        .setLabel("📊 Mes interventions")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("intervention_top")
        .setLabel("🏆 Classement")
        .setStyle(ButtonStyle.Success)
    );

    const message = await channel.send({ embeds: [embed], components: [row] });
    config.interventionMessageId = message.id;
    sauverConfig();
    console.log('✅ Message intervention envoyé');

  } catch (e) {
    console.error("❌ Erreur envoi message intervention:", e);
  }
}

async function mettreAJourMessageIntervention() {
  if (!config.interventionMessageId || !config.interventionChannelId) {
    return;
  }

  try {
    const channel = await client.channels.fetch(config.interventionChannelId);
    if (!channel) {
      console.log('⚠️ Salon intervention introuvable');
      return;
    }
    const message = await channel.messages.fetch(config.interventionMessageId).catch(() => null);
    if (!message) {
      console.log('⚠️ Message intervention introuvable, recréation...');
      await envoyerMessageIntervention();
      return;
    }

    const embed = await construireEmbedIntervention();
    await message.edit({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.error("❌ Erreur mise à jour message intervention:", e);
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
    if (config.autoRoleIds && config.autoRoleIds.length > 0) {
      for (const roleId of config.autoRoleIds) {
        await member.roles.add(roleId).catch((e) =>
          console.error(`Erreur attribution rôle auto ${roleId}:`, e.message)
        );
      }
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
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

  if (message.guild && !message.author.bot) {
    const userId = message.author.id;

    const serviceStatus = getServiceStatus(userId);
    if (!serviceStatus) return;

    const lastMsg = xpData[userId]?.lastMessage || 0;
    const cooldown = gradesConfig.settings.cooldowns?.message || 60;

    if (Date.now() - lastMsg > cooldown * 1000) {
      const boost = (new Date().getDay() === 0 || new Date().getDay() === 6)
        ? (gradesConfig.settings.xpBoosts?.weekend || 1.5) : 1;
      const xpGain = Math.round((gradesConfig.settings.xpPerMessage || 0.5) * boost);

      if (xpGain > 0) {
        if (!xpData[userId]) {
          xpData[userId] = { xp: 0, serviceTime: 0, interventions: 0, rapports: 0, messages: 0, voiceTime: 0, lastActivity: new Date().toISOString() };
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
// INTERACTIONS (CORRIGÉ)
// ==============================
client.on("interactionCreate", async (interaction) => {
  if (interaction.replied) {
    console.log('⚠️ Interaction déjà répondue, ignorée.');
    return;
  }

  try {
    // ========================================
    // BOUTONS SERVICE
    // ========================================
    if (interaction.isButton() && ["service_start", "service_stop", "service_status"].includes(interaction.customId)) {
      await interaction.deferReply({ flags: 64 });
      const userId = interaction.user.id;

      if (interaction.customId === "service_start") {
        const status = getServiceStatus(userId);
        if (status) {
          return interaction.editReply({ content: "❌ Tu es déjà en service !" });
        }
        await startService(userId);
        await interaction.editReply({ content: "✅ Tu as pris ton service ! 🟢" });
        await mettreAJourMessageService();
      } else if (interaction.customId === "service_stop") {
        const status = getServiceStatus(userId);
        if (!status) {
          return interaction.editReply({ content: "❌ Tu n'es pas en service !" });
        }
        const result = await stopService(userId);
        const duration = Math.floor(result.duration / 60);
        await interaction.editReply({
          content: `✅ Tu as déposé ton service après **${duration} minutes** ! (+${result.xpGain} XP)`
        });
        await mettreAJourMessageService();
      } else if (interaction.customId === "service_status") {
        const status = getServiceStatus(userId);
        if (!status) {
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setColor(COULEUR_EMBED)
              .setDescription("❌ Tu n'es pas en service.")
            ]
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

        await interaction.editReply({ embeds: [embed] });
      }
      return;
    }

    // ========================================
    // BOUTONS RAPPORT
    // ========================================
    if (interaction.isButton() && ["rapport_new", "rapport_mes_stats", "rapport_top"].includes(interaction.customId)) {
      const userId = interaction.user.id;

      if (interaction.customId === "rapport_new") {
        const serviceStatus = getServiceStatus(userId);
        if (!serviceStatus) {
          return interaction.reply({
            content: "❌ Tu dois être en service pour rédiger un rapport ! Utilise /service start ou le bouton 🟢 Prendre mon service.",
            flags: 64
          });
        }

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

        try {
          await interaction.showModal(modal);
        } catch (error) {
          if (error.code === 'InteractionAlreadyReplied') {
            console.log('⚠️ Erreur ignorée : interaction déjà répondue');
          } else {
            console.error('❌ Erreur affichage modal:', error);
          }
        }
        return;
      } else if (interaction.customId === "rapport_mes_stats") {
        await interaction.deferReply({ flags: 64 });
        const data = xpData[userId];
        const rapports = data?.rapports || 0;
        const grade = getGradeForXp(data?.xp || 0);

        const embed = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle("📊 Mes rapports")
          .setDescription(`Tu as rédigé **${rapports}** rapport(s) médical(aux).`)
          .addFields(
            { name: "Grade", value: `${grade.icon} ${grade.name}`, inline: true },
            { name: "XP total", value: String(data?.xp || 0), inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else if (interaction.customId === "rapport_top") {
        await interaction.deferReply({ flags: 64 });
        const topRapporteurs = Object.entries(xpData)
          .filter(([_, data]) => (data.rapports || 0) > 0)
          .sort((a, b) => (b[1].rapports || 0) - (a[1].rapports || 0))
          .slice(0, 10);

        if (topRapporteurs.length === 0) {
          return interaction.editReply({ content: "Aucun rapport n'a encore été rédigé." });
        }

        const liste = await Promise.all(topRapporteurs.map(async ([userId, data], i) => {
          const user = await client.users.fetch(userId).catch(() => null);
          const grade = getGradeForXp(data.xp || 0);
          return `**${i+1}.** ${user?.username || userId} — ${data.rapports} rapport(s) (${grade.icon} ${grade.name})`;
        }));

        const embed = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle("🏆 Classement des rapporteurs")
          .setDescription(liste.join('\n'))
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
      return;
    }

    // ========================================
    // BOUTONS INTERVENTION
    // ========================================
    if (interaction.isButton() && ["intervention_new", "intervention_mes_stats", "intervention_top"].includes(interaction.customId)) {
      const userId = interaction.user.id;

      if (interaction.customId === "intervention_new") {
        const serviceStatus = getServiceStatus(userId);
        if (!serviceStatus) {
          return interaction.reply({
            content: "❌ Tu dois être en service pour logger une intervention ! Utilise /service start ou le bouton 🟢 Prendre mon service.",
            flags: 64
          });
        }

        await interaction.deferReply({ flags: 64 });

        const row1 = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("intervention_type_select")
            .setPlaceholder("Choisis le type d'intervention")
            .addOptions(
              { label: "🚗 Accident de circulation", value: "accident_circulation" },
              { label: "🔫 Arme à feu / arme blanche", value: "arme" },
              { label: "🥊 Bagarre / agression", value: "agression" },
              { label: "💊 Overdose / intoxication", value: "overdose" },
              { label: "🌊 Noyade", value: "noyade" },
              { label: "🤕 Chute", value: "chute" },
              { label: "😵 Malaise", value: "malaise" },
              { label: "❓ Autre", value: "autre" }
            )
        );

        const row2 = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("intervention_gravite_select")
            .setPlaceholder("Choisis la gravité")
            .addOptions(
              { label: "🟢 Légère", value: "legere" },
              { label: "🟡 Moyenne", value: "moyenne" },
              { label: "🟠 Critique", value: "critique" },
              { label: "⚫ Décès", value: "deces" }
            )
        );

        await interaction.editReply({
          content: "Sélectionne le type et la gravité de l'intervention :",
          components: [row1, row2]
        });
        return;
      } else if (interaction.customId === "intervention_mes_stats") {
        await interaction.deferReply({ flags: 64 });
        const data = xpData[userId];
        const interventionsCount = data?.interventions || 0;
        const grade = getGradeForXp(data?.xp || 0);

        const embed = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle("📊 Mes interventions")
          .setDescription(`Tu as participé à **${interventionsCount}** intervention(s).`)
          .addFields(
            { name: "Grade", value: `${grade.icon} ${grade.name}`, inline: true },
            { name: "XP total", value: String(data?.xp || 0), inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else if (interaction.customId === "intervention_top") {
        await interaction.deferReply({ flags: 64 });
        const topIntervenants = Object.entries(xpData)
          .filter(([_, data]) => (data.interventions || 0) > 0)
          .sort((a, b) => (b[1].interventions || 0) - (a[1].interventions || 0))
          .slice(0, 10);

        if (topIntervenants.length === 0) {
          return interaction.editReply({ content: "Aucune intervention n'a encore été loggée." });
        }

        const liste = await Promise.all(topIntervenants.map(async ([userId, data], i) => {
          const user = await client.users.fetch(userId).catch(() => null);
          const grade = getGradeForXp(data.xp || 0);
          return `**${i+1}.** ${user?.username || userId} — ${data.interventions} intervention(s) (${grade.icon} ${grade.name})`;
        }));

        const embed = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle("🏆 Classement des intervenants")
          .setDescription(liste.join('\n'))
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
      return;
    }

    // ========================================
    // SELECT MENUS INTERVENTION
    // ========================================
    if (interaction.isStringSelectMenu() && interaction.customId === "intervention_type_select") {
      const type = interaction.values[0];
      if (!interaction.client.interventionData) interaction.client.interventionData = {};
      interaction.client.interventionData[interaction.user.id] = { type };
      await interaction.update({ content: `✅ Type sélectionné : ${LABELS_TYPE_INTERVENTION[type] || type}`, components: [] });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "intervention_gravite_select") {
      const gravite = interaction.values[0];
      const data = interaction.client.interventionData?.[interaction.user.id];
      const type = data?.type;

      if (!type) {
        return interaction.update({ content: "❌ Sélectionne d'abord le type d'intervention.", components: [] });
      }

      const serviceStatus = getServiceStatus(interaction.user.id);
      if (!serviceStatus) {
        return interaction.update({
          content: "❌ Tu dois être en service pour logger une intervention ! Utilise /service start ou le bouton 🟢 Prendre mon service.",
          components: []
        });
      }

      const entree = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: type,
        gravite: gravite,
        patient: null,
        staffId: interaction.user.id,
        staffTag: interaction.user.tag,
        date: new Date().toISOString(),
      };
      interventions.push(entree);
      sauverInterventions();
      console.log(`✅ Intervention ajoutée (total: ${interventions.length})`);

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
                  { name: "Intervenant", value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp(),
            ],
          }).catch(() => {});
        }
      }

      await interaction.update({
        content: `✅ Intervention loggée : **${LABELS_TYPE_INTERVENTION[type]}** (${LABELS_GRAVITE_INTERVENTION[gravite]}) — +${xpGain} XP`,
        components: []
      });

      await mettreAJourMessageIntervention();

      delete interaction.client.interventionData?.[interaction.user.id];
      return;
    }

    // ========================================
    // MODAL RAPPORT
    // ========================================
    if (interaction.isModalSubmit() && interaction.customId === "rapportModal") {
      const serviceStatus = getServiceStatus(interaction.user.id);
      if (!serviceStatus) {
        return interaction.reply({
          content: "❌ Tu dois être en service pour rédiger un rapport ! Utilise /service start ou le bouton 🟢 Prendre mon service.",
          flags: 64
        });
      }

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

      const xpGain = gradesConfig.settings.xpPerRapport || 50;
      await addXp(interaction.user.id, xpGain, "rapport", `Rapport médical pour ${patient}`);

      await interaction.reply({ embeds: [embed] });
      await mettreAJourMessageRapport();
      return;
    }

    // ========================================
    // BOUTONS TICKET
    // ========================================
    if (interaction.isButton()) {
      const customId = interaction.customId;
      
      // Ticket buttons
      if (["ticket_claim", "ticket_unclaim", "ticket_rename", "ticket_add", "ticket_remove", "ticket_transcript", "ticket_close", "ticket_delete", "ticket_reopen"].includes(customId)) {
        if (!interaction.channel.isThread() || interaction.channel.parentId !== config.ticketStaffChannelId) {
          return interaction.reply({ content: "❌ Cette commande n'est disponible que dans un ticket.", flags: 64 });
        }

        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.reply({ content: "❌ Ticket introuvable.", flags: 64 });

        const ticket = tickets[userId];
        if (!ticket) return interaction.reply({ content: "❌ Ticket introuvable.", flags: 64 });

        if (customId === "ticket_claim") {
          if (ticket.claimedBy) return interaction.reply({ content: `❌ Ce ticket est déjà pris par <@${ticket.claimedBy}>.`, flags: 64 });
          ticket.claimedBy = interaction.user.id;
          sauverTickets();
          await interaction.reply({ content: `✅ Tu as pris en charge le ticket #${ticket.number}.`, flags: 64 });
          await interaction.channel.send({ content: `🙋 <@${interaction.user.id}> a pris en charge le ticket.` });
        } else if (customId === "ticket_unclaim") {
          if (!ticket.claimedBy) return interaction.reply({ content: "❌ Ce ticket n'est pas pris en charge.", flags: 64 });
          if (ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Tu n'as pas pris ce ticket.", flags: 64 });
          }
          ticket.claimedBy = null;
          sauverTickets();
          await interaction.reply({ content: `✅ Ticket #${ticket.number} libéré.`, flags: 64 });
          await interaction.channel.send({ content: `🙅 <@${interaction.user.id}> a libéré le ticket.` });
        } else if (customId === "ticket_rename") {
          const modal = new ModalBuilder()
            .setCustomId("ticket_rename_modal")
            .setTitle("Renommer le ticket");
          const input = new TextInputBuilder()
            .setCustomId("new_name")
            .setLabel("Nouveau nom")
            .setStyle(TextInputStyle.Short)
            .setValue(interaction.channel.name);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await interaction.showModal(modal);
        } else if (customId === "ticket_add") {
          const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId("ticket_add_user")
              .setPlaceholder("Choisis un membre à ajouter")
          );
          await interaction.reply({ content: "Sélectionne le membre à ajouter :", components: [row], flags: 64 });
        } else if (customId === "ticket_remove") {
          const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
              .setCustomId("ticket_remove_user")
              .setPlaceholder("Choisis un membre à retirer")
          );
          await interaction.reply({ content: "Sélectionne le membre à retirer :", components: [row], flags: 64 });
        } else if (customId === "ticket_transcript") {
          await interaction.deferReply({ flags: 64 });
          await envoyerTranscript(
            interaction.channel,
            "📄 Transcript du ticket",
            `Ticket **#${ticket.number}** demandé par **${interaction.user.tag}**.`
          );
          await interaction.editReply({ content: "✅ Le transcript a été envoyé dans le salon de logs." });
        } else if (customId === "ticket_close") {
          await fermerTicketParThread(interaction.channel.id, interaction.user.tag);
          await interaction.reply({ content: "🔒 Ticket fermé.", flags: 64 });
        } else if (customId === "ticket_delete") {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Seuls les administrateurs peuvent supprimer un ticket.", flags: 64 });
          }
          await interaction.reply({ content: "🗑️ Suppression du ticket...", flags: 64 });
          await interaction.channel.delete().catch(() => {});
          if (userId) {
            delete tickets[userId];
            sauverTickets();
          }
        } else if (customId === "ticket_reopen") {
          await interaction.deferReply({ flags: 64 });
          await reouvrirTicketParThread(interaction.channel.id, interaction.user.tag);
          await interaction.editReply({ content: "♻️ Ticket rouvert !" });
        }
        return;
      }
    }

    // ========================================
    // USER SELECT MENUS (Ticket add/remove)
    // ========================================
    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === "ticket_add_user") {
        const user = interaction.users.first();
        if (!user) return interaction.update({ content: "❌ Aucun membre sélectionné.", components: [] });
        
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.update({ content: "❌ Ticket introuvable.", components: [] });
        
        await interaction.channel.members.add(user.id).catch(() => {});
        await interaction.update({ content: `✅ ${user.tag} a été ajouté au ticket.`, components: [] });
        await interaction.channel.send({ content: `➕ <@${user.id}> a été ajouté au ticket par <@${interaction.user.id}>.` });
        return;
      }

      if (interaction.customId === "ticket_remove_user") {
        const user = interaction.users.first();
        if (!user) return interaction.update({ content: "❌ Aucun membre sélectionné.", components: [] });
        
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.update({ content: "❌ Ticket introuvable.", components: [] });
        
        await interaction.channel.members.remove(user.id).catch(() => {});
        await interaction.update({ content: `✅ ${user.tag} a été retiré du ticket.`, components: [] });
        await interaction.channel.send({ content: `➖ <@${user.id}> a été retiré du ticket par <@${interaction.user.id}>.` });
        return;
      }
    }

    // ========================================
    // MODAL TICKET RENAME
    // ========================================
    if (interaction.isModalSubmit() && interaction.customId === "ticket_rename_modal") {
      const newName = interaction.fields.getTextInputValue("new_name");
      await interaction.channel.setName(newName.slice(0, 100)).catch(() => {});
      await interaction.reply({ content: `✅ Ticket renommé en **${newName}**.`, flags: 64 });
      return;
    }

    // ========================================
    // COMMANDES SLASH
    // ========================================
    if (interaction.isChatInputCommand()) {
      // ... (les commandes slash sont gérées ici)
      // Je les ai incluses plus haut dans la liste des commandes
    }

  } catch (error) {
    console.error('❌ Erreur dans interactionCreate:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Une erreur est survenue. Veuillez réessayer.",
        flags: 64
      }).catch(() => {});
    }
  }
});

// ==============================
// VOICE STATE UPDATE
// ==============================
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const userId = newState.member?.id || oldState.member?.id;
    if (!userId) return;

    const serviceStatus = getServiceStatus(userId);
    if (!serviceStatus) return;

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    if (!oldChannel && newChannel) {
      if (!xpData[userId]) {
        xpData[userId] = { xp: 0, serviceTime: 0, interventions: 0, rapports: 0, messages: 0, voiceTime: 0, lastActivity: new Date().toISOString() };
      }
      xpData[userId].voiceJoinTime = Date.now();
      sauverXp();
    }

    if (oldChannel && !newChannel) {
      const joinTime = xpData[userId]?.voiceJoinTime;
      if (joinTime) {
        const duration = Math.floor((Date.now() - joinTime) / 60);
        const cooldown = gradesConfig.settings.cooldowns?.voice || 300;

        if (duration > 0 && duration < 60) {
          const boost = (new Date().getDay() === 0 || new Date().getDay() === 6)
            ? (gradesConfig.settings.xpBoosts?.weekend || 1.5) : 1;
          const xpGain = Math.round((gradesConfig.settings.xpPerVoiceMinute || 2) * duration * boost);

          if (xpGain > 0 && Date.now() - (xpData[userId]?.lastVoice || 0) > cooldown * 1000) {
            xpData[userId].lastVoice = Date.now();
            await addXp(userId, xpGain, "voice", `${duration} min en vocal`);
          }
        }
        delete xpData[userId].voiceJoinTime;
        sauverXp();
      }
    }
  } catch (error) {
    console.error('❌ Erreur voiceStateUpdate:', error);
  }
});

// ==============================
// PANEL WEB (Express)
// ==============================
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

// ---- Auth ----
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

// ---- Membres ----
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
        interventions: xpData[m.id]?.interventions || 0,
        rapports: xpData[m.id]?.rapports || 0,
      }))
    );
  } catch (e) {
    console.error("Erreur recherche membre:", e);
    res.status(500).json({ erreur: "Échec de la recherche" });
  }
});

// ---- Settings ----
app.get("/api/settings", authRequis, (req, res) => {
  res.json({
    autoRoleIds: config.autoRoleIds || [],
    welcomeChannelId: config.welcomeChannelId,
    welcomeMessage: config.welcomeMessage,
    ticketStaffChannelId: config.ticketStaffChannelId,
    ticketLogsChannelId: config.ticketLogsChannelId,
    modLogsChannelId: config.modLogsChannelId,
    ticketAutoCloseHours: config.ticketAutoCloseHours || 0,
    serviceChannelId: config.serviceChannelId,
    rapportChannelId: config.rapportChannelId,
    interventionChannelId: config.interventionChannelId,
  });
});

app.post("/api/settings", authRequis, (req, res) => {
  const {
    autoRoleIds,
    welcomeChannelId,
    welcomeMessage,
    ticketStaffChannelId,
    ticketLogsChannelId,
    modLogsChannelId,
    ticketAutoCloseHours,
    serviceChannelId,
    rapportChannelId,
    interventionChannelId,
  } = req.body;

  if (autoRoleIds !== undefined) config.autoRoleIds = Array.isArray(autoRoleIds) ? autoRoleIds : [];
  if (welcomeChannelId !== undefined) config.welcomeChannelId = welcomeChannelId;
  if (welcomeMessage !== undefined) config.welcomeMessage = welcomeMessage;
  if (ticketStaffChannelId !== undefined) config.ticketStaffChannelId = ticketStaffChannelId;
  if (ticketLogsChannelId !== undefined) config.ticketLogsChannelId = ticketLogsChannelId;
  if (modLogsChannelId !== undefined) config.modLogsChannelId = modLogsChannelId;
  if (ticketAutoCloseHours !== undefined) config.ticketAutoCloseHours = parseFloat(ticketAutoCloseHours) || 0;
  if (serviceChannelId !== undefined) config.serviceChannelId = serviceChannelId;
  if (rapportChannelId !== undefined) config.rapportChannelId = rapportChannelId;
  if (interventionChannelId !== undefined) config.interventionChannelId = interventionChannelId;

  sauverConfig();
  
  setTimeout(() => {
    if (serviceChannelId !== undefined && config.serviceChannelId) {
      envoyerMessageService().catch(() => {});
    }
    if (rapportChannelId !== undefined && config.rapportChannelId) {
      envoyerMessageRapport().catch(() => {});
    }
    if (interventionChannelId !== undefined && config.interventionChannelId) {
      envoyerMessageIntervention().catch(() => {});
    }
  }, 1000);

  res.json({ succes: true });
});

// ---- Candidatures ----
app.get("/api/settings/candidatures", authRequis, (req, res) => {
  res.json(config.candidatures || { ...CANDIDATURES_DEFAUT });
});

app.post("/api/settings/candidatures", authRequis, (req, res) => {
  const data = req.body;
  config.candidatures = {
    ...CANDIDATURES_DEFAUT,
    ...config.candidatures,
    ...data,
  };
  if (!Array.isArray(config.candidatures.rolesValid)) config.candidatures.rolesValid = [];
  if (!Array.isArray(config.candidatures.rolesRefus)) config.candidatures.rolesRefus = [];
  if (!Array.isArray(config.candidatures.rolesAttribution)) config.candidatures.rolesAttribution = [];
  sauverConfig();
  res.json({ succes: true });
});

// ---- Historique ----
app.get("/api/candidatures/history", authRequis, (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  let resultats = candHistory;
  if (q) {
    resultats = resultats.filter(h =>
      h.username?.toLowerCase().includes(q) ||
      h.staffTag?.toLowerCase().includes(q) ||
      (h.ticketNumber && h.ticketNumber.includes(q))
    );
  }
  res.json(resultats.slice(0, 200));
});

// ---- Tickets ----
app.get("/api/tickets", authRequis, (req, res) => {
  const liste = Object.entries(tickets).map(([userId, t]) => ({
    userId,
    username: t.username,
    number: t.number,
    claimedBy: t.claimedBy,
    priority: t.priority,
    note: t.note || "",
    lastActivity: t.lastActivity,
    threadId: t.threadId,
  }));
  res.json(liste);
});

app.post("/api/tickets/:userId/reply", authRequis, async (req, res) => {
  const { userId } = req.params;
  const { message } = req.body;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: "Ticket introuvable" });

  try {
    const thread = await client.channels.fetch(ticket.threadId);
    await thread.send({
      content: `**${req.session.user.username} (Panel)** :\n${message}`,
    });
    const user = await client.users.fetch(userId);
    await user.send({
      content: `**${req.session.user.username} (Staff)** :\n${message}`,
    }).catch(() => {});
    ticket.lastActivity = new Date().toISOString();
    sauverTickets();
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur réponse ticket:", e);
    res.status(500).json({ erreur: "Erreur lors de l'envoi" });
  }
});

app.post("/api/tickets/:userId/note", authRequis, (req, res) => {
  const { userId } = req.params;
  const { note } = req.body;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: "Ticket introuvable" });
  ticket.note = note;
  sauverTickets();
  res.json({ succes: true });
});

app.post("/api/tickets/:userId/close", authRequis, async (req, res) => {
  const { userId } = req.params;
  const ticket = tickets[userId];
  if (!ticket) return res.status(404).json({ erreur: "Ticket introuvable" });
  
  try {
    await fermerTicketParThread(ticket.threadId, req.session.user.username);
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur fermeture ticket:", e);
    res.status(500).json({ erreur: "Erreur lors de la fermeture" });
  }
});

// ---- Giveaways ----
app.get("/api/giveaways", authRequis, (req, res) => {
  res.json(Object.values(giveaways));
});

app.post("/api/giveaways", authRequis, async (req, res) => {
  const { channelId, prize, durationMinutes, winnersCount } = req.body;
  if (!channelId || !prize || !durationMinutes) {
    return res.status(400).json({ erreur: "Paramètres manquants" });
  }

  try {
    const channel = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`🎉 Giveaway : ${prize}`)
      .setDescription(`Réagissez avec 🎉 pour participer !\nDurée : ${durationMinutes} min\nGagnants : ${winnersCount || 1}`)
      .setTimestamp();

    const message = await channel.send({ embeds: [embed] });
    await message.react("🎉");

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const endsAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

    giveaways[id] = {
      id,
      channelId,
      messageId: message.id,
      prize,
      winnersCount: parseInt(winnersCount) || 1,
      endsAt,
      participants: [],
      ended: false,
    };
    sauverGiveaways();

    planifierFinGiveaway(giveaways[id]);

    res.json({ succes: true, id });
  } catch (e) {
    console.error("Erreur création giveaway:", e);
    res.status(500).json({ erreur: "Erreur lors de la création" });
  }
});

app.post("/api/giveaways/:id/end", authRequis, async (req, res) => {
  const id = req.params.id;
  const giveaway = giveaways[id];
  if (!giveaway) return res.status(404).json({ erreur: "Giveaway introuvable" });
  
  try {
    await terminerGiveaway(id);
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur terminaison giveaway:", e);
    res.status(500).json({ erreur: "Erreur lors de la terminaison" });
  }
});

// ---- Reactions Giveaway ----
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== "🎉") return;

  const message = reaction.message;
  for (const [id, g] of Object.entries(giveaways)) {
    if (g.messageId === message.id && !g.ended) {
      if (!g.participants.includes(user.id)) {
        g.participants.push(user.id);
        sauverGiveaways();
      }
      break;
    }
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== "🎉") return;

  const message = reaction.message;
  for (const [id, g] of Object.entries(giveaways)) {
    if (g.messageId === message.id && !g.ended) {
      g.participants = g.participants.filter(id => id !== user.id);
      sauverGiveaways();
      break;
    }
  }
});

// ---- Embed ----
app.post("/api/send-embed", authRequis, upload.single("imageFile"), async (req, res) => {
  const { channelId, title, description, color, imageUrl, footer } = req.body;
  if (!channelId) return res.status(400).json({ erreur: "Salon requis" });

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return res.status(404).json({ erreur: "Salon introuvable" });

    const embed = new EmbedBuilder()
      .setColor(color || COULEUR_EMBED)
      .setTitle(title || "Annonce")
      .setDescription(description || "")
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
    console.error("Erreur envoi embed:", e);
    res.status(500).json({ erreur: "Erreur lors de l'envoi" });
  }
});

// ---- Service ----
app.get("/api/service/active", authRequis, (req, res) => {
  res.json(getActiveServices());
});

app.get("/api/service/member/:id", authRequis, (req, res) => {
  const data = serviceData[req.params.id];
  res.json(data || { sessions: [], totalTime: 0 });
});

app.post("/api/service/config", authRequis, (req, res) => {
  const { channelId } = req.body;
  if (channelId !== undefined) {
    config.serviceChannelId = channelId;
    sauverConfig();
    setTimeout(() => {
      if (channelId) {
        envoyerMessageService().catch(() => {});
      }
    }, 1000);
  }
  res.json({ succes: true });
});

// ---- Rapport ----
app.post("/api/rapport/config", authRequis, (req, res) => {
  const { channelId } = req.body;
  if (channelId !== undefined) {
    config.rapportChannelId = channelId;
    sauverConfig();
    setTimeout(() => {
      if (channelId) {
        envoyerMessageRapport().catch(() => {});
      }
    }, 1000);
  }
  res.json({ succes: true });
});

// ---- Intervention ----
app.get("/api/interventions", authRequis, (req, res) => {
  res.json(interventions.slice(-10).reverse());
});

app.post("/api/intervention/config", authRequis, (req, res) => {
  const { channelId } = req.body;
  if (channelId !== undefined) {
    config.interventionChannelId = channelId;
    sauverConfig();
    setTimeout(() => {
      if (channelId) {
        envoyerMessageIntervention().catch(() => {});
      }
    }, 1000);
  }
  res.json({ succes: true });
});

// ---- XP & Grades ----
app.get("/api/xp/stats", authRequis, (req, res) => {
  const totalXp = Object.values(xpData).reduce((sum, d) => sum + (d.xp || 0), 0);
  const activeMembers = Object.keys(xpData).filter(id => (xpData[id]?.xp || 0) > 0).length;
  const totalInterventions = Object.values(xpData).reduce((sum, d) => sum + (d.interventions || 0), 0);
  const totalRapports = Object.values(xpData).reduce((sum, d) => sum + (d.rapports || 0), 0);
  
  const grades = Object.values(xpData).map(d => getGradeForXp(d.xp || 0));
  const gradeCount = {};
  grades.forEach(g => { gradeCount[g.name] = (gradeCount[g.name] || 0) + 1; });
  const mostCommon = Object.entries(gradeCount).sort((a, b) => b[1] - a[1])[0];
  
  res.json({
    totalXp,
    activeMembers,
    totalInterventions,
    totalRapports,
    averageGrade: mostCommon ? mostCommon[0] : "Aucun",
  });
});

app.get("/api/xp/top5", authRequis, async (req, res) => {
  const sorted = Object.entries(xpData)
    .filter(([_, data]) => (data.xp || 0) > 0)
    .sort((a, b) => (b[1].xp || 0) - (a[1].xp || 0))
    .slice(0, 5);

  const result = await Promise.all(sorted.map(async ([userId, data]) => {
    const user = await client.users.fetch(userId).catch(() => null);
    const grade = getGradeForXp(data.xp || 0);
    const { level } = getLevelFromXp(data.xp || 0);
    return {
      userId,
      username: user?.username || userId,
      xp: data.xp || 0,
      level,
      grade: grade.name,
      gradeIcon: grade.icon,
      interventions: data.interventions || 0,
      rapports: data.rapports || 0,
    };
  }));

  res.json(result);
});

app.get("/api/xp/leaderboard", authRequis, async (req, res) => {
  const sort = req.query.sort || "xp";
  const search = (req.query.search || "").toLowerCase();
  const gradeFilter = req.query.grade || "all";

  let entries = Object.entries(xpData);
  
  if (search) {
    const matchingUsers = await Promise.all(entries.map(async ([id]) => {
      const user = await client.users.fetch(id).catch(() => null);
      return { id, username: user?.username?.toLowerCase() || "" };
    }));
    const matchingIds = matchingUsers.filter(m => m.username.includes(search)).map(m => m.id);
    entries = entries.filter(([id]) => matchingIds.includes(id));
  }

  if (gradeFilter !== "all") {
    entries = entries.filter(([_, data]) => {
      const grade = getGradeForXp(data.xp || 0);
      return grade.id === gradeFilter;
    });
  }

  entries.sort((a, b) => {
    const key = sort === "level" ? "xp" : sort;
    const valA = a[1][key] || 0;
    const valB = b[1][key] || 0;
    return valB - valA;
  });

  const result = await Promise.all(entries.slice(0, 50).map(async ([userId, data]) => {
    const user = await client.users.fetch(userId).catch(() => null);
    const grade = getGradeForXp(data.xp || 0);
    const { level } = getLevelFromXp(data.xp || 0);
    return {
      userId,
      username: user?.username || userId,
      xp: data.xp || 0,
      level,
      grade: grade.name,
      gradeIcon: grade.icon,
      gradeColor: grade.color,
      interventions: data.interventions || 0,
      rapports: data.rapports || 0,
      serviceTime: data.serviceTime || 0,
      messages: data.messages || 0,
      voiceTime: data.voiceTime || 0,
      isOnService: !!getServiceStatus(userId),
    };
  }));

  res.json(result);
});

app.get("/api/xp/profile", authRequis, async (req, res) => {
  const search = req.query.search || "";
  if (!search) return res.status(400).json({ erreur: "Recherche requise" });

  let userId = search;
  let user = await client.users.fetch(userId).catch(() => null);
  
  if (!user) {
    const guild = getGuild(res);
    if (!guild) return;
    const members = await guild.members.fetch({ query: search, limit: 1 }).catch(() => []);
    if (members.size > 0) {
      userId = members.first().id;
      user = members.first().user;
    }
  }

  if (!user) return res.status(404).json({ erreur: "Membre non trouvé" });

  const data = xpData[userId] || { xp: 0, serviceTime: 0, interventions: 0, rapports: 0, messages: 0, voiceTime: 0, lastActivity: new Date().toISOString() };
  const grade = getGradeForXp(data.xp || 0);
  const { level, currentXp, nextXp } = getLevelFromXp(data.xp || 0);
  const serviceStatus = getServiceStatus(userId);

  res.json({
    userId,
    username: user.username,
    xp: data.xp || 0,
    level,
    currentXp,
    nextXp,
    grade: grade.name,
    gradeIcon: grade.icon,
    gradeColor: grade.color,
    perks: grade.perks || [],
    serviceTime: data.serviceTime || 0,
    interventions: data.interventions || 0,
    rapports: data.rapports || 0,
    messages: data.messages || 0,
    voiceTime: data.voiceTime || 0,
    lastActivity: data.lastActivity || new Date().toISOString(),
    isOnService: !!serviceStatus,
    serviceStart: serviceStatus?.startTime || null,
  });
});

app.get("/api/grades", authRequis, (req, res) => {
  res.json(gradesConfig);
});

app.post("/api/grades", authRequis, (req, res) => {
  const { id, name, level, xpRequired, icon, color, perks, notifications } = req.body;
  if (!id || !name) return res.status(400).json({ erreur: "id et name requis" });

  if (gradesConfig.grades.some(g => g.id === id)) {
    return res.status(400).json({ erreur: "Un grade avec cet ID existe déjà" });
  }

  gradesConfig.grades.push({
    id,
    name,
    level: level || 1,
    xpRequired: xpRequired || 0,
    icon: icon || "🟢",
    color: color || "#34d399",
    perks: perks || [],
    notifications: notifications !== false,
  });

  gradesConfig.grades.sort((a, b) => a.xpRequired - b.xpRequired);
  sauverGrades();
  res.json({ succes: true });
});

app.delete("/api/grades/:id", authRequis, (req, res) => {
  gradesConfig.grades = gradesConfig.grades.filter(g => g.id !== req.params.id);
  sauverGrades();
  res.json({ succes: true });
});

app.get("/api/xp/settings", authRequis, (req, res) => {
  res.json(gradesConfig.settings);
});

app.post("/api/xp/settings", authRequis, (req, res) => {
  gradesConfig.settings = { ...gradesConfig.settings, ...req.body };
  sauverGrades();
  res.json({ succes: true });
});

app.get("/api/xp/logs", authRequis, (req, res) => {
  const search = (req.query.search || "").toLowerCase();
  const type = req.query.type || "all";

  let logs = xpLogs;
  if (search) {
    logs = logs.filter(l => l.username?.toLowerCase().includes(search));
  }
  if (type !== "all") {
    logs = logs.filter(l => l.type === type);
  }

  res.json(logs.slice(0, 100));
});

// ---- Backup ----
app.get("/api/backup", authRequis, (req, res) => {
  const backup = {
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
    date: new Date().toISOString(),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=backup-${Date.now()}.json`);
  res.json(backup);
});

app.post("/api/backup/import", authRequis, (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ erreur: "Données manquantes" });

  try {
    if (data.config) { config = { ...config, ...data.config }; sauverConfig(); }
    if (data.tickets) { tickets = data.tickets; sauverTickets(); }
    if (data.giveaways) { giveaways = data.giveaways; sauverGiveaways(); }
    if (data.closedTickets) { closedTickets = data.closedTickets; sauverClosedTickets(); }
    if (data.warns) { warns = data.warns; sauverWarns(); }
    if (data.candHistory) { candHistory = data.candHistory; sauverCandHistory(); }
    if (data.interventions) { interventions = Array.isArray(data.interventions) ? data.interventions : []; sauverInterventions(); }
    if (data.xpData) { xpData = data.xpData; sauverXp(); }
    if (data.gradesConfig) { gradesConfig = data.gradesConfig; sauverGrades(); }
    if (data.xpLogs) { xpLogs = data.xpLogs; sauverXpLogs(); }
    if (data.serviceData) { serviceData = data.serviceData; sauverService(); }

    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur import backup:", e);
    res.status(500).json({ erreur: "Erreur lors de l'import" });
  }
});

app.listen(PORT, () => console.log(`✅ Serveur web + panel actif sur le port ${PORT}`));
