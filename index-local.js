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
  REST,
  Routes,
} = require("discord.js");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// Upload en mémoire (le fichier n'est jamais écrit sur le disque, il part direct dans le message Discord)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ==============================
// CONFIGURATION - variables d'environnement (Render > Environment)
// ==============================
const TOKEN = process.env.TOKEN || "TON_TOKEN_DISCORD_ICI";
const CLIENT_ID = process.env.CLIENT_ID || "TON_CLIENT_ID_ICI";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "TON_CLIENT_SECRET_ICI";
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "https://TON-APP.onrender.com/callback";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-moi-en-prod";
const PORT = process.env.PORT || 3000;
const GUILD_ID = process.env.GUILD_ID || "TON_GUILD_ID_ICI";

// Rôles autorisés à accéder au panel (en plus des administrateurs)
const ROLES_AUTORISES = ["1524935532914933837", "1524975599460814888"];

const NOM_SERVEUR = "EMS";
const COULEUR_EMBED = "#ff2d78"; // rose

// ==============================
// STOCKAGE (fichiers JSON locaux - simples, gratuits, pas de DB)
// ==============================
const DATA_DIR = __dirname;
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const GIVEAWAYS_FILE = path.join(DATA_DIR, "giveaways.json");

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
}

let config = lire(CONFIG_FILE, {
  autoRoleId: null,
  welcomeChannelId: null,
  welcomeMessage: "Bienvenue {user} sur **{server}** ! Tu es le membre **#{count}**.",
  ticketStaffChannelId: null,
});
let tickets = lire(TICKETS_FILE, {}); // { [userId]: { threadId, username } }
let giveaways = lire(GIVEAWAYS_FILE, {}); // { [id]: {...} }

function sauverConfig() { ecrire(CONFIG_FILE, config); }
function sauverTickets() { ecrire(TICKETS_FILE, tickets); }
function sauverGiveaways() { ecrire(GIVEAWAYS_FILE, giveaways); }

function trouverUserIdParThread(threadId) {
  for (const [userId, t] of Object.entries(tickets)) {
    if (t.threadId === threadId) return userId;
  }
  return null;
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
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ==============================
// COMMANDE SLASH /rapport (rapport médical RP)
// ==============================
const commands = [
  new SlashCommandBuilder()
    .setName("rapport")
    .setDescription("Générer un rapport médical d'intervention"),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Commande /rapport enregistrée avec succès.");
  } catch (error) {
    console.error(error);
  }
})();

client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  // relance les giveaways en cours
  for (const g of Object.values(giveaways)) {
    if (!g.ended) planifierFinGiveaway(g);
  }
});

// ==============================
// AUTO-ROLE + BIENVENUE (configurable via panel)
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
// SYSTEME DE TICKETS DM <-> THREAD
// ==============================
function boutonsTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_claim").setLabel("Prendre en charge").setEmoji("🙋").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket_rename").setLabel("Renommer").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Fermer").setEmoji("🔒").setStyle(ButtonStyle.Danger)
  );
}

function estStaffTicket(interaction) {
  return interaction.member && interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads);
}

async function fermerTicketParThread(threadId, fermePar) {
  const userId = trouverUserIdParThread(threadId);
  const thread = await client.channels.fetch(threadId).catch(() => null);

  if (thread) {
    await thread
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COULEUR_EMBED)
            .setTitle("🔒 Ticket fermé")
            .setDescription(`Fermé par **${fermePar}**.`)
            .setTimestamp(),
        ],
      })
      .catch(() => {});
    await thread.setName(`Fermé - ${thread.name}`.slice(0, 100)).catch(() => {});
    await thread.setArchived(true).catch(() => {});
    await thread.setLocked(true).catch(() => {});
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
    delete tickets[userId];
    sauverTickets();
  }
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

  const thread = await staffChannel.threads.create({
    name: `Ticket - ${user.username}`.slice(0, 100),
    autoArchiveDuration: 10080,
    type: ChannelType.PublicThread,
    reason: `Nouveau ticket de ${user.tag}`,
  });

  tickets[user.id] = { threadId: thread.id, username: user.username };
  sauverTickets();

  await thread.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COULEUR_EMBED)
        .setTitle("🎫 Nouveau ticket")
        .setDescription(`Ouvert par **${user.tag}** (\`${user.id}\`)\n\nRépondez directement dans ce fil, ça part en DM à la personne.`)
        .setTimestamp(),
    ],
    components: [boutonsTicket()],
  });

  return { thread, nouveau: true };
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.channel.type === ChannelType.DM) {
    try {
      const { thread, nouveau } = await obtenirOuCreerThread(message.author);
      await thread.send({
        content: `**${message.author.tag}** :\n${message.content || "*(pièce jointe / message vide)*"}`,
        files: [...message.attachments.values()],
      });

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
    } catch (e) {
      console.error("Erreur relais thread->DM:", e);
      await message.reply("⚠️ Impossible d'envoyer le DM (DMs fermés par l'utilisateur ?).");
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

client.on("interactionCreate", async (interaction) => {
  // ---- Boutons ticket ----
  if (interaction.isButton() && interaction.customId === "ticket_claim") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    await interaction.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COULEUR_EMBED)
          .setDescription(`🙋 Ticket pris en charge par <@${interaction.user.id}>`),
      ],
    });
    return interaction.reply({ content: "Tu as pris ce ticket en charge.", ephemeral: true });
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
      .setPlaceholder("Ex: Ticket - Angel Santiago (urgent)")
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

  if (interaction.isButton() && interaction.customId === "ticket_close") {
    if (!estStaffTicket(interaction)) {
      return interaction.reply({ content: "⛔ Tu n'as pas la permission de faire ça.", ephemeral: true });
    }
    await interaction.reply({ content: "🔒 Fermeture du ticket en cours...", ephemeral: true });
    await fermerTicketParThread(interaction.channel.id, interaction.user.tag);
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

  // ---- Commande /rapport ----
  if (interaction.isChatInputCommand() && interaction.commandName === "rapport") {
    const modal = new ModalBuilder()
      .setCustomId("rapportModal")
      .setTitle("Rapport d'intervention médicale");

    const soignantInput = new TextInputBuilder()
      .setCustomId("soignant")
      .setLabel("Ton nom et prénom (intervenant)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Ex: Roberto Galavera")
      .setRequired(true);

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
      new ActionRowBuilder().addComponents(soignantInput),
      new ActionRowBuilder().addComponents(patientInput),
      new ActionRowBuilder().addComponents(situationInput)
    );

    await interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === "rapportModal") {
    const soignant = interaction.fields.getTextInputValue("soignant");
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
        { name: "🩺 Intervenant", value: soignant, inline: true },
        { name: "🕒 Date et heure", value: `${dateStr} - ${heureStr}`, inline: false },
        { name: "📌 Motif de prise en charge", value: situation, inline: false },
        { name: "🔍 Examen réalisé", value: rapport.examen, inline: false },
        { name: "🩹 Diagnostic", value: diagnosticTexte, inline: false },
        { name: "💉 Prise en charge", value: soinsTexte, inline: false },
        { name: "📝 Observations", value: rapport.observations, inline: false }
      )
      .setFooter({ text: `Rapport généré par ${soignant}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
});

// ==============================
// BIBLIOTHÈQUE DE SITUATIONS (rapport médical)
// ==============================
const SITUATIONS = [
  {
    mots_cles: ["voiture", "accident de voiture", "crash", "collision", "car"],
    examen: ["Radiographie du thorax et des membres", "Scanner corporel complet", "Radiographie et bilan des fonctions vitales"],
    diagnostic: [["Traumatisme thoracique", "Fracture du bras"], ["Contusions multiples", "Traumatisme cervical léger"], ["Fracture de la jambe", "Choc traumatique"]],
    prise_en_charge: [["Immobilisation cervicale", "Pose d'une attelle", "Surveillance des constantes vitales"], ["Réduction de la fracture", "Immobilisation par plâtre", "Perfusion de soluté"], ["Oxygénothérapie", "Surveillance cardiaque", "Transport vers le centre médical"]],
    observations: ["Le patient a été stabilisé sur place avant transport. Surveillance recommandée dans les prochaines heures.", "État stable après prise en charge. Suivi conseillé pour évaluer l'évolution des fractures."],
  },
  {
    mots_cles: ["moto", "accident de moto", "motard"],
    examen: ["Radiographie des membres et du bassin", "Scanner crânien et radiographie complète"],
    diagnostic: [["Fracture ouverte du péroné", "Traumatisme crânien léger"], ["Fracture du bassin", "Contusions multiples"], ["Fracture du bras", "Plaies superficielles multiples"]],
    prise_en_charge: [["Sédation du patient", "Réduction de la fracture", "Pose d'un plâtre"], ["Immobilisation complète", "Surveillance neurologique", "Transport en urgence"], ["Désinfection et suture des plaies", "Immobilisation du bras", "Antalgiques administrés"]],
    observations: ["Patient stabilisé et pris en charge dans de bonnes conditions. Suivi recommandé pour la consolidation osseuse.", "Surveillance neurologique recommandée les prochaines 24h en cas de traumatisme crânien."],
  },
  {
    mots_cles: ["bagarre", "coups", "tabassé", "frappé", "battu", "violence physique"],
    examen: ["Radiographie du visage et des côtes", "Examen clinique complet des zones de contusion"],
    diagnostic: [["Contusions multiples au visage", "Suspicion de fracture des côtes"], ["Hématomes multiples", "Traumatisme abdominal léger"], ["Plaie ouverte à l'arcade", "Contusions au thorax"]],
    prise_en_charge: [["Désinfection des plaies", "Pose de points de suture si nécessaire", "Antalgiques administrés"], ["Bandage des zones contuses", "Surveillance des constantes", "Glace appliquée sur les hématomes"]],
    observations: ["Le patient est stable, surveillance recommandée en cas de douleur abdominale persistante.", "État général satisfaisant après les soins. Repos conseillé."],
  },
  {
    mots_cles: ["arme à feu", "tiré", "balle", "fusil", "pistolet", "tir", "abattu"],
    examen: ["Radiographie pour localiser le ou les projectiles", "Scanner corporel en urgence"],
    diagnostic: [["Plaie par arme à feu à l'abdomen", "Hémorragie interne suspectée"], ["Plaie par balle à la jambe", "Fracture osseuse associée"], ["Plaie par balle à l'épaule", "Atteinte musculaire profonde"]],
    prise_en_charge: [["Extraction du projectile", "Suture de la plaie", "Transfusion si nécessaire", "Surveillance intensive"], ["Pansement compressif", "Perfusion de soluté", "Transport d'urgence vers le bloc opératoire"]],
    observations: ["Patient dans un état critique stabilisé. Surveillance intensive requise dans les heures suivant l'intervention.", "Pronostic réservé, suivi médical rapproché nécessaire."],
  },
  {
    mots_cles: ["arme blanche", "couteau", "poignardé", "lame", "coup de couteau"],
    examen: ["Examen clinique de la plaie", "Radiographie si suspicion d'atteinte profonde"],
    diagnostic: [["Plaie par arme blanche à l'abdomen", "Risque d'atteinte des organes internes"], ["Plaie par arme blanche au bras", "Section musculaire superficielle"]],
    prise_en_charge: [["Nettoyage et désinfection de la plaie", "Suture chirurgicale", "Surveillance post-opératoire"], ["Pansement compressif", "Perfusion", "Transport vers le bloc opératoire"]],
    observations: ["Patient stabilisé après intervention. Surveillance recommandée pour prévenir une infection.", "Suivi médical rapproché conseillé dans les jours suivant l'intervention."],
  },
  {
    mots_cles: ["chute", "tombé", "tombée", "dégringolé", "tombe d'un immeuble", "tombé de hauteur"],
    examen: ["Scanner crânien complet", "Radiographie de la colonne et des membres"],
    diagnostic: [["Traumatisme crânien modéré", "Fracture du poignet"], ["Traumatisme vertébral", "Contusions multiples"], ["Fracture de la cheville", "Entorse du genou"]],
    prise_en_charge: [["Immobilisation complète", "Surveillance neurologique", "Transport en urgence"], ["Pose d'une attelle", "Antalgiques administrés", "Surveillance des constantes"]],
    observations: ["Surveillance neurologique recommandée en cas de traumatisme crânien, même léger.", "État stable, suivi conseillé pour l'évolution des fractures."],
  },
  {
    mots_cles: ["inconscient", "évanoui", "ne respire plus", "malaise", "perte de connaissance", "coma"],
    examen: ["Bilan des fonctions vitales", "Scanner crânien", "Analyse sanguine"],
    diagnostic: [["Perte de connaissance d'origine indéterminée", "Suspicion de traumatisme crânien"], ["Malaise vagal", "Hypotension sévère"]],
    prise_en_charge: [["Mise en position latérale de sécurité", "Surveillance des voies respiratoires", "Perfusion de soluté"], ["Oxygénothérapie", "Surveillance cardiaque continue", "Transport en urgence"]],
    observations: ["Patient repris connaissance après prise en charge. Surveillance recommandée les prochaines heures.", "Bilan complémentaire nécessaire pour déterminer la cause exacte du malaise."],
  },
  {
    mots_cles: ["overdose", "drogue", "intoxication", "surdose", "empoisonné", "poison"],
    examen: ["Analyse sanguine et toxicologique", "Surveillance des fonctions vitales"],
    diagnostic: [["Intoxication aiguë suspectée", "Détresse respiratoire légère"], ["Surdosage médicamenteux", "Trouble de la conscience"]],
    prise_en_charge: [["Administration d'antidote si disponible", "Surveillance respiratoire continue", "Perfusion de soluté"], ["Lavage gastrique si indiqué", "Oxygénothérapie", "Transport en urgence"]],
    observations: ["Patient stabilisé après intervention. Surveillance rapprochée recommandée les prochaines 24h.", "Suivi psychologique conseillé en complément du suivi médical."],
  },
  {
    mots_cles: ["brûlure", "feu", "incendie", "brûlé", "flammes"],
    examen: ["Évaluation de la surface et du degré des brûlures"],
    diagnostic: [["Brûlures du second degré sur le bras", "Risque d'infection"], ["Brûlures superficielles multiples", "Inhalation de fumée légère"]],
    prise_en_charge: [["Refroidissement de la zone brûlée", "Pansement stérile", "Antalgiques administrés"], ["Oxygénothérapie", "Surveillance respiratoire", "Transport vers le centre médical"]],
    observations: ["Surveillance recommandée pour prévenir une infection des zones brûlées.", "Suivi médical conseillé pour l'évolution de la cicatrisation."],
  },
  {
    mots_cles: ["noyade", "noyé", "eau", "piscine", "sous l'eau"],
    examen: ["Bilan respiratoire complet", "Radiographie pulmonaire"],
    diagnostic: [["Inhalation d'eau suspectée", "Détresse respiratoire modérée"], ["Hypothermie légère", "Trouble de la conscience"]],
    prise_en_charge: [["Manœuvre de réanimation initiale", "Oxygénothérapie", "Réchauffement progressif"], ["Surveillance respiratoire continue", "Perfusion de soluté", "Transport en urgence"]],
    observations: ["Patient stabilisé après intervention. Surveillance respiratoire recommandée les prochaines heures.", "Suivi médical conseillé pour écarter tout risque de complication pulmonaire tardive."],
  },
];

const SITUATION_GENERIQUE = {
  examen: ["Examen clinique général", "Bilan des constantes vitales"],
  diagnostic: [["Traumatisme à évaluer", "Douleur localisée"]],
  prise_en_charge: [["Premiers soins administrés", "Surveillance des constantes", "Transport si nécessaire"]],
  observations: ["Patient pris en charge dans de bonnes conditions. Suivi recommandé selon l'évolution."],
};

function choisirAuHasard(tableau) {
  return tableau[Math.floor(Math.random() * tableau.length)];
}

function trouverSituation(texte) {
  const texteLower = texte.toLowerCase();
  let meilleureCorrespondance = null;
  let meilleurScore = 0;

  for (const situation of SITUATIONS) {
    let score = 0;
    for (const motCle of situation.mots_cles) {
      if (texteLower.includes(motCle)) score++;
    }
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleureCorrespondance = situation;
    }
  }

  const base = meilleureCorrespondance || SITUATION_GENERIQUE;

  return {
    examen: choisirAuHasard(base.examen),
    diagnostic: choisirAuHasard(base.diagnostic),
    prise_en_charge: choisirAuHasard(base.prise_en_charge),
    observations: choisirAuHasard(base.observations),
  };
}

client.login(TOKEN);

// ==================================================================
// ==================================================================
//                        PANEL WEB (Express)
// ==================================================================
// ==================================================================
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
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
    .filter((r) => r.id !== guild.id) // exclut @everyone
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
    await membre.kick(req.body.reason || "Aucune raison fournie");
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
    await guild.members.ban(req.params.id, { reason: req.body.reason || "Aucune raison fournie" });
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
    await membre.timeout(minutes * 60 * 1000, req.body.reason || "Aucune raison fournie");
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

// ---- Paramètres (auto-rôle, bienvenue, tickets) ----
app.get("/api/settings", authRequis, (req, res) => res.json(config));

app.post("/api/settings", authRequis, (req, res) => {
  const { autoRoleId, welcomeChannelId, welcomeMessage, ticketStaffChannelId } = req.body;
  config = {
    autoRoleId: autoRoleId || null,
    welcomeChannelId: welcomeChannelId || null,
    welcomeMessage: welcomeMessage || config.welcomeMessage,
    ticketStaffChannelId: ticketStaffChannelId || null,
  };
  sauverConfig();
  res.json({ succes: true });
});

// ---- Annonces / Embeds ----
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
      // Image envoyée depuis l'ordinateur : elle part en pièce jointe avec le message
      const nomFichier = "image" + path.extname(req.file.originalname || "").slice(0, 10) || "image.png";
      embed.setImage(`attachment://${nomFichier}`);
      options.files = [{ attachment: req.file.buffer, name: nomFichier }];
    } else if (imageUrl) {
      // Sinon, si une URL a été fournie, on l'utilise telle quelle
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
  res.json(Object.entries(tickets).map(([userId, t]) => ({ userId, username: t.username, threadId: t.threadId })));
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

    res.json({ succes: true });
  } catch (e) {
    console.error("Erreur réponse ticket:", e);
    res.status(500).json({ erreur: "Échec de l'envoi (DM peut-être fermés)" });
  }
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

app.listen(PORT, () => console.log(`Serveur web + panel actif sur le port ${PORT}`));
