<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>EMS - Panel</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #07080d;
    --bg-card: rgba(20,23,35,0.68);
    --bg-card-solid: #12141f;
    --bg-input: #10121c;
    --border: rgba(148,163,184,0.10);
    --border-hover: rgba(255,45,120,0.35);
    --accent: #ff2d78;
    --accent-b: #3b82f6;
    --accent-grad: linear-gradient(135deg, var(--accent), var(--accent-b));
    --text: #f2f3f7;
    --text-dim: #8890a4;
    --text-faint: #545c72;
    --ok: #34d399;
    --err: #fb7185;
    --warn: #f59e0b;
    --radius-lg: 18px;
    --radius-md: 12px;
    --radius-sm: 9px;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    display: flex;
    min-height: 100vh;
  }
  h1, h2, h3 { font-family: 'Sora', sans-serif; }

  body::before {
    content: '';
    position: fixed; inset: 0; z-index: 0;
    background:
      radial-gradient(circle at 12% 8%, rgba(255,45,120,0.14), transparent 42%),
      radial-gradient(circle at 88% 6%, rgba(59,130,246,0.12), transparent 46%),
      var(--bg);
  }

  nav {
    width: 220px;
    background: rgba(10,11,17,0.55);
    border-right: 1px solid var(--border);
    backdrop-filter: blur(20px);
    padding: 20px 14px;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    z-index: 2;
  }
  nav h1 {
    font-size: 15px;
    font-weight: 700;
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
  }
  nav .tab {
    padding: 10px 12px;
    cursor: pointer;
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    margin-bottom: 2px;
    transition: all .18s ease;
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
  nav .tab { position: relative; }

  main {
    flex: 1;
    padding: 30px 40px 60px;
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

  .carte {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 18px 20px;
    margin-bottom: 14px;
    backdrop-filter: blur(16px);
    transition: border-color .2s ease;
  }
  .carte:hover { border-color: var(--border-hover); }

  .stats-grille {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
    margin-bottom: 22px;
  }
  .stat-carte {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
    backdrop-filter: blur(16px);
  }
  .stat-carte .valeur {
    font-family: 'Sora', sans-serif;
    font-size: 28px;
    font-weight: 800;
    background: var(--accent-grad);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .stat-carte .label { font-size: 12px; color: var(--text-dim); margin-top: 5px; font-weight: 500; }

  .hidden { display: none; }
  .ligne { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }

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

  .classement-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: var(--bg-card-solid);
    border-radius: var(--radius-sm);
    margin-bottom: 6px;
    border-left: 3px solid var(--border-hover);
  }
  .classement-item .rang {
    font-weight: 700;
    color: var(--text-dim);
    width: 40px;
  }
  .classement-item .nom { font-weight: 600; flex: 1; }
  .classement-item .valeur { font-weight: 700; color: var(--accent); }
  .classement-item.top1 { border-left-color: #ffd700; }
  .classement-item.top2 { border-left-color: #c0c0c0; }
  .classement-item.top3 { border-left-color: #cd7f32; }

  .daily-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    margin: 10px 0;
  }
  .daily-item {
    text-align: center;
    padding: 8px 4px;
    background: var(--bg-input);
    border-radius: var(--radius-sm);
  }
  .daily-item .day { font-size: 11px; color: var(--text-dim); }
  .daily-item .hours { font-size: 14px; font-weight: 600; color: var(--text); }

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

  a.discret { color: var(--text-faint); font-size: 12.5px; text-decoration: none; }
  a.discret:hover { color: var(--text-dim); }

  .msg-ok { color: var(--ok); background: rgba(52,211,153,0.1); padding: 8px 12px; border-radius: 8px; }
  .msg-err { color: var(--err); background: rgba(251,113,133,0.1); padding: 8px 12px; border-radius: 8px; }

  @media (max-width: 900px) {
    body { flex-direction: column; }
    nav { width: 100%; height: auto; position: relative; flex-direction: row; flex-wrap: wrap; }
    main { max-width: 100%; padding: 20px; }
    .daily-grid { grid-template-columns: repeat(7, 1fr); }
  }

  ::-webkit-scrollbar { width: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.15); border-radius: 999px; }
</style>
</head>
<body>

<nav>
  <h1><span class="mark">🚑</span> Panel EMS</h1>
  <div class="tab actif" data-tab="services">🟢 Services</div>
  <div class="tab" data-tab="interventions">🚑 Interventions</div>
  <div class="tab" data-tab="rapports">📋 Rapports</div>
  <div id="compte"></div>
  <div style="padding: 14px 10px 0; margin-top: auto;">
    <a href="/logout" class="discret">↪ Déconnexion</a>
  </div>
</nav>

<main>
  <!-- SERVICES -->
  <section id="vue-services">
    <h2>🟢 Statistiques de Service</h2>
    
    <div class="stats-grille" id="service-stats">
      <div class="stat-carte">
        <div class="valeur" id="service-total-membres">0</div>
        <div class="label">Membres actifs</div>
      </div>
      <div class="stat-carte">
        <div class="valeur" id="service-total-heures">0h</div>
        <div class="label">Heures totales cumulées</div>
      </div>
      <div class="stat-carte">
        <div class="valeur" id="service-en-cours">0</div>
        <div class="label">En service actuellement</div>
      </div>
      <div class="stat-carte">
        <div class="valeur" id="service-moyenne">0h</div>
        <div class="label">Moyenne par membre</div>
      </div>
    </div>

    <div class="carte">
      <h3 style="margin-top:0;">📊 Classement des membres (temps total)</h3>
      <div id="service-leaderboard">
        <p style="color:var(--text-dim);">Chargement...</p>
      </div>
    </div>

    <div class="carte">
      <h3 style="margin-top:0;">📋 Détail par membre</h3>
      <div id="service-detail">
        <p style="color:var(--text-dim);">Chargement...</p>
      </div>
    </div>
  </section>

  <!-- INTERVENTIONS -->
  <section id="vue-interventions" class="hidden">
    <h2>🚑 Statistiques d'Interventions</h2>
    
    <div class="stats-grille" id="intervention-stats">
      <div class="stat-carte">
        <div class="valeur" id="intervention-total">0</div>
        <div class="label">Total interventions</div>
      </div>
      <div class="stat-carte">
        <div class="valeur" id="intervention-intervenants">0</div>
        <div class="label">Intervenants uniques</div>
      </div>
      <div class="stat-carte">
        <div class="valeur" id="intervention-moyenne">0</div>
        <div class="label">Moyenne par intervenant</div>
      </div>
    </div>

    <div class="carte">
      <h3 style="margin-top:0;">🏆 Classement des intervenants</h3>
      <div id="intervention-leaderboard">
        <p style="color:var(--text-dim);">Chargement...</p>
      </div>
    </div>
  </section>

  <!-- RAPPORTS -->
  <section id="vue-rapports" class="hidden">
    <h2>📋 Statistiques de Rapports</h2>
    
    <div class="stats-grille" id="rapport-stats">
      <div class="stat-carte">
        <div class="valeur" id="rapport-total">0</div>
        <div class="label">Total rapports</div>
      </div>
      <div class="stat-carte">
        <div class="valeur" id="rapport-auteurs">0</div>
        <div class="label">Rapporteurs uniques</div>
      </div>
      <div class="stat-carte">
        <div class="valeur" id="rapport-moyenne">0</div>
        <div class="label">Moyenne par rapporteur</div>
      </div>
    </div>

    <div class="carte">
      <h3 style="margin-top:0;">🏆 Classement des rapporteurs</h3>
      <div id="rapport-leaderboard">
        <p style="color:var(--text-dim);">Chargement...</p>
      </div>
    </div>
  </section>

</main>

<script>
  // ==========================================
  // NAVIGATION
  // ==========================================
  const tabs = document.querySelectorAll('.tab');
  const vues = {
    services: chargerServices,
    interventions: chargerInterventions,
    rapports: chargerRapports,
  };

  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('actif'));
    tab.classList.add('actif');
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
    document.getElementById('vue-' + tab.dataset.tab).classList.remove('hidden');
    if (vues[tab.dataset.tab]) vues[tab.dataset.tab]();
  }));

  // ==========================================
  // COMPTE
  // ==========================================
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

  // ==========================================
  // FORMATAGE
  // ==========================================
  function formatTime(seconds) {
    if (!seconds || seconds < 0) return '0h';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours === 0 && minutes === 0) return '0h';
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h${minutes}`;
  }

  function formatTimeFull(seconds) {
    if (!seconds || seconds < 0) return '0h0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h${minutes}`;
  }

  // ==========================================
  // SERVICES
  // ==========================================
  async function chargerServices() {
    try {
      const res = await fetch('/api/ems/stats');
      const data = await res.json();
      
      if (!data || data.length === 0) {
        document.getElementById('service-leaderboard').innerHTML = '<p style="color:var(--text-dim);">Aucune donnée disponible.</p>';
        document.getElementById('service-detail').innerHTML = '<p style="color:var(--text-dim);">Aucune donnée disponible.</p>';
        return;
      }

      // Stats globales
      let totalSeconds = 0;
      let activeCount = 0;
      let onServiceCount = 0;
      const membersWithService = data.filter(m => m.totalServiceSeconds > 0);

      for (const m of data) {
        totalSeconds += m.totalServiceSeconds || 0;
        if (m.totalServiceSeconds > 0) activeCount++;
        if (m.isOnService) onServiceCount++;
      }

      document.getElementById('service-total-membres').textContent = activeCount;
      document.getElementById('service-total-heures').textContent = formatTime(totalSeconds);
      document.getElementById('service-en-cours').textContent = onServiceCount;
      document.getElementById('service-moyenne').textContent = activeCount > 0 ? formatTime(Math.floor(totalSeconds / activeCount)) : '0h';

      // Classement
      const sorted = [...membersWithService].sort((a, b) => b.totalServiceSeconds - a.totalServiceSeconds);
      
      let leaderboardHtml = '';
      sorted.slice(0, 20).forEach((m, i) => {
        let cls = 'classement-item';
        if (i === 0) cls += ' top1';
        else if (i === 1) cls += ' top2';
        else if (i === 2) cls += ' top3';
        
        const statusBadge = m.isOnService 
          ? '<span class="service-badge" style="font-size:10px;padding:2px 8px;">🟢 En service</span>'
          : '';

        leaderboardHtml += `
          <div class="${cls}">
            <span class="rang">#${i+1}</span>
            <span class="nom">${m.username} ${statusBadge}</span>
            <span class="valeur">${formatTime(m.totalServiceSeconds)}</span>
          </div>
        `;
      });

      document.getElementById('service-leaderboard').innerHTML = leaderboardHtml || '<p style="color:var(--text-dim);">Aucun membre avec du temps de service.</p>';

      // Détail par membre avec temps de la semaine et journalier
      let detailHtml = '';
      const weekStart = getWeekStart();
      const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
      
      // Trier par temps de la semaine
      const sortedWeekly = [...data]
        .filter(m => m.weeklyServiceSeconds > 0)
        .sort((a, b) => b.weeklyServiceSeconds - a.weeklyServiceSeconds)
        .slice(0, 15);

      if (sortedWeekly.length === 0) {
        detailHtml = '<p style="color:var(--text-dim);">Aucune activité cette semaine.</p>';
      } else {
        for (const m of sortedWeekly) {
          const dailyHtml = days.map((day, i) => {
            const seconds = m.dailyService?.[day] || 0;
            return `<div class="daily-item"><div class="day">${day.substring(0,3)}</div><div class="hours">${formatTimeFull(seconds)}</div></div>`;
          }).join('');

          detailHtml += `
            <div class="carte" style="margin-bottom:10px;">
              <div class="ligne">
                <div>
                  <strong>${m.username}</strong>
                  <span style="color:var(--text-dim);font-size:12px;margin-left:8px;">
                    Total: ${formatTime(m.totalServiceSeconds)} | Cette semaine: ${formatTime(m.weeklyServiceSeconds)}
                  </span>
                  ${m.isOnService ? '<span class="service-badge" style="font-size:10px;padding:2px 8px;margin-left:8px;">🟢</span>' : ''}
                </div>
                <span style="color:var(--text-dim);font-size:12px;">🚑 ${m.totalInterventions || 0} | 📋 ${m.totalRapports || 0}</span>
              </div>
              <div class="daily-grid">${dailyHtml}</div>
            </div>
          `;
        }
      }

      document.getElementById('service-detail').innerHTML = detailHtml;

    } catch (e) {
      console.error('Erreur chargement services:', e);
      document.getElementById('service-leaderboard').innerHTML = '<p style="color:var(--err);">❌ Erreur de chargement</p>';
    }
  }

  function getWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  // ==========================================
  // INTERVENTIONS
  // ==========================================
  async function chargerInterventions() {
    try {
      const res = await fetch('/api/ems/leaderboard/interventions');
      const data = await res.json();

      if (!data || data.length === 0) {
        document.getElementById('intervention-leaderboard').innerHTML = '<p style="color:var(--text-dim);">Aucune intervention enregistrée.</p>';
        document.getElementById('intervention-stats').innerHTML = `
          <div class="stat-carte"><div class="valeur">0</div><div class="label">Total interventions</div></div>
          <div class="stat-carte"><div class="valeur">0</div><div class="label">Intervenants uniques</div></div>
          <div class="stat-carte"><div class="valeur">0</div><div class="label">Moyenne par intervenant</div></div>
        `;
        return;
      }

      const total = data.reduce((sum, m) => sum + m.count, 0);
      const unique = data.filter(m => m.count > 0).length;
      const avg = unique > 0 ? Math.round(total / unique * 10) / 10 : 0;

      document.getElementById('intervention-total').textContent = total;
      document.getElementById('intervention-intervenants').textContent = unique;
      document.getElementById('intervention-moyenne').textContent = avg;

      let html = '';
      data.filter(m => m.count > 0).slice(0, 30).forEach((m, i) => {
        let cls = 'classement-item';
        if (i === 0) cls += ' top1';
        else if (i === 1) cls += ' top2';
        else if (i === 2) cls += ' top3';

        html += `
          <div class="${cls}">
            <span class="rang">#${i+1}</span>
            <span class="nom">${m.username}</span>
            <span class="valeur">${m.count} intervention${m.count > 1 ? 's' : ''}</span>
          </div>
        `;
      });

      document.getElementById('intervention-leaderboard').innerHTML = html || '<p style="color:var(--text-dim);">Aucune intervention.</p>';

    } catch (e) {
      console.error('Erreur chargement interventions:', e);
      document.getElementById('intervention-leaderboard').innerHTML = '<p style="color:var(--err);">❌ Erreur de chargement</p>';
    }
  }

  // ==========================================
  // RAPPORTS
  // ==========================================
  async function chargerRapports() {
    try {
      const res = await fetch('/api/ems/leaderboard/rapports');
      const data = await res.json();

      if (!data || data.length === 0) {
        document.getElementById('rapport-leaderboard').innerHTML = '<p style="color:var(--text-dim);">Aucun rapport enregistré.</p>';
        document.getElementById('rapport-stats').innerHTML = `
          <div class="stat-carte"><div class="valeur">0</div><div class="label">Total rapports</div></div>
          <div class="stat-carte"><div class="valeur">0</div><div class="label">Rapporteurs uniques</div></div>
          <div class="stat-carte"><div class="valeur">0</div><div class="label">Moyenne par rapporteur</div></div>
        `;
        return;
      }

      const total = data.reduce((sum, m) => sum + m.count, 0);
      const unique = data.filter(m => m.count > 0).length;
      const avg = unique > 0 ? Math.round(total / unique * 10) / 10 : 0;

      document.getElementById('rapport-total').textContent = total;
      document.getElementById('rapport-auteurs').textContent = unique;
      document.getElementById('rapport-moyenne').textContent = avg;

      let html = '';
      data.filter(m => m.count > 0).slice(0, 30).forEach((m, i) => {
        let cls = 'classement-item';
        if (i === 0) cls += ' top1';
        else if (i === 1) cls += ' top2';
        else if (i === 2) cls += ' top3';

        html += `
          <div class="${cls}">
            <span class="rang">#${i+1}</span>
            <span class="nom">${m.username}</span>
            <span class="valeur">${m.count} rapport${m.count > 1 ? 's' : ''}</span>
          </div>
        `;
      });

      document.getElementById('rapport-leaderboard').innerHTML = html || '<p style="color:var(--text-dim);">Aucun rapport.</p>';

    } catch (e) {
      console.error('Erreur chargement rapports:', e);
      document.getElementById('rapport-leaderboard').innerHTML = '<p style="color:var(--err);">❌ Erreur de chargement</p>';
    }
  }

  // ==========================================
  // RAFRAÎCHISSEMENT AUTO
  // ==========================================
  let refreshInterval;

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      const activeTab = document.querySelector('.tab.actif');
      if (activeTab && vues[activeTab.dataset.tab]) {
        vues[activeTab.dataset.tab]();
      }
    }, 30000);
  }

  // ==========================================
  // INITIALISATION
  // ==========================================
  chargerCompte();
  chargerServices();
  startAutoRefresh();
</script>

</body>
</html>
