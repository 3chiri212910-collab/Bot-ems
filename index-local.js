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
// CHARGEMENT SITUATIONS (module externe)
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
    process.exit(1);
  }
}

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET || "";
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "https://TON-APP.onrender.com/callback";
// SESSION_SECRET stable : généré une fois et stocké dans .secret
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  const secretFile = path.join(__dirname, ".secret");
  if (fs.existsSync(secretFile)) {
    SESSION_SECRET = fs.readFileSync(secretFile, "utf8").trim();
  } else {
    SESSION_SECRET = require("crypto").randomBytes(32).toString("hex");
    fs.writeFileSync(secretFile, SESSION_SECRET);
  }
}
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
const SERVICE_FILE = path.join(DATA_DIR, "service.json");
const RAPPORTS_FILE = path.join(DATA_DIR, "rapports.json");

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
let serviceData = lire(SERVICE_FILE, {});
let rapports = lire(RAPPORTS_FILE, []);

function sauverConfig() { ecrire(CONFIG_FILE, config); }
function sauverTickets() { ecrire(TICKETS_FILE, tickets); }
function sauverGiveaways() { ecrire(GIVEAWAYS_FILE, giveaways); }
function sauverClosedTickets() { ecrire(CLOSED_TICKETS_FILE, closedTickets); }
function sauverWarns() { ecrire(WARNS_FILE, warns); }
function sauverCandHistory() { ecrire(CAND_HISTORY_FILE, candHistory); }
function sauverInterventions() { ecrire(INTERVENTIONS_FILE, interventions); }
function sauverService() { ecrire(SERVICE_FILE, serviceData); }
function sauverRapports() { ecrire(RAPPORTS_FILE, rapports); }

// ==============================
// FONCTIONS SERVICE
// ==============================
function getJourSemaine(date) {
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return jours[date.getDay()];
}

function getDebutSemaine() {
  const now = new Date();
  const jour = now.getDay();
  const diff = now.getDate() - jour + (jour === 0 ? -6 : 1);
  const debut = new Date(now);
  debut.setDate(diff);
  debut.setHours(0, 0, 0, 0);
  return debut;
}

function getServiceStatus(userId) {
  const data = serviceData[userId];
  if (!data || !data.active) return null;
  const start = new Date(data.startTime);
  if (Date.now() - start.getTime() > 24 * 60 * 60 * 1000) {
    (async () => { await stopService(userId); })();
    return null;
  }
  return data;
}

function getActiveServices() {
  const active = [];
  const now = Date.now();
  for (const [userId, data] of Object.entries(serviceData)) {
    if (data.active) {
      const start = new Date(data.startTime);
      if (now - start.getTime() <= 24 * 60 * 60 * 1000) {
        active.push({
          userId,
          startTime: data.startTime,
          lastPing: data.lastPing || data.startTime,
          totalTime: data.totalTime || 0,
          weeklyTime: data.weeklyTime || 0
        });
      } else {
        (async () => { await stopService(userId); })();
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
      weeklyTime: 0,
      daily: { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 },
      sessions: [],
      active: false
    };
  }

  if (serviceData[userId].active) return null;

  serviceData[userId].active = true;
  serviceData[userId].startTime = now.toISOString();
  serviceData[userId].lastPing = now.toISOString();

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
    return { duration: 0, message: "Service trop court (moins de 30s)" };
  }

  data.active = false;
  data.endTime = now.toISOString();
  data.totalTime = (data.totalTime || 0) + duration;

  const debutSemaine = getDebutSemaine();
  const startDate = new Date(data.startTime);
  if (startDate >= debutSemaine) {
    data.weeklyTime = (data.weeklyTime || 0) + duration;
  } else {
    data.weeklyTime = duration;
  }

  const jour = getJourSemaine(startDate);
  data.daily = data.daily || { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 };
  data.daily[jour] = (data.daily[jour] || 0) + duration;

  if (!data.sessions) data.sessions = [];
  data.sessions.push({
    start: data.startTime,
    end: now.toISOString(),
    duration: duration
  });

  sauverService();
  return { duration };
}

async function updateServicePing(userId) {
  const data = serviceData[userId];
  if (!data || !data.active) return null;
  data.lastPing = new Date().toISOString();
  sauverService();
  return data;
}

// ==============================
// FONCTIONS STATISTIQUES
// ==============================
function getServiceStats(userId) {
  const data = serviceData[userId];
  if (!data) return null;
  return {
    totalTime: data.totalTime || 0,
    weeklyTime: data.weeklyTime || 0,
    daily: data.daily || { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 },
    sessions: data.sessions || [],
    active: data.active || false,
    startTime: data.startTime || null
  };
}

function getInterventionsByUser(userId) {
  return interventions.filter(iv => iv.userId === userId);
}

function getRapportsByUser(userId) {
  return rapports.filter(r => r.userId === userId);
}

function getTopServices(limit = 10) {
  return Object.entries(serviceData)
    .filter(([_, data]) => (data.totalTime || 0) > 0)
    .sort((a, b) => (b[1].totalTime || 0) - (a[1].totalTime || 0))
    .slice(0, limit)
    .map(([userId, data]) => ({ userId, ...data }));
}

function getTopWeeklyServices(limit = 10) {
  return Object.entries(serviceData)
    .filter(([_, data]) => (data.weeklyTime || 0) > 0)
    .sort((a, b) => (b[1].weeklyTime || 0) - (a[1].weeklyTime || 0))
    .slice(0, limit)
    .map(([userId, data]) => ({ userId, ...data }));
}

function getTopInterventions(limit = 10) {
  const counts = {};
  interventions.forEach(iv => {
    counts[iv.userId] = (counts[iv.userId] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([userId, count]) => ({ userId, count }));
}

function getTopRapports(limit = 10) {
  const counts = {};
  rapports.forEach(r => {
    counts[r.userId] = (counts[r.userId] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([userId, count]) => ({ userId, count }));
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
  const intervenants = new Set(interventions.map(iv => iv.userId)).size;
  return { total: interventions.length, intervenants, parType, parGravite, parMois };
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
    GatewayIntentBits.GuildMessageReactions, // ✅ Bug #1
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction // ✅ Bug #1
  ],
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
    .setDescription("Supprimer des messages (dans un salon ou un ticket)")
    .addIntegerOption((o) => o.setName("nombre").setDescription("Nombre de messages (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName("lock").setDescription("Verrouiller le salon ou ticket"),
  new SlashCommandBuilder().setName("unlock").setDescription("Déverrouiller le salon ou ticket"),
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Définir le mode lent (salon ou ticket)")
    .addIntegerOption((o) => o.setName("secondes").setDescription("Délai en secondes (0 = désactivé)").setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName("nuke").setDescription("Purger tous les messages du salon (ou ticket)"),
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
    .setName("stats")
    .setDescription("Voir tes statistiques EMS")
    .addUserOption((o) => o.setName("membre").setDescription("Membre à consulter").setRequired(false)),
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
  const [c, t, g, ct, w, ch, iv, sv, rp] = await Promise.all([
    redisGet("config"),
    redisGet("tickets"),
    redisGet("giveaways"),
    redisGet("closed-tickets"),
    redisGet("warns"),
    redisGet("candidatures-history"),
    redisGet("interventions"),
    redisGet("service"),
    redisGet("rapports"),
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
  if (sv) serviceData = sv;
  if (rp) rapports = Array.isArray(rp) ? rp : [];
  console.log("✅ Toutes les données rechargées depuis Upstash Redis.");
}

(async () => {
  await chargerDepuisRedis();
  try {
    // Enregistrement en guild (plus rapide)
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Commandes slash enregistrées avec succès (guild).");
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

function nettoyerTimers() {
  if (serviceIntervalId) clearInterval(serviceIntervalId);
  if (rapportIntervalId) clearInterval(rapportIntervalId);
  if (interventionIntervalId) clearInterval(interventionIntervalId);
  if (orphanServiceIntervalId) clearInterval(orphanServiceIntervalId);
}

process.on('SIGINT', () => {
  console.log('🛑 Arrêt du bot... Nettoyage des timers...');
  nettoyerTimers();
  process.exit(0);
});

// ✅ Ajout SIGTERM
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt (SIGTERM)... Nettoyage...');
  nettoyerTimers();
  process.exit(0);
});

// ==============================
// VARIABLES GLOBALES
// ==============================
let serviceIntervalId = null;
let rapportIntervalId = null;
let interventionIntervalId = null;
let orphanServiceIntervalId = null;
let isBotReady = false;

// ==============================
// CLIENT READY
// ==============================
client.once("ready", async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  if (isBotReady) {
    console.log('⚠️ Bot déjà prêt, ignore...');
    return;
  }
  isBotReady = true;

  nettoyerTimers();

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

  const totalRapports = rapports.length;
  const rapporteurs = new Set(rapports.map(r => r.userId)).size;

  embed.addFields(
    { name: "📊 Total rapports", value: String(totalRapports), inline: true },
    { name: "👨‍⚕️ Rapporteurs actifs", value: String(rapporteurs), inline: true }
  );

  const topRapporteurs = getTopRapports(3);

  if (topRapporteurs.length > 0) {
    const topListe = await Promise.all(topRapporteurs.map(async (r, i) => {
      const user = await client.users.fetch(r.userId).catch(() => null);
      return `**${i+1}.** ${user?.username || r.userId} — ${r.count} rapport(s)`;
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
    ? new Set(interventions.map(iv => iv.userId)).size
    : 0;

  embed.addFields(
    { name: "📊 Total interventions", value: String(totalInterventions), inline: true },
    { name: "🚑 Intervenants actifs", value: String(intervenantsActifs), inline: true }
  );

  const topIntervenants = getTopInterventions(3);

  if (topIntervenants.length > 0) {
    const topListe = await Promise.all(topIntervenants.map(async (iv, i) => {
      const user = await client.users.fetch(iv.userId).catch(() => null);
      return `**${i+1}.** ${user?.username || iv.userId} — ${iv.count} intervention(s)`;
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
          content: `✅ Tu as déposé ton service après **${duration} minutes** !`
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

        const stats = getServiceStats(userId);
        const totalHours = Math.floor((stats.totalTime || 0) / 3600);
        const totalMinutes = Math.floor(((stats.totalTime || 0) % 3600) / 60);
        const weeklyHours = Math.floor((stats.weeklyTime || 0) / 3600);
        const weeklyMinutes = Math.floor(((stats.weeklyTime || 0) % 3600) / 60);

        const embed = new EmbedBuilder()
          .setColor("#34d399")
          .setTitle("🟢 En service")
          .setDescription(`Tu es en service depuis **${hours}h${minutes}**`)
          .addFields(
            { name: "Heure de début", value: start.toLocaleTimeString("fr-FR"), inline: true },
            { name: "Temps total", value: `${hours}h${minutes}`, inline: true },
            { name: "Temps total cumulé", value: `${totalHours}h${totalMinutes}`, inline: false },
            { name: "Temps cette semaine", value: `${weeklyHours}h${weeklyMinutes}`, inline: false }
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
        const userRapports = getRapportsByUser(userId);
        const count = userRapports.length;

        const embed = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle("📊 Mes rapports")
          .setDescription(`Tu as rédigé **${count}** rapport(s) médical(aux).`)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else if (interaction.customId === "rapport_top") {
        await interaction.deferReply({ flags: 64 });
        const topRapporteurs = getTopRapports(10);

        if (topRapporteurs.length === 0) {
          return interaction.editReply({ content: "Aucun rapport n'a encore été rédigé." });
        }

        const liste = await Promise.all(topRapporteurs.map(async (r, i) => {
          const user = await client.users.fetch(r.userId).catch(() => null);
          return `**${i+1}.** ${user?.username || r.userId} — ${r.count} rapport(s)`;
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

        // On stocke les deux menus dans la réponse, et on les renverra à chaque sélection
        await interaction.editReply({
          content: "Sélectionne le type et la gravité de l'intervention :",
          components: [row1, row2]
        });
        return;
      } else if (interaction.customId === "intervention_mes_stats") {
        await interaction.deferReply({ flags: 64 });
        const userInterventions = getInterventionsByUser(userId);
        const count = userInterventions.length;

        const embed = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle("📊 Mes interventions")
          .setDescription(`Tu as participé à **${count}** intervention(s).`)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else if (interaction.customId === "intervention_top") {
        await interaction.deferReply({ flags: 64 });
        const topIntervenants = getTopInterventions(10);

        if (topIntervenants.length === 0) {
          return interaction.editReply({ content: "Aucune intervention n'a encore été loggée." });
        }

        const liste = await Promise.all(topIntervenants.map(async (iv, i) => {
          const user = await client.users.fetch(iv.userId).catch(() => null);
          return `**${i+1}.** ${user?.username || iv.userId} — ${iv.count} intervention(s)`;
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
      // On stocke le type dans la session de l'interaction (ou dans un cache)
      if (!interaction.client.interventionData) interaction.client.interventionData = {};
      interaction.client.interventionData[interaction.user.id] = { type };

      // On récupère le message original pour garder les composants
      const originalMessage = interaction.message;
      // On reconstruit les menus (on pourrait les récupérer depuis le message, mais on les recrée)
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
          .setDisabled(true) // On désactive le type une fois choisi
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

      await interaction.update({
        content: `✅ Type sélectionné : **${LABELS_TYPE_INTERVENTION[type] || type}**\nSélectionne maintenant la gravité.`,
        components: [row1, row2]
      });
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
        userId: interaction.user.id,
        type: type,
        gravite: gravite,
        patient: null,
        date: new Date().toISOString(),
      };
      interventions.push(entree);
      sauverInterventions();
      console.log(`✅ Intervention ajoutée (total: ${interventions.length})`);

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
        content: `✅ Intervention loggée : **${LABELS_TYPE_INTERVENTION[type]}** (${LABELS_GRAVITE_INTERVENTION[gravite]})`,
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

      const diagnosticTexte = (rapport.diagnostic || []).map((d) => `• ${d}`).join("\n");
      const soinsTexte = (rapport.prise_en_charge || []).map((s) => `• ${s}`).join("\n");

      const embed = new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle(`📋 Rapport Médical - ${NOM_SERVEUR}`)
        .addFields(
          { name: "👤 Patient", value: patient, inline: true },
          { name: "🩺 Intervenant", value: `<@${interaction.user.id}>`, inline: true },
          { name: "🕒 Date et heure", value: `${dateStr} - ${heureStr}`, inline: false },
          { name: "📌 Motif de prise en charge", value: situation, inline: false },
          { name: "🔍 Examen réalisé", value: rapport.examen || "Examen non spécifié", inline: false },
          { name: "🩹 Diagnostic", value: diagnosticTexte || "Non diagnostiqué", inline: false },
          { name: "💉 Prise en charge", value: soinsTexte || "Aucune prise en charge", inline: false },
          { name: "📝 Observations", value: rapport.observations || "Aucune observation", inline: false }
        )
        .setFooter({ text: `Rapport généré par ${interaction.user.tag}` })
        .setTimestamp();

      const rapportEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        userId: interaction.user.id,
        patient: patient,
        situation: situation,
        date: new Date().toISOString()
      };
      rapports.push(rapportEntry);
      sauverRapports();
      console.log(`✅ Rapport ajouté (total: ${rapports.length})`);

      await interaction.reply({ embeds: [embed] });
      await mettreAJourMessageRapport();
      return;
    }

    // ========================================
    // BOUTONS TICKET
    // ========================================
    if (interaction.isButton()) {
      const customId = interaction.customId;
      
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
        
        try {
          await interaction.channel.members.add(user.id);
          await interaction.update({ content: `✅ ${user.tag} a été ajouté au ticket.`, components: [] });
          await interaction.channel.send({ content: `➕ <@${user.id}> a été ajouté au ticket par <@${interaction.user.id}>.` });
        } catch (e) {
          await interaction.update({ content: `❌ Échec : ${e.message}`, components: [] });
        }
        return;
      }

      if (interaction.customId === "ticket_remove_user") {
        const user = interaction.users.first();
        if (!user) return interaction.update({ content: "❌ Aucun membre sélectionné.", components: [] });
        
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.update({ content: "❌ Ticket introuvable.", components: [] });
        
        try {
          await interaction.channel.members.remove(user.id);
          await interaction.update({ content: `✅ ${user.tag} a été retiré du ticket.`, components: [] });
          await interaction.channel.send({ content: `➖ <@${user.id}> a été retiré du ticket par <@${interaction.user.id}>.` });
        } catch (e) {
          await interaction.update({ content: `❌ Échec : ${e.message}`, components: [] });
        }
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
      const commandName = interaction.commandName;
      const options = interaction.options;

      // --------------------- SERVICE ---------------------
      if (commandName === "service") {
        const subcommand = options.getSubcommand();
        const userId = interaction.user.id;

        if (subcommand === "start") {
          const status = getServiceStatus(userId);
          if (status) {
            return interaction.reply({ content: "❌ Tu es déjà en service !", flags: 64 });
          }
          await startService(userId);
          await interaction.reply({ content: "✅ Tu as pris ton service ! 🟢", flags: 64 });
          await mettreAJourMessageService();
        } else if (subcommand === "stop") {
          const status = getServiceStatus(userId);
          if (!status) {
            return interaction.reply({ content: "❌ Tu n'es pas en service !", flags: 64 });
          }
          const result = await stopService(userId);
          const duration = Math.floor(result.duration / 60);
          await interaction.reply({
            content: `✅ Tu as déposé ton service après **${duration} minutes** !`,
            flags: 64
          });
          await mettreAJourMessageService();
        } else if (subcommand === "status") {
          const status = getServiceStatus(userId);
          if (!status) {
            return interaction.reply({
              embeds: [new EmbedBuilder()
                .setColor(COULEUR_EMBED)
                .setDescription("❌ Tu n'es pas en service.")
              ],
              flags: 64
            });
          }
          const start = new Date(status.startTime);
          const duration = Math.floor((Date.now() - start) / 60000);
          const hours = Math.floor(duration / 60);
          const minutes = duration % 60;

          const stats = getServiceStats(userId);
          const totalHours = Math.floor((stats.totalTime || 0) / 3600);
          const totalMinutes = Math.floor(((stats.totalTime || 0) % 3600) / 60);
          const weeklyHours = Math.floor((stats.weeklyTime || 0) / 3600);
          const weeklyMinutes = Math.floor(((stats.weeklyTime || 0) % 3600) / 60);

          const embed = new EmbedBuilder()
            .setColor("#34d399")
            .setTitle("🟢 En service")
            .setDescription(`Tu es en service depuis **${hours}h${minutes}**`)
            .addFields(
              { name: "Heure de début", value: start.toLocaleTimeString("fr-FR"), inline: true },
              { name: "Temps total", value: `${hours}h${minutes}`, inline: true },
              { name: "Temps total cumulé", value: `${totalHours}h${totalMinutes}`, inline: false },
              { name: "Temps cette semaine", value: `${weeklyHours}h${weeklyMinutes}`, inline: false }
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed], flags: 64 });
        }
        return;
      }

      // --------------------- STATS ---------------------
      if (commandName === "stats") {
        const targetUser = options.getUser("membre") || interaction.user;
        const userId = targetUser.id;

        const serviceStats = getServiceStats(userId);
        const userInterventions = getInterventionsByUser(userId);
        const userRapports = getRapportsByUser(userId);

        const embed = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle(`📊 Statistiques EMS - ${targetUser.username}`)
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        if (serviceStats) {
          const totalHours = Math.floor((serviceStats.totalTime || 0) / 3600);
          const totalMinutes = Math.floor(((serviceStats.totalTime || 0) % 3600) / 60);
          const weeklyHours = Math.floor((serviceStats.weeklyTime || 0) / 3600);
          const weeklyMinutes = Math.floor(((serviceStats.weeklyTime || 0) % 3600) / 60);

          embed.addFields({
            name: "🟢 Service",
            value: `Total: ${totalHours}h${totalMinutes}\nCette semaine: ${weeklyHours}h${weeklyMinutes}\nSessions: ${(serviceStats.sessions || []).length}`,
            inline: true
          });

          const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
          const dailyText = jours.map(j => {
            const seconds = serviceStats.daily?.[j] || 0;
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `**${j.charAt(0).toUpperCase() + j.slice(1)}**: ${hours}h${minutes}`;
          }).join('\n');
          embed.addFields({ name: "📅 Par jour", value: dailyText, inline: false });
        } else {
          embed.addFields({ name: "🟢 Service", value: "Aucun service enregistré", inline: true });
        }

        embed.addFields({
          name: "🚑 Interventions",
          value: `${userInterventions.length} intervention(s)`,
          inline: true
        });

        embed.addFields({
          name: "📋 Rapports",
          value: `${userRapports.length} rapport(s)`,
          inline: true
        });

        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
      }

      // ========================================
      // COMMANDES DE TICKET (avec vérification que c'est un ticket)
      // ========================================
      if (["rename", "claim", "unclaim", "add", "remove", "priority", "reopen", "transcript"].includes(commandName)) {
        // Ces commandes nécessitent un ticket
        if (!interaction.channel.isThread() || interaction.channel.parentId !== config.ticketStaffChannelId) {
          return interaction.reply({ content: "❌ Cette commande n'est disponible que dans un ticket.", flags: 64 });
        }
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.reply({ content: "❌ Ticket introuvable.", flags: 64 });
        const ticket = tickets[userId];
        if (!ticket) return interaction.reply({ content: "❌ Ticket introuvable.", flags: 64 });

        if (commandName === "rename") {
          const nouveauNom = options.getString("nom");
          await interaction.channel.setName(nouveauNom.slice(0, 100)).catch(() => {});
          await interaction.reply({ content: `✅ Ticket renommé en **${nouveauNom}**.`, flags: 64 });
          return;
        }

        if (commandName === "claim") {
          if (ticket.claimedBy) return interaction.reply({ content: `❌ Ce ticket est déjà pris par <@${ticket.claimedBy}>.`, flags: 64 });
          ticket.claimedBy = interaction.user.id;
          sauverTickets();
          await interaction.reply({ content: `✅ Tu as pris en charge le ticket #${ticket.number}.`, flags: 64 });
          await interaction.channel.send({ content: `🙋 <@${interaction.user.id}> a pris en charge le ticket.` });
          return;
        }

        if (commandName === "unclaim") {
          if (!ticket.claimedBy) return interaction.reply({ content: "❌ Ce ticket n'est pas pris en charge.", flags: 64 });
          if (ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: "❌ Tu n'as pas pris ce ticket.", flags: 64 });
          }
          ticket.claimedBy = null;
          sauverTickets();
          await interaction.reply({ content: `✅ Ticket #${ticket.number} libéré.`, flags: 64 });
          await interaction.channel.send({ content: `🙅 <@${interaction.user.id}> a libéré le ticket.` });
          return;
        }

        if (commandName === "add") {
          const membre = options.getUser("membre");
          try {
            await interaction.channel.members.add(membre.id);
            await interaction.reply({ content: `✅ ${membre.tag} a été ajouté au ticket.`, flags: 64 });
            await interaction.channel.send({ content: `➕ <@${membre.id}> a été ajouté au ticket par <@${interaction.user.id}>.` });
          } catch (e) {
            await interaction.reply({ content: `❌ Échec : ${e.message}`, flags: 64 });
          }
          return;
        }

        if (commandName === "remove") {
          const membre = options.getUser("membre");
          try {
            await interaction.channel.members.remove(membre.id);
            await interaction.reply({ content: `✅ ${membre.tag} a été retiré du ticket.`, flags: 64 });
            await interaction.channel.send({ content: `➖ <@${membre.id}> a été retiré du ticket par <@${interaction.user.id}>.` });
          } catch (e) {
            await interaction.reply({ content: `❌ Échec : ${e.message}`, flags: 64 });
          }
          return;
        }

        if (commandName === "priority") {
          const niveau = options.getString("niveau");
          ticket.priority = niveau;
          sauverTickets();
          await interaction.reply({ content: `✅ Priorité définie sur **${EMOJIS_PRIORITE[niveau]} ${niveau}**.`, flags: 64 });
          return;
        }

        if (commandName === "reopen") {
          // Correction : utiliser closedTickets directement
          await interaction.deferReply({ flags: 64 });
          const closedInfo = closedTickets[interaction.channel.id];
          if (!closedInfo) {
            return interaction.editReply({ content: "❌ Ce ticket n'est pas fermé ou n'existe pas dans les archives." });
          }
          await reouvrirTicketParThread(interaction.channel.id, interaction.user.tag);
          await interaction.editReply({ content: "♻️ Ticket rouvert !" });
          return;
        }

        if (commandName === "transcript") {
          await interaction.deferReply({ flags: 64 });
          await envoyerTranscript(
            interaction.channel,
            "📄 Transcript du ticket",
            `Ticket **#${ticket.number}** demandé par **${interaction.user.tag}**.`
          );
          await interaction.editReply({ content: "✅ Le transcript a été envoyé dans le salon de logs." });
          return;
        }
      }

      // ========================================
      // COMMANDES DE MODÉRATION (clear, lock, unlock, slowmode, nuke)
      // ========================================
      if (["clear", "lock", "unlock", "slowmode", "nuke"].includes(commandName)) {
        // Ces commandes fonctionnent dans n'importe quel salon (ou ticket) avec les permissions appropriées
        const channel = interaction.channel;

        // Vérifier les permissions selon la commande
        if (commandName === "clear") {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: "❌ Tu n'as pas la permission de gérer les messages.", flags: 64 });
          }
          const nb = options.getInteger("nombre");
          const messages = await channel.messages.fetch({ limit: nb });
          await channel.bulkDelete(messages, true);
          await interaction.reply({ content: `✅ ${messages.size} messages supprimés.`, flags: 64 });
          return;
        }

        if (commandName === "lock") {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads)) {
            return interaction.reply({ content: "❌ Tu n'as pas la permission de verrouiller.", flags: 64 });
          }
          if (channel.isThread()) {
            await channel.setLocked(true);
          } else {
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: false });
          }
          await interaction.reply({ content: "🔒 Salon verrouillé.", flags: 64 });
          return;
        }

        if (commandName === "unlock") {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads)) {
            return interaction.reply({ content: "❌ Tu n'as pas la permission de déverrouiller.", flags: 64 });
          }
          if (channel.isThread()) {
            await channel.setLocked(false);
          } else {
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: null });
          }
          await interaction.reply({ content: "🔓 Salon déverrouillé.", flags: 64 });
          return;
        }

        if (commandName === "slowmode") {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: "❌ Tu n'as pas la permission de gérer le mode lent.", flags: 64 });
          }
          const secondes = options.getInteger("secondes");
          if (channel.isThread()) {
            await channel.setRateLimitPerUser(secondes);
          } else {
            await channel.setRateLimitPerUser(secondes);
          }
          await interaction.reply({ content: `✅ Mode lent défini sur ${secondes} secondes.`, flags: 64 });
          return;
        }

        if (commandName === "nuke") {
          if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: "❌ Tu n'as pas la permission de purger.", flags: 64 });
          }
          await interaction.deferReply({ flags: 64 });
          let all = [];
          let last = undefined;
          let loops = 0;
          // On supprime par lots de 100 jusqu'à 500 messages (5 lots) pour éviter de timeout
          while (loops < 5) {
            const batch = await channel.messages.fetch({ limit: 100, before: last });
            if (!batch.size) break;
            all.push(...batch.values());
            last = batch.last().id;
            loops++;
          }
          if (all.length === 0) {
            return interaction.editReply({ content: "⚠️ Aucun message à supprimer." });
          }
          await channel.bulkDelete(all, true);
          await interaction.editReply({ content: `✅ ${all.length} messages supprimés (nuke).` });
          return;
        }
      }

      // ========================================
      // COMMANDES VALID / REFUSER (candidatures) - nécessitent un ticket
      // ========================================
      if (["valid", "refuser"].includes(commandName)) {
        if (!interaction.channel.isThread() || interaction.channel.parentId !== config.ticketStaffChannelId) {
          return interaction.reply({ content: "❌ Cette commande n'est disponible que dans un ticket.", flags: 64 });
        }
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.reply({ content: "❌ Ticket introuvable.", flags: 64 });
        const ticket = tickets[userId];
        if (!ticket) return interaction.reply({ content: "❌ Ticket introuvable.", flags: 64 });

        const raison = options.getString("raison") || "Sans commentaire";
        const cfg = config.candidatures || {};
        if (!cfg.actif) {
          return interaction.reply({ content: "❌ Le système de candidatures est désactivé.", flags: 64 });
        }

        if (commandName === "valid") {
          if (!estAutoriseCandidature(interaction, cfg.rolesValid)) {
            return interaction.reply({ content: "❌ Tu n'as pas la permission de valider.", flags: 64 });
          }
          // Attribution des rôles - utiliser fetch pour être sûr
          if (cfg.rolesAttribution && cfg.rolesAttribution.length > 0) {
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (member) {
              for (const roleId of cfg.rolesAttribution) {
                await member.roles.add(roleId).catch(() => {});
              }
            }
          }
          const vars = {
            user: `<@${userId}>`,
            mention: `<@${userId}>`,
            username: ticket.username,
            server: interaction.guild.name,
            staff: interaction.user.tag,
            ticket: `#${ticket.number}`,
            date: new Date().toLocaleString("fr-FR"),
            raison: raison
          };
          const msgVal = remplacerVariables(cfg.messageValidation, vars);
          await interaction.channel.send({ content: msgVal });
          if (cfg.salonValidation) {
            const salon = await interaction.guild.channels.fetch(cfg.salonValidation).catch(() => null);
            if (salon) {
              const embed = new EmbedBuilder()
                .setColor(COULEUR_EMBED)
                .setTitle(`✅ Candidature validée - #${ticket.number}`)
                .setDescription(msgVal)
                .setTimestamp();
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
          candHistory.push({
            userId,
            username: ticket.username,
            ticketNumber: ticket.number,
            result: "validee",
            staffTag: interaction.user.tag,
            raison: raison,
            date: new Date().toISOString()
          });
          sauverCandHistory();
          if (cfg.fermetureAuto) {
            const delai = parseInt(cfg.fermetureDelai) || 10;
            setTimeout(async () => {
              await fermerTicketParThread(interaction.channel.id, "Auto-fermeture après validation");
            }, delai * 1000);
          }
          await interaction.reply({ content: "✅ Candidature validée.", flags: 64 });
          return;
        }

        if (commandName === "refuser") {
          if (!estAutoriseCandidature(interaction, cfg.rolesRefus)) {
            return interaction.reply({ content: "❌ Tu n'as pas la permission de refuser.", flags: 64 });
          }
          const vars = {
            user: `<@${userId}>`,
            mention: `<@${userId}>`,
            username: ticket.username,
            server: interaction.guild.name,
            staff: interaction.user.tag,
            ticket: `#${ticket.number}`,
            date: new Date().toLocaleString("fr-FR"),
            raison: raison
          };
          const msgRef = remplacerVariables(cfg.messageRefus, vars);
          await interaction.channel.send({ content: msgRef });
          if (cfg.salonRefus) {
            const salon = await interaction.guild.channels.fetch(cfg.salonRefus).catch(() => null);
            if (salon) {
              const embed = new EmbedBuilder()
                .setColor("#fb7185")
                .setTitle(`❌ Candidature refusée - #${ticket.number}`)
                .setDescription(msgRef)
                .setTimestamp();
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
          candHistory.push({
            userId,
            username: ticket.username,
            ticketNumber: ticket.number,
            result: "refusee",
            staffTag: interaction.user.tag,
            raison: raison,
            date: new Date().toISOString()
          });
          sauverCandHistory();
          if (cfg.fermetureAuto) {
            const delai = parseInt(cfg.fermetureDelai) || 10;
            setTimeout(async () => {
              await fermerTicketParThread(interaction.channel.id, "Auto-fermeture après refus");
            }, delai * 1000);
          }
          await interaction.reply({ content: "❌ Candidature refusée.", flags: 64 });
          return;
        }
      }

      // --------------------- WARN ---------------------
      if (commandName === "warn") {
        const membre = options.getUser("membre");
        const raison = options.getString("raison");
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return interaction.reply({ content: "❌ Tu n'as pas la permission d'avertir.", flags: 64 });
        }
        if (!warns[membre.id]) warns[membre.id] = [];
        warns[membre.id].push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          reason: raison,
          staffId: interaction.user.id,
          staffTag: interaction.user.tag,
          date: new Date().toISOString()
        });
        sauverWarns();
        const embed = embedLogModeration({
          action: "Avertissement",
          couleur: "#f59e0b",
          emoji: "⚠️",
          cibleTag: membre.tag,
          cibleId: membre.id,
          parTag: interaction.user.tag,
          raison: raison
        });
        await envoyerLogModeration(embed);
        await interaction.reply({ content: `⚠️ ${membre.tag} a été averti pour : ${raison}`, flags: 64 });
        return;
      }

      // --------------------- WARNS ---------------------
      if (commandName === "warns") {
        const membre = options.getUser("membre");
        // Vérifier permission modération
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          return interaction.reply({ content: "❌ Tu n'as pas la permission de voir les avertissements.", flags: 64 });
        }
        const liste = warns[membre.id] || [];
        if (liste.length === 0) {
          return interaction.reply({ content: `${membre.tag} n'a aucun avertissement.`, flags: 64 });
        }
        const desc = liste.map((w, i) => `**${i+1}.** ${w.reason} (par ${w.staffTag} le ${new Date(w.date).toLocaleString("fr-FR")})`).join("\n");
        const embed = new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setTitle(`⚠️ Avertissements de ${membre.tag}`)
          .setDescription(desc)
          .setTimestamp();
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
      }

      // Commande non reconnue (normalement ne devrait pas arriver)
      console.log(`Commande non implémentée : ${commandName}`);
      await interaction.reply({ content: "❌ Cette commande n'est pas encore implémentée.", flags: 64 });
    }

  } catch (error) {
    console.error('❌ Erreur dans interactionCreate:', error);
    // Gérer les cas où on a déjà defer/reply
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: "❌ Une erreur est survenue. Veuillez réessayer.", flags: 64 }).catch(() => {});
    } else {
      await interaction.reply({
        content: "❌ Une erreur est survenue. Veuillez réessayer.",
        flags: 64
      }).catch(() => {});
    }
  }
});

// ==============================
// VOICE STATE UPDATE (désactivé pour éviter double comptage)
// ==============================
// Le temps de service est géré par les boutons, donc on désactive l'ajout automatique
/*
client.on("voiceStateUpdate", async (oldState, newState) => {
  // ... code désactivé ...
});
*/

// ==============================
// PANEL WEB (Express)
// ==============================
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Middleware de session
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 12, sameSite: 'lax' },
  })
);

// Middleware de vérification de session (pour les routes API)
function authRequis(req, res, next) {
  if (!req.session.user) return res.status(401).json({ erreur: "Non authentifié" });
  // Revalidation du rôle à chaque requête
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return res.status(500).json({ erreur: "Serveur introuvable" });
  guild.members.fetch(req.session.user.id).then(member => {
    if (!member) {
      req.session.destroy();
      return res.status(401).json({ erreur: "Membre non trouvé" });
    }
    const estAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const aRoleAutorise = member.roles.cache.some((role) => ROLES_AUTORISES.includes(role.id));
    if (!estAdmin && !aRoleAutorise) {
      req.session.destroy();
      return res.status(403).json({ erreur: "Rôle insuffisant" });
    }
    next();
  }).catch(() => {
    req.session.destroy();
    res.status(401).json({ erreur: "Erreur de vérification" });
  });
}

function getGuild(res) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    res.status(500).json({ erreur: "Le bot n'est pas sur le serveur configuré (GUILD_ID)" });
    return null;
  }
  return guild;
}

// ---- Routes d'authentification ----
app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/panel");
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/panel");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/panel", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "public", "panel.html"));
});

// Génération des fichiers HTML manquants
function creerFichiersHTML() {
  const publicDir = path.join(__dirname, "public");
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
  // login.html
  const loginHTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Connexion</title></head>
<body style="background:#07080d;color:#f2f3f7;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
<div style="text-align:center;background:#12141f;padding:40px;border-radius:18px;border:1px solid rgba(148,163,184,0.1);">
<h1 style="color:#ff2d78;">🚑 EMS Panel</h1>
<a href="/auth/discord" style="display:inline-block;background:linear-gradient(135deg,#ff2d78,#3b82f6);color:white;padding:14px 28px;border-radius:9px;text-decoration:none;font-weight:600;margin-top:16px;">Se connecter avec Discord</a>
</div>
</body>
</html>`;
  fs.writeFileSync(path.join(publicDir, "login.html"), loginHTML);

  // panel.html (avec toutes les corrections CSS/JS)
  const panelHTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>Panel EMS - Statistiques</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* ... tout le CSS corrigé avec .case-ligne ... */
  :root {
    --bg: #07080d;
    --bg-alt: rgba(15,17,26,0.6);
    --bg-card: rgba(20,23,35,0.68);
    --bg-card-solid: #12141f;
    --bg-input: #10121c;
    --border: rgba(148,163,184,0.10);
    --border-hover: rgba(255,45,120,0.35);
    --accent: #ff2d78;
    --accent-b: #3b82f6;
    --accent-grad: linear-gradient(135deg, var(--accent), var(--accent-b));
    --accent-dim: rgba(255,45,120,0.12);
    --text: #f2f3f7;
    --text-dim: #8890a4;
    --text-faint: #545c72;
    --ok: #34d399;
    --err: #fb7185;
    --warn: #f59e0b;
    --radius-lg: 18px;
    --radius-md: 12px;
    --radius-sm: 9px;
    --shadow-soft: 0 10px 34px -14px rgba(0,0,0,0.6);
    --shadow-glow: 0 0 0 1px rgba(255,45,120,0.06), 0 22px 60px -22px rgba(255,45,120,0.22);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: 'Inter', -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    display: flex;
    min-height: 100vh;
    position: relative;
  }
  h1, h2, h3 { font-family: 'Sora', sans-serif; }
  body::before {
    content: '';
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background:
      radial-gradient(circle at 12% 8%, rgba(255,45,120,0.14), transparent 42%),
      radial-gradient(circle at 88% 6%, rgba(59,130,246,0.12), transparent 46%),
      radial-gradient(circle at 50% 100%, rgba(255,45,120,0.05), transparent 40%),
      var(--bg);
    animation: emsDrift 24s ease-in-out infinite alternate;
  }
  @keyframes emsDrift {
    0%   { background-position: 0% 0%, 0% 0%, 0% 0%; }
    100% { background-position: 3% 5%, -3% -3%, 2% -2%; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, body::before { animation: none !important; transition: none !important; }
  }
  nav {
    width: 250px;
    background: rgba(10,11,17,0.55);
    border-right: 1px solid var(--border);
    backdrop-filter: blur(20px);
    padding: 20px 14px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    z-index: 2;
  }
  nav h1 {
    font-size: 15.5px;
    font-weight: 700;
    letter-spacing: -0.01em;
    padding: 4px 10px 18px;
    margin: 0 0 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  nav h1 .mark {
    width: 30px; height: 30px; border-radius: 9px;
    background: var(--accent-grad);
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; flex-shrink: 0;
    box-shadow: 0 6px 16px -4px rgba(255,45,120,0.5);
  }
  nav .tab {
    padding: 10px 12px;
    cursor: pointer;
    color: var(--text-dim);
    font-size: 13.5px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    margin-bottom: 2px;
    transition: all .18s ease;
    position: relative;
  }
  nav .tab:hover { color: var(--text); background: rgba(255,255,255,0.03); }
  nav .tab.actif {
    color: #fff;
    font-weight: 600;
    background: linear-gradient(90deg, rgba(255,45,120,0.16), rgba(59,130,246,0.05));
  }
  nav .tab.actif::before {
    content: '';
    position: absolute; left: -14px; top: 6px; bottom: 6px; width: 3px;
    background: var(--accent-grad); border-radius: 0 4px 4px 0;
  }
  main {
    flex: 1;
    padding: 34px 44px 60px;
    max-width: 1200px;
    position: relative;
    z-index: 1;
  }
  main section h2 {
    font-size: 23px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 22px;
  }
  label {
    display: block;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-dim);
    margin: 16px 0 7px;
    letter-spacing: 0.01em;
  }
  label .small-hint {
    font-weight: 400;
    color: var(--text-faint);
    font-size: 11px;
    display: block;
    margin-top: 3px;
  }
  input, textarea, select {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 11px 13px;
    border-radius: var(--radius-sm);
    font-size: 13.5px;
    font-family: inherit;
    transition: border-color .18s ease, box-shadow .18s ease;
  }
  input:focus, textarea:focus, select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(255,45,120,0.14);
  }
  textarea { min-height: 90px; resize: vertical; line-height: 1.55; }
  select { cursor: pointer; }
  select[multiple] {
    min-height: 100px;
    padding: 6px;
  }
  select[multiple] option {
    padding: 6px 10px;
    border-radius: 4px;
    margin: 2px 0;
  }
  select[multiple] option:checked {
    background: var(--accent-grad);
    color: white;
  }
  /* case-ligne */
  .case-ligne {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
  }
  .case-ligne input[type="checkbox"] {
    width: 18px;
    height: 18px;
    margin: 0;
  }
  .case-ligne label {
    margin: 0;
    cursor: pointer;
  }
  button {
    margin-top: 20px;
    background: var(--accent-grad);
    color: white;
    border: none;
    padding: 11px 22px;
    border-radius: var(--radius-sm);
    font-size: 13.5px;
    cursor: pointer;
    font-weight: 600;
    font-family: inherit;
    box-shadow: 0 8px 22px -8px rgba(255,45,120,0.5);
    transition: transform .18s ease, box-shadow .18s ease, opacity .18s ease;
  }
  button:hover { transform: translateY(-1px); box-shadow: 0 12px 28px -8px rgba(255,45,120,0.65); }
  button:active { transform: translateY(0); }
  button.secondaire {
    background: var(--bg-card-solid);
    border: 1px solid var(--border);
    color: var(--text);
    box-shadow: none;
  }
  button.secondaire:hover { border-color: var(--border-hover); box-shadow: none; }
  button.danger { background: linear-gradient(135deg,#fb7185,#ef4444); box-shadow: 0 8px 22px -8px rgba(239,68,68,0.5); }
  button.avertir { background: linear-gradient(135deg,#fbbf24,#f59e0b); box-shadow: 0 8px 22px -8px rgba(245,158,11,0.5); }
  button.petit { padding: 7px 13px; font-size: 12px; margin-top: 0; }
  button.ok { background: linear-gradient(135deg,#34d399,#10b981); box-shadow: 0 8px 22px -8px rgba(52,211,153,0.5); }
  button:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
  #compte {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 10px;
    margin-top: 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    background: var(--bg-card-solid);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  #compte img { width: 26px; height: 26px; border-radius: 50%; }
  .carte {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px 20px;
    margin-bottom: 14px;
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-soft);
    transition: border-color .2s ease, transform .2s ease;
  }
  .carte:hover { border-color: var(--border-hover); }
  .stats-grille {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px;
    margin-bottom: 22px;
  }
  .stat-carte {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-soft);
    transition: transform .2s ease, border-color .2s ease;
    text-align: center;
  }
  .stat-carte:hover { transform: translateY(-2px); border-color: var(--border-hover); }
  .stat-carte .valeur {
    font-family: 'Sora', sans-serif;
    font-size: 28px;
    font-weight: 800;
    background: var(--accent-grad);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .stat-carte .valeur.ok { background: linear-gradient(135deg, #34d399, #10b981); -webkit-background-clip: text; background-clip: text; }
  .stat-carte .label { font-size: 12px; color: var(--text-dim); margin-top: 5px; font-weight: 500; }
  .msg-ok, .msg-err {
    font-size: 12.5px;
    font-weight: 600;
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    display: inline-block;
  }
  .msg-ok { color: var(--ok); background: rgba(52,211,153,0.1); border: 1px solid rgba(52,211,153,0.25); }
  .msg-err { color: var(--err); background: rgba(251,113,133,0.1); border: 1px solid rgba(251,113,133,0.25); }
  .hidden { display: none; }
  .sous-titre {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 30px 0 6px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  .sous-titre:first-of-type { margin-top: 6px; }
  .deux-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
  .role-badge {
    display: inline-flex;
    align-items: center;
    background: var(--accent-dim);
    color: var(--accent);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
    margin: 3px 5px 3px 0;
    border: 1px solid rgba(255,45,120,0.2);
  }
  .service-badge {
    display: inline-flex;
    align-items: center;
    background: rgba(52,211,153,0.15);
    color: var(--ok);
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    border: 1px solid rgba(52,211,153,0.3);
    animation: pulse-service 2s ease-in-out infinite;
  }
  @keyframes pulse-service {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  .service-off {
    display: inline-flex;
    align-items: center;
    background: rgba(148,163,184,0.1);
    color: var(--text-dim);
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    border: 1px solid var(--border);
  }
  .rank-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--bg-card-solid);
    border-radius: var(--radius-sm);
    margin-bottom: 6px;
    border-left: 3px solid var(--accent);
    transition: border-color .2s ease;
  }
  .rank-item:hover { border-color: var(--accent); }
  .rank-item .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rank-item .info .nom {
    font-weight: 600;
    font-size: 14px;
  }
  .rank-item .info .details {
    font-size: 12px;
    color: var(--text-dim);
  }
  .rank-item .value {
    font-size: 15px;
    font-weight: 700;
    color: var(--accent);
  }
  .rank-item .rank-num {
    font-weight: 700;
    color: var(--text-faint);
    margin-right: 12px;
    font-size: 13px;
    min-width: 30px;
  }
  .search-bar {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .search-bar input {
    flex: 1;
    min-width: 200px;
  }
  .search-bar select {
    width: auto;
    min-width: 150px;
  }
  .tab-stats {
    padding: 8px 16px;
    background: var(--bg-card-solid);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all .18s ease;
    font-family: inherit;
  }
  .tab-stats:hover { border-color: var(--border-hover); color: var(--text); }
  .tab-stats.actif {
    background: var(--accent-grad);
    color: white;
    border-color: transparent;
  }
  .stats-content { display: block; }
  .stats-content.hidden { display: none; }
  .daily-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 8px;
    margin: 10px 0;
  }
  .daily-item {
    background: var(--bg-card-solid);
    border-radius: var(--radius-sm);
    padding: 10px;
    text-align: center;
    border: 1px solid var(--border);
  }
  .daily-item .jour {
    font-size: 11px;
    color: var(--text-dim);
    font-weight: 600;
    text-transform: uppercase;
  }
  .daily-item .temps {
    font-size: 18px;
    font-weight: 700;
    margin-top: 4px;
    color: var(--text);
  }
  .daily-item .temps.high { color: var(--accent); }
  .warn-badge {
    display: inline-flex;
    align-items: center;
    background: rgba(245,158,11,0.12);
    color: var(--warn);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 700;
    margin: 3px 5px 3px 0;
    border: 1px solid rgba(245,158,11,0.25);
    cursor: pointer;
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.15); border-radius: 999px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,0.28); }
  @media (max-width: 900px) {
    body { flex-direction: column; }
    nav { width: 100%; height: auto; position: relative; flex-direction: row; flex-wrap: wrap; }
    main { max-width: 100%; padding: 24px; }
    .stats-grille { grid-template-columns: 1fr 1fr; }
    .deux-col { grid-template-columns: 1fr; }
    .daily-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 600px) {
    .stats-grille { grid-template-columns: 1fr; }
    .daily-grid { grid-template-columns: repeat(2, 1fr); }
    .search-bar { flex-direction: column; }
    .search-bar select { width: 100%; }
  }
</style>
</head>
<body>
<nav>
  <h1><span class="mark">🚑</span> Panel EMS</h1>
  <div class="tab actif" data-tab="dashboard">📊 Dashboard</div>
  <div class="tab" data-tab="service">🟢 Service</div>
  <div class="tab" data-tab="interventions">🚑 Interventions</div>
  <div class="tab" data-tab="rapports">📋 Rapports</div>
  <div class="tab" data-tab="moderation">🛡️ Modération</div>
  <div class="tab" data-tab="salons">💬 Salons</div>
  <div class="tab" data-tab="roles">🎭 Rôles</div>
  <div class="tab" data-tab="bienvenue">👋 Bienvenue</div>
  <div class="tab" data-tab="candidatures">✅ Candidatures</div>
  <div class="tab" data-tab="historique">🕘 Historique</div>
  <div class="tab" data-tab="embed">📢 Annonces</div>
  <div class="tab" data-tab="tickets">🎫 Tickets</div>
  <div class="tab" data-tab="giveaways">🎉 Giveaways</div>
  <div class="tab" data-tab="backup">💾 Sauvegarde</div>
  <div id="compte"></div>
  <div style="padding: 14px 10px 0; margin-top: auto;">
    <a href="/logout" class="discret" style="color:var(--text-faint);font-size:12.5px;text-decoration:none;">↪ Déconnexion</a>
  </div>
</nav>
<main>
  <section id="vue-dashboard"><h2>📊 Dashboard EMS</h2><div class="stats-grille" id="stats-grille"></div><button class="secondaire" onclick="chargerStats()">🔄 Rafraîchir</button></section>
  <section id="vue-service" class="hidden"><h2>🟢 Statistiques de service</h2><div class="encart-info" style="font-size:12.5px;color:var(--text-dim);background:var(--bg-card-solid);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;line-height:1.6;margin-bottom:16px;">Temps de service total, par semaine et par jour pour chaque membre.</div><div class="carte"><div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;"><button class="tab-stats actif" data-service-tab="top">🏆 Classement total</button><button class="tab-stats" data-service-tab="weekly">📅 Classement semaine</button><button class="tab-stats" data-service-tab="member">👤 Profil membre</button></div><div id="service-top" class="stats-content"><div id="service-top-liste"></div></div><div id="service-weekly" class="stats-content hidden"><div id="service-weekly-liste"></div></div><div id="service-member" class="stats-content hidden"><div class="search-bar"><input id="service-search" placeholder="ID ou pseudo du membre..." /><button onclick="chargerServiceMembre()" style="margin:0;">Rechercher</button></div><div id="service-member-content"><div class="carte" style="text-align:center;color:var(--text-dim);">Entrez un ID ou un pseudo pour voir les stats de service</div></div></div></div></section>
  <section id="vue-interventions" class="hidden"><h2>🚑 Statistiques d'interventions</h2><div class="encart-info" style="font-size:12.5px;color:var(--text-dim);background:var(--bg-card-solid);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;line-height:1.6;margin-bottom:16px;">Nombre total d'interventions par membre, avec classement complet.</div><div class="stats-grille" id="intervention-stats-cards"><div class="stat-carte"><div class="valeur" id="intervention-total">0</div><div class="label">Total interventions</div></div><div class="stat-carte"><div class="valeur" id="intervention-intervenants">0</div><div class="label">Intervenants uniques</div></div></div><div class="carte"><h3 style="margin-top:0;font-size:16px;">🏆 Classement des intervenants</h3><div id="intervention-top-liste"></div></div><div class="carte"><h3 style="margin-top:0;font-size:16px;">👤 Interventions d'un membre</h3><div class="search-bar"><input id="intervention-search" placeholder="ID ou pseudo du membre..." /><button onclick="chargerInterventionsMembre()" style="margin:0;">Rechercher</button></div><div id="intervention-member-content"><div style="color:var(--text-dim);text-align:center;">Entrez un ID ou un pseudo pour voir ses interventions</div></div></div></section>
  <section id="vue-rapports" class="hidden"><h2>📋 Statistiques de rapports médicaux</h2><div class="encart-info" style="font-size:12.5px;color:var(--text-dim);background:var(--bg-card-solid);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;line-height:1.6;margin-bottom:16px;">Nombre total de rapports médicaux par membre, avec classement complet.</div><div class="stats-grille" id="rapport-stats-cards"><div class="stat-carte"><div class="valeur" id="rapport-total">0</div><div class="label">Total rapports</div></div><div class="stat-carte"><div class="valeur" id="rapport-auteurs">0</div><div class="label">Rapporteurs uniques</div></div></div><div class="carte"><h3 style="margin-top:0;font-size:16px;">🏆 Classement des rapporteurs</h3><div id="rapport-top-liste"></div></div><div class="carte"><h3 style="margin-top:0;font-size:16px;">👤 Rapports d'un membre</h3><div class="search-bar"><input id="rapport-search" placeholder="ID ou pseudo du membre..." /><button onclick="chargerRapportsMembre()" style="margin:0;">Rechercher</button></div><div id="rapport-member-content"><div style="color:var(--text-dim);text-align:center;">Entrez un ID ou un pseudo pour voir ses rapports</div></div></div></section>
  <section id="vue-moderation" class="hidden"><h2>🛡️ Modération</h2><label>Rechercher un membre (pseudo)</label><input id="mod-recherche" placeholder="Tape un pseudo..." oninput="rechercherMembres(this.value)" /><div id="mod-resultats" style="margin-top: 16px;"></div></section>
  <section id="vue-salons" class="hidden"><h2>💬 Salons</h2><div class="carte"><label>Nouveau salon</label><input id="salon-nom" placeholder="nom-du-salon" /><label>Type</label><select id="salon-type"><option value="text">Texte</option><option value="voice">Vocal</option></select><button onclick="creerSalon()">Créer</button><div id="salon-statut"></div></div><div id="liste-salons"></div></section>
  <section id="vue-roles" class="hidden"><h2>🎭 Rôles</h2><div class="carte"><label>Nouveau rôle</label><input id="role-nom" placeholder="Nom du rôle" /><label>Couleur</label><input id="role-couleur" value="#ff2d78" /><button onclick="creerRole()">Créer</button><div id="role-statut"></div></div><div id="liste-roles"></div></section>
  <section id="vue-bienvenue" class="hidden"><h2>👋 Bienvenue & Auto-rôle</h2><label>Rôle(s) attribué(s) automatiquement à l'arrivée</label><select id="param-autorole" multiple><option value="">Aucun</option></select><label>Salon de bienvenue</label><select id="param-salon-bienvenue"><option value="">Aucun</option></select><label>Message de bienvenue ({user}, {server}, {count})</label><textarea id="param-message-bienvenue"></textarea><div class="sous-titre">Tickets</div><label>Salon staff pour les tickets</label><select id="param-salon-tickets"><option value="">Aucun</option></select><label>Salon des logs de tickets</label><select id="param-salon-logs-tickets"><option value="">Aucun</option></select><label>Auto-fermeture des tickets (heures)</label><input id="param-autoclose-heures" type="number" min="0" step="0.5" value="0" /><div class="sous-titre">Modération</div><label>Salon des logs de modération</label><select id="param-salon-modlogs"><option value="">Aucun</option></select><div class="sous-titre">Service</div><label>Salon du message de prise de service</label><select id="param-salon-service"><option value="">Aucun</option></select><div class="sous-titre">Rapports médicaux</div><label>Salon du message de rapport</label><select id="param-salon-rapport"><option value="">Aucun</option></select><div class="sous-titre">Interventions</div><label>Salon du message d'intervention</label><select id="param-salon-intervention"><option value="">Aucun</option></select><button onclick="sauverParametres()">Enregistrer</button><div id="param-statut"></div></section>
  <section id="vue-candidatures" class="hidden"><h2>✅ Gestion des candidatures</h2><div class="case-ligne"><input type="checkbox" id="cand-actif" /><label for="cand-actif">Activer le système de validation</label></div><div class="sous-titre">Salons de résultat</div><div class="deux-col"><div><label>Salon des validations</label><select id="cand-salon-validation"><option value="">Aucun</option></select></div><div><label>Salon des refus</label><select id="cand-salon-refus"><option value="">Utiliser le même</option></select></div></div><label>Rôle(s) autorisé(s) à valider</label><select id="cand-roles-valid" multiple><option value="">Administrateurs</option></select><label>Rôle(s) autorisé(s) à refuser</label><select id="cand-roles-refus" multiple><option value="">Administrateurs</option></select><label>Rôle(s) attribué(s) lors d'une validation</label><select id="cand-roles-attribution" multiple><option value="">Aucun</option></select><div class="case-ligne"><input type="checkbox" id="cand-mp-actif" /><label for="cand-mp-actif">Envoyer un MP</label></div><div class="case-ligne"><input type="checkbox" id="cand-mention-user" /><label for="cand-mention-user">Mentionner le candidat</label></div><div class="case-ligne"><input type="checkbox" id="cand-fermeture-auto" /><label for="cand-fermeture-auto">Fermer le ticket automatiquement</label></div><label>Délai avant fermeture (secondes)</label><input id="cand-fermeture-delai" type="number" min="0" value="10" /><div class="sous-titre">Messages</div><label>Message de validation</label><textarea id="cand-msg-validation"></textarea><label>Message de refus</label><textarea id="cand-msg-refus"></textarea><label>MP de validation</label><textarea id="cand-mp-validation"></textarea><label>MP de refus</label><textarea id="cand-mp-refus"></textarea><button onclick="sauverCandidatures()">Enregistrer</button><div id="cand-statut"></div></section>
  <section id="vue-historique" class="hidden"><h2>🕘 Historique des candidatures</h2><label>Rechercher</label><input id="hist-recherche" placeholder="Tape pour filtrer..." oninput="chargerHistorique()" /><div id="liste-historique" style="margin-top:16px;"></div></section>
  <section id="vue-embed" class="hidden"><h2>📢 Envoyer une annonce</h2><label>Salon</label><select id="embed-salon"></select><label>Titre</label><input id="embed-titre" placeholder="Titre de l'annonce" /><label>Description</label><textarea id="embed-description" placeholder="Contenu..."></textarea><label>Couleur (hex)</label><input id="embed-couleur" value="#ff2d78" /><label>Image (fichier)</label><input id="embed-image-fichier" type="file" accept="image/*" /><label>OU Image (URL)</label><input id="embed-image" placeholder="https://..." /><label>Footer</label><input id="embed-footer" placeholder="Footer..." /><button onclick="envoyerEmbed()">Envoyer</button><div id="embed-statut"></div></section>
  <section id="vue-tickets" class="hidden"><h2>🎫 Tickets ouverts</h2><button class="secondaire" onclick="chargerTickets()">🔄 Rafraîchir</button><div id="liste-tickets"></div></section>
  <section id="vue-giveaways" class="hidden"><h2>🎉 Giveaways</h2><div class="carte"><label>Salon</label><select id="giveaway-salon"></select><label>Lot</label><input id="giveaway-prize" placeholder="Ex: Grade VIP" /><label>Durée (minutes)</label><input id="giveaway-duree" type="number" value="60" /><label>Nombre de gagnants</label><input id="giveaway-gagnants" type="number" value="1" /><button onclick="creerGiveaway()">Lancer</button><div id="giveaway-statut"></div></div><div id="liste-giveaways"></div></section>
  <section id="vue-backup" class="hidden"><h2>💾 Sauvegarde</h2><div class="carte"><button onclick="exporterBackup()">📤 Télécharger la sauvegarde</button></div><div class="carte"><label>📥 Importer une sauvegarde</label><input id="backup-fichier" type="file" accept="application/json" /><button class="danger" onclick="importerBackup()">Importer et écraser</button><div id="backup-statut"></div></div></section>
</main>
<script>
// ==========================================
// PANEL SCRIPT CORRIGÉ (JavaScript)
// ==========================================

// Échappement HTML pour éviter XSS
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Gestion de la touche Entrée dans les barres de recherche
document.querySelectorAll('.search-bar input').forEach(input => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const btn = input.parentElement.querySelector('button');
      if (btn) btn.click();
    }
  });
});

// Variables globales
let cachedServiceData = {};
let rechercheTimeout;

// ===== Navigation =====
const tabs = document.querySelectorAll('.tab');
const vues = {
  dashboard: chargerStats,
  service: function() { chargerService(); chargerServiceTop(); chargerServiceWeekly(); },
  interventions: function() { chargerInterventionsStats(); chargerInterventionsTop(); },
  rapports: function() { chargerRapportsStats(); chargerRapportsTop(); },
  moderation: null,
  salons: chargerSalonsListe,
  roles: chargerRolesListe,
  bienvenue: chargerParametres,
  candidatures: chargerCandidatures,
  historique: chargerHistorique,
  embed: chargerSalons,
  tickets: chargerTickets,
  giveaways: chargerGiveaways,
  backup: null,
};

tabs.forEach(tab => tab.addEventListener('click', () => {
  tabs.forEach(t => t.classList.remove('actif'));
  tab.classList.add('actif');
  document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
  document.getElementById('vue-' + tab.dataset.tab).classList.remove('hidden');
  if (vues[tab.dataset.tab]) vues[tab.dataset.tab]();
}));

document.querySelectorAll('[data-service-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[data-service-tab]').forEach(t => t.classList.remove('actif'));
    tab.classList.add('actif');
    document.querySelectorAll('#vue-service .stats-content').forEach(c => c.classList.add('hidden'));
    document.getElementById('service-' + tab.dataset.serviceTab).classList.remove('hidden');
  });
});

// ===== Compte =====
async function chargerCompte() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/login'; return; }
    const user = await res.json();
    document.getElementById('compte').innerHTML =
      (user.avatar ? `<img src="${user.avatar}" />` : '') + `<span>${user.username}</span>`;
  } catch (e) {
    console.error('Erreur chargement compte:', e);
  }
}

// ===== Formatage =====
function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0h0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h${minutes}`;
}

function formatTimeShort(seconds) {
  if (!seconds || seconds < 0) return '0h';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h${minutes}m`;
}

// ===== Dashboard =====
async function chargerStats() {
  try {
    const res = await fetch('/api/stats');
    const s = await res.json();
    const items = [
      ['Membres', s.memberCount],
      ['Salons', s.channelCount],
      ['Rôles', s.roleCount],
      ['Ping', s.ping + ' ms'],
      ['Uptime', Math.floor(s.uptime/60) + ' min'],
      ['🟢 En service', s.servicesActifs || 0],
      ['🚑 Interventions', s.totalInterventions || 0],
      ['📋 Rapports', s.totalRapports || 0],
      ['⏱️ Service total', s.totalServiceTime + 'h'],
      ['🎫 Tickets', s.ticketsOuverts || 0],
      ['🎉 Giveaways', s.giveawaysActifs || 0],
    ];
    document.getElementById('stats-grille').innerHTML = items.map(([label, val]) =>
      `<div class="stat-carte"><div class="valeur">${val}</div><div class="label">${label}</div></div>`
    ).join('');
  } catch (e) {
    console.error('Erreur chargement stats:', e);
  }
}

// ===== Service =====
async function chargerService() {
  try {
    const res = await fetch('/api/service/active');
    const active = await res.json();
    const container = document.getElementById('service-top-liste');
    if (!container) return;
    if (active.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);">Aucun membre en service.</p>';
    } else {
      let html = '<div style="margin-bottom:12px;font-weight:600;color:var(--ok);">🟢 En service actuellement</div>';
      for (const s of active) {
        const user = await fetchUser(s.userId);
        const start = new Date(s.startTime);
        const duration = Math.floor((Date.now() - start) / 1000);
        html += `
          <div class="rank-item" style="border-left-color:var(--ok);">
            <div class="info">
              <span class="nom">${user?.username || s.userId}</span>
              <span class="details">Depuis ${start.toLocaleTimeString('fr-FR')}</span>
            </div>
            <div class="value" style="color:var(--ok);">${formatTime(duration)}</div>
          </div>
        `;
      }
      container.innerHTML = html;
    }
  } catch (e) {
    console.error('Erreur chargement service:', e);
  }
}

async function chargerServiceTop() {
  try {
    const res = await fetch('/api/service/top');
    const data = await res.json();
    const container = document.getElementById('service-top-liste');
    if (!container) return;
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);">Aucune donnée de service.</p>';
      return;
    }
    let html = '<div style="margin-bottom:12px;font-weight:600;">🏆 Classement selon le temps de service total</div>';
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const user = await fetchUser(item.userId);
      const isActive = getServiceStatus(item.userId);
      html += `
        <div class="rank-item" style="border-left-color:${isActive ? 'var(--ok)' : 'var(--border-hover)'};">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <span class="rank-num">#${i+1}</span>
            <div class="info">
              <span class="nom">${user?.username || item.userId} ${isActive ? '<span class="service-badge" style="font-size:10px;padding:2px 8px;">🟢</span>' : ''}</span>
              <span class="details">${item.sessions ? item.sessions.length + ' session(s)' : ''}</span>
            </div>
          </div>
          <div class="value">${formatTime(item.totalTime || 0)}</div>
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (e) {
    console.error('Erreur chargement top service:', e);
  }
}

async function chargerServiceWeekly() {
  try {
    const res = await fetch('/api/service/top/weekly');
    const data = await res.json();
    const container = document.getElementById('service-weekly-liste');
    if (!container) return;
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);">Aucune donnée de service cette semaine.</p>';
      return;
    }
    let html = '<div style="margin-bottom:12px;font-weight:600;">📅 Classement selon le temps de service de la semaine</div>';
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const user = await fetchUser(item.userId);
      html += `
        <div class="rank-item">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <span class="rank-num">#${i+1}</span>
            <div class="info">
              <span class="nom">${user?.username || item.userId}</span>
            </div>
          </div>
          <div class="value">${formatTime(item.weeklyTime || 0)}</div>
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (e) {
    console.error('Erreur chargement top weekly:', e);
  }
}

async function chargerServiceMembre() {
  const search = document.getElementById('service-search').value.trim();
  if (!search) return;
  try {
    const userId = await resolveUser(search);
    if (!userId) {
      document.getElementById('service-member-content').innerHTML = 
        '<div class="carte" style="text-align:center;color:var(--err);">❌ Membre non trouvé</div>';
      return;
    }
    const res = await fetch(`/api/service/member/${userId}`);
    const stats = await res.json();
    const user = await fetchUser(userId);
    if (!stats || stats.totalTime === 0) {
      document.getElementById('service-member-content').innerHTML = `
        <div class="carte" style="text-align:center;color:var(--text-dim);">
          ${user?.username || userId} n'a pas encore de temps de service enregistré.
        </div>
      `;
      return;
    }
    const isActive = stats.active || false;
    const daily = stats.daily || { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 };
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    const maxDaily = Math.max(...Object.values(daily));
    document.getElementById('service-member-content').innerHTML = `
      <div class="carte">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-size:20px;font-weight:700;">${user?.username || userId}</div>
            ${isActive ? '<span class="service-badge">🟢 En service</span>' : '<span class="service-off">Hors service</span>'}
          </div>
          <div style="text-align:right;">
            <div style="font-size:24px;font-weight:700;color:var(--accent);">${formatTime(stats.totalTime || 0)}</div>
            <div style="color:var(--text-dim);font-size:13px;">Total cumulé</div>
          </div>
        </div>
        <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="stat-carte" style="text-align:center;">
            <div class="valeur ok">${formatTime(stats.weeklyTime || 0)}</div>
            <div class="label">Cette semaine</div>
          </div>
          <div class="stat-carte" style="text-align:center;">
            <div class="valeur">${stats.sessions ? stats.sessions.length : 0}</div>
            <div class="label">Sessions</div>
          </div>
        </div>
        <div style="margin-top:16px;">
          <div style="font-weight:600;margin-bottom:8px;">📅 Temps par jour</div>
          <div class="daily-grid">
            ${jours.map(j => `
              <div class="daily-item">
                <div class="jour">${j.charAt(0).toUpperCase() + j.slice(1)}</div>
                <div class="temps ${daily[j] === maxDaily && maxDaily > 0 ? 'high' : ''}">${formatTimeShort(daily[j] || 0)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        ${stats.sessions && stats.sessions.length > 0 ? `
          <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
            <div style="font-weight:600;margin-bottom:8px;">📋 Dernières sessions</div>
            ${stats.sessions.slice(-5).reverse().map(s => `
              <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border);">
                <span style="color:var(--text-dim);">${new Date(s.start).toLocaleString('fr-FR')}</span>
                <span style="font-weight:600;">${formatTime(s.duration || 0)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } catch (e) {
    console.error('Erreur chargement service membre:', e);
    document.getElementById('service-member-content').innerHTML = 
      '<div class="carte" style="text-align:center;color:var(--err);">❌ Erreur lors du chargement</div>';
  }
}

// ===== Interventions =====
async function chargerInterventionsStats() {
  try {
    const res = await fetch('/api/interventions/stats');
    const stats = await res.json();
    document.getElementById('intervention-total').textContent = stats.total || 0;
    document.getElementById('intervention-intervenants').textContent = stats.intervenants || 0;
  } catch (e) {
    console.error('Erreur chargement stats interventions:', e);
  }
}

async function chargerInterventionsTop() {
  try {
    const res = await fetch('/api/interventions/top');
    const data = await res.json();
    const container = document.getElementById('intervention-top-liste');
    if (!container) return;
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);">Aucune intervention enregistrée.</p>';
      return;
    }
    let html = '';
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const user = await fetchUser(item.userId);
      html += `
        <div class="rank-item">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <span class="rank-num">#${i+1}</span>
            <div class="info">
              <span class="nom">${user?.username || item.userId}</span>
            </div>
          </div>
          <div class="value">${item.count} intervention(s)</div>
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (e) {
    console.error('Erreur chargement top interventions:', e);
  }
}

async function chargerInterventionsMembre() {
  const search = document.getElementById('intervention-search').value.trim();
  if (!search) return;
  try {
    const userId = await resolveUser(search);
    if (!userId) {
      document.getElementById('intervention-member-content').innerHTML = 
        '<div style="color:var(--err);text-align:center;">❌ Membre non trouvé</div>';
      return;
    }
    const res = await fetch(`/api/interventions/user/${userId}`);
    const data = await res.json();
    const user = await fetchUser(userId);
    if (!data || data.length === 0) {
      document.getElementById('intervention-member-content').innerHTML = 
        `<div style="color:var(--text-dim);text-align:center;">${user?.username || userId} n'a pas encore d'intervention.</div>`;
      return;
    }
    const types = {};
    data.forEach(iv => {
      types[iv.type] = (types[iv.type] || 0) + 1;
    });
    document.getElementById('intervention-member-content').innerHTML = `
      <div class="carte">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div style="font-size:18px;font-weight:700;">${user?.username || userId}</div>
          <div style="font-size:20px;font-weight:700;color:var(--accent);">${data.length} intervention(s)</div>
        </div>
        ${Object.keys(types).length > 0 ? `
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
            ${Object.entries(types).map(([type, count]) => `
              <span class="role-badge">${LABELS_TYPE_INTERVENTION[type] || type}: ${count}</span>
            `).join('')}
          </div>
        ` : ''}
        <div style="margin-top:12px;max-height:300px;overflow-y:auto;">
          ${data.slice(-10).reverse().map(iv => `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border);">
              <span>${LABELS_TYPE_INTERVENTION[iv.type] || iv.type} (${LABELS_GRAVITE_INTERVENTION[iv.gravite] || iv.gravite})</span>
              <span style="color:var(--text-dim);">${iv.patient || 'Patient inconnu'} — ${new Date(iv.date).toLocaleDateString('fr-FR')}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    console.error('Erreur chargement interventions membre:', e);
    document.getElementById('intervention-member-content').innerHTML = 
      '<div style="color:var(--err);text-align:center;">❌ Erreur lors du chargement</div>';
  }
}

// ===== Rapports =====
async function chargerRapportsStats() {
  try {
    const res = await fetch('/api/rapports/stats');
    const stats = await res.json();
    document.getElementById('rapport-total').textContent = stats.total || 0;
    document.getElementById('rapport-auteurs').textContent = stats.users || 0;
  } catch (e) {
    console.error('Erreur chargement stats rapports:', e);
  }
}

async function chargerRapportsTop() {
  try {
    const res = await fetch('/api/rapports/top');
    const data = await res.json();
    const container = document.getElementById('rapport-top-liste');
    if (!container) return;
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);">Aucun rapport enregistré.</p>';
      return;
    }
    let html = '';
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const user = await fetchUser(item.userId);
      html += `
        <div class="rank-item">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            <span class="rank-num">#${i+1}</span>
            <div class="info">
              <span class="nom">${user?.username || item.userId}</span>
            </div>
          </div>
          <div class="value">${item.count} rapport(s)</div>
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (e) {
    console.error('Erreur chargement top rapports:', e);
  }
}

async function chargerRapportsMembre() {
  const search = document.getElementById('rapport-search').value.trim();
  if (!search) return;
  try {
    const userId = await resolveUser(search);
    if (!userId) {
      document.getElementById('rapport-member-content').innerHTML = 
        '<div style="color:var(--err);text-align:center;">❌ Membre non trouvé</div>';
      return;
    }
    const res = await fetch(`/api/rapports/user/${userId}`);
    const data = await res.json();
    const user = await fetchUser(userId);
    if (!data || data.length === 0) {
      document.getElementById('rapport-member-content').innerHTML = 
        `<div style="color:var(--text-dim);text-align:center;">${user?.username || userId} n'a pas encore de rapport.</div>`;
      return;
    }
    document.getElementById('rapport-member-content').innerHTML = `
      <div class="carte">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div style="font-size:18px;font-weight:700;">${user?.username || userId}</div>
          <div style="font-size:20px;font-weight:700;color:var(--accent);">${data.length} rapport(s)</div>
        </div>
        <div style="margin-top:12px;max-height:400px;overflow-y:auto;">
          ${data.slice(-10).reverse().map(r => `
            <div style="padding:10px;border-bottom:1px solid var(--border);">
              <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;">
                <span style="font-weight:600;">${escapeHTML(r.patient)}</span>
                <span style="color:var(--text-dim);font-size:12px;">${new Date(r.date).toLocaleString('fr-FR')}</span>
              </div>
              <div style="font-size:13px;color:var(--text-dim);margin-top:4px;">${escapeHTML(r.situation.substring(0, 100))}${r.situation.length > 100 ? '...' : ''}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    console.error('Erreur chargement rapports membre:', e);
    document.getElementById('rapport-member-content').innerHTML = 
      '<div style="color:var(--err);text-align:center;">❌ Erreur lors du chargement</div>';
  }
}

// ===== Modération =====
async function fetchUser(userId) {
  try {
    const res = await fetch(`/api/members/search?q=${userId}`);
    const data = await res.json();
    if (data && data.length > 0) return data[0];
    return null;
  } catch { return null; }
}

async function resolveUser(search) {
  try {
    const res = await fetch(`/api/members/search?q=${encodeURIComponent(search)}`);
    const data = await res.json();
    if (data && data.length > 0) return data[0].id;
    return null;
  } catch { return null; }
}

function getServiceStatus(userId) {
  return cachedServiceData[userId]?.active || false;
}

function rechercherMembres(q) {
  clearTimeout(rechercheTimeout);
  rechercheTimeout = setTimeout(async () => {
    if (!q) { document.getElementById('mod-resultats').innerHTML = ''; return; }
    try {
      const res = await fetch('/api/members/search?q=' + encodeURIComponent(q));
      const membres = await res.json();
      const roles = await (await fetch('/api/roles')).json();
      const optionsRoles = roles.map(r => `<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');

      const serviceRes = await fetch('/api/service/stats');
      cachedServiceData = await serviceRes.json();

      document.getElementById('mod-resultats').innerHTML = membres.map(m => `
        <div class="carte">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div><img src="${m.avatar}" style="width:32px;height:32px;border-radius:50%;vertical-align:middle;margin-right:8px;">${escapeHTML(m.tag)}</div>
            <div>
              ${m.isOnService ? '<span class="service-badge">🟢 En service</span>' : '<span class="service-off">Hors service</span>'}
              <span class="warn-badge" onclick="toggleWarns('${m.id}')">⚠️ ${m.warnCount} avertissement(s)</span>
              <span class="role-badge">🚑 ${m.interventions} interventions</span>
              <span class="role-badge">📋 ${m.rapports} rapports</span>
              <span class="role-badge">⏱️ ${m.serviceTime}h de service</span>
            </div>
          </div>
          <div style="margin-top:8px;">
            ${m.roles.map(r => `<span class="role-badge">${escapeHTML(r.name)}</span>`).join('')}
          </div>
          <div id="warn-liste-${m.id}" class="warn-liste" style="margin-top:8px;display:none;"></div>
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
            <select id="role-add-${m.id}" style="width:auto;">${optionsRoles}</select>
            <button class="petit secondaire" onclick="modifierRole('${m.id}', document.getElementById('role-add-${m.id}').value, 'add')">+ Rôle</button>
            <button class="petit secondaire" onclick="timeoutMembre('${m.id}')">Timeout 10min</button>
            <button class="petit avertir" onclick="avertirMembre('${m.id}')">⚠️ Avertir</button>
            <button class="petit danger" onclick="kickMembre('${m.id}')">Kick</button>
            <button class="petit danger" onclick="banMembre('${m.id}')">Ban</button>
          </div>
        </div>
      `).join('') || '<p style="color:var(--text-dim);">Aucun résultat.</p>';
    } catch (e) {
      console.error('Erreur recherche membres:', e);
    }
  }, 400);
}

async function toggleWarns(userId) {
  const zone = document.getElementById('warn-liste-' + userId);
  if (zone.style.display === 'block') { zone.style.display = 'none'; return; }
  try {
    const res = await fetch(`/api/members/${userId}/warns`);
    const liste = await res.json();
    zone.innerHTML = liste.length
      ? liste.map(w => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <div>
            <div>${escapeHTML(w.reason)}</div>
            <div style="color:var(--text-faint);font-size:11px;">Par ${escapeHTML(w.staffTag)} — ${new Date(w.date).toLocaleString('fr-FR')}</div>
          </div>
          <button class="petit danger" style="margin:0;padding:2px 8px;font-size:11px;" onclick="supprimerWarn('${userId}','${w.id}')">×</button>
        </div>
      `).join('')
      : '<p style="color:var(--text-dim);font-size:12.5px;">Aucun avertissement.</p>';
    zone.style.display = 'block';
  } catch (e) {
    console.error('Erreur chargement warns:', e);
  }
}

async function avertirMembre(userId) {
  const raison = prompt("Raison de l'avertissement ?");
  if (!raison) return;
  try {
    const res = await fetch(`/api/members/${userId}/warn`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ reason: raison })
    });
    if (res.ok) rechercherMembres(document.getElementById('mod-recherche').value);
    else alert("Échec de l'avertissement.");
  } catch (e) {
    console.error('Erreur avertissement:', e);
    alert("Erreur lors de l'avertissement.");
  }
}

async function supprimerWarn(userId, warnId) {
  if (!confirm('Supprimer cet avertissement ?')) return;
  try {
    await fetch(`/api/members/${userId}/warns/${warnId}`, { method: 'DELETE' });
    toggleWarns(userId);
  } catch (e) {
    console.error('Erreur suppression warn:', e);
  }
}

async function modifierRole(userId, roleId, action) {
  try {
    await fetch(`/api/members/${userId}/roles/${roleId}`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action })
    });
    rechercherMembres(document.getElementById('mod-recherche').value);
  } catch (e) {
    console.error('Erreur modification rôle:', e);
  }
}

async function kickMembre(userId) {
  const raison = prompt('Raison du kick ? (optionnel)') || '';
  if (!confirm('Kick ce membre ?')) return;
  try {
    await fetch(`/api/members/${userId}/kick`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ reason: raison }) });
    rechercherMembres(document.getElementById('mod-recherche').value);
  } catch (e) {
    console.error('Erreur kick:', e);
    alert("Erreur lors du kick.");
  }
}

async function banMembre(userId) {
  const raison = prompt('Raison du ban ? (optionnel)') || '';
  if (!confirm('Bannir ce membre ?')) return;
  try {
    await fetch(`/api/members/${userId}/ban`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ reason: raison }) });
    rechercherMembres(document.getElementById('mod-recherche').value);
  } catch (e) {
    console.error('Erreur ban:', e);
    alert("Erreur lors du ban.");
  }
}

async function timeoutMembre(userId) {
  try {
    await fetch(`/api/members/${userId}/timeout`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ minutes: 10 }) });
    rechercherMembres(document.getElementById('mod-recherche').value);
  } catch (e) {
    console.error('Erreur timeout:', e);
    alert("Erreur lors du timeout.");
  }
}

// ===== Salons =====
async function chargerSalonsListe() {
  try {
    const res = await fetch('/api/channels/all');
    const salons = await res.json();
    document.getElementById('liste-salons').innerHTML = salons.map(c => `
      <div class="carte" style="display:flex;justify-content:space-between;align-items:center;">
        <span>#${escapeHTML(c.name)}</span>
        <button class="petit danger" onclick="supprimerSalon('${c.id}')">Supprimer</button>
      </div>
    `).join('');
  } catch (e) {
    console.error('Erreur chargement salons:', e);
  }
}

async function creerSalon() {
  const statut = document.getElementById('salon-statut');
  try {
    const res = await fetch('/api/channels', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name: document.getElementById('salon-nom').value, type: document.getElementById('salon-type').value })
    });
    statut.textContent = res.ok ? '✅ Créé' : '❌ Erreur';
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
    if (res.ok) { document.getElementById('salon-nom').value = ''; chargerSalonsListe(); }
  } catch (e) {
    console.error('Erreur création salon:', e);
    statut.textContent = '❌ Erreur';
    statut.className = 'msg-err';
  }
}

async function supprimerSalon(id) {
  if (!confirm('Supprimer ce salon ?')) return;
  try {
    await fetch('/api/channels/' + id, { method: 'DELETE' });
    chargerSalonsListe();
  } catch (e) {
    console.error('Erreur suppression salon:', e);
  }
}

// ===== Rôles =====
async function chargerRolesListe() {
  try {
    const res = await fetch('/api/roles');
    const roles = await res.json();
    document.getElementById('liste-roles').innerHTML = roles.map(r => `
      <div class="carte" style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:${r.color !== '#000000' ? r.color : 'var(--text)'};">${escapeHTML(r.name)}</span>
        <button class="petit danger" onclick="supprimerRole('${r.id}')">Supprimer</button>
      </div>
    `).join('');
  } catch (e) {
    console.error('Erreur chargement rôles:', e);
  }
}

async function creerRole() {
  const statut = document.getElementById('role-statut');
  try {
    const res = await fetch('/api/roles', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name: document.getElementById('role-nom').value, color: document.getElementById('role-couleur').value })
    });
    statut.textContent = res.ok ? '✅ Créé' : '❌ Erreur';
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
    if (res.ok) { document.getElementById('role-nom').value = ''; chargerRolesListe(); }
  } catch (e) {
    console.error('Erreur création rôle:', e);
    statut.textContent = '❌ Erreur';
    statut.className = 'msg-err';
  }
}

async function supprimerRole(id) {
  if (!confirm('Supprimer ce rôle ?')) return;
  try {
    await fetch('/api/roles/' + id, { method: 'DELETE' });
    chargerRolesListe();
  } catch (e) {
    console.error('Erreur suppression rôle:', e);
  }
}

// ===== Bienvenue / Paramètres =====
async function chargerParametres() {
  try {
    const [salons, params] = await Promise.all([
      (await fetch('/api/channels')).json(),
      (await fetch('/api/settings')).json(),
    ]);
    const roles = await (await fetch('/api/roles')).json();

    const optionsSalons = '<option value="">Aucun</option>' + salons.map(s => `<option value="${s.id}">#${escapeHTML(s.name)}</option>`).join('');
    const optionsRoles = '<option value="">Aucun</option>' + roles.map(r => `<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');

    const autoRoleSelect = document.getElementById('param-autorole');
    autoRoleSelect.innerHTML = optionsRoles;
    if (params.autoRoleIds && Array.isArray(params.autoRoleIds)) {
      Array.from(autoRoleSelect.options).forEach(opt => {
        opt.selected = params.autoRoleIds.includes(opt.value);
      });
    }

    document.getElementById('param-salon-bienvenue').innerHTML = optionsSalons;
    document.getElementById('param-salon-tickets').innerHTML = optionsSalons;
    document.getElementById('param-salon-logs-tickets').innerHTML = '<option value="">Aucun</option>' + salons.map(s => `<option value="${s.id}">#${escapeHTML(s.name)}</option>`).join('');
    document.getElementById('param-salon-modlogs').innerHTML = optionsSalons;
    document.getElementById('param-salon-service').innerHTML = optionsSalons;
    document.getElementById('param-salon-rapport').innerHTML = optionsSalons;
    document.getElementById('param-salon-intervention').innerHTML = optionsSalons;

    document.getElementById('param-salon-bienvenue').value = params.welcomeChannelId || '';
    document.getElementById('param-message-bienvenue').value = params.welcomeMessage || '';
    document.getElementById('param-salon-tickets').value = params.ticketStaffChannelId || '';
    document.getElementById('param-salon-logs-tickets').value = params.ticketLogsChannelId || '';
    document.getElementById('param-salon-modlogs').value = params.modLogsChannelId || '';
    document.getElementById('param-autoclose-heures').value = params.ticketAutoCloseHours ?? 0;
    document.getElementById('param-salon-service').value = params.serviceChannelId || '';
    document.getElementById('param-salon-rapport').value = params.rapportChannelId || '';
    document.getElementById('param-salon-intervention').value = params.interventionChannelId || '';
  } catch (e) {
    console.error('Erreur chargement paramètres:', e);
  }
}

async function sauverParametres() {
  const statut = document.getElementById('param-statut');
  const autoRoleSelect = document.getElementById('param-autorole');
  const autoRoleIds = Array.from(autoRoleSelect.selectedOptions).map(opt => opt.value).filter(v => v);
  
  try {
    const res = await fetch('/api/settings', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        autoRoleIds: autoRoleIds,
        welcomeChannelId: document.getElementById('param-salon-bienvenue').value,
        welcomeMessage: document.getElementById('param-message-bienvenue').value,
        ticketStaffChannelId: document.getElementById('param-salon-tickets').value,
        ticketLogsChannelId: document.getElementById('param-salon-logs-tickets').value,
        modLogsChannelId: document.getElementById('param-salon-modlogs').value,
        ticketAutoCloseHours: document.getElementById('param-autoclose-heures').value,
        serviceChannelId: document.getElementById('param-salon-service').value,
        rapportChannelId: document.getElementById('param-salon-rapport').value,
        interventionChannelId: document.getElementById('param-salon-intervention').value,
      })
    });
    statut.textContent = res.ok ? '✅ Enregistré' : '❌ Erreur';
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
  } catch (e) {
    console.error('Erreur sauvegarde paramètres:', e);
    statut.textContent = '❌ Erreur';
    statut.className = 'msg-err';
  }
}

// ===== Candidatures =====
async function chargerCandidatures() {
  try {
    const [salons, roles, cfg] = await Promise.all([
      (await fetch('/api/channels')).json(),
      (await fetch('/api/roles')).json(),
      (await fetch('/api/settings/candidatures')).json(),
    ]);

    const optionsSalons = '<option value="">Aucun</option>' + salons.map(s => `<option value="${s.id}">#${escapeHTML(s.name)}</option>`).join('');
    const optionsSalonRefus = '<option value="">Utiliser le même</option>' + salons.map(s => `<option value="${s.id}">#${escapeHTML(s.name)}</option>`).join('');
    const optionsRoles = '<option value="">Administrateurs</option>' + roles.map(r => `<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');
    const optionsRolesAttr = '<option value="">Aucun</option>' + roles.map(r => `<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');

    document.getElementById('cand-salon-validation').innerHTML = optionsSalons;
    document.getElementById('cand-salon-refus').innerHTML = optionsSalonRefus;
    
    const rolesValidSelect = document.getElementById('cand-roles-valid');
    rolesValidSelect.innerHTML = optionsRoles;
    if (cfg.rolesValid && Array.isArray(cfg.rolesValid)) {
      Array.from(rolesValidSelect.options).forEach(opt => {
        opt.selected = cfg.rolesValid.includes(opt.value);
      });
    }

    const rolesRefusSelect = document.getElementById('cand-roles-refus');
    rolesRefusSelect.innerHTML = optionsRoles;
    if (cfg.rolesRefus && Array.isArray(cfg.rolesRefus)) {
      Array.from(rolesRefusSelect.options).forEach(opt => {
        opt.selected = cfg.rolesRefus.includes(opt.value);
      });
    }

    const rolesAttributionSelect = document.getElementById('cand-roles-attribution');
    rolesAttributionSelect.innerHTML = optionsRolesAttr;
    if (cfg.rolesAttribution && Array.isArray(cfg.rolesAttribution)) {
      Array.from(rolesAttributionSelect.options).forEach(opt => {
        opt.selected = cfg.rolesAttribution.includes(opt.value);
      });
    }

    document.getElementById('cand-actif').checked = !!cfg.actif;
    document.getElementById('cand-salon-validation').value = cfg.salonValidation || '';
    document.getElementById('cand-salon-refus').value = cfg.salonRefus || '';
    document.getElementById('cand-mp-actif').checked = cfg.mpActif !== false;
    document.getElementById('cand-mention-user').checked = cfg.mentionUser !== false;
    document.getElementById('cand-fermeture-auto').checked = !!cfg.fermetureAuto;
    document.getElementById('cand-fermeture-delai').value = cfg.fermetureDelai ?? 10;
    document.getElementById('cand-msg-validation').value = cfg.messageValidation || '';
    document.getElementById('cand-msg-refus').value = cfg.messageRefus || '';
    document.getElementById('cand-mp-validation').value = cfg.mpValidation || '';
    document.getElementById('cand-mp-refus').value = cfg.mpRefus || '';
  } catch (e) {
    console.error('Erreur chargement candidatures:', e);
  }
}

async function sauverCandidatures() {
  const statut = document.getElementById('cand-statut');
  const rolesValidSelect = document.getElementById('cand-roles-valid');
  const rolesRefusSelect = document.getElementById('cand-roles-refus');
  const rolesAttributionSelect = document.getElementById('cand-roles-attribution');
  
  try {
    const res = await fetch('/api/settings/candidatures', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        actif: document.getElementById('cand-actif').checked,
        salonValidation: document.getElementById('cand-salon-validation').value,
        salonRefus: document.getElementById('cand-salon-refus').value,
        rolesValid: Array.from(rolesValidSelect.selectedOptions).map(opt => opt.value).filter(v => v),
        rolesRefus: Array.from(rolesRefusSelect.selectedOptions).map(opt => opt.value).filter(v => v),
        rolesAttribution: Array.from(rolesAttributionSelect.selectedOptions).map(opt => opt.value).filter(v => v),
        mpActif: document.getElementById('cand-mp-actif').checked,
        mentionUser: document.getElementById('cand-mention-user').checked,
        fermetureAuto: document.getElementById('cand-fermeture-auto').checked,
        fermetureDelai: document.getElementById('cand-fermeture-delai').value,
        messageValidation: document.getElementById('cand-msg-validation').value,
        messageRefus: document.getElementById('cand-msg-refus').value,
        mpValidation: document.getElementById('cand-mp-validation').value,
        mpRefus: document.getElementById('cand-mp-refus').value,
      })
    });
    statut.textContent = res.ok ? '✅ Enregistré' : '❌ Erreur';
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
  } catch (e) {
    console.error('Erreur sauvegarde candidatures:', e);
    statut.textContent = '❌ Erreur';
    statut.className = 'msg-err';
  }
}

// ===== Historique =====
let histTimeout;
function chargerHistorique() {
  clearTimeout(histTimeout);
  histTimeout = setTimeout(async () => {
    try {
      const q = document.getElementById('hist-recherche').value || '';
      const res = await fetch('/api/candidatures/history?q=' + encodeURIComponent(q));
      const liste = await res.json();
      document.getElementById('liste-historique').innerHTML = liste.length ? liste.map(h => `
        <div class="carte">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-weight:600;">${escapeHTML(h.username)} ${h.ticketNumber ? '— ticket #' + escapeHTML(h.ticketNumber) : ''}</div>
              <div style="color:var(--text-dim);font-size:12.5px;margin-top:3px;">Par ${escapeHTML(h.staffTag)} — ${new Date(h.date).toLocaleString('fr-FR')}</div>
              ${h.raison ? `<div style="margin-top:6px;font-size:12.5px;">💬 ${escapeHTML(h.raison)}</div>` : ''}
            </div>
            <span style="padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;${h.result === 'validee' ? 'background:rgba(52,211,153,0.12);color:var(--ok);border:1px solid rgba(52,211,153,0.25);' : 'background:rgba(251,113,133,0.12);color:var(--err);border:1px solid rgba(251,113,133,0.25);'}">${h.result === 'validee' ? '✅ Validée' : '❌ Refusée'}</span>
          </div>
        </div>
      `).join('') : `<p style="color:var(--text-dim);">Aucune entrée dans l'historique.</p>`;
    } catch (e) {
      console.error('Erreur chargement historique:', e);
    }
  }, 250);
}

// ===== Annonces =====
async function chargerSalons() {
  try {
    const res = await fetch('/api/channels');
    const salons = await res.json();
    const html = salons.map(s => `<option value="${s.id}">#${escapeHTML(s.name)}</option>`).join('');
    document.getElementById('embed-salon').innerHTML = html;
    document.getElementById('giveaway-salon').innerHTML = html;
  } catch (e) {
    console.error('Erreur chargement salons:', e);
  }
}

async function envoyerEmbed() {
  const statut = document.getElementById('embed-statut');
  const fichier = document.getElementById('embed-image-fichier').files[0];

  const donnees = new FormData();
  donnees.append('channelId', document.getElementById('embed-salon').value);
  donnees.append('title', document.getElementById('embed-titre').value);
  donnees.append('description', document.getElementById('embed-description').value);
  donnees.append('color', document.getElementById('embed-couleur').value);
  donnees.append('imageUrl', document.getElementById('embed-image').value);
  donnees.append('footer', document.getElementById('embed-footer').value);
  if (fichier) donnees.append('imageFile', fichier);

  try {
    const res = await fetch('/api/send-embed', { method: 'POST', body: donnees });
    const data = await res.json();
    statut.textContent = res.ok ? '✅ Envoyé !' : '❌ ' + (data.erreur || 'Erreur');
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
  } catch (e) {
    console.error('Erreur envoi embed:', e);
    statut.textContent = '❌ Erreur';
    statut.className = 'msg-err';
  }
}

// ===== Tickets =====
async function chargerTickets() {
  try {
    const res = await fetch('/api/tickets');
    const tickets = await res.json();
    const liste = document.getElementById('liste-tickets');
    if (tickets.length === 0) { liste.innerHTML = '<p style="color:var(--text-dim);">Aucun ticket ouvert.</p>'; return; }
    liste.innerHTML = tickets.map(t => `
      <div class="carte">
        <div style="font-weight:600;margin-bottom:2px;">#${escapeHTML(t.number || '?')} — ${escapeHTML(t.username)}</div>
        ${t.lastActivity ? `<div style="color:var(--text-faint);font-size:11.5px;margin-bottom:8px;">Dernière activité : ${new Date(t.lastActivity).toLocaleString('fr-FR')}</div>` : ''}
        <textarea id="reply-${t.userId}" placeholder="Réponse..."></textarea>
        <button onclick="repondreTicket('${t.userId}')">Répondre</button>
        <button class="secondaire" onclick="fermerTicket('${t.userId}')">Fermer</button>
        <div id="statut-${t.userId}"></div>
        <div style="margin-top:10px;">
          <label style="font-size:12px;color:var(--text-dim);">📝 Note interne</label>
          <textarea id="note-${t.userId}" placeholder="Note staff..." style="min-height:40px;font-size:12px;">${escapeHTML(t.note || '')}</textarea>
          <button class="petit secondaire" onclick="sauverNoteTicket('${t.userId}')">Enregistrer la note</button>
          <span id="note-statut-${t.userId}" style="margin-left:8px;font-size:12px;"></span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Erreur chargement tickets:', e);
  }
}

async function repondreTicket(userId) {
  const message = document.getElementById('reply-' + userId).value;
  const statut = document.getElementById('statut-' + userId);
  if (!message) return;
  try {
    const res = await fetch(`/api/tickets/${userId}/reply`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ message })
    });
    statut.textContent = res.ok ? '✅ Envoyé' : '❌ Erreur';
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
    if (res.ok) document.getElementById('reply-' + userId).value = '';
  } catch (e) {
    console.error('Erreur réponse ticket:', e);
    statut.textContent = '❌ Erreur';
    statut.className = 'msg-err';
  }
}

async function sauverNoteTicket(userId) {
  const note = document.getElementById('note-' + userId).value;
  const statut = document.getElementById('note-statut-' + userId);
  try {
    const res = await fetch(`/api/tickets/${userId}/note`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ note })
    });
    statut.textContent = res.ok ? '✅ Note enregistrée' : '❌ Erreur';
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
    setTimeout(() => { statut.textContent = ''; }, 2500);
  } catch (e) {
    console.error('Erreur sauvegarde note:', e);
    statut.textContent = '❌ Erreur';
    statut.className = 'msg-err';
  }
}

async function fermerTicket(userId) {
  try {
    await fetch(`/api/tickets/${userId}/close`, { method: 'POST' });
    chargerTickets();
  } catch (e) {
    console.error('Erreur fermeture ticket:', e);
  }
}

// ===== Giveaways =====
async function chargerGiveaways() {
  try {
    await chargerSalons();
    const res = await fetch('/api/giveaways');
    const gs = await res.json();
    document.getElementById('liste-giveaways').innerHTML = gs.map(g => `
      <div class="carte">
        <div style="font-weight:600;">${escapeHTML(g.prize)} — ${g.participants.length} participant(s)</div>
        <div style="color:var(--text-dim);font-size:13px;">${g.ended ? 'Terminé' : 'En cours'}</div>
        ${!g.ended ? `<button class="petit secondaire" onclick="terminerGiveawayPanel('${g.id}')">Terminer maintenant</button>` : ''}
      </div>
    `).join('') || '<p style="color:var(--text-dim);">Aucun giveaway.</p>';
  } catch (e) {
    console.error('Erreur chargement giveaways:', e);
  }
}

async function creerGiveaway() {
  const statut = document.getElementById('giveaway-statut');
  try {
    const res = await fetch('/api/giveaways', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        channelId: document.getElementById('giveaway-salon').value,
        prize: document.getElementById('giveaway-prize').value,
        durationMinutes: document.getElementById('giveaway-duree').value,
        winnersCount: document.getElementById('giveaway-gagnants').value,
      })
    });
    statut.textContent = res.ok ? '✅ Lancé !' : '❌ Erreur';
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
    if (res.ok) chargerGiveaways();
  } catch (e) {
    console.error('Erreur création giveaway:', e);
    statut.textContent = '❌ Erreur';
    statut.className = 'msg-err';
  }
}

async function terminerGiveawayPanel(id) {
  try {
    await fetch(`/api/giveaways/${id}/end`, { method: 'POST' });
    chargerGiveaways();
  } catch (e) {
    console.error('Erreur terminaison giveaway:', e);
  }
}

// ===== Backup =====
function exporterBackup() {
  window.location.href = '/api/backup';
}

async function importerBackup() {
  const statut = document.getElementById('backup-statut');
  const fichier = document.getElementById('backup-fichier').files[0];
  if (!fichier) { statut.textContent = '❌ Choisis un fichier .json'; statut.className = 'msg-err'; return; }
  if (!confirm('Cette action va écraser les données actuelles. Continuer ?')) return;

  try {
    const texte = await fichier.text();
    const data = JSON.parse(texte);
    const res = await fetch('/api/backup/import', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    });
    statut.textContent = res.ok ? '✅ Sauvegarde importée' : "❌ Échec de l'import";
    statut.className = res.ok ? 'msg-ok' : 'msg-err';
  } catch (e) {
    console.error('Erreur import backup:', e);
    statut.textContent = '❌ Fichier invalide';
    statut.className = 'msg-err';
  }
}

// ===== Constantes =====
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

// ===== Initialisation =====
chargerCompte();
chargerStats();
</script>
</body>
</html>`;
  // Écrire panel.html
  fs.writeFileSync(path.join(publicDir, "panel.html"), panelHTML);
  console.log("✅ panel.html généré automatiquement.");
}
creerFichiersHTML();

// ---- Auth ----
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

app.get("/api/me", authRequis, (req, res) => res.json(req.session.user));

// ---- Dashboard ----
app.get("/api/stats", authRequis, (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;

  const activeServices = getActiveServices();
  const totalInterventions = interventions.length;
  const totalRapports = rapports.length;
  const totalServiceTime = Object.values(serviceData).reduce((sum, d) => sum + (d.totalTime || 0), 0);

  res.json({
    memberCount: guild.memberCount,
    channelCount: guild.channels.cache.size,
    roleCount: guild.roles.cache.size,
    ping: client.ws.ping,
    uptime: Math.floor(process.uptime()),
    ticketsOuverts: Object.keys(tickets).length,
    giveawaysActifs: Object.values(giveaways).filter((g) => !g.ended).length,
    servicesActifs: activeServices.length,
    totalInterventions,
    totalRapports,
    totalServiceTime: Math.floor(totalServiceTime / 3600)
  });
});

// ---- Service Stats API ----
app.get("/api/service/stats", authRequis, (req, res) => {
  const allStats = {};
  for (const [userId, data] of Object.entries(serviceData)) {
    allStats[userId] = {
      totalTime: data.totalTime || 0,
      weeklyTime: data.weeklyTime || 0,
      daily: data.daily || { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 },
      sessions: data.sessions || [],
      active: data.active || false,
      startTime: data.startTime || null
    };
  }
  res.json(allStats);
});

app.get("/api/service/active", authRequis, (req, res) => {
  const active = getActiveServices();
  res.json(active);
});

app.get("/api/service/top", authRequis, (req, res) => {
  const top = getTopServices(50);
  res.json(top);
});

app.get("/api/service/top/weekly", authRequis, (req, res) => {
  const top = getTopWeeklyServices(50);
  res.json(top);
});

app.get("/api/service/member/:id", authRequis, (req, res) => {
  const stats = getServiceStats(req.params.id);
  res.json(stats || { totalTime: 0, weeklyTime: 0, daily: { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 }, sessions: [], active: false });
});

// ---- Interventions API ----
app.get("/api/interventions/stats", authRequis, (req, res) => {
  const stats = statsInterventions();
  res.json(stats);
});

app.get("/api/interventions/top", authRequis, (req, res) => {
  const top = getTopInterventions(50);
  res.json(top);
});

app.get("/api/interventions/user/:id", authRequis, (req, res) => {
  const userInterventions = getInterventionsByUser(req.params.id);
  res.json(userInterventions);
});

app.get("/api/interventions/recent", authRequis, (req, res) => {
  res.json(interventions.slice(-20).reverse());
});

// ---- Rapports API ----
app.get("/api/rapports/stats", authRequis, (req, res) => {
  const total = rapports.length;
  const users = new Set(rapports.map(r => r.userId)).size;
  res.json({ total, users });
});

app.get("/api/rapports/top", authRequis, (req, res) => {
  const top = getTopRapports(50);
  res.json(top);
});

app.get("/api/rapports/user/:id", authRequis, (req, res) => {
  const userRapports = getRapportsByUser(req.params.id);
  res.json(userRapports);
});

app.get("/api/rapports/recent", authRequis, (req, res) => {
  res.json(rapports.slice(-20).reverse());
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

// ---- Service config ----
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

// ---- Rapport config ----
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

// ---- Intervention config ----
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

// ---- Channels API ----
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
  if (name.length < 1 || name.length > 100) return res.status(400).json({ erreur: "nom trop long" });

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

// ---- Roles API ----
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
  if (name.length < 1 || name.length > 100) return res.status(400).json({ erreur: "nom trop long" });
  let colorNum;
  if (color) {
    const hex = color.replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return res.status(400).json({ erreur: "couleur hex invalide" });
    colorNum = parseInt(hex, 16);
  }

  try {
    const role = await guild.roles.create({
      name,
      color: colorNum,
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

// ---- Members API (recherche) ----
app.get("/api/members/search", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const q = req.query.q || "";
  if (!q) return res.json([]);

  try {
    let resultats;
    // Si la requête est un ID Discord (18 chiffres)
    if (/^\d{17,20}$/.test(q)) {
      const member = await guild.members.fetch(q).catch(() => null);
      resultats = member ? [member] : [];
    } else {
      resultats = await guild.members.fetch({ query: q, limit: 15 });
    }
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
        interventions: getInterventionsByUser(m.id).length,
        rapports: getRapportsByUser(m.id).length,
        serviceTime: Math.floor((serviceData[m.id]?.totalTime || 0) / 3600)
      }))
    );
  } catch (e) {
    console.error("Erreur recherche membre:", e);
    res.status(500).json({ erreur: "Échec de la recherche" });
  }
});

// ---- Warns API ----
app.get("/api/members/:id/warns", authRequis, (req, res) => {
  const userWarns = warns[req.params.id] || [];
  res.json(userWarns);
});

app.post("/api/members/:id/warn", authRequis, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ erreur: "Raison requise" });

  if (!warns[req.params.id]) warns[req.params.id] = [];
  warns[req.params.id].push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    reason,
    staffId: req.session.user.id,
    staffTag: req.session.user.username,
    date: new Date().toISOString()
  });
  sauverWarns();

  const user = await client.users.fetch(req.params.id).catch(() => null);
  const embed = embedLogModeration({
    action: "Avertissement",
    couleur: "#f59e0b",
    emoji: "⚠️",
    cibleTag: user?.tag || req.params.id,
    cibleId: req.params.id,
    parTag: req.session.user.username,
    raison: reason
  });
  await envoyerLogModeration(embed);

  res.json({ succes: true });
});

app.delete("/api/members/:userId/warns/:warnId", authRequis, (req, res) => {
  if (!warns[req.params.userId]) return res.status(404).json({ erreur: "Aucun avertissement" });
  warns[req.params.userId] = warns[req.params.userId].filter(w => w.id !== req.params.warnId);
  sauverWarns();
  res.json({ succes: true });
});

// ---- Gestion des rôles d'un membre ----
app.post("/api/members/:userId/roles/:roleId", authRequis, async (req, res) => {
  const { userId, roleId } = req.params;
  const { action } = req.body;
  const guild = getGuild(res);
  if (!guild) return;

  try {
    const member = await guild.members.fetch(userId);
    if (!member) return res.status(404).json({ erreur: "Membre introuvable" });
    if (action === 'add') {
      await member.roles.add(roleId);
    } else if (action === 'remove') {
      await member.roles.remove(roleId);
    } else {
      return res.status(400).json({ erreur: "Action invalide (add/remove)" });
    }
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur modification rôle:", e);
    res.status(500).json({ erreur: "Erreur lors de la modification" });
  }
});

// ---- Kick, Ban, Timeout ----
app.post("/api/members/:userId/kick", authRequis, async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(userId);
    await member.kick(reason || "Aucune raison spécifiée");
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur kick:", e);
    res.status(500).json({ erreur: "Erreur lors du kick" });
  }
});

app.post("/api/members/:userId/ban", authRequis, async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(userId);
    await member.ban({ reason: reason || "Aucune raison spécifiée" });
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur ban:", e);
    res.status(500).json({ erreur: "Erreur lors du ban" });
  }
});

app.post("/api/members/:userId/timeout", authRequis, async (req, res) => {
  const { userId } = req.params;
  const { minutes } = req.body;
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(userId);
    const duration = (parseInt(minutes) || 10) * 60 * 1000;
    await member.timeout(duration, "Timeout via panel");
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur timeout:", e);
    res.status(500).json({ erreur: "Erreur lors du timeout" });
  }
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
  if (parseInt(durationMinutes) <= 0) return res.status(400).json({ erreur: "Durée doit être > 0" });
  if (parseInt(winnersCount) <= 0) return res.status(400).json({ erreur: "Nombre de gagnants doit être > 0" });

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

// ---- Reactions Giveaway (avec partial) ----
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
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
  if (reaction.partial) await reaction.fetch().catch(() => {});
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
    serviceData,
    rapports,
    date: new Date().toISOString(),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=backup-${Date.now()}.json`);
  res.json(backup);
});

app.post("/api/backup/import", authRequis, (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ erreur: "Données manquantes" });
  // Validation basique du schéma
  if (typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ erreur: "Format invalide" });
  }

  try {
    if (data.config) { config = { ...config, ...data.config }; sauverConfig(); }
    if (data.tickets) { tickets = data.tickets; sauverTickets(); }
    if (data.giveaways) { giveaways = data.giveaways; sauverGiveaways(); }
    if (data.closedTickets) { closedTickets = data.closedTickets; sauverClosedTickets(); }
    if (data.warns) { warns = data.warns; sauverWarns(); }
    if (data.candHistory) { candHistory = data.candHistory; sauverCandHistory(); }
    if (data.interventions) { interventions = Array.isArray(data.interventions) ? data.interventions : []; sauverInterventions(); }
    if (data.serviceData) { serviceData = data.serviceData; sauverService(); }
    if (data.rapports) { rapports = Array.isArray(data.rapports) ? data.rapports : []; sauverRapports(); }

    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur import backup:", e);
    res.status(500).json({ erreur: "Erreur lors de l'import" });
  }
});

// ==============================
// MIDDLEWARE D'ERREUR EXPRESS
// ==============================
app.use((err, req, res, next) => {
  console.error('❌ Erreur Express:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ erreur: 'Erreur upload: ' + err.message });
  }
  res.status(500).json({ erreur: 'Erreur serveur interne' });
});

// ==============================
// LANCEMENT DU SERVEUR
// ==============================
app.listen(PORT, () => console.log(`✅ Serveur web + panel actif sur le port ${PORT}`));
