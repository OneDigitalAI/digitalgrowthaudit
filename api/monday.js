// /api/monday.js — Vercel Serverless Function (CommonJS)
// Maakt een lead aan in Monday.com vanuit de Digital Growth Audit

const MONDAY_API = 'https://api.monday.com/v2';
const BOARD_ID = process.env.MONDAY_BOARD_ID || '7257992066';
const TOKEN = () => process.env.MONDAY_API_TOKEN;

async function mondayQuery(query, variables) {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': TOKEN(),
      'API-Version': '2023-10',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error('Monday API: ' + JSON.stringify(json.errors));
  }
  return json.data;
}

async function getColumns() {
  const data = await mondayQuery(`
    query {
      boards(ids: [${BOARD_ID}]) {
        columns { id title type }
        groups { id title }
      }
    }
  `);
  const board = data.boards[0];
  const colMap = {};
  for (const col of board.columns) {
    colMap[col.title.toLowerCase().trim()] = { id: col.id, type: col.type };
  }
  const group = board.groups.find(g =>
    g.title.toLowerCase().includes('nieuw') ||
    g.title.toLowerCase().includes('new')
  ) || board.groups[0];
  return { colMap, groupId: group ? group.id : null };
}

function buildColumnValues(colMap, body) {
  const { company, email, phone, score, profile, revenue } = body;
  const cv = {};

  const set = (names, value) => {
    for (const n of names) {
      if (colMap[n]) { cv[colMap[n].id] = value; return; }
    }
  };

  // Status → Nieuwe lead
  set(['status'], { label: 'Nieuwe lead' });

  // Bedrijf
  set(['bedrijf', 'company', 'organisatie'], company || '');

  // E-mail
  if (email) set(['e-mail', 'email', 'mail'], { email, text: email });

  // Telefoon
  if (phone) {
    const clean = phone.replace(/\s/g, '');
    set(['telefoon', 'phone', 'gsm', 'tel'], { phone: clean, countryShortName: 'BE' });
  }

  // Bron → voeg "Digital Growth Audit" handmatig toe als label in Monday
  // of uncomment onderstaande lijn nadat je het label hebt aangemaakt:
  // set(['bron', 'source', 'kanaal'], { label: 'Digital Growth Audit' });

  // Reacties = long_text kolom — audit resultaten direct in de kolom
  const notes = buildNotes(body);
  set(['reacties', 'long_text', 'notities', 'notes', 'tekst'], { text: notes });

  return cv;
}

function buildNotes(body) {
  const { firstname, lastname, company, email, phone,
          score, profile, revenue, toplineGrowth, ebitdaImpact,
          blockScores, answers } = body;

  const date = new Date().toLocaleDateString('nl-BE');
  const qLabels = [
    'Hoe komen jullie aan nieuwe klanten?',
    'Closing rate en verkoopproces?',
    'Klantbehoud en upsell?',
    'Marketing ROI inzicht?',
    'Automatisering en AI?',
    'Beslissingen op basis van data?',
    'Online vindbaarheid?',
    'Schaalbaarheid zonder extra mensen?',
  ];
  const scoreLbls = { 1: 'Geen systeem', 2: 'Rudimentair', 3: 'Gedeeltelijk', 4: 'Volledig uitgebouwd' };

  let txt = `📊 Digital Growth Audit — ${date}\n`;
  txt += `─────────────────────────────\n`;
  txt += `Naam: ${firstname} ${lastname}\n`;
  txt += `Bedrijf: ${company}\n`;
  txt += `E-mail: ${email}\n`;
  if (phone) txt += `Telefoon: ${phone}\n`;
  txt += `Omzetcategorie: ${revenue}\n\n`;
  txt += `🏆 Score: ${score}/100 — ${profile}\n`;
  txt += `📈 Omzetgroeipotentieel: ${toplineGrowth}\n`;
  txt += `💰 EBITDA-verbeterpotentieel: ${ebitdaImpact}\n\n`;

  if (blockScores && blockScores.length) {
    txt += `Score per blok:\n`;
    blockScores.forEach(b => {
      const pct = Math.round((b.score / b.max) * 100);
      txt += `  ${b.icon || '•'} ${b.name}: ${pct}%\n`;
    });
    txt += '\n';
  }

  if (answers && Object.keys(answers).length) {
    txt += `Antwoorden:\n`;
    Object.entries(answers).forEach(([q, s]) => {
      const idx = parseInt(q) - 1;
      txt += `  V${q}: ${qLabels[idx] || `Vraag ${q}`}\n`;
      txt += `       → ${scoreLbls[s] || s}/4\n`;
    });
  }

  return txt;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!TOKEN()) {
    console.error('[Monday] MONDAY_API_TOKEN ontbreekt');
    return res.status(500).json({ error: 'MONDAY_API_TOKEN niet ingesteld in Vercel Environment Variables' });
  }

  const body = req.body || {};
  const { firstname, lastname, email } = body;
  if (!firstname || !email) {
    return res.status(400).json({ error: 'Naam en e-mail zijn verplicht' });
  }

  try {
    // 1. Kolommen ophalen
    const { colMap, groupId } = await getColumns();
    console.log('[Monday] Gevonden kolommen:', Object.keys(colMap).join(', '));

    // 2. Column values bouwen
    const cv = buildColumnValues(colMap, body);
    console.log('[Monday] Column values:', JSON.stringify(cv));

    // 3. Item aanmaken
    const itemName = `${firstname} ${lastname}`;
    const createData = await mondayQuery(`
      mutation($boardId: ID!, $groupId: String, $name: String!, $cv: JSON!) {
        create_item(
          board_id: $boardId,
          group_id: $groupId,
          item_name: $name,
          column_values: $cv
        ) { id }
      }
    `, {
      boardId: String(BOARD_ID),
      groupId: groupId || null,
      name: itemName,
      cv: JSON.stringify(cv),
    });

    const itemId = createData?.create_item?.id;
    console.log('[Monday] Item aangemaakt:', itemId);
    if (!itemId) throw new Error('Item ID ontbreekt in response');

    return res.status(200).json({ success: true, itemId });

  } catch (err) {
    console.error('[Monday] Fout:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
