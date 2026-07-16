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
const ANTECEDENTS_FILE = path.join(DATA_DIR, "antecedents.json");
const RESET_HISTORY_FILE = path.join(DATA_DIR, "resetHistory.json");

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
  antecedents: {
    enabled: false,
    channelId: null,
    messageId: null,
    allowedRoles: [],
  },
  autoReset: {
    enabled: false,
    targets: [],
    frequency: 'daily',
    customInterval: 1,
    customTime: '00:00',
    nextReset: null
  }
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
if (!config.antecedents) {
  config.antecedents = { enabled: false, channelId: null, messageId: null, allowedRoles: [] };
}
if (!config.autoReset) {
  config.autoReset = { enabled: false, targets: [], frequency: 'daily', customInterval: 1, customTime: '00:00', nextReset: null };
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
let antecedents = lire(ANTECEDENTS_FILE, []);
let resetHistory = lire(RESET_HISTORY_FILE, []);

function sauverConfig() { ecrire(CONFIG_FILE, config); }
function sauverTickets() { ecrire(TICKETS_FILE, tickets); }
function sauverGiveaways() { ecrire(GIVEAWAYS_FILE, giveaways); }
function sauverClosedTickets() { ecrire(CLOSED_TICKETS_FILE, closedTickets); }
function sauverWarns() { ecrire(WARNS_FILE, warns); }
function sauverCandHistory() { ecrire(CAND_HISTORY_FILE, candHistory); }
function sauverInterventions() { ecrire(INTERVENTIONS_FILE, interventions); }
function sauverService() { ecrire(SERVICE_FILE, serviceData); }
function sauverRapports() { ecrire(RAPPORTS_FILE, rapports); }
function sauverAntecedents() { ecrire(ANTECEDENTS_FILE, antecedents); }
function sauverResetHistory() { ecrire(RESET_HISTORY_FILE, resetHistory); }

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
      active: false,
      userInfo: null
    };
  }
  // Sauvegarder les infos utilisateur
  try {
    const user = await client.users.fetch(userId);
    const member = client.guilds.cache.get(GUILD_ID)?.members.cache.get(userId);
    serviceData[userId].userInfo = {
      username: user.username,
      displayName: member?.displayName || user.username,
      avatar: user.displayAvatarURL(),
      guildId: GUILD_ID
    };
  } catch (e) {}

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

function getServiceStats(userId) {
  const data = serviceData[userId];
  if (!data) return null;
  return {
    totalTime: data.totalTime || 0,
    weeklyTime: data.weeklyTime || 0,
    daily: data.daily || { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 },
    sessions: data.sessions || [],
    active: data.active || false,
    startTime: data.startTime || null,
    userInfo: data.userInfo || null
  };
}

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

// ==============================
// CACHES STATISTIQUES
// ==============================
let cachedInterventionTop = null;
let cachedServiceTop = null;
let cachedServiceWeekly = null;
let cachedRapportTop = null;
let cacheDirty = true;

function invalidateCache() {
  cacheDirty = true;
  cachedInterventionTop = null;
  cachedServiceTop = null;
  cachedServiceWeekly = null;
  cachedRapportTop = null;
}

function getTopServices(limit = 10) {
  if (!cacheDirty && cachedServiceTop) return cachedServiceTop.slice(0, limit);
  const top = Object.entries(serviceData)
    .filter(([_, data]) => (data.totalTime || 0) > 0)
    .sort((a, b) => (b[1].totalTime || 0) - (a[1].totalTime || 0))
    .map(([userId, data]) => ({ userId, ...data }));
  cachedServiceTop = top;
  cacheDirty = false;
  return top.slice(0, limit);
}

function getTopWeeklyServices(limit = 10) {
  if (!cacheDirty && cachedServiceWeekly) return cachedServiceWeekly.slice(0, limit);
  const items = Object.entries(serviceData).map(([userId, data]) => {
    const weekly = recalculerWeeklyTime(userId);
    return { userId, weekly, ...data };
  });
  const top = items
    .filter(item => item.weekly > 0)
    .sort((a, b) => b.weekly - a.weekly)
    .map(({ userId, weekly }) => ({ userId, weeklyTime: weekly }));
  cachedServiceWeekly = top;
  cacheDirty = false;
  return top.slice(0, limit);
}

function getTopInterventions(limit = 10) {
  if (!cacheDirty && cachedInterventionTop) return cachedInterventionTop.slice(0, limit);
  const counts = {};
  interventions.forEach(iv => {
    counts[iv.userId] = (counts[iv.userId] || 0) + 1;
  });
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([userId, count]) => {
      // Récupérer userInfo du premier élément
      const sample = interventions.find(iv => iv.userId === userId);
      return { userId, count, userInfo: sample?.userInfo || null };
    });
  cachedInterventionTop = top;
  cacheDirty = false;
  return top.slice(0, limit);
}

function getTopRapports(limit = 10) {
  if (!cacheDirty && cachedRapportTop) return cachedRapportTop.slice(0, limit);
  const counts = {};
  rapports.forEach(r => {
    counts[r.userId] = (counts[r.userId] || 0) + 1;
  });
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([userId, count]) => {
      const sample = rapports.find(r => r.userId === userId);
      return { userId, count, userInfo: sample?.userInfo || null };
    });
  cachedRapportTop = top;
  cacheDirty = false;
  return top.slice(0, limit);
}

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
// FONCTIONS ANTÉCÉDENTS
// ==============================
function genererIdAntecedent() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ajouterAntecedent(patientNom, auteurId, auteurTag, donnees) {
  const entry = {
    id: genererIdAntecedent(),
    patientNom: patientNom,
    auteurId: auteurId,
    auteurTag: auteurTag,
    dateCreation: new Date().toISOString(),
    dateModification: null,
    type: donnees.type || "Non spécifié",
    description: donnees.description || "",
    allergies: donnees.allergies || "",
    traitements: donnees.traitements || "",
    maladiesChroniques: donnees.maladiesChroniques || "",
    operations: donnees.operations || "",
    observations: donnees.observations || "",
    historiqueModifications: []
  };
  antecedents.push(entry);
  sauverAntecedents();
  return entry;
}

function modifierAntecedent(id, auteurId, auteurTag, nouvellesDonnees) {
  const index = antecedents.findIndex(a => a.id === id);
  if (index === -1) return null;
  const ancien = antecedents[index];
  const modifications = [];
  const champs = ['type', 'description', 'allergies', 'traitements', 'maladiesChroniques', 'operations', 'observations'];
  for (const champ of champs) {
    if (nouvellesDonnees[champ] !== undefined && nouvellesDonnees[champ] !== ancien[champ]) {
      modifications.push({
        date: new Date().toISOString(),
        auteurTag: auteurTag,
        champ: champ,
        ancienneValeur: ancien[champ] || "",
        nouvelleValeur: nouvellesDonnees[champ] || ""
      });
    }
  }
  if (modifications.length === 0) return ancien;
  for (const mod of modifications) {
    ancien[mod.champ] = mod.nouvelleValeur;
  }
  ancien.dateModification = new Date().toISOString();
  ancien.historiqueModifications = ancien.historiqueModifications || [];
  ancien.historiqueModifications.push(...modifications);
  sauverAntecedents();
  return ancien;
}

function supprimerAntecedent(id) {
  const index = antecedents.findIndex(a => a.id === id);
  if (index === -1) return false;
  antecedents.splice(index, 1);
  sauverAntecedents();
  return true;
}

function obtenirAntecedentParId(id) {
  return antecedents.find(a => a.id === id);
}

function rechercherAntecedents(patientNom) {
  if (!patientNom) return antecedents;
  const lower = patientNom.toLowerCase();
  return antecedents.filter(a => a.patientNom.toLowerCase().includes(lower));
}

function estAutoriseAntecedents(member) {
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  const allowed = config.antecedents.allowedRoles || [];
  if (allowed.length === 0) return false;
  return member.roles.cache.some(role => allowed.includes(role.id));
}

async function envoyerMessageAntecedents() {
  if (!config.antecedents.enabled || !config.antecedents.channelId) {
    return;
  }
  try {
    const channel = await client.channels.fetch(config.antecedents.channelId);
    if (!channel || !channel.isTextBased()) return;

    if (config.antecedents.messageId) {
      try {
        const oldMsg = await channel.messages.fetch(config.antecedents.messageId);
        if (oldMsg) await oldMsg.delete();
      } catch (e) {}
    }

    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle("🩺 Module Antécédents Médicaux")
      .setDescription("Utilisez les boutons ci-dessous pour gérer les antécédents médicaux des patients.\n\n" +
        "• **🩺 Créer un antécédent** : Enregistrer un nouvel antécédent\n" +
        "• **🔍 Rechercher** : Consulter les antécédents d'un patient")
      .setFooter({ text: NOM_SERVEUR })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("antecedents_creer")
        .setLabel("🩺 Créer un antécédent")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("antecedents_rechercher")
        .setLabel("🔍 Rechercher un patient")
        .setStyle(ButtonStyle.Secondary)
    );

    const message = await channel.send({ embeds: [embed], components: [row] });
    config.antecedents.messageId = message.id;
    sauverConfig();
    console.log('✅ Message antécédents envoyé');
  } catch (e) {
    console.error("❌ Erreur envoi message antécédents:", e);
  }
}

// ==============================
// FONCTIONS RESET
// ==============================
function logReset(type, source, username) {
  const entry = {
    type,
    source, // 'manuel' ou 'auto'
    username: username || 'Système',
    date: new Date().toISOString()
  };
  resetHistory.push(entry);
  if (resetHistory.length > 1000) resetHistory = resetHistory.slice(-1000);
  sauverResetHistory();
}

function calculateNextReset(auto) {
  const now = new Date();
  let target = new Date(now);
  const freq = auto.frequency || 'daily';
  const customDays = parseInt(auto.customInterval) || 1;
  const [hour, minute] = (auto.customTime || '00:00').split(':').map(Number);

  if (freq === 'daily') {
    target.setDate(target.getDate() + 1);
  } else if (freq === 'weekly') {
    target.setDate(target.getDate() + 7);
  } else if (freq === 'monthly') {
    target.setMonth(target.getMonth() + 1);
  } else if (freq === 'custom') {
    target.setDate(target.getDate() + customDays);
  }

  target.setHours(hour || 0, minute || 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

let serviceAutoResetInterval = null;

async function performAutoReset() {
  const auto = config.autoReset || {};
  if (!auto.enabled) return;
  const targets = auto.targets || [];
  const resetAll = targets.includes('all') || targets.length === 0;

  if (resetAll) {
    interventions = [];
    sauverInterventions();
    serviceData = {};
    sauverService();
    rapports = [];
    sauverRapports();
    logReset('all', 'auto', 'Système');
    invalidateCache();
  } else {
    if (targets.includes('interventions')) {
      interventions = [];
      sauverInterventions();
      logReset('interventions', 'auto', 'Système');
      invalidateCache();
    }
    if (targets.includes('services')) {
      serviceData = {};
      sauverService();
      logReset('services', 'auto', 'Système');
      invalidateCache();
    }
    if (targets.includes('rapports')) {
      rapports = [];
      sauverRapports();
      logReset('rapports', 'auto', 'Système');
      invalidateCache();
    }
  }

  // Recalculer prochaine date
  const next = calculateNextReset(auto);
  auto.nextReset = next.toISOString();
  sauverConfig();
  scheduleAutoReset();

  // Rafraîchir les messages Discord
  if (config.serviceChannelId) await mettreAJourMessageService().catch(() => {});
  if (config.rapportChannelId) await mettreAJourMessageRapport().catch(() => {});
  if (config.interventionChannelId) await mettreAJourMessageIntervention().catch(() => {});

  // Émettre mise à jour temps réel
  if (io) io.emit('dataUpdated', { type: 'reset' });
}

function scheduleAutoReset() {
  if (serviceAutoResetInterval) {
    clearTimeout(serviceAutoResetInterval);
    serviceAutoResetInterval = null;
  }
  const auto = config.autoReset || {};
  if (!auto.enabled) return;
  if (!auto.targets || auto.targets.length === 0) return;

  const now = new Date();
  let nextDate = auto.nextReset ? new Date(auto.nextReset) : null;

  if (!nextDate || nextDate <= now) {
    nextDate = calculateNextReset(auto);
    auto.nextReset = nextDate.toISOString();
    sauverConfig();
  }

  const delay = nextDate.getTime() - now.getTime();
  if (delay <= 0) {
    performAutoReset();
    return;
  }

  serviceAutoResetInterval = setTimeout(() => {
    performAutoReset();
  }, delay);
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
  const [c, t, g, ct, w, ch, iv, sv, rp, ant, rh] = await Promise.all([
    redisGet("config"),
    redisGet("tickets"),
    redisGet("giveaways"),
    redisGet("closed-tickets"),
    redisGet("warns"),
    redisGet("candidatures-history"),
    redisGet("interventions"),
    redisGet("service"),
    redisGet("rapports"),
    redisGet("antecedents"),
    redisGet("resetHistory"),
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
    if (!config.antecedents) config.antecedents = { enabled: false, channelId: null, messageId: null, allowedRoles: [] };
    if (!config.autoReset) config.autoReset = { enabled: false, targets: [], frequency: 'daily', customInterval: 1, customTime: '00:00', nextReset: null };
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
  if (ant) antecedents = Array.isArray(ant) ? ant : [];
  if (rh) resetHistory = Array.isArray(rh) ? rh : [];
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
  if (serviceAutoResetInterval) clearTimeout(serviceAutoResetInterval);
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
let io = null;

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

  if (config.antecedents.enabled && config.antecedents.channelId) {
    await envoyerMessageAntecedents();
  }

  serviceIntervalId = setInterval(async () => {
    if (!isBotReady) return;
    await mettreAJourMessageService();
  }, 30000);

  // Planification auto-reset
  scheduleAutoReset();

  console.log("✅ Bot prêt et auto-reset planifié.");
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
    let texte = liste.join('\n');
    if (texte.length > 900) {
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

  const guild = client.guilds.cache.get(GUILD_ID);
  const guildIcon = guild?.iconURL({ dynamic: true }) || "https://cdn.discordapp.com/embed/avatars/0.png";
  const user = await client.users.fetch(thread.ownerId).catch(() => null);

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
  body { background:#313338; color:#dbdee1; font-family: Arial, sans-serif; margin:0; padding:0; }
  .header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; background:#1e1f22; border-bottom:2px solid #ff2d78; }
  .header-left { display:flex; align-items:center; gap:12px; }
  .header-left img { height:40px; border-radius:50%; }
  .header-left span { font-weight:bold; font-size:20px; color:#fff; }
  .header-right { font-weight:600; color:#ff2d78; }
  .content { padding:20px 24px; }
  h1 { color:#ff2d78; margin:0 0 12px; }
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
    <p>Généré le ${new Date().toLocaleString("fr-FR")} — ${toutMessages.length} message(s)</p>
    ${lignes || "<p><i>Aucun message.</i></p>"}
  </div>
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
// GIVEAWAYS – GESTION DES RÉACTIONS (AJOUT)
// ==============================
client.on("messageReactionAdd", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  const giveaway = Object.values(giveaways).find(g =>
    g.messageId === reaction.message.id && !g.ended
  );
  if (!giveaway) return;
  if (!giveaway.participants.includes(user.id)) {
    giveaway.participants.push(user.id);
    sauverGiveaways();
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  const giveaway = Object.values(giveaways).find(g =>
    g.messageId === reaction.message.id && !g.ended
  );
  if (!giveaway) return;
  const idx = giveaway.participants.indexOf(user.id);
  if (idx !== -1) {
    giveaway.participants.splice(idx, 1);
    sauverGiveaways();
  }
});

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
        if (io) io.emit('dataUpdated', { type: 'service' });
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
        if (io) io.emit('dataUpdated', { type: 'service' });
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

      const userInfo = {
        username: interaction.user.username,
        displayName: interaction.member?.displayName || interaction.user.username,
        avatar: interaction.user.displayAvatarURL(),
        guildId: interaction.guildId || GUILD_ID
      };

      const entree = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        userId: interaction.user.id,
        type: type,
        gravite: gravite,
        patient: patient || "Inconnu",
        date: new Date().toISOString(),
        userInfo: userInfo
      };
      interventions.push(entree);
      sauverInterventions();
      invalidateCache();
      console.log(`✅ Intervention ajoutée (total: ${interventions.length})`);

      if (config.interventionChannelId) {
        const salon = await client.channels.fetch(config.interventionChannelId).catch(() => null);
        if (salon) {
          await salon.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COULEUR_EMBED)
                .setTitle("🚑 Intervention loggée")
                .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
                .setThumbnail(interaction.guild?.iconURL({ dynamic: true }) || null)
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
      if (io) io.emit('dataUpdated', { type: 'intervention' });
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
        .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
        .setThumbnail(interaction.guild?.iconURL({ dynamic: true }) || null)
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

      const userInfo = {
        username: interaction.user.username,
        displayName: interaction.member?.displayName || interaction.user.username,
        avatar: interaction.user.displayAvatarURL(),
        guildId: interaction.guildId || GUILD_ID
      };

      const rapportEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        userId: interaction.user.id,
        patient: patient,
        situation: situation,
        date: new Date().toISOString(),
        userInfo: userInfo
      };
      rapports.push(rapportEntry);
      sauverRapports();
      invalidateCache();
      console.log(`✅ Rapport ajouté (total: ${rapports.length})`);

      await interaction.reply({ embeds: [embed] });
      await mettreAJourMessageRapport();
      if (io) io.emit('dataUpdated', { type: 'rapport' });
      return;
    }

    // ========================================
    // BOUTONS TICKET (inchangé)
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
    // BOUTONS ANTÉCÉDENTS
    // ========================================
    if (interaction.isButton() && ["antecedents_creer", "antecedents_rechercher"].includes(interaction.customId)) {
      if (!estAutoriseAntecedents(interaction.member)) {
        return interaction.reply({ content: "❌ Vous n'avez pas la permission d'utiliser ce module.", flags: 64 });
      }

      if (interaction.customId === "antecedents_creer") {
        const modal2 = new ModalBuilder()
          .setCustomId("antecedents_modal_creer")
          .setTitle("🩺 Nouvel antécédent");

        modal2.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("patient_nom")
              .setLabel("Nom du patient")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("Ex: Jean Dupont")
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("type")
              .setLabel("Type d'antécédent")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("Ex: Allergie, maladie, opération...")
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("description")
              .setLabel("Description")
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder("Détails...")
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("allergies")
              .setLabel("Allergies")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("Ex: Pénicilline")
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("traitements")
              .setLabel("Traitements en cours")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("Ex: Paracétamol 500mg")
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("maladies")
              .setLabel("Maladies chroniques")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("Ex: Diabète")
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("operations")
              .setLabel("Opérations subies")
              .setStyle(TextInputStyle.Short)
              .setPlaceholder("Ex: Appendicectomie")
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("observations")
              .setLabel("Observations")
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder("Informations complémentaires...")
              .setRequired(false)
          )
        );

        await interaction.showModal(modal2);
        return;
      }

      if (interaction.customId === "antecedents_rechercher") {
        const modal = new ModalBuilder()
          .setCustomId("antecedents_modal_recherche")
          .setTitle("🔍 Rechercher un patient");
        const searchInput = new TextInputBuilder()
          .setCustomId("recherche")
          .setLabel("Nom du patient")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Saisissez le nom")
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(searchInput));
        await interaction.showModal(modal);
        return;
      }
    }

    // ========================================
    // MODALS ANTÉCÉDENTS
    // ========================================
    if (interaction.isModalSubmit() && interaction.customId === "antecedents_modal_creer") {
      await interaction.deferReply({ flags: 64 });
      const patientNom = interaction.fields.getTextInputValue("patient_nom");
      const type = interaction.fields.getTextInputValue("type");
      const description = interaction.fields.getTextInputValue("description");
      const allergies = interaction.fields.getTextInputValue("allergies");
      const traitements = interaction.fields.getTextInputValue("traitements");
      const maladiesChroniques = interaction.fields.getTextInputValue("maladies");
      const operations = interaction.fields.getTextInputValue("operations");
      const observations = interaction.fields.getTextInputValue("observations");

      const entry = ajouterAntecedent(
        patientNom,
        interaction.user.id,
        interaction.user.tag,
        { type, description, allergies, traitements, maladiesChroniques, operations, observations }
      );

      await interaction.editReply({ content: `✅ Antécédent créé pour **${patientNom}** (ID: ${entry.id}).` });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "antecedents_modal_recherche") {
      await interaction.deferReply({ flags: 64 });
      const recherche = interaction.fields.getTextInputValue("recherche").trim();
      if (!recherche) return interaction.editReply({ content: "❌ Veuillez saisir un nom." });

      const resultats = rechercherAntecedents(recherche);
      if (resultats.length === 0) {
        return interaction.editReply({ content: `Aucun antécédent trouvé pour **${recherche}**.` });
      }

      const embed = new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle(`📋 Antécédents de ${resultats[0].patientNom}`)
        .setDescription(`**${resultats.length}** antécédent(s) trouvé(s).`)
        .setTimestamp();

      const maxAffichage = Math.min(resultats.length, 10);
      for (let i = 0; i < maxAffichage; i++) {
        const a = resultats[i];
        const date = new Date(a.dateCreation).toLocaleString('fr-FR');
        let value = `ID: \`${a.id}\`\nType: ${a.type}\n`;
        if (a.description) value += `📝 ${a.description}\n`;
        if (a.allergies) value += `⚠️ Allergies: ${a.allergies}\n`;
        if (a.traitements) value += `💊 Traitements: ${a.traitements}\n`;
        if (a.maladiesChroniques) value += `🩺 Maladies: ${a.maladiesChroniques}\n`;
        if (a.operations) value += `🔬 Opérations: ${a.operations}\n`;
        if (a.observations) value += `📋 Obs: ${a.observations}`;
        embed.addFields({ name: `🩺 ${a.type} (${date})`, value: value || "Aucune info", inline: false });
      }
      if (resultats.length > 10) {
        embed.setFooter({ text: `Et ${resultats.length - 10} autres... Consultez le panel web.` });
      }
      await interaction.editReply({ embeds: [embed] });
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
          if (io) io.emit('dataUpdated', { type: 'service' });
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
          if (io) io.emit('dataUpdated', { type: 'service' });
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

      // TICKET COMMANDS
      if (["rename", "claim", "unclaim", "add", "remove", "priority", "reopen", "transcript"].includes(commandName)) {
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

      // MODERATION COMMANDS
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

      // CANDIDATURES
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
// PANEL WEB (Express) + Socket.io
// ==============================
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
io = new Server(server, {
  cors: { origin: "*" }
});

app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 12, sameSite: 'lax' },
  })
);

// Middleware d'authentification
function authRequis(req, res, next) {
  if (!req.session.user) return res.status(401).json({ erreur: "Non authentifié" });
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

// ==============================
// ROUTES D'AUTHENTIFICATION
// ==============================
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

// ==============================
// API STATS
// ==============================
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

// ==============================
// API SERVICE
// ==============================
app.get("/api/service/stats", authRequis, (req, res) => {
  const allStats = {};
  for (const [userId, data] of Object.entries(serviceData)) {
    allStats[userId] = {
      totalTime: data.totalTime || 0,
      weeklyTime: data.weeklyTime || 0,
      daily: data.daily || { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 },
      sessions: data.sessions || [],
      active: data.active || false,
      startTime: data.startTime || null,
      userInfo: data.userInfo || null
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
  if (stats) {
    stats.weeklyTime = recalculerWeeklyTime(req.params.id);
  }
  res.json(stats || { totalTime: 0, weeklyTime: 0, daily: { lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 }, sessions: [], active: false, userInfo: null });
});

// ==============================
// API INTERVENTIONS
// ==============================
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

// ==============================
// API RAPPORTS
// ==============================
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

// ==============================
// API SETTINGS
// ==============================
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
    autoReset: config.autoReset || { enabled: false, targets: [], frequency: 'daily', customInterval: 1, customTime: '00:00', nextReset: null }
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

  const oldService = config.serviceChannelId;
  const oldRapport = config.rapportChannelId;
  const oldIntervention = config.interventionChannelId;

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

  if (serviceChannelId !== undefined && serviceChannelId !== oldService) {
    setTimeout(() => {
      if (config.serviceChannelId) envoyerMessageService().catch(() => {});
    }, 1000);
  }
  if (rapportChannelId !== undefined && rapportChannelId !== oldRapport) {
    setTimeout(() => {
      if (config.rapportChannelId) envoyerMessageRapport().catch(() => {});
    }, 1000);
  }
  if (interventionChannelId !== undefined && interventionChannelId !== oldIntervention) {
    setTimeout(() => {
      if (config.interventionChannelId) envoyerMessageIntervention().catch(() => {});
    }, 1000);
  }

  res.json({ succes: true });
});

// ==============================
// API SERVICE CONFIG
// ==============================
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

// ==============================
// API RESET
// ==============================
app.post('/api/reset/interventions', authRequis, async (req, res) => {
  try {
    interventions = [];
    sauverInterventions();
    invalidateCache();
    logReset('interventions', 'manuel', req.session.user.username);
    if (io) io.emit('dataUpdated', { type: 'reset' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reset/services', authRequis, async (req, res) => {
  try {
    serviceData = {};
    sauverService();
    invalidateCache();
    logReset('services', 'manuel', req.session.user.username);
    if (io) io.emit('dataUpdated', { type: 'reset' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reset/rapports', authRequis, async (req, res) => {
  try {
    rapports = [];
    sauverRapports();
    invalidateCache();
    logReset('rapports', 'manuel', req.session.user.username);
    if (io) io.emit('dataUpdated', { type: 'reset' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reset/all', authRequis, async (req, res) => {
  try {
    interventions = [];
    sauverInterventions();
    serviceData = {};
    sauverService();
    rapports = [];
    sauverRapports();
    invalidateCache();
    logReset('all', 'manuel', req.session.user.username);
    if (io) io.emit('dataUpdated', { type: 'reset' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==============================
// API AUTO-RESET
// ==============================
app.get('/api/auto-reset/config', authRequis, (req, res) => {
  const auto = config.autoReset || { enabled: false, targets: [], frequency: 'daily', customInterval: 1, customTime: '00:00', nextReset: null };
  res.json(auto);
});

app.post('/api/auto-reset/config', authRequis, (req, res) => {
  const { enabled, targets, frequency, customInterval, customTime } = req.body;
  if (!config.autoReset) config.autoReset = {};
  config.autoReset.enabled = enabled === true;
  config.autoReset.targets = Array.isArray(targets) ? targets : [];
  config.autoReset.frequency = frequency || 'daily';
  config.autoReset.customInterval = parseInt(customInterval) || 1;
  config.autoReset.customTime = customTime || '00:00';
  const next = calculateNextReset(config.autoReset);
  config.autoReset.nextReset = next.toISOString();
  sauverConfig();
  scheduleAutoReset();
  res.json({ success: true });
});

// ==============================
// API RESET HISTORY
// ==============================
app.get('/api/reset-history', authRequis, (req, res) => {
  res.json(resetHistory);
});

// ==============================
// API CHANNELS
// ==============================
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

// ==============================
// API ROLES
// ==============================
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

// ==============================
// API MEMBERS SEARCH
// ==============================
app.get("/api/members/search", authRequis, async (req, res) => {
  const guild = getGuild(res);
  if (!guild) return;
  const q = req.query.q || "";
  if (!q) return res.json([]);

  try {
    let resultats;
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

// ==============================
// API WARNS
// ==============================
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

// ==============================
// API MEMBER ROLES
// ==============================
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

// ==============================
// API KICK / BAN / TIMEOUT
// ==============================
app.post("/api/members/:userId/kick", authRequis, async (req, res) => {
  const { userId } = req.params;
  const { reason } = req.body;
  const guild = getGuild(res);
  if (!guild) return;
  try {
    const member = await guild.members.fetch(userId);
    await member.kick(reason || "Aucune raison spécifiée");
    const user = await client.users.fetch(userId).catch(() => null);
    const embed = embedLogModeration({
      action: "Kick",
      couleur: "#f59e0b",
      emoji: "👢",
      cibleTag: user?.tag || userId,
      cibleId: userId,
      parTag: req.session.user.username,
      raison: reason || "Aucune raison"
    });
    await envoyerLogModeration(embed);
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
    const user = await client.users.fetch(userId).catch(() => null);
    const embed = embedLogModeration({
      action: "Ban",
      couleur: "#ef4444",
      emoji: "⛔",
      cibleTag: user?.tag || userId,
      cibleId: userId,
      parTag: req.session.user.username,
      raison: reason || "Aucune raison"
    });
    await envoyerLogModeration(embed);
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
    const user = await client.users.fetch(userId).catch(() => null);
    const embed = embedLogModeration({
      action: "Timeout",
      couleur: "#3b82f6",
      emoji: "⏰",
      cibleTag: user?.tag || userId,
      cibleId: userId,
      parTag: req.session.user.username,
      raison: `${minutes || 10} minutes`
    });
    await envoyerLogModeration(embed);
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur timeout:", e);
    res.status(500).json({ erreur: "Erreur lors du timeout" });
  }
});

// ==============================
// API CANDIDATURES
// ==============================
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

// ==============================
// API TICKETS
// ==============================
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

// ==============================
// API GIVEAWAYS
// ==============================
app.get("/api/giveaways", authRequis, (req, res) => {
  res.json(Object.values(giveaways));
});

app.post("/api/giveaways", authRequis, async (req, res) => {
  const { channelId, prize, durationMinutes, winnersCount } = req.body;
  if (!channelId || !prize) {
    return res.status(400).json({ erreur: "Paramètres manquants" });
  }
  const duration = parseInt(durationMinutes);
  const winners = parseInt(winnersCount) || 1;
  if (isNaN(duration) || duration <= 0) {
    return res.status(400).json({ erreur: "Durée invalide (doit être un nombre > 0)" });
  }
  if (isNaN(winners) || winners <= 0) {
    return res.status(400).json({ erreur: "Nombre de gagnants invalide (doit être > 0)" });
  }

  try {
    const channel = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`🎉 Giveaway : ${prize}`)
      .setDescription(`Réagissez avec 🎉 pour participer !\nDurée : ${duration} min\nGagnants : ${winners}`)
      .setTimestamp();

    const message = await channel.send({ embeds: [embed] });
    await message.react("🎉");

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const endsAt = new Date(Date.now() + duration * 60 * 1000).toISOString();

    giveaways[id] = {
      id,
      channelId,
      messageId: message.id,
      prize,
      winnersCount: winners,
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

// ==============================
// API SEND EMBED
// ==============================
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

// ==============================
// API BACKUP
// ==============================
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
    antecedents,
    resetHistory,
    date: new Date().toISOString(),
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=backup-${Date.now()}.json`);
  res.json(backup);
});

app.post("/api/backup/import", authRequis, (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ erreur: "Données manquantes" });
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
    if (data.antecedents) { antecedents = Array.isArray(data.antecedents) ? data.antecedents : []; sauverAntecedents(); }
    if (data.resetHistory) { resetHistory = Array.isArray(data.resetHistory) ? data.resetHistory : []; sauverResetHistory(); }
    invalidateCache();
    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur import backup:", e);
    res.status(500).json({ erreur: "Erreur lors de l'import" });
  }
});

// ==============================
// API ANTÉCÉDENTS
// ==============================
app.get("/api/antecedents/config", authRequis, (req, res) => {
  res.json(config.antecedents || { enabled: false, channelId: null, allowedRoles: [] });
});

app.post("/api/antecedents/config", authRequis, (req, res) => {
  const { enabled, channelId, allowedRoles } = req.body;
  if (!config.antecedents) config.antecedents = {};
  if (enabled !== undefined) config.antecedents.enabled = !!enabled;
  if (channelId !== undefined) config.antecedents.channelId = channelId;
  if (allowedRoles !== undefined) config.antecedents.allowedRoles = Array.isArray(allowedRoles) ? allowedRoles : [];
  sauverConfig();
  if (config.antecedents.enabled && config.antecedents.channelId) {
    envoyerMessageAntecedents().catch(() => {});
  }
  res.json({ succes: true });
});

app.get("/api/antecedents", authRequis, (req, res) => {
  const { q, limit = 100, offset = 0 } = req.query;
  let resultats = antecedents;
  if (q) {
    const lower = q.toLowerCase();
    resultats = resultats.filter(a => 
      a.patientNom.toLowerCase().includes(lower) ||
      a.id.toLowerCase().includes(lower) ||
      (a.type && a.type.toLowerCase().includes(lower))
    );
  }
  const total = resultats.length;
  const paginated = resultats.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json({ data: paginated, total, offset: parseInt(offset), limit: parseInt(limit) });
});

app.get("/api/antecedents/:id", authRequis, (req, res) => {
  const entry = obtenirAntecedentParId(req.params.id);
  if (!entry) return res.status(404).json({ erreur: "Antécédent introuvable" });
  res.json(entry);
});

app.post("/api/antecedents", authRequis, (req, res) => {
  const { patientNom, type, description, allergies, traitements, maladiesChroniques, operations, observations } = req.body;
  if (!patientNom || !type) {
    return res.status(400).json({ erreur: "Patient et type sont requis." });
  }
  const entry = ajouterAntecedent(
    patientNom,
    req.session.user.id,
    req.session.user.username,
    { type, description, allergies, traitements, maladiesChroniques, operations, observations }
  );
  res.status(201).json(entry);
});

app.put("/api/antecedents/:id", authRequis, (req, res) => {
  const { type, description, allergies, traitements, maladiesChroniques, operations, observations } = req.body;
  const updated = modifierAntecedent(
    req.params.id,
    req.session.user.id,
    req.session.user.username,
    { type, description, allergies, traitements, maladiesChroniques, operations, observations }
  );
  if (!updated) return res.status(404).json({ erreur: "Antécédent introuvable" });
  res.json(updated);
});

app.delete("/api/antecedents/:id", authRequis, (req, res) => {
  const success = supprimerAntecedent(req.params.id);
  if (!success) return res.status(404).json({ erreur: "Antécédent introuvable" });
  res.json({ succes: true });
});

app.get("/api/antecedents/:id/historique", authRequis, (req, res) => {
  const entry = obtenirAntecedentParId(req.params.id);
  if (!entry) return res.status(404).json({ erreur: "Antécédent introuvable" });
  res.json(entry.historiqueModifications || []);
});

// ==============================
// MIDDLEWARE D'ERREUR
// ==============================
app.use((err, req, res, next) => {
  console.error('❌ Erreur Express:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ erreur: 'Erreur upload: ' + err.message });
  }
  res.status(500).json({ erreur: 'Erreur serveur interne' });
});

// ==============================
server.listen(PORT, () => console.log(`✅ Serveur web + panel + Socket.io actif sur le port ${PORT}`));
