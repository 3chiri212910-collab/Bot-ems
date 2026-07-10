const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  REST,
  Routes,
} = require("discord.js");
const http = require("http");

// ==============================
// SERVEUR WEB MINIMAL (pour rester éveillé sur Render)
// ==============================
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Le bot est en ligne !");
  })
  .listen(PORT, () => console.log(`Serveur web actif sur le port ${PORT}`));

// ==============================
// CONFIGURATION - À REMPLIR (ou variables d'environnement sur Render)
// ==============================
const TOKEN = process.env.TOKEN || "TON_TOKEN_DISCORD_ICI";
const CLIENT_ID = process.env.CLIENT_ID || "TON_CLIENT_ID_ICI";
const NOM_SERVICE = "Service Médical";
const COULEUR_EMBED = "#ff4d94";

// ==============================
// CLIENT DISCORD
// ==============================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ==============================
// ENREGISTREMENT DE LA COMMANDE SLASH
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
});

// ==============================
// BIBLIOTHÈQUE DE SITUATIONS PRÉ-ÉCRITES
// ==============================
// Chaque catégorie a des mots-clés (pour la détection) et plusieurs variantes
// possibles pour chaque champ (choisies au hasard pour varier les rapports).

const SITUATIONS = [
  {
    mots_cles: ["voiture", "accident de voiture", "crash", "collision", "car"],
    examen: ["Radiographie du thorax et des membres", "Scanner corporel complet", "Radiographie et bilan des fonctions vitales"],
    diagnostic: [
      ["Traumatisme thoracique", "Fracture du bras"],
      ["Contusions multiples", "Traumatisme cervical léger"],
      ["Fracture de la jambe", "Choc traumatique"],
    ],
    prise_en_charge: [
      ["Immobilisation cervicale", "Pose d'une attelle", "Surveillance des constantes vitales"],
      ["Réduction de la fracture", "Immobilisation par plâtre", "Perfusion de soluté"],
      ["Oxygénothérapie", "Surveillance cardiaque", "Transport vers le centre médical"],
    ],
    observations: [
      "Le patient a été stabilisé sur place avant transport. Surveillance recommandée dans les prochaines heures.",
      "État stable après prise en charge. Suivi conseillé pour évaluer l'évolution des fractures.",
    ],
  },
  {
    mots_cles: ["moto", "accident de moto", "motard"],
    examen: ["Radiographie des membres et du bassin", "Scanner crânien et radiographie complète"],
    diagnostic: [
      ["Fracture ouverte du péroné", "Traumatisme crânien léger"],
      ["Fracture du bassin", "Contusions multiples"],
      ["Fracture du bras", "Plaies superficielles multiples"],
    ],
    prise_en_charge: [
      ["Sédation du patient", "Réduction de la fracture", "Pose d'un plâtre"],
      ["Immobilisation complète", "Surveillance neurologique", "Transport en urgence"],
      ["Désinfection et suture des plaies", "Immobilisation du bras", "Antalgiques administrés"],
    ],
    observations: [
      "Patient stabilisé et pris en charge dans de bonnes conditions. Suivi recommandé pour la consolidation osseuse.",
      "Surveillance neurologique recommandée les prochaines 24h en cas de traumatisme crânien.",
    ],
  },
  {
    mots_cles: ["bagarre", "coups", "tabassé", "frappé", "battu", "violence physique"],
    examen: ["Radiographie du visage et des côtes", "Examen clinique complet des zones de contusion"],
    diagnostic: [
      ["Contusions multiples au visage", "Suspicion de fracture des côtes"],
      ["Hématomes multiples", "Traumatisme abdominal léger"],
      ["Plaie ouverte à l'arcade", "Contusions au thorax"],
    ],
    prise_en_charge: [
      ["Désinfection des plaies", "Pose de points de suture si nécessaire", "Antalgiques administrés"],
      ["Bandage des zones contuses", "Surveillance des constantes", "Glace appliquée sur les hématomes"],
    ],
    observations: [
      "Le patient est stable, surveillance recommandée en cas de douleur abdominale persistante.",
      "État général satisfaisant après les soins. Repos conseillé.",
    ],
  },
  {
    mots_cles: ["arme à feu", "tiré", "balle", "fusil", "pistolet", "tir", "abattu"],
    examen: ["Radiographie pour localiser le ou les projectiles", "Scanner corporel en urgence"],
    diagnostic: [
      ["Plaie par arme à feu à l'abdomen", "Hémorragie interne suspectée"],
      ["Plaie par balle à la jambe", "Fracture osseuse associée"],
      ["Plaie par balle à l'épaule", "Atteinte musculaire profonde"],
    ],
    prise_en_charge: [
      ["Extraction du projectile", "Suture de la plaie", "Transfusion si nécessaire", "Surveillance intensive"],
      ["Pansement compressif", "Perfusion de soluté", "Transport d'urgence vers le bloc opératoire"],
    ],
    observations: [
      "Patient dans un état critique stabilisé. Surveillance intensive requise dans les heures suivant l'intervention.",
      "Pronostic réservé, suivi médical rapproché nécessaire.",
    ],
  },
  {
    mots_cles: ["arme blanche", "couteau", "poignardé", "lame", "coup de couteau"],
    examen: ["Examen clinique de la plaie", "Radiographie si suspicion d'atteinte profonde"],
    diagnostic: [
      ["Plaie par arme blanche à l'abdomen", "Risque d'atteinte des organes internes"],
      ["Plaie par arme blanche au bras", "Section musculaire superficielle"],
    ],
    prise_en_charge: [
      ["Nettoyage et désinfection de la plaie", "Suture chirurgicale", "Surveillance post-opératoire"],
      ["Pansement compressif", "Perfusion", "Transport vers le bloc opératoire"],
    ],
    observations: [
      "Patient stabilisé après intervention. Surveillance recommandée pour prévenir une infection.",
      "Suivi médical rapproché conseillé dans les jours suivant l'intervention.",
    ],
  },
  {
    mots_cles: ["chute", "tombé", "tombée", "dégringolé", "tombe d'un immeuble", "tombé de hauteur"],
    examen: ["Scanner crânien complet", "Radiographie de la colonne et des membres"],
    diagnostic: [
      ["Traumatisme crânien modéré", "Fracture du poignet"],
      ["Traumatisme vertébral", "Contusions multiples"],
      ["Fracture de la cheville", "Entorse du genou"],
    ],
    prise_en_charge: [
      ["Immobilisation complète", "Surveillance neurologique", "Transport en urgence"],
      ["Pose d'une attelle", "Antalgiques administrés", "Surveillance des constantes"],
    ],
    observations: [
      "Surveillance neurologique recommandée en cas de traumatisme crânien, même léger.",
      "État stable, suivi conseillé pour l'évolution des fractures.",
    ],
  },
  {
    mots_cles: ["inconscient", "évanoui", "ne respire plus", "malaise", "perte de connaissance", "coma"],
    examen: ["Bilan des fonctions vitales", "Scanner crânien", "Analyse sanguine"],
    diagnostic: [
      ["Perte de connaissance d'origine indéterminée", "Suspicion de traumatisme crânien"],
      ["Malaise vagal", "Hypotension sévère"],
    ],
    prise_en_charge: [
      ["Mise en position latérale de sécurité", "Surveillance des voies respiratoires", "Perfusion de soluté"],
      ["Oxygénothérapie", "Surveillance cardiaque continue", "Transport en urgence"],
    ],
    observations: [
      "Patient repris connaissance après prise en charge. Surveillance recommandée les prochaines heures.",
      "Bilan complémentaire nécessaire pour déterminer la cause exacte du malaise.",
    ],
  },
  {
    mots_cles: ["overdose", "drogue", "intoxication", "surdose", "empoisonné", "poison"],
    examen: ["Analyse sanguine et toxicologique", "Surveillance des fonctions vitales"],
    diagnostic: [
      ["Intoxication aiguë suspectée", "Détresse respiratoire légère"],
      ["Surdosage médicamenteux", "Trouble de la conscience"],
    ],
    prise_en_charge: [
      ["Administration d'antidote si disponible", "Surveillance respiratoire continue", "Perfusion de soluté"],
      ["Lavage gastrique si indiqué", "Oxygénothérapie", "Transport en urgence"],
    ],
    observations: [
      "Patient stabilisé après intervention. Surveillance rapprochée recommandée les prochaines 24h.",
      "Suivi psychologique conseillé en complément du suivi médical.",
    ],
  },
  {
    mots_cles: ["brûlure", "feu", "incendie", "brûlé", "flammes"],
    examen: ["Évaluation de la surface et du degré des brûlures"],
    diagnostic: [
      ["Brûlures du second degré sur le bras", "Risque d'infection"],
      ["Brûlures superficielles multiples", "Inhalation de fumée légère"],
    ],
    prise_en_charge: [
      ["Refroidissement de la zone brûlée", "Pansement stérile", "Antalgiques administrés"],
      ["Oxygénothérapie", "Surveillance respiratoire", "Transport vers le centre médical"],
    ],
    observations: [
      "Surveillance recommandée pour prévenir une infection des zones brûlées.",
      "Suivi médical conseillé pour l'évolution de la cicatrisation.",
    ],
  },
  {
    mots_cles: ["noyade", "noyé", "eau", "piscine", "sous l'eau"],
    examen: ["Bilan respiratoire complet", "Radiographie pulmonaire"],
    diagnostic: [
      ["Inhalation d'eau suspectée", "Détresse respiratoire modérée"],
      ["Hypothermie légère", "Trouble de la conscience"],
    ],
    prise_en_charge: [
      ["Manœuvre de réanimation initiale", "Oxygénothérapie", "Réchauffement progressif"],
      ["Surveillance respiratoire continue", "Perfusion de soluté", "Transport en urgence"],
    ],
    observations: [
      "Patient stabilisé après intervention. Surveillance respiratoire recommandée les prochaines heures.",
      "Suivi médical conseillé pour écarter tout risque de complication pulmonaire tardive.",
    ],
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

// ==============================
// GESTION DES INTERACTIONS
// ==============================
client.on("interactionCreate", async (interaction) => {
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
    const dateStr = maintenant.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const heureStr = maintenant.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const diagnosticTexte = rapport.diagnostic.map((d) => `• ${d}`).join("\n");
    const soinsTexte = rapport.prise_en_charge.map((s) => `• ${s}`).join("\n");

    const embed = new EmbedBuilder()
      .setColor(COULEUR_EMBED)
      .setTitle(`📋 Rapport Médical - ${NOM_SERVICE}`)
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

client.login(TOKEN);
