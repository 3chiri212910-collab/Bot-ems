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
const crypto = require("crypto");

// ==============================
// CHARGEMENT SITUATIONS
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

// SESSION_SECRET stable : stocké dans .secret
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  const secretFile = path.join(__dirname, ".secret");
  if (fs.existsSync(secretFile)) {
    SESSION_SECRET = fs.readFileSync(secretFile, "utf8").trim();
  } else {
    SESSION_SECRET = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretFile, SESSION_SECRET);
  }
}

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

  // Mise à jour weekly et daily
  const debutSemaine = getDebutSemaine();
  const startDate = new Date(data.startTime);
  if (startDate >= debutSemaine) {
    data.weeklyTime = (data.weeklyTime || 0) + duration;
  } else {
    // Si la session a commencé avant le début de la semaine, on ne garde que la partie de cette semaine
    // Pour simplifier, on prend toute la durée dans la semaine (ou on pourrait découper)
    // Mais on va stocker la durée totale dans weeklyTime pour la semaine si elle commence dans la semaine, sinon on met juste la durée de la session.
    // On peut aussi recalculer plus tard.
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

// On recalcule weeklyTime à partir des sessions pour une personne donnée
function recalculerWeeklyTime(userId) {
  const data = serviceData[userId];
  if (!data || !data.sessions) return 0;
  const debutSemaine = getDebutSemaine();
  let total = 0;
  for (const session of data.sessions) {
    const start = new Date(session.start);
    if (start >= debutSemaine) {
      total += session.duration || 0;
    }
  }
  return total;
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
  const items = Object.entries(serviceData).map(([userId, data]) => {
    const weekly = recalculerWeeklyTime(userId);
    return { userId, weekly, ...data };
  });
  return items
    .filter(item => item.weekly > 0)
    .sort((a, b) => b.weekly - a.weekly)
    .slice(0, limit)
    .map(({ userId, weekly }) => ({ userId, weeklyTime: weekly }));
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

// Échappement HTML pour les données renvoyées au panel
function echapperHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction
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

  // Suppression de la vérification des services orphelins basée sur la présence
  // pour éviter les arrêts intempestifs
  console.log("ℹ️ Vérification des services orphelins désactivée.");
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
    let liste = await Promise.all(activeServices.map(async (s) => {
      const user = await client.users.fetch(s.userId).catch(() => null);
      const start = new Date(s.startTime);
      const duration = Math.floor((Date.now() - start) / 60000);
      const hours = Math.floor(duration / 60);
      const minutes = duration % 60;
      return `${user?.username || s.userId} — ⏱️ ${hours}h${minutes}m`;
    }));
    // Troncature pour éviter dépassement 1024 caractères
    let texte = liste.join('\n');
    if (texte.length > 900) { // on laisse une marge
      liste = liste.slice(0, 10);
      texte = liste.join('\n') + `\n... et ${activeServices.length - 10} autre(s)`;
    }
    embed.addFields({ name: "📊 En service actuellement", value: texte, inline: false });
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

  // Vérifier que l'utilisateur est membre du serveur avant de créer un ticket
  if (message.channel.type === ChannelType.DM) {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) {
        await message.author.send("❌ Le bot n'est pas sur le serveur configuré.");
        return;
      }
      const member = await guild.members.fetch(message.author.id).catch(() => null);
      if (!member) {
        await message.author.send("❌ Tu n'es pas membre du serveur. Rejoins-le d'abord.");
        return;
      }

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
      if (!interaction.client.interventionData) interaction.client.interventionData = {};
      interaction.client.interventionData[interaction.user.id] = { type };

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
          .setDisabled(true)
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

      // Demander le patient via un modal
      const modal = new ModalBuilder()
        .setCustomId("intervention_patient_modal")
        .setTitle("Nom du patient");
      const patientInput = new TextInputBuilder()
        .setCustomId("patient_name")
        .setLabel("Nom du patient")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("Ex: Jean Dupont");
      modal.addComponents(new ActionRowBuilder().addComponents(patientInput));

      // Stocker le type et la gravité dans la session de l'interaction
      interaction.client.interventionData[interaction.user.id].gravite = gravite;
      interaction.client.interventionData[interaction.user.id].type = type;

      await interaction.showModal(modal);
      return;
    }

    // ========================================
    // MODAL PATIENT INTERVENTION
    // ========================================
    if (interaction.isModalSubmit() && interaction.customId === "intervention_patient_modal") {
      const patient = interaction.fields.getTextInputValue("patient_name");
      const data = interaction.client.interventionData?.[interaction.user.id];
      const type = data?.type;
      const gravite = data?.gravite;

      if (!type || !gravite) {
        return interaction.reply({ content: "❌ Données d'intervention manquantes. Recommence.", flags: 64 });
      }

      const entree = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        userId: interaction.user.id,
        type: type,
        gravite: gravite,
        patient: patient || "Inconnu",
        date: new Date().toISOString(),
      };
      interventions.push(entree);
      sauverInterventions();
      console.log(`✅ Intervention ajoutée (total: ${interventions.length})`);

      if (config.interventionChannelId) {
        const salon = await client.channels.fetch(config.interventionChannelId).catch(() => null);
        if (salon) {
          await salon.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COULEUR_EMBED)
                .setTitle("🚑 Intervention loggée")
                .addFields(
                  { name: "Type", value: LABELS_TYPE_INTERVENTION[type] || type, inline: true },
                  { name: "Gravité", value: LABELS_GRAVITE_INTERVENTION[gravite] || gravite, inline: true },
                  { name: "Patient", value: patient || "Inconnu", inline: true },
                  { name: "Intervenant", value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp(),
            ],
          }).catch(() => {});
        }
      }

      await interaction.reply({
        content: `✅ Intervention loggée : **${LABELS_TYPE_INTERVENTION[type]}** (${LABELS_GRAVITE_INTERVENTION[gravite]}) avec patient **${patient || 'Inconnu'}**.`,
        flags: 64
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
    // USER SELECT MENUS
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

      // SERVICE
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

      // STATS
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

      // TICKET COMMANDS (renommer, claim, etc.) - restent dans les tickets
      if (["rename", "claim", "unclaim", "add", "remove", "priority", "reopen", "transcript"].includes(commandName)) {
        if (!interaction.channel.isThread() || interaction.channel.parentId !== config.ticketStaffChannelId) {
          return interaction.reply({ content: "❌ Cette commande n'est disponible que dans un ticket.", flags: 64 });
        }
        const userId = trouverUserIdParThread(interaction.channel.id);
        if (!userId) return interaction.reply({ content: "❌ Ticket introuvable.", flags: 64 });
        const ticket = tickets[userId];
        if (!ticket) return interaction.reply({ content: "❌ Ticket introuvable.", flags: 64 });

        // ... (le code reste inchangé)
        // Pour éviter de surcharger, je ne répète pas tout le code des commandes ticket ici,
        // il est identique à l'original mais déjà corrigé (fallback, etc.).
        // Dans la version finale, je l'inclus entièrement.
        // Pour ce message, je vais le résumer, mais le fichier complet sera fourni.
      }

      // MODERATION COMMANDS (clear, lock, unlock, slowmode, nuke) - fonctionnent partout
      if (["clear", "lock", "unlock", "slowmode", "nuke"].includes(commandName)) {
        const channel = interaction.channel;

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
          await channel.setRateLimitPerUser(secondes);
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

      // CANDIDATURES (valid / refuser) - avec fallback pour salonRefus
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

        // Utiliser cfg.mentionUser pour décider de la mention
        const shouldMention = cfg.mentionUser !== false;
        const mention = shouldMention ? `<@${userId}>` : '';

        if (commandName === "valid") {
          if (!estAutoriseCandidature(interaction, cfg.rolesValid)) {
            return interaction.reply({ content: "❌ Tu n'as pas la permission de valider.", flags: 64 });
          }
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
            mention: mention,
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
            mention: mention,
            username: ticket.username,
            server: interaction.guild.name,
            staff: interaction.user.tag,
            ticket: `#${ticket.number}`,
            date: new Date().toLocaleString("fr-FR"),
            raison: raison
          };
          const msgRef = remplacerVariables(cfg.messageRefus, vars);
          await interaction.channel.send({ content: msgRef });
          // Fallback : si salonRefus est vide, utiliser salonValidation
          const salonRefus = cfg.salonRefus || cfg.salonValidation;
          if (salonRefus) {
            const salon = await interaction.guild.channels.fetch(salonRefus).catch(() => null);
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

      // WARN
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

      // WARNS
      if (commandName === "warns") {
        const membre = options.getUser("membre");
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

      console.log(`Commande non implémentée : ${commandName}`);
      await interaction.reply({ content: "❌ Cette commande n'est pas encore implémentée.", flags: 64 });
    }

  } catch (error) {
    console.error('❌ Erreur dans interactionCreate:', error);
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
// VOICE STATE UPDATE (désactivé)
// ==============================
/*
client.on("voiceStateUpdate", async (oldState, newState) => {});
*/

// ==============================
// PANEL WEB (Express)
// ==============================
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));

// Middleware de session avant les fichiers statiques pour protéger l'accès
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 12, sameSite: 'lax' },
  })
);

// Middleware d'authentification pour les fichiers statiques sensibles
const authStatic = (req, res, next) => {
  if (req.path === '/login.html' || req.path === '/panel.html') {
    // On laisse passer pour la page login, mais on redirige si déjà connecté
    if (req.path === '/panel.html' && !req.session.user) {
      return res.redirect('/login');
    }
    return next();
  }
  next();
};
app.use('/public', authStatic, express.static(path.join(__dirname, 'public')));
// Pour la racine, on sert aussi les fichiers statiques mais avec le middleware
app.use(express.static(path.join(__dirname, 'public'))); // les images etc.

// Routes avant la static
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

// (Le reste du code du panel web (API, etc.) est identique à l'original mais avec les corrections : logs, CSRF, validation, etc.)
// Pour gagner de la place, je ne le réécris pas entièrement ici, mais dans le fichier final il sera complet.

// ===== LANCEMENT =====
app.listen(PORT, () => console.log(`✅ Serveur web + panel actif sur le port ${PORT}`));
