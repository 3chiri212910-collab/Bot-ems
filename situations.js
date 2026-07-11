// ==================================================================
// BIBLIOTHÈQUE DE SITUATIONS MÉDICALES — SYSTÈME 100% PRÉ-ÉCRIT
// ==================================================================
// Aucune IA, aucune génération dynamique de texte.
// Le bot détecte la catégorie via des mots-clés, puis pioche
// aléatoirement parmi des modèles déjà rédigés (motif, examen,
// diagnostic, prise en charge, observations).
//
// Pour ajouter/modifier une catégorie : éditez simplement le tableau
// CATEGORIES ci-dessous. Chaque catégorie est indépendante.
// ==================================================================

const CATEGORIES = [
  // ------------------------------------------------------------
  {
    id: "malaise",
    motsCles: ["malaise", "malaise vagal", "perte de connaissance", "personne faible", "vertige",
      "tourne de la tete", "tourne de la tête", "syncope", "evanoui", "évanoui", "faiblesse",
      "ne se sent pas bien", "coup de chaud", "coup de fatigue"],
    motifs: [
      "Évaluation d'un patient présentant un malaise d'origine indéterminée.",
      "Intervention pour perte de connaissance brève sur la voie publique.",
      "Prise en charge d'un malaise vagal avec chute de tension.",
      "Bilan d'un patient retrouvé conscient après un épisode de faiblesse generale.",
    ],
    examens: [
      "Prise des constantes vitales (tension, pouls, saturation)",
      "Examen neurologique rapide et bilan des fonctions vitales",
      "Contrôle de la glycémie et de la tension artérielle",
      "Auscultation cardiaque et évaluation de l'état de conscience",
    ],
    diagnostics: [
      ["Malaise vagal", "Hypotension orthostatique"],
      ["Malaise d'origine indéterminée", "Légère déshydratation"],
      ["Baisse de tension transitoire", "Fatigue generale"],
      ["Malaise sans perte de connaissance prolongée", "Stress aigu"],
    ],
    priseEnCharge: [
      ["Mise au repos en position allongée", "Surveillance des constantes", "Hydratation orale"],
      ["Jambes surélevées", "Contrôle régulier de la tension", "Réassurance du patient"],
      ["Oxygénothérapie de precaution", "Surveillance rapprochée", "Perfusion de soluté si besoin"],
      ["Mise en position latérale de sécurité", "Surveillance de la reprise de conscience", "Transport pour bilan"],
    ],
    observations: [
      "Patient repris connaissance rapidement, état stable au moment du départ des secours.",
      "Aucune complication observée, surveillance à domicile recommandée.",
      "Bilan rassurant, conseil de consulter en cas de récidive.",
      "Patient stable, un bilan complémentaire est conseillé dans les prochaines heures.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "avc",
    motsCles: ["avc", "accident vasculaire cerebral", "accident vasculaire cérébral", "suspicion avc",
      "visage tombant", "paralysie faciale", "parole confuse", "bras qui ne bouge plus"],
    motifs: [
      "Intervention pour suspicion d'accident vasculaire cérébral.",
      "Prise en charge d'un patient présentant une paralysie faciale brutale.",
      "Bilan neurologique en urgence pour trouble de la parole d'apparition soudaine.",
      "Évaluation d'un déficit moteur unilatéral d'installation rapide.",
    ],
    examens: [
      "Test neurologique rapide (visage, bras, parole)",
      "Bilan neurologique complet et prise des constantes",
      "Contrôle de la tension artérielle et de la glycémie",
      "Évaluation de la symétrie du visage et de la force musculaire",
    ],
    diagnostics: [
      ["Suspicion d'accident vasculaire cérébral", "Paralysie faciale droite"],
      ["Suspicion d'AVC ischémique", "Trouble de l'élocution"],
      ["Déficit moteur du bras gauche", "Confusion associée"],
      ["Suspicion d'AVC", "Asymétrie faciale marquée"],
    ],
    priseEnCharge: [
      ["Mise au repos strict", "Surveillance neurologique continue", "Transport en urgence vers le centre médical"],
      ["Oxygénothérapie", "Contrôle régulier des constantes", "Transport prioritaire"],
      ["Immobilisation et rassurance du patient", "Surveillance de l'évolution des symptômes", "Transport en urgence"],
      ["Position semi-assise", "Surveillance de la conscience", "Transport rapide vers le bloc médical"],
    ],
    observations: [
      "Patient stabilisé, prise en charge rapide effectuée. Pronostic dépendant du délai d'intervention.",
      "Symptômes toujours présents au moment du transport, suivi neurologique indispensable.",
      "Amélioration légère observée avant le transport, surveillance continue recommandée.",
      "État stable mais fragile, transport en urgence effectué sans complication.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "acr",
    motsCles: ["arret cardiaque", "arrêt cardiaque", "acr", "ne respire plus et inconscient", "coeur qui s'arrete",
      "cœur qui s'arrête", "reanimation", "réanimation"],
    motifs: [
      "Intervention en urgence pour arrêt cardio-respiratoire.",
      "Prise en charge d'un patient en arrêt cardiaque sur la voie publique.",
      "Réanimation cardio-pulmonaire effectuée en urgence.",
      "Intervention critique pour absence de pouls et de respiration.",
    ],
    examens: [
      "Contrôle de l'absence de pouls et de respiration",
      "Bilan des fonctions vitales en urgence absolue",
      "Vérification des voies aériennes et du rythme cardiaque",
      "Évaluation immédiate de l'état de conscience et des signes vitaux",
    ],
    diagnostics: [
      ["Arrêt cardio-respiratoire", "Absence de pouls palpable"],
      ["Arrêt cardiaque d'origine indéterminée", "Cyanose marquée"],
      ["Arrêt cardio-respiratoire suite à un traumatisme", "Détresse vitale"],
      ["Arrêt cardiaque récupéré", "Instabilité hémodynamique"],
    ],
    priseEnCharge: [
      ["Réanimation cardio-pulmonaire immédiate", "Utilisation du défibrillateur", "Transport en urgence absolue"],
      ["Massage cardiaque continu", "Ventilation assistée", "Perfusion et transport d'urgence"],
      ["Défibrillation effectuée", "Reprise d'une activité cardiaque", "Surveillance intensive et transport"],
      ["Manœuvres de réanimation prolongées", "Oxygénation continue", "Transport immédiat vers le bloc"],
    ],
    observations: [
      "Reprise d'une activité cardiaque après plusieurs cycles de réanimation. Pronostic réservé.",
      "Patient stabilisé après réanimation, surveillance intensive requise dans les prochaines heures.",
      "Réanimation efficace, transport effectué dans un état critique mais stable.",
      "Situation critique prise en charge rapidement, suivi hospitalier immédiat nécessaire.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "douleur_thoracique",
    motsCles: ["douleur thoracique", "douleur a la poitrine", "douleur à la poitrine", "mal a la poitrine",
      "mal au coeur", "mal au cœur", "poitrine serree", "poitrine serrée", "crise cardiaque", "infarctus"],
    motifs: [
      "Évaluation d'une douleur thoracique nécessitant un bilan complet.",
      "Intervention pour suspicion de crise cardiaque.",
      "Prise en charge d'un patient présentant une douleur thoracique aiguë.",
      "Bilan cardiaque d'urgence suite à une sensation d'oppression thoracique.",
    ],
    examens: [
      "Auscultation cardiaque et contrôle de la tension",
      "Bilan des constantes vitales et évaluation de la douleur",
      "Contrôle du rythme cardiaque et de la saturation en oxygène",
      "Examen clinique du thorax et prise du pouls",
    ],
    diagnostics: [
      ["Suspicion d'infarctus du myocarde", "Douleur thoracique irradiante"],
      ["Douleur thoracique d'origine indéterminée", "Anxiété associée"],
      ["Suspicion de syndrome coronarien aigu", "Oppression thoracique persistante"],
      ["Douleur thoracique musculaire probable", "Tension artérielle élevée"],
    ],
    priseEnCharge: [
      ["Mise au repos en position semi-assise", "Oxygénothérapie", "Transport en urgence vers le centre médical"],
      ["Surveillance du rythme cardiaque", "Perfusion de soluté", "Transport prioritaire"],
      ["Administration d'oxygène", "Réassurance du patient", "Transport rapide pour bilan cardiaque"],
      ["Position confortable", "Surveillance continue des constantes", "Transport en urgence"],
    ],
    observations: [
      "Douleur atténuée après prise en charge, surveillance cardiaque recommandée.",
      "Patient stable pendant le transport, bilan cardiaque approfondi nécessaire.",
      "Amélioration partielle des symptômes, suivi médical rapproché conseillé.",
      "État stable, transport effectué par precaution vers le centre médical.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "detresse_respiratoire",
    motsCles: ["detresse respiratoire", "détresse respiratoire", "difficulte a respirer", "difficulté à respirer",
      "n'arrive plus a respirer", "n'arrive plus à respirer", "essoufflement", "asthme", "crise d'asthme"],
    motifs: [
      "Prise en charge d'une détresse respiratoire aiguë.",
      "Intervention pour crise d'asthme sévère.",
      "Évaluation d'un patient présentant une gêne respiratoire importante.",
      "Bilan respiratoire d'urgence suite à un essoufflement soudain.",
    ],
    examens: [
      "Auscultation pulmonaire et mesure de la saturation",
      "Bilan respiratoire complet et contrôle des constantes",
      "Évaluation de la fréquence respiratoire et de la coloration cutanée",
      "Contrôle de la saturation en oxygène et du rythme cardiaque",
    ],
    diagnostics: [
      ["Crise d'asthme aiguë", "Sibilants bilatéraux"],
      ["Détresse respiratoire modérée", "Anxiété associée"],
      ["Bronchospasme sévère", "Désaturation en oxygène"],
      ["Détresse respiratoire d'origine indéterminée", "Fatigue respiratoire"],
    ],
    priseEnCharge: [
      ["Position semi-assise", "Oxygénothérapie", "Surveillance respiratoire continue"],
      ["Administration de bronchodilatateur", "Surveillance de la saturation", "Transport en urgence"],
      ["Oxygène à haut débit", "Réassurance du patient", "Transport prioritaire vers le centre médical"],
      ["Surveillance rapprochée de la fréquence respiratoire", "Perfusion de soluté", "Transport rapide"],
    ],
    observations: [
      "Amélioration de la respiration après prise en charge, surveillance continue recommandée.",
      "Patient stabilisé, transport effectué sans complication majeure.",
      "Détresse respiratoire contrôlée, suivi médical conseillé dans les heures suivantes.",
      "État stable au moment du transport, surveillance respiratoire maintenue.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "accident_voiture",
    motsCles: ["voiture", "accident de voiture", "crash", "collision", "car", "accident de la route",
      "accident de la circulation", "carambolage", "choc frontal"],
    motifs: [
      "Intervention suite à un accident de la circulation impliquant un véhicule.",
      "Prise en charge d'un patient victime d'une collision routière.",
      "Bilan traumatologique suite à un accident de voiture.",
      "Évaluation d'un patient extrait d'un véhicule accidenté.",
    ],
    examens: [
      "Radiographie du thorax et des membres",
      "Scanner corporel complet",
      "Radiographie et bilan des fonctions vitales",
      "Examen clinique complet et bilan des constantes",
    ],
    diagnostics: [
      ["Traumatisme thoracique", "Fracture du bras"],
      ["Contusions multiples", "Traumatisme cervical léger"],
      ["Fracture de la jambe", "Choc traumatique"],
      ["Polytraumatisme léger", "Plaies superficielles multiples"],
    ],
    priseEnCharge: [
      ["Immobilisation cervicale", "Pose d'une attelle", "Surveillance des constantes vitales"],
      ["Réduction de la fracture", "Immobilisation par plâtre", "Perfusion de soluté"],
      ["Oxygénothérapie", "Surveillance cardiaque", "Transport vers le centre médical"],
      ["Extraction encadrée du véhicule", "Immobilisation complète", "Transport en urgence"],
    ],
    observations: [
      "Le patient a été stabilisé sur place avant transport. Surveillance recommandée dans les prochaines heures.",
      "État stable après prise en charge. Suivi conseillé pour évaluer l'évolution des fractures.",
      "Extraction effectuée sans complication supplémentaire, transport réalisé dans de bonnes conditions.",
      "Bilan traumatologique complémentaire nécessaire à l'arrivée au centre médical.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "accident_moto",
    motsCles: ["moto", "accident de moto", "motard", "scooter", "chute de moto"],
    motifs: [
      "Intervention suite à un accident de moto.",
      "Prise en charge d'un motard victime d'une chute à vitesse.",
      "Bilan traumatologique suite à une sortie de route en moto.",
      "Évaluation d'un patient projeté au sol après un accident de deux-roues.",
    ],
    examens: [
      "Radiographie des membres et du bassin",
      "Scanner crânien et radiographie complète",
      "Bilan traumatologique complet",
      "Examen clinique des zones de choc et bilan des constantes",
    ],
    diagnostics: [
      ["Fracture ouverte du péroné", "Traumatisme crânien léger"],
      ["Fracture du bassin", "Contusions multiples"],
      ["Fracture du bras", "Plaies superficielles multiples"],
      ["Traumatisme thoracique", "Abrasions cutanées étendues"],
    ],
    priseEnCharge: [
      ["Sédation du patient", "Réduction de la fracture", "Pose d'un plâtre"],
      ["Immobilisation complète", "Surveillance neurologique", "Transport en urgence"],
      ["Désinfection et suture des plaies", "Immobilisation du bras", "Antalgiques administrés"],
      ["Retrait encadré du casque", "Immobilisation cervicale de precaution", "Transport prioritaire"],
    ],
    observations: [
      "Patient stabilisé et pris en charge dans de bonnes conditions. Suivi recommandé pour la consolidation osseuse.",
      "Surveillance neurologique recommandée les prochaines 24h en cas de traumatisme crânien.",
      "État stable au moment du transport, aucune complication supplémentaire observée.",
      "Prise en charge rapide sur les lieux, transport effectué sans encombre.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "chute",
    motsCles: ["chute", "tombe", "tombé", "tombée", "degringole", "dégringolé", "tombe d'un immeuble",
      "tombé de hauteur", "chute de hauteur", "chute dans les escaliers"],
    motifs: [
      "Intervention pour suspicion de traumatisme suite à une chute.",
      "Prise en charge d'un patient victime d'une chute de hauteur.",
      "Bilan traumatologique suite à une chute dans les escaliers.",
      "Évaluation d'un patient après une chute avec point d'impact au sol.",
    ],
    examens: [
      "Scanner crânien complet",
      "Radiographie de la colonne et des membres",
      "Bilan traumatologique et neurologique",
      "Examen clinique des points d'impact et bilan des constantes",
    ],
    diagnostics: [
      ["Traumatisme crânien modéré", "Fracture du poignet"],
      ["Traumatisme vertébral", "Contusions multiples"],
      ["Fracture de la cheville", "Entorse du genou"],
      ["Contusions au bassin", "Douleur lombaire aiguë"],
    ],
    priseEnCharge: [
      ["Immobilisation complète", "Surveillance neurologique", "Transport en urgence"],
      ["Pose d'une attelle", "Antalgiques administrés", "Surveillance des constantes"],
      ["Immobilisation de la colonne", "Transport en position allongée", "Surveillance continue"],
      ["Glace sur la zone contuse", "Bandage de soutien", "Transport pour bilan complémentaire"],
    ],
    observations: [
      "Surveillance neurologique recommandée en cas de traumatisme crânien, même léger.",
      "État stable, suivi conseillé pour l'évolution des fractures.",
      "Aucune aggravation observée durant le transport, bilan complémentaire recommandé.",
      "Patient conscient et stable, douleur maîtrisée après prise en charge.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "fracture",
    motsCles: ["fracture", "os casse", "os cassé", "jambe cassee", "jambe cassée", "bras casse", "bras cassé",
      "cheville cassee", "cheville cassée", "poignet casse", "poignet cassé"],
    motifs: [
      "Prise en charge d'une suspicion de fracture suite à un traumatisme.",
      "Évaluation d'une déformation visible d'un membre après un choc.",
      "Bilan orthopédique suite à une chute avec impact direct.",
      "Intervention pour douleur vive et impotence fonctionnelle d'un membre.",
    ],
    examens: [
      "Radiographie du membre concerné",
      "Examen clinique de la déformation et du membre atteint",
      "Bilan de la mobilité et de la sensibilité du membre",
      "Radiographie complète et évaluation de la douleur",
    ],
    diagnostics: [
      ["Fracture fermée de l'avant-bras", "Œdème local important"],
      ["Fracture du tibia", "Impotence fonctionnelle totale"],
      ["Fracture du poignet", "Douleur vive à la palpation"],
      ["Fracture de la cheville", "Gonflement marqué"],
    ],
    priseEnCharge: [
      ["Immobilisation par attelle", "Antalgiques administrés", "Transport pour radiographie"],
      ["Réduction manuelle prudente", "Pose d'un plâtre provisoire", "Surveillance de la circulation du membre"],
      ["Glace appliquée sur la zone", "Immobilisation stricte", "Transport vers le centre médical"],
      ["Surélévation du membre", "Bandage de contention", "Transport pour bilan orthopédique"],
    ],
    observations: [
      "Fracture stabilisée sur place, consolidation à surveiller dans les semaines à venir.",
      "Douleur bien contrôlée après immobilisation, transport sans complication.",
      "Bonne circulation sanguine conservée dans le membre atteint après immobilisation.",
      "Suivi orthopédique recommandé pour confirmer l'étendue de la fracture.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "plaie",
    motsCles: ["plaie", "coupure", "entaille", "blessure ouverte", "lacération", "eraflure", "éraflure"],
    motifs: [
      "Prise en charge d'une plaie ouverte nécessitant des soins.",
      "Évaluation d'une lacération suite à un accident.",
      "Intervention pour désinfection et suture d'une plaie profonde.",
      "Bilan clinique d'une blessure ouverte avec saignement modéré.",
    ],
    examens: [
      "Examen clinique de la plaie et évaluation de sa profondeur",
      "Contrôle de l'absence de corps étranger dans la plaie",
      "Bilan de la douleur et de l'étendue de la lésion",
      "Vérification du statut vaccinal antitétanique",
    ],
    diagnostics: [
      ["Plaie profonde de l'avant-bras", "Saignement modéré"],
      ["Lacération superficielle du cuir chevelu", "Saignement abondant initial"],
      ["Plaie ouverte de la jambe", "Risque infectieux à surveiller"],
      ["Plaie punctiforme de la main", "Douleur localisée"],
    ],
    priseEnCharge: [
      ["Nettoyage et désinfection de la plaie", "Pose de points de suture", "Pansement stérile"],
      ["Compression pour arrêter le saignement", "Désinfection", "Bandage protecteur"],
      ["Suture chirurgicale légère", "Pansement compressif", "Antalgiques administrés"],
      ["Nettoyage abondant à l'eau", "Fermeture par strips adhésifs", "Surveillance de l'évolution"],
    ],
    observations: [
      "Saignement stoppé après compression, plaie propre et sans complication.",
      "Suture réalisée sans difficulté, cicatrisation à surveiller.",
      "Surveillance recommandée pour prévenir tout risque d'infection.",
      "État général satisfaisant après les soins, rappel du vaccin antitétanique conseillé.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "hemorragie",
    motsCles: ["hemorragie", "hémorragie", "saignement abondant", "saigne beaucoup", "perte de sang importante",
      "saignement important"],
    motifs: [
      "Intervention en urgence pour hémorragie abondante.",
      "Prise en charge d'un patient présentant une perte de sang importante.",
      "Bilan d'urgence suite à un saignement massif non contrôlé.",
      "Évaluation d'une hémorragie externe nécessitant un contrôle rapide.",
    ],
    examens: [
      "Évaluation immédiate de la source du saignement",
      "Bilan des constantes vitales et de la perte sanguine estimée",
      "Contrôle de la tension artérielle et du pouls",
      "Examen clinique de la plaie hémorragique",
    ],
    diagnostics: [
      ["Hémorragie externe abondante", "Risque de choc hémorragique"],
      ["Hémorragie modérée d'un membre", "Pâleur cutanée associée"],
      ["Hémorragie active nécessitant un contrôle rapide", "Tachycardie compensatrice"],
      ["Hémorragie profuse d'une plaie ouverte", "Anxiété liée à la perte de sang"],
    ],
    priseEnCharge: [
      ["Compression directe et prolongée", "Pansement compressif", "Perfusion de soluté"],
      ["Pose d'un garrot si nécessaire", "Surveillance de la tension", "Transport en urgence"],
      ["Élévation du membre atteint", "Compression manuelle continue", "Transport prioritaire"],
      ["Bandage hémostatique", "Surveillance rapprochée des constantes", "Transport rapide vers le bloc"],
    ],
    observations: [
      "Saignement contrôlé avant transport, surveillance de la tension recommandée.",
      "Patient stabilisé après compression prolongée, transfusion possible à l'arrivée.",
      "Pâleur persistante malgré le contrôle du saignement, surveillance intensive requise.",
      "Hémorragie maîtrisée, aucune complication supplémentaire observée durant le transport.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "brulure",
    motsCles: ["brulure", "brûlure", "feu", "incendie", "brule", "brûlé", "flammes", "brulé"],
    motifs: [
      "Prise en charge d'un patient victime de brûlures.",
      "Intervention suite à une exposition directe aux flammes.",
      "Bilan clinique de brûlures cutanées suite à un incendie.",
      "Évaluation de l'étendue de brûlures thermiques.",
    ],
    examens: [
      "Évaluation de la surface et du degré des brûlures",
      "Bilan respiratoire en cas d'inhalation de fumée",
      "Examen clinique des zones brûlées et de la douleur associée",
      "Contrôle de l'hydratation et des constantes vitales",
    ],
    diagnostics: [
      ["Brûlures du second degré sur le bras", "Risque d'infection"],
      ["Brûlures superficielles multiples", "Inhalation de fumée légère"],
      ["Brûlures du premier degré étendues", "Douleur cutanée importante"],
      ["Brûlure profonde localisée", "Risque de déshydratation cutanée"],
    ],
    priseEnCharge: [
      ["Refroidissement de la zone brûlée", "Pansement stérile", "Antalgiques administrés"],
      ["Oxygénothérapie", "Surveillance respiratoire", "Transport vers le centre médical"],
      ["Nettoyage délicat des zones atteintes", "Pansement adapté aux brûlures", "Perfusion de soluté"],
      ["Retrait des vêtements non adhérents", "Couverture stérile", "Transport en urgence"],
    ],
    observations: [
      "Surveillance recommandée pour prévenir une infection des zones brûlées.",
      "Suivi médical conseillé pour l'évolution de la cicatrisation.",
      "Aucune atteinte respiratoire supplémentaire observée après surveillance.",
      "Douleur bien contrôlée après les premiers soins, transport effectué sans complication.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "intoxication",
    motsCles: ["intoxication", "empoisonne", "empoisonné", "poison", "produit chimique", "gaz toxique",
      "intoxication alimentaire"],
    motifs: [
      "Prise en charge d'une suspicion d'intoxication.",
      "Intervention suite à une exposition à un produit toxique.",
      "Bilan clinique d'une intoxication alimentaire suspectée.",
      "Évaluation d'un patient présentant des signes d'intoxication.",
    ],
    examens: [
      "Analyse sanguine et toxicologique",
      "Surveillance des fonctions vitales",
      "Bilan digestif et neurologique",
      "Contrôle de la fréquence cardiaque et respiratoire",
    ],
    diagnostics: [
      ["Intoxication aiguë suspectée", "Détresse respiratoire légère"],
      ["Intoxication alimentaire probable", "Vomissements répétés"],
      ["Exposition à un produit chimique", "Irritation des voies respiratoires"],
      ["Intoxication d'origine indéterminée", "Trouble digestif associé"],
    ],
    priseEnCharge: [
      ["Administration d'antidote si disponible", "Surveillance respiratoire continue", "Perfusion de soluté"],
      ["Lavage gastrique si indiqué", "Oxygénothérapie", "Transport en urgence"],
      ["Réhydratation orale", "Surveillance digestive", "Transport pour bilan complémentaire"],
      ["Éloignement de la source toxique", "Oxygénothérapie de précaution", "Transport prioritaire"],
    ],
    observations: [
      "Patient stabilisé après intervention. Surveillance rapprochée recommandée les prochaines 24h.",
      "Suivi médical conseillé en complément du suivi digestif.",
      "Aucune complication respiratoire supplémentaire observée après surveillance.",
      "Amélioration progressive des symptômes durant le transport.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "overdose",
    motsCles: ["overdose", "drogue", "surdose", "surdosage", "produit stupefiant", "produit stupéfiant"],
    motifs: [
      "Intervention pour suspicion de surdosage.",
      "Prise en charge d'un patient présentant les signes d'une overdose.",
      "Bilan d'urgence suite à une consommation excessive de substances.",
      "Évaluation d'un trouble de la conscience lié à une surdose suspectée.",
    ],
    examens: [
      "Analyse sanguine et toxicologique",
      "Surveillance des fonctions vitales",
      "Bilan neurologique et respiratoire",
      "Contrôle de la fréquence cardiaque et de la saturation",
    ],
    diagnostics: [
      ["Surdosage médicamenteux", "Trouble de la conscience"],
      ["Overdose suspectée", "Détresse respiratoire modérée"],
      ["Intoxication aiguë par substance", "Somnolence marquée"],
      ["Surdosage suspecté", "Ralentissement du rythme respiratoire"],
    ],
    priseEnCharge: [
      ["Administration d'antidote si disponible", "Surveillance respiratoire continue", "Perfusion de soluté"],
      ["Oxygénothérapie", "Surveillance cardiaque", "Transport en urgence"],
      ["Mise en position latérale de sécurité", "Surveillance de la conscience", "Transport prioritaire"],
      ["Ventilation assistée si nécessaire", "Surveillance intensive", "Transport rapide vers le bloc"],
    ],
    observations: [
      "Patient stabilisé après intervention. Surveillance rapprochée recommandée les prochaines 24h.",
      "Suivi psychologique conseillé en complément du suivi médical.",
      "Reprise progressive de la conscience durant le transport.",
      "État stable mais fragile, surveillance intensive maintenue à l'arrivée.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "epilepsie",
    motsCles: ["crise d'epilepsie", "crise d'épilepsie", "epilepsie", "épilepsie", "convulsions", "convulsion",
      "crise convulsive", "spasmes"],
    motifs: [
      "Intervention pour crise convulsive sur la voie publique.",
      "Prise en charge d'un patient épileptique en crise.",
      "Bilan neurologique suite à une crise d'épilepsie.",
      "Évaluation post-critique d'un patient après des convulsions.",
    ],
    examens: [
      "Bilan neurologique post-critique",
      "Contrôle de la glycémie et des constantes vitales",
      "Évaluation de l'état de conscience après la crise",
      "Examen clinique de recherche de blessures liées à la crise",
    ],
    diagnostics: [
      ["Crise d'épilepsie généralisée", "État post-critique"],
      ["Convulsions d'origine indéterminée", "Confusion post-critique"],
      ["Crise convulsive isolée", "Morsure de langue superficielle"],
      ["Crise d'épilepsie connue", "Fatigue post-critique marquée"],
    ],
    priseEnCharge: [
      ["Mise en position latérale de sécurité", "Protection contre les blessures", "Surveillance post-critique"],
      ["Surveillance de la reprise de conscience", "Contrôle de la glycémie", "Transport pour bilan"],
      ["Éloignement des objets dangereux", "Surveillance respiratoire", "Transport si première crise"],
      ["Réassurance à la reprise de conscience", "Surveillance des constantes", "Transport pour bilan neurologique"],
    ],
    observations: [
      "Reprise de conscience progressive, état post-critique classique observé.",
      "Aucune récidive de crise pendant la prise en charge.",
      "Suivi neurologique recommandé pour ajuster le traitement si nécessaire.",
      "Patient orienté et stable au moment du transport.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "allergie",
    motsCles: ["reaction allergique", "réaction allergique", "allergie", "choc anaphylactique", "anaphylaxie",
      "urticaire", "gonflement du visage", "piqure d'insecte", "piqûre d'insecte"],
    motifs: [
      "Intervention pour réaction allergique sévère.",
      "Prise en charge d'un choc anaphylactique suspecté.",
      "Bilan clinique suite à une piqûre d'insecte avec réaction cutanée.",
      "Évaluation d'un gonflement facial d'apparition brutale.",
    ],
    examens: [
      "Bilan respiratoire et cutané complet",
      "Surveillance de la tension artérielle et de la saturation",
      "Examen clinique de l'étendue de la réaction allergique",
      "Contrôle de la fréquence cardiaque et de l'état des voies aériennes",
    ],
    diagnostics: [
      ["Choc anaphylactique suspecté", "Œdème du visage"],
      ["Réaction allergique modérée", "Urticaire généralisée"],
      ["Réaction allergique à une piqûre d'insecte", "Gonflement localisé"],
      ["Réaction allergique sévère", "Difficulté respiratoire associée"],
    ],
    priseEnCharge: [
      ["Administration d'adrénaline si disponible", "Oxygénothérapie", "Transport en urgence"],
      ["Surveillance respiratoire rapprochée", "Perfusion de soluté", "Transport prioritaire"],
      ["Application de froid sur la zone touchée", "Surveillance de l'évolution", "Transport pour bilan"],
      ["Position semi-assise", "Surveillance des voies aériennes", "Transport rapide vers le centre médical"],
    ],
    observations: [
      "Amélioration rapide après administration d'adrénaline, surveillance continue recommandée.",
      "Aucune aggravation respiratoire observée durant le transport.",
      "Réaction contrôlée, suivi allergologique conseillé.",
      "État stable au moment du transport, surveillance maintenue par précaution.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "etouffement",
    motsCles: ["etouffement", "étouffement", "s'etouffe", "s'étouffe", "avale un objet", "coince dans la gorge",
      "coincé dans la gorge", "obstruction des voies respiratoires"],
    motifs: [
      "Intervention en urgence pour obstruction des voies respiratoires.",
      "Prise en charge d'un patient victime d'étouffement.",
      "Bilan d'urgence suite à l'ingestion d'un corps étranger.",
      "Évaluation d'une détresse respiratoire aiguë par étouffement.",
    ],
    examens: [
      "Évaluation immédiate de la perméabilité des voies aériennes",
      "Bilan respiratoire et de la coloration cutanée",
      "Contrôle de la saturation en oxygène",
      "Examen de la cavité buccale à la recherche d'un corps étranger",
    ],
    diagnostics: [
      ["Obstruction partielle des voies respiratoires", "Toux efficace persistante"],
      ["Obstruction complète levée", "Détresse respiratoire résiduelle"],
      ["Étouffement par corps étranger", "Cyanose transitoire"],
      ["Obstruction des voies aériennes", "Anxiété importante associée"],
    ],
    priseEnCharge: [
      ["Manœuvre de Heimlich effectuée", "Surveillance respiratoire", "Transport pour bilan"],
      ["Tapes dans le dos et compressions abdominales", "Oxygénothérapie", "Transport prioritaire"],
      ["Extraction du corps étranger", "Surveillance de la respiration", "Transport en urgence"],
      ["Position facilitant la respiration", "Surveillance continue", "Transport pour bilan ORL"],
    ],
    observations: [
      "Obstruction levée avec succès, respiration normale retrouvée.",
      "Surveillance respiratoire recommandée dans les heures suivant l'épisode.",
      "Aucune séquelle apparente après l'intervention, transport par précaution.",
      "Patient anxieux mais stable, réassurance apportée durant le transport.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "noyade",
    motsCles: ["noyade", "noye", "noyé", "eau", "piscine", "sous l'eau", "s'est noye", "s'est noyé"],
    motifs: [
      "Intervention suite à une noyade en milieu aquatique.",
      "Prise en charge d'un patient sorti de l'eau inconscient.",
      "Bilan respiratoire d'urgence suite à une noyade.",
      "Évaluation d'un patient victime d'une immersion prolongée.",
    ],
    examens: [
      "Bilan respiratoire complet",
      "Radiographie pulmonaire",
      "Contrôle de la température corporelle",
      "Évaluation de l'état de conscience et des constantes vitales",
    ],
    diagnostics: [
      ["Inhalation d'eau suspectée", "Détresse respiratoire modérée"],
      ["Hypothermie légère", "Trouble de la conscience"],
      ["Noyade avec perte de connaissance brève", "Toux productive"],
      ["Détresse respiratoire post-noyade", "Fatigue intense"],
    ],
    priseEnCharge: [
      ["Manœuvre de réanimation initiale", "Oxygénothérapie", "Réchauffement progressif"],
      ["Surveillance respiratoire continue", "Perfusion de soluté", "Transport en urgence"],
      ["Retrait des vêtements humides", "Couverture thermique", "Transport prioritaire"],
      ["Position latérale de sécurité", "Surveillance de la reprise de conscience", "Transport rapide"],
    ],
    observations: [
      "Patient stabilisé après intervention. Surveillance respiratoire recommandée les prochaines heures.",
      "Suivi médical conseillé pour écarter tout risque de complication pulmonaire tardive.",
      "Réchauffement efficace, aucune complication supplémentaire observée.",
      "État stable au moment du transport, surveillance respiratoire maintenue.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "pendaison",
    motsCles: ["pendaison", "pendu", "pendue", "s'est pendu", "s'est pendue", "corde autour du cou"],
    motifs: [
      "Intervention en urgence suite à une pendaison.",
      "Prise en charge d'un patient découvert en situation de pendaison.",
      "Bilan critique suite à une strangulation par pendaison.",
      "Évaluation d'urgence après retrait d'une ligature au niveau du cou.",
    ],
    examens: [
      "Bilan respiratoire et neurologique immédiat",
      "Contrôle des voies aériennes et de la circulation cervicale",
      "Évaluation de l'état de conscience et des constantes vitales",
      "Examen clinique des marques cervicales",
    ],
    diagnostics: [
      ["Détresse respiratoire sévère post-pendaison", "Marques de striction au cou"],
      ["Traumatisme cervical associé", "Trouble de la conscience"],
      ["Anoxie cérébrale suspectée", "Instabilité respiratoire"],
      ["Détresse vitale post-pendaison", "Œdème cervical"],
    ],
    priseEnCharge: [
      ["Retrait immédiat de la ligature", "Immobilisation cervicale", "Oxygénothérapie"],
      ["Réanimation cardio-pulmonaire si nécessaire", "Surveillance neurologique continue", "Transport en urgence absolue"],
      ["Ventilation assistée", "Surveillance des constantes", "Transport prioritaire vers le bloc"],
      ["Immobilisation complète", "Surveillance respiratoire rapprochée", "Transport rapide"],
    ],
    observations: [
      "Situation critique prise en charge rapidement, pronostic dépendant du délai d'intervention.",
      "Reprise d'une respiration spontanée après les premiers soins.",
      "Surveillance neurologique intensive requise à l'arrivée au centre médical.",
      "État instable au moment du transport, prise en charge hospitalière immédiate nécessaire.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "tentative_suicide",
    motsCles: ["tentative de suicide", "suicide", "envie de mourir", "veut se faire du mal", "tentative de mettre fin a sa vie",
      "tentative de mettre fin à sa vie", "automutilation"],
    motifs: [
      "Intervention suite à une tentative de suicide.",
      "Prise en charge médicale et psychologique d'un patient en détresse.",
      "Bilan clinique suite à un geste auto-agressif.",
      "Évaluation d'urgence d'un patient présentant des idées suicidaires actives.",
    ],
    examens: [
      "Bilan médical complet des lésions éventuelles",
      "Évaluation de l'état psychologique immédiat",
      "Contrôle des constantes vitales",
      "Examen clinique des éventuelles blessures auto-infligées",
    ],
    diagnostics: [
      ["Geste auto-agressif nécessitant une prise en charge médicale", "Détresse psychologique majeure"],
      ["Lésions superficielles auto-infligées", "État de choc émotionnel"],
      ["Tentative de suicide par intoxication", "Trouble de la conscience léger"],
      ["Détresse psychologique aiguë", "Absence de lésion physique grave"],
    ],
    priseEnCharge: [
      ["Soins des blessures si nécessaire", "Mise en sécurité du patient", "Transport vers une structure adaptée"],
      ["Surveillance rapprochée et continue", "Réassurance et écoute", "Transport pour prise en charge psychiatrique"],
      ["Stabilisation médicale des lésions", "Accompagnement psychologique immédiat", "Transport en urgence"],
      ["Mise en sécurité de l'environnement", "Surveillance constante", "Transport vers le centre médical"],
    ],
    observations: [
      "Patient stabilisé sur le plan physique, prise en charge psychologique indispensable.",
      "Aucune lésion vitale identifiée, suivi psychiatrique fortement recommandé.",
      "Situation prise en charge avec écoute et discrétion, transport effectué en sécurité.",
      "État émotionnel fragile, accompagnement rapproché maintenu jusqu'au transport.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "psychiatrique",
    motsCles: ["intervention psychiatrique", "crise de panique", "crise d'angoisse", "trouble psychiatrique",
      "delire", "délire", "personne agitee", "personne agitée", "confusion mentale"],
    motifs: [
      "Intervention pour trouble psychiatrique aigu.",
      "Prise en charge d'un patient en crise d'angoisse sévère.",
      "Bilan clinique d'un patient présentant un état confusionnel.",
      "Évaluation d'une personne en état de forte agitation psychologique.",
    ],
    examens: [
      "Évaluation de l'état psychologique et du comportement",
      "Bilan des constantes vitales de base",
      "Contrôle de l'orientation et de la cohérence du discours",
      "Examen clinique excluant une cause organique",
    ],
    diagnostics: [
      ["Crise d'angoisse aiguë", "Agitation psychomotrice"],
      ["État confusionnel aigu", "Désorientation temporo-spatiale"],
      ["Décompensation psychiatrique", "Discours incohérent"],
      ["Crise de panique sévère", "Hyperventilation associée"],
    ],
    priseEnCharge: [
      ["Approche calme et rassurante", "Mise en sécurité du patient et de l'entourage", "Transport vers une structure adaptée"],
      ["Réduction des stimuli environnants", "Surveillance continue", "Transport pour évaluation psychiatrique"],
      ["Accompagnement verbal apaisant", "Surveillance des constantes", "Transport en collaboration avec les autorités si nécessaire"],
      ["Exercices de respiration guidée", "Surveillance rapprochée", "Transport pour bilan complémentaire"],
    ],
    observations: [
      "Patient progressivement apaisé grâce à l'approche verbale, transport réalisé calmement.",
      "État stable au moment du transport, suivi psychiatrique recommandé.",
      "Aucune mise en danger supplémentaire observée durant l'intervention.",
      "Situation gérée avec prudence, accompagnement rapproché maintenu jusqu'à la prise en charge.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "agression",
    motsCles: ["bagarre", "coups", "tabasse", "tabassé", "frappe", "frappé", "battu", "violence physique",
      "agression", "agresse", "agressé"],
    motifs: [
      "Prise en charge d'un patient victime d'une agression physique.",
      "Bilan traumatologique suite à une altercation violente.",
      "Évaluation clinique après des coups portés au visage et au corps.",
      "Intervention suite à une bagarre avec blessures multiples.",
    ],
    examens: [
      "Radiographie du visage et des côtes",
      "Examen clinique complet des zones de contusion",
      "Bilan des douleurs et de la mobilité",
      "Contrôle des constantes vitales et des lésions visibles",
    ],
    diagnostics: [
      ["Contusions multiples au visage", "Suspicion de fracture des côtes"],
      ["Hématomes multiples", "Traumatisme abdominal léger"],
      ["Plaie ouverte à l'arcade", "Contusions au thorax"],
      ["Traumatisme facial", "Douleur diffuse au niveau du dos"],
    ],
    priseEnCharge: [
      ["Désinfection des plaies", "Pose de points de suture si nécessaire", "Antalgiques administrés"],
      ["Bandage des zones contuses", "Surveillance des constantes", "Glace appliquée sur les hématomes"],
      ["Immobilisation de précaution des côtes", "Surveillance de la douleur", "Transport pour bilan"],
      ["Nettoyage des plaies superficielles", "Antalgiques administrés", "Transport pour radiographie"],
    ],
    observations: [
      "Le patient est stable, surveillance recommandée en cas de douleur abdominale persistante.",
      "État général satisfaisant après les soins. Repos conseillé.",
      "Aucune atteinte interne suspectée après le premier bilan.",
      "Blessures superficielles principalement, suivi médical de précaution recommandé.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "arme_feu",
    motsCles: ["arme a feu", "arme à feu", "tire", "tiré", "balle", "fusil", "pistolet", "tir", "abattu",
      "coup de feu"],
    motifs: [
      "Intervention en urgence pour blessure par arme à feu.",
      "Prise en charge d'un patient victime d'un tir.",
      "Bilan critique suite à une plaie par balle.",
      "Évaluation d'urgence d'un patient touché par un projectile.",
    ],
    examens: [
      "Radiographie pour localiser le ou les projectiles",
      "Scanner corporel en urgence",
      "Bilan des fonctions vitales et de l'hémorragie",
      "Examen clinique de l'orifice d'entrée et de sortie",
    ],
    diagnostics: [
      ["Plaie par arme à feu à l'abdomen", "Hémorragie interne suspectée"],
      ["Plaie par balle à la jambe", "Fracture osseuse associée"],
      ["Plaie par balle à l'épaule", "Atteinte musculaire profonde"],
      ["Plaie par balle au thorax", "Détresse respiratoire associée"],
    ],
    priseEnCharge: [
      ["Extraction du projectile si accessible", "Suture de la plaie", "Transfusion si nécessaire", "Surveillance intensive"],
      ["Pansement compressif", "Perfusion de soluté", "Transport d'urgence vers le bloc opératoire"],
      ["Compression de l'hémorragie", "Oxygénothérapie", "Transport en urgence absolue"],
      ["Immobilisation de la zone touchée", "Surveillance hémodynamique continue", "Transport prioritaire"],
    ],
    observations: [
      "Patient dans un état critique stabilisé. Surveillance intensive requise dans les heures suivant l'intervention.",
      "Pronostic réservé, suivi médical rapproché nécessaire.",
      "Hémorragie contrôlée avant transport, transfusion probable à l'arrivée.",
      "État instable au moment du transport, prise en charge chirurgicale immédiate nécessaire.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "arme_blanche",
    motsCles: ["arme blanche", "couteau", "poignarde", "poignardé", "lame", "coup de couteau"],
    motifs: [
      "Intervention en urgence pour blessure par arme blanche.",
      "Prise en charge d'un patient victime d'un coup de couteau.",
      "Bilan critique suite à une plaie par arme tranchante.",
      "Évaluation d'urgence d'un patient poignardé.",
    ],
    examens: [
      "Examen clinique de la plaie",
      "Radiographie si suspicion d'atteinte profonde",
      "Bilan des fonctions vitales et de l'hémorragie",
      "Échographie abdominale si atteinte suspectée",
    ],
    diagnostics: [
      ["Plaie par arme blanche à l'abdomen", "Risque d'atteinte des organes internes"],
      ["Plaie par arme blanche au bras", "Section musculaire superficielle"],
      ["Plaie par arme blanche au thorax", "Risque de pneumothorax"],
      ["Plaie profonde au dos", "Hémorragie modérée"],
    ],
    priseEnCharge: [
      ["Nettoyage et désinfection de la plaie", "Suture chirurgicale", "Surveillance post-opératoire"],
      ["Pansement compressif", "Perfusion", "Transport vers le bloc opératoire"],
      ["Compression de l'hémorragie", "Oxygénothérapie", "Transport en urgence"],
      ["Immobilisation de la zone touchée", "Surveillance hémodynamique", "Transport prioritaire"],
    ],
    observations: [
      "Patient stabilisé après intervention. Surveillance recommandée pour prévenir une infection.",
      "Suivi médical rapproché conseillé dans les jours suivant l'intervention.",
      "Aucune atteinte des organes vitaux détectée lors du premier bilan.",
      "État stable au moment du transport, surveillance chirurgicale nécessaire à l'arrivée.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "accouchement",
    motsCles: ["accouchement", "va accoucher", "contractions", "perte des eaux", "bebe arrive", "bébé arrive",
      "en train d'accoucher"],
    motifs: [
      "Intervention pour accouchement en cours en dehors du bloc médical.",
      "Prise en charge d'une patiente en travail avancé.",
      "Bilan obstétrical d'urgence suite à la perte des eaux.",
      "Assistance médicale pour un accouchement imminent.",
    ],
    examens: [
      "Évaluation de la fréquence des contractions",
      "Contrôle des constantes vitales de la mère",
      "Bilan de l'avancement du travail",
      "Surveillance du rythme cardiaque fœtal si possible",
    ],
    diagnostics: [
      ["Travail actif avancé", "Contractions régulières et rapprochées"],
      ["Accouchement imminent", "Perte des eaux confirmée"],
      ["Travail obstétrical en cours", "Patiente stable"],
      ["Accouchement en cours hors structure médicale", "Contractions intenses"],
    ],
    priseEnCharge: [
      ["Installation de la patiente en position confortable", "Assistance à l'accouchement", "Transport en urgence vers la maternité"],
      ["Surveillance rapprochée du travail", "Préparation du matériel d'accouchement", "Transport prioritaire"],
      ["Accompagnement de la patiente durant les contractions", "Surveillance continue", "Transport rapide vers le centre médical"],
      ["Réassurance et gestion de la douleur", "Surveillance des constantes", "Transport en urgence vers la maternité"],
    ],
    observations: [
      "Accouchement pris en charge dans de bonnes conditions, mère et enfant stables.",
      "Transport effectué à temps, suivi obstétrical poursuivi à l'arrivée.",
      "Aucune complication observée durant la prise en charge.",
      "Patiente stable durant tout le transport, arrivée à la maternité dans les délais.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "hypoglycemie",
    motsCles: ["hypoglycemie", "hypoglycémie", "sucre bas", "malaise diabetique", "malaise diabétique",
      "manque de sucre"],
    motifs: [
      "Intervention pour suspicion d'hypoglycémie.",
      "Prise en charge d'un patient diabétique présentant un malaise.",
      "Bilan clinique d'une baisse importante de la glycémie.",
      "Évaluation d'un patient confus avec antécédent de diabète.",
    ],
    examens: [
      "Contrôle immédiat de la glycémie capillaire",
      "Bilan neurologique rapide",
      "Évaluation de l'état de conscience",
      "Contrôle des constantes vitales",
    ],
    diagnostics: [
      ["Hypoglycémie sévère", "Confusion associée"],
      ["Hypoglycémie modérée", "Sudation abondante"],
      ["Malaise hypoglycémique", "Tremblements associés"],
      ["Hypoglycémie chez patient diabétique connu", "Fatigue intense"],
    ],
    priseEnCharge: [
      ["Resucrage oral immédiat", "Surveillance de la glycémie", "Surveillance de la reprise de conscience"],
      ["Administration de glucose", "Surveillance continue", "Transport si absence d'amélioration"],
      ["Collation sucrée administrée", "Contrôle répété de la glycémie", "Surveillance rapprochée"],
      ["Perfusion de soluté glucosé si nécessaire", "Surveillance neurologique", "Transport pour bilan"],
    ],
    observations: [
      "Glycémie normalisée après resucrage, patient conscient et orienté.",
      "Amélioration rapide de l'état général après prise en charge.",
      "Suivi diabétologique recommandé pour ajuster le traitement.",
      "Aucune complication observée, patient stable au moment du départ des secours.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "hyperglycemie",
    motsCles: ["hyperglycemie", "hyperglycémie", "sucre trop haut", "glycemie trop elevee", "glycémie trop élevée"],
    motifs: [
      "Intervention pour suspicion d'hyperglycémie sévère.",
      "Prise en charge d'un patient diabétique en décompensation.",
      "Bilan clinique d'une glycémie anormalement élevée.",
      "Évaluation d'un patient présentant des signes de déshydratation liés au diabète.",
    ],
    examens: [
      "Contrôle immédiat de la glycémie capillaire",
      "Bilan de l'hydratation et des constantes vitales",
      "Évaluation de l'état de conscience",
      "Contrôle de la fréquence respiratoire",
    ],
    diagnostics: [
      ["Hyperglycémie sévère", "Déshydratation associée"],
      ["Décompensation diabétique", "Fatigue intense"],
      ["Hyperglycémie modérée", "Soif excessive rapportée"],
      ["Hyperglycémie chez patient diabétique connu", "Confusion légère"],
    ],
    priseEnCharge: [
      ["Réhydratation orale ou par perfusion", "Surveillance de la glycémie", "Transport pour bilan"],
      ["Surveillance des constantes vitales", "Contrôle répété de la glycémie", "Transport si absence d'amélioration"],
      ["Perfusion de soluté", "Surveillance neurologique", "Transport en urgence si signes de gravité"],
      ["Surveillance rapprochée de l'état général", "Réassurance du patient", "Transport pour bilan complémentaire"],
    ],
    observations: [
      "Amélioration progressive après réhydratation, surveillance recommandée.",
      "Suivi diabétologique conseillé pour ajuster le traitement.",
      "Aucune complication supplémentaire observée durant le transport.",
      "État stable au moment du départ des secours, bilan complémentaire nécessaire.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "electrocution",
    motsCles: ["electrocution", "électrocution", "choc electrique", "choc électrique", "electrocute", "électrocuté"],
    motifs: [
      "Intervention suite à une électrocution.",
      "Prise en charge d'un patient victime d'un choc électrique.",
      "Bilan critique suite à un contact avec une source électrique.",
      "Évaluation d'urgence après une électrisation accidentelle.",
    ],
    examens: [
      "Bilan cardiaque complet et surveillance du rythme",
      "Examen clinique des points de contact électrique",
      "Contrôle des fonctions vitales",
      "Recherche de brûlures internes et externes",
    ],
    diagnostics: [
      ["Électrisation avec brûlures au point de contact", "Trouble du rythme cardiaque suspecté"],
      ["Choc électrique modéré", "Contractions musculaires douloureuses"],
      ["Électrocution avec perte de connaissance brève", "Brûlures superficielles"],
      ["Électrisation sans perte de connaissance", "Douleur musculaire diffuse"],
    ],
    priseEnCharge: [
      ["Surveillance cardiaque continue", "Pansement des brûlures", "Transport en urgence"],
      ["Oxygénothérapie", "Surveillance du rythme cardiaque", "Transport prioritaire"],
      ["Réanimation cardio-pulmonaire si nécessaire", "Surveillance intensive", "Transport en urgence absolue"],
      ["Immobilisation et surveillance", "Soins des brûlures", "Transport pour bilan cardiaque"],
    ],
    observations: [
      "Surveillance cardiaque prolongée recommandée en raison du risque de trouble du rythme retardé.",
      "Aucune anomalie cardiaque détectée lors du bilan initial.",
      "Brûlures superficielles uniquement, suivi médical de précaution conseillé.",
      "État stable après surveillance, transport effectué par précaution.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "ecrasement",
    motsCles: ["ecrasement", "écrasement", "ecrase", "écrasé", "coince sous", "coincé sous", "compression"],
    motifs: [
      "Intervention suite à un écrasement d'un membre.",
      "Prise en charge d'un patient victime d'une compression prolongée.",
      "Bilan traumatologique suite à un écrasement accidentel.",
      "Évaluation d'urgence après extraction d'un membre coincé.",
    ],
    examens: [
      "Bilan des fonctions vitales et de la circulation du membre",
      "Radiographie du membre concerné",
      "Contrôle de la sensibilité et de la mobilité",
      "Bilan sanguin de recherche de complications liées à la compression",
    ],
    diagnostics: [
      ["Syndrome d'écrasement suspecté", "Atteinte musculaire profonde"],
      ["Fracture associée à un écrasement", "Œdème important du membre"],
      ["Compression prolongée d'un membre", "Risque de complication vasculaire"],
      ["Écrasement partiel de la main", "Douleur intense localisée"],
    ],
    priseEnCharge: [
      ["Extraction encadrée du membre coincé", "Immobilisation", "Surveillance de la circulation"],
      ["Perfusion de soluté", "Surveillance des constantes", "Transport en urgence"],
      ["Pansement et immobilisation", "Surveillance de la douleur", "Transport prioritaire"],
      ["Surveillance rapprochée du membre atteint", "Antalgiques administrés", "Transport pour bilan complémentaire"],
    ],
    observations: [
      "Circulation du membre correcte après extraction, surveillance recommandée.",
      "Risque de complication tardive à surveiller dans les heures suivant l'écrasement.",
      "État stable au moment du transport, bilan complémentaire nécessaire à l'arrivée.",
      "Aucune atteinte vasculaire majeure détectée lors du premier bilan.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "accident_travail",
    motsCles: ["accident de travail", "accident du travail", "chantier", "outil de travail", "machine industrielle"],
    motifs: [
      "Intervention suite à un accident survenu sur le lieu de travail.",
      "Prise en charge d'un patient blessé lors d'une activité professionnelle.",
      "Bilan traumatologique suite à un accident impliquant un outil de travail.",
      "Évaluation d'un patient victime d'un incident sur un chantier.",
    ],
    examens: [
      "Examen clinique complet de la zone touchée",
      "Radiographie si suspicion de fracture",
      "Bilan des fonctions vitales",
      "Contrôle de la mobilité et de la sensibilité du membre concerné",
    ],
    diagnostics: [
      ["Plaie profonde liée à un outil de travail", "Saignement modéré"],
      ["Fracture suite à une chute sur le chantier", "Douleur intense localisée"],
      ["Contusions multiples suite à un accident professionnel", "Œdème local"],
      ["Traumatisme de la main lié à une machine", "Risque fonctionnel à évaluer"],
    ],
    priseEnCharge: [
      ["Nettoyage et pansement de la plaie", "Immobilisation si nécessaire", "Transport pour bilan"],
      ["Pose d'une attelle", "Antalgiques administrés", "Transport vers le centre médical"],
      ["Surveillance des constantes", "Compression de l'hémorragie si présente", "Transport prioritaire"],
      ["Immobilisation de précaution", "Glace sur la zone contuse", "Transport pour radiographie"],
    ],
    observations: [
      "Prise en charge rapide sur le lieu de travail, transport effectué sans complication.",
      "Suivi médical recommandé pour évaluer l'évolution de la blessure.",
      "Aucune atteinte fonctionnelle majeure détectée lors du premier bilan.",
      "État stable, bilan complémentaire nécessaire à l'arrivée au centre médical.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "accident_domestique",
    motsCles: ["accident domestique", "accident a la maison", "accident à la maison", "chute a la maison",
      "chute à la maison", "accident menager", "accident ménager"],
    motifs: [
      "Intervention suite à un accident domestique.",
      "Prise en charge d'un patient blessé à son domicile.",
      "Bilan clinique suite à un incident survenu à la maison.",
      "Évaluation d'un patient victime d'une chute domestique.",
    ],
    examens: [
      "Examen clinique complet de la zone touchée",
      "Radiographie si suspicion de fracture",
      "Bilan des constantes vitales",
      "Contrôle de la mobilité et de la douleur",
    ],
    diagnostics: [
      ["Contusions suite à une chute domestique", "Douleur localisée modérée"],
      ["Plaie superficielle liée à un objet tranchant", "Saignement léger"],
      ["Entorse suite à un accident à la maison", "Gonflement de l'articulation"],
      ["Traumatisme léger suite à une chute d'escabeau", "Douleur au dos"],
    ],
    priseEnCharge: [
      ["Nettoyage et pansement si nécessaire", "Antalgiques administrés", "Surveillance des constantes"],
      ["Immobilisation de précaution", "Glace sur la zone touchée", "Transport pour bilan si besoin"],
      ["Bandage de contention", "Surveillance de la douleur", "Transport pour radiographie"],
      ["Surveillance rapprochée de l'état général", "Réassurance du patient", "Transport si nécessaire"],
    ],
    observations: [
      "Blessure superficielle prise en charge sans complication.",
      "Suivi médical de précaution recommandé pour l'évolution des douleurs.",
      "Aucune aggravation observée après les premiers soins.",
      "État stable, transport effectué par précaution.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "accident_sport",
    motsCles: ["accident sportif", "accident de sport", "blessure sportive", "entorse en jouant", "blessure au foot",
      "blessure en courant", "musculation"],
    motifs: [
      "Intervention suite à une blessure survenue lors d'une activité sportive.",
      "Prise en charge d'un patient blessé pendant un entraînement.",
      "Bilan traumatologique suite à une chute sur le terrain.",
      "Évaluation d'un patient victime d'une entorse pendant une activité physique.",
    ],
    examens: [
      "Examen clinique de l'articulation touchée",
      "Radiographie si suspicion de fracture",
      "Bilan de la mobilité et de la douleur",
      "Contrôle des constantes vitales",
    ],
    diagnostics: [
      ["Entorse de la cheville", "Gonflement important"],
      ["Contusion musculaire suite à un choc sportif", "Douleur à la palpation"],
      ["Suspicion de fracture suite à une chute sportive", "Impotence fonctionnelle"],
      ["Élongation musculaire", "Douleur vive à l'effort"],
    ],
    priseEnCharge: [
      ["Glace sur la zone touchée", "Bandage de contention", "Surveillance de la douleur"],
      ["Immobilisation de l'articulation", "Antalgiques administrés", "Transport pour bilan si nécessaire"],
      ["Repos et surélévation du membre", "Surveillance de l'évolution", "Transport pour radiographie"],
      ["Compression légère", "Réassurance du patient", "Transport si douleur persistante"],
    ],
    observations: [
      "Blessure typique du sport prise en charge sans complication.",
      "Suivi conseillé pour évaluer la nécessité d'une rééducation.",
      "Aucune fracture suspectée après le premier bilan clinique.",
      "État stable, transport effectué par précaution pour bilan complémentaire.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "polytraumatisme",
    motsCles: ["polytraumatisme", "polytraumatise", "polytraumatisé", "blessures multiples", "traumatismes multiples"],
    motifs: [
      "Intervention critique pour polytraumatisme.",
      "Prise en charge d'un patient présentant des blessures multiples et sévères.",
      "Bilan traumatologique complet suite à un accident majeur.",
      "Évaluation d'urgence d'un patient polytraumatisé.",
    ],
    examens: [
      "Scanner corporel complet en urgence",
      "Bilan des fonctions vitales et de l'hémorragie",
      "Radiographie de l'ensemble des zones traumatisées",
      "Examen clinique complet et rapide de toutes les lésions",
    ],
    diagnostics: [
      ["Polytraumatisme sévère", "Hémorragie interne suspectée"],
      ["Traumatisme thoracique et abdominal associé", "Fractures multiples"],
      ["Polytraumatisme avec atteinte crânienne", "Instabilité hémodynamique"],
      ["Traumatismes multiples", "Détresse respiratoire associée"],
    ],
    priseEnCharge: [
      ["Immobilisation complète du patient", "Perfusion de soluté", "Transport en urgence absolue"],
      ["Oxygénothérapie", "Surveillance hémodynamique continue", "Transport prioritaire vers le bloc"],
      ["Contrôle des hémorragies multiples", "Surveillance intensive", "Transport rapide"],
      ["Immobilisation cervicale et dorsale", "Surveillance des constantes vitales", "Transport en urgence"],
    ],
    observations: [
      "Patient dans un état critique, pris en charge rapidement sur les lieux.",
      "Pronostic réservé, surveillance intensive requise à l'arrivée au centre médical.",
      "Stabilisation partielle obtenue avant le transport.",
      "État instable, prise en charge chirurgicale immédiate nécessaire.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "traumatisme_cranien",
    motsCles: ["traumatisme cranien", "traumatisme crânien", "coup a la tete", "coup à la tête", "choc a la tete",
      "choc à la tête", "tete qui saigne", "tête qui saigne"],
    motifs: [
      "Prise en charge d'un traumatisme crânien suite à un choc.",
      "Évaluation neurologique suite à un coup porté à la tête.",
      "Bilan clinique d'un patient présentant une plaie au niveau du crâne.",
      "Intervention pour suspicion de traumatisme crânien après une chute.",
    ],
    examens: [
      "Scanner crânien complet",
      "Bilan neurologique rapide",
      "Examen clinique de la plaie crânienne",
      "Contrôle de l'état de conscience et des pupilles",
    ],
    diagnostics: [
      ["Traumatisme crânien léger", "Plaie superficielle du cuir chevelu"],
      ["Traumatisme crânien modéré", "Céphalées importantes"],
      ["Suspicion de commotion cérébrale", "Vertiges associés"],
      ["Traumatisme crânien avec perte de connaissance brève", "Amnésie de l'épisode"],
    ],
    priseEnCharge: [
      ["Immobilisation cervicale de précaution", "Surveillance neurologique continue", "Transport pour bilan"],
      ["Pansement de la plaie crânienne", "Surveillance de la conscience", "Transport en urgence si aggravation"],
      ["Surveillance rapprochée des pupilles", "Antalgiques administrés", "Transport pour scanner"],
      ["Réassurance et immobilisation", "Surveillance des signes neurologiques", "Transport si symptômes persistants"],
    ],
    observations: [
      "Surveillance neurologique recommandée dans les 24 à 48 heures suivant le traumatisme.",
      "Aucun signe de gravité détecté lors du premier bilan.",
      "État stable, transport effectué par précaution pour un bilan complémentaire.",
      "Patient orienté et cohérent au moment du transport.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "traumatisme_cervical",
    motsCles: ["traumatisme cervical", "coup au cou", "douleur au cou", "cervicales", "nuque bloquee",
      "nuque bloquée", "coup du lapin"],
    motifs: [
      "Prise en charge d'un traumatisme cervical suite à un choc.",
      "Évaluation d'une douleur cervicale d'apparition brutale.",
      "Bilan clinique suite à un mouvement brusque de la nuque.",
      "Intervention pour suspicion d'atteinte cervicale après un accident.",
    ],
    examens: [
      "Radiographie de la colonne cervicale",
      "Bilan neurologique des membres",
      "Examen clinique de la mobilité du cou",
      "Contrôle de la sensibilité des extrémités",
    ],
    diagnostics: [
      ["Traumatisme cervical léger", "Douleur à la mobilisation"],
      ["Entorse cervicale", "Raideur importante de la nuque"],
      ["Suspicion d'atteinte cervicale", "Douleur irradiante vers l'épaule"],
      ["Contracture musculaire cervicale", "Limitation des mouvements du cou"],
    ],
    priseEnCharge: [
      ["Immobilisation cervicale avec collier", "Surveillance neurologique", "Transport pour bilan"],
      ["Antalgiques administrés", "Surveillance de la douleur", "Transport pour radiographie"],
      ["Maintien de l'alignement cervical", "Surveillance de la sensibilité des membres", "Transport prioritaire"],
      ["Repos strict de la nuque", "Surveillance de l'évolution", "Transport si aggravation"],
    ],
    observations: [
      "Aucun signe neurologique alarmant détecté lors du bilan initial.",
      "Surveillance recommandée pour l'évolution de la douleur cervicale.",
      "État stable, transport effectué avec immobilisation de précaution.",
      "Suivi médical conseillé pour confirmer l'absence de lésion structurelle.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "douleur_abdominale",
    motsCles: ["douleur abdominale", "mal au ventre", "douleur au ventre", "crampes abdominales", "ventre dur",
      "appendicite"],
    motifs: [
      "Évaluation d'une douleur abdominale nécessitant un bilan complet.",
      "Prise en charge d'un patient présentant des douleurs au ventre.",
      "Bilan clinique suite à une douleur abdominale aiguë.",
      "Intervention pour suspicion d'urgence abdominale.",
    ],
    examens: [
      "Palpation abdominale complète",
      "Bilan des constantes vitales",
      "Évaluation de la localisation et de l'intensité de la douleur",
      "Contrôle de la température et de l'état général",
    ],
    diagnostics: [
      ["Douleur abdominale d'origine indéterminée", "Sensibilité à la palpation"],
      ["Suspicion d'appendicite", "Douleur localisée à droite"],
      ["Crampes abdominales aiguës", "Nausées associées"],
      ["Douleur abdominale diffuse", "Légère fièvre associée"],
    ],
    priseEnCharge: [
      ["Mise au repos en position antalgique", "Surveillance de la douleur", "Transport pour bilan"],
      ["Surveillance des constantes vitales", "Antalgiques administrés avec précaution", "Transport pour examen complémentaire"],
      ["Réassurance du patient", "Surveillance de l'évolution des symptômes", "Transport si aggravation"],
      ["Position semi-assise", "Surveillance rapprochée", "Transport pour bilan chirurgical"],
    ],
    observations: [
      "Douleur stable durant le transport, bilan complémentaire nécessaire à l'arrivée.",
      "Aucun signe de gravité immédiate détecté lors du bilan initial.",
      "Suivi médical recommandé pour déterminer la cause exacte de la douleur.",
      "État général satisfaisant, surveillance maintenue par précaution.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "fievre",
    motsCles: ["fievre", "fièvre", "temperature elevee", "température élevée", "chaud et fievreux",
      "chaud et fiévreux", "frissons"],
    motifs: [
      "Évaluation d'un patient présentant une fièvre élevée.",
      "Prise en charge d'un état fébrile avec frissons.",
      "Bilan clinique suite à une montée de température importante.",
      "Intervention pour un épisode fébrile persistant.",
    ],
    examens: [
      "Contrôle de la température corporelle",
      "Bilan des constantes vitales",
      "Examen clinique général de recherche d'un foyer infectieux",
      "Évaluation de l'état d'hydratation",
    ],
    diagnostics: [
      ["Fièvre élevée d'origine indéterminée", "Frissons associés"],
      ["État fébrile modéré", "Fatigue générale"],
      ["Suspicion de syndrome infectieux", "Sudation abondante"],
      ["Fièvre persistante", "Légère déshydratation associée"],
    ],
    priseEnCharge: [
      ["Refroidissement corporel léger", "Surveillance de la température", "Hydratation orale"],
      ["Surveillance des constantes vitales", "Réassurance du patient", "Transport pour bilan si besoin"],
      ["Retrait des vêtements superflus", "Surveillance rapprochée", "Transport si persistance de la fièvre"],
      ["Hydratation encouragée", "Surveillance de l'évolution", "Transport pour bilan infectieux"],
    ],
    observations: [
      "Légère baisse de la température observée après prise en charge.",
      "Suivi médical recommandé pour identifier l'origine de la fièvre.",
      "État général stable, surveillance maintenue par précaution.",
      "Aucune complication observée durant la prise en charge.",
    ],
  },
  // ------------------------------------------------------------
  {
    id: "deshydratation",
    motsCles: ["deshydratation", "déshydratation", "manque d'eau", "trop chaud", "coup de chaleur",
      "insolation"],
    motifs: [
      "Évaluation d'un patient présentant des signes de déshydratation.",
      "Prise en charge d'un coup de chaleur suspecté.",
      "Bilan clinique suite à une exposition prolongée à la chaleur.",
      "Intervention pour suspicion d'insolation.",
    ],
    examens: [
      "Bilan des constantes vitales et de la température",
      "Évaluation de l'état d'hydratation cutanée",
      "Contrôle de la tension artérielle",
      "Examen clinique général de l'état de fatigue",
    ],
    diagnostics: [
      ["Déshydratation modérée", "Fatigue intense"],
      ["Coup de chaleur suspecté", "Peau chaude et sèche"],
      ["Insolation légère", "Céphalées associées"],
      ["Déshydratation sévère", "Vertiges à la mobilisation"],
    ],
    priseEnCharge: [
      ["Mise à l'ombre et au frais", "Réhydratation orale progressive", "Surveillance de la température"],
      ["Perfusion de soluté si nécessaire", "Surveillance des constantes", "Transport pour bilan si besoin"],
      ["Refroidissement corporel progressif", "Surveillance rapprochée", "Transport si absence d'amélioration"],
      ["Hydratation encouragée", "Repos en position allongée", "Transport pour bilan complémentaire"],
    ],
    observations: [
      "Amélioration progressive de l'état général après réhydratation.",
      "Aucune complication supplémentaire observée durant la prise en charge.",
      "Suivi recommandé pour éviter toute récidive lors de fortes chaleurs.",
      "État stable au moment du départ des secours.",
    ],
  },
];

// ==================================================================
// CATÉGORIE GÉNÉRIQUE (utilisée si aucun mot-clé ne correspond)
// ==================================================================
const CATEGORIE_GENERIQUE = {
  motifs: [
    "Évaluation d'un patient présentant des symptômes à préciser.",
    "Intervention médicale de routine suite à un appel de détresse.",
    "Bilan clinique general suite à un motif non spécifié.",
    "Prise en charge d'un patient nécessitant une évaluation complémentaire.",
  ],
  examens: [
    "Examen clinique general",
    "Bilan des constantes vitales",
    "Évaluation générale de l'état du patient",
    "Contrôle des fonctions vitales de base",
  ],
  diagnostics: [
    ["Traumatisme à évaluer", "Douleur localisée"],
    ["État general à surveiller", "Symptômes non spécifiques"],
    ["Bilan à compléter", "Aucun signe de gravité immédiate"],
    ["Motif à préciser lors du bilan complémentaire", "Patient conscient et orienté"],
  ],
  priseEnCharge: [
    ["Premiers soins administrés", "Surveillance des constantes", "Transport si nécessaire"],
    ["Réassurance du patient", "Surveillance générale", "Transport pour bilan complémentaire"],
    ["Surveillance rapprochée", "Soins de base prodigués", "Transport vers le centre médical"],
    ["Prise en charge standard", "Surveillance continue", "Transport pour évaluation approfondie"],
  ],
  observations: [
    "Patient pris en charge dans de bonnes conditions. Suivi recommandé selon l'évolution.",
    "Aucune complication majeure observée lors de la prise en charge.",
    "Bilan complémentaire nécessaire pour affiner le diagnostic.",
    "État stable, surveillance maintenue par précaution.",
  ],
};

function choisirAuHasard(tableau) {
  return tableau[Math.floor(Math.random() * tableau.length)];
}

function normaliser(texte) {
  return String(texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // retire les accents pour une meilleure détection
}

function trouverCategorie(texte) {
  const texteNormalise = normaliser(texte);
  let meilleureCategorie = null;
  let meilleurScore = 0;

  for (const categorie of CATEGORIES) {
    let score = 0;
    for (const motCle of categorie.motsCles) {
      if (texteNormalise.includes(normaliser(motCle))) score++;
    }
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleureCategorie = categorie;
    }
  }

  return meilleureCategorie;
}

// Fonction principale : garde la même signature que l'ancien système
// pour rester 100% compatible avec le reste du bot.
function trouverSituation(texte) {
  const categorie = trouverCategorie(texte) || CATEGORIE_GENERIQUE;

  return {
    motif: choisirAuHasard(categorie.motifs),
    examen: choisirAuHasard(categorie.examens),
    diagnostic: choisirAuHasard(categorie.diagnostics),
    prise_en_charge: choisirAuHasard(categorie.priseEnCharge),
    observations: choisirAuHasard(categorie.observations),
  };
}

module.exports = { trouverSituation, CATEGORIES, CATEGORIE_GENERIQUE };
