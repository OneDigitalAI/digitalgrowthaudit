/**
 * /api/monday.js — Vercel Serverless Function
 * Ontvangt lead data van de Digital Growth Audit en maakt een item aan in Monday.com.
 *
 * Vereiste Environment Variables in Vercel:
 *   MONDAY_API_TOKEN   → jouw Monday.com API token
 *   MONDAY_BOARD_ID    → 7257992066
 */

const MONDAY_API = 'https://api.monday.com/v2';

async function mondayQuery(token, query, variables = {}) {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
      'API-Version': '2023-10',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/**
 * Haalt kolom-IDs op en mapt ze op kolomnaam.
 * Zo werkt de code ongeacht de exacte IDs in het board.
 */
async function getColumnMap(token, boardId) {
  const data = await mondayQuery(token, `
    query($boardId: [ID!]!) {
      boards(ids: $boardId) {
        columns { id title type }
        groups { id title }
      }
    }
  `, { boardId: [String(boardId)] });

  const cols = data.boards[0].columns;
  const groups = data.boards[0].groups;
  const map = {};

  for (const col of cols) {
    // Map op exacte titel (lowercase) én op type als fallback
    map[col.title.toLowerCase()] = { id: col.id, type: col.type };
    if (!map[`_type_${col.type}`]) {
      map[`_type_${col.type}`] = { id: col.id, type: col.type };
    }
  }

  // Zoek de "Nieuwe leads" groep, of neem de eerste
  const targetGroup = groups.find(g =>
    g.title.toLowerCase().includes('nieuwe') ||
    g.title.toLowerCase().includes('new')
  ) || groups[0];

  return { map, groupId: targetGroup?.id };
}

/**
 * Formatteer de audit antwoorden als gestructureerde tekst voor de Reacties kolom.
 */
function formatAuditNotes(body) {
  const {
    firstname, lastname, company, phone, email,
    score, profile, revenue, toplineGrowth, ebitdaImpact,
    blockScores, answers
  } = body;

  const date = new Date().toLocaleDateString('nl-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  const blockLabels = [
    'Commerciële motor',
    'Operationele marge',
    'Digitale groeipositie',
  ];

  let notes = `📊 DIGITAL GROWTH AUDIT — ${date}\n`;
  notes += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  notes += `👤 ${firstname} ${lastname} — ${company}\n`;
  notes += `📧 ${email}\n`;
  if (phone) notes += `📱 ${phone}\n`;
  notes += `💰 Omzetcategorie: ${revenue}\n\n`;
  notes += `🏆 SCORE: ${score}/100 — ${profile}\n`;
  notes += `📈 Top-line groeipotentieel: ${toplineGrowth}\n`;
  notes += `💡 EBITDA-verbeterpotentieel: ${ebitdaImpact}\n\n`;

  if (blockScores && blockScores.length > 0) {
    notes += `SCORE PER BLOK:\n`;
    blockScores.forEach((b, i) => {
      const pct = Math.round((b.score / b.max) * 100);
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      notes += `  ${b.icon || '•'} ${b.name}: ${pct}% ${bar}\n`;
    });
    notes += '\n';
  }

  if (answers) {
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
    const scoreLbls = ['', 'Geen systeem', 'Rudimentair', 'Gedeeltelijk', 'Volledig uitgebouwd'];
    notes += `ANTWOORDEN PER VRAAG:\n`;
    Object.entries(answers).forEach(([q, s]) => {
      const idx = parseInt(q) - 1;
      notes += `  V${q}: ${qLabels[idx] || `Vraag ${q}`} → ${scoreLbls[s] || s}/4\n`;
    });
  }

  return notes;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.MONDAY_API_TOKEN;
  const boardId = process.env.MONDAY_BOARD_ID || '7257992066';

  if (!token) {
    console.error('MONDAY_API_TOKEN ontbreekt in environment variables');
    return res.status(500).json({ error: 'Monday.com niet geconfigureerd' });
  }

  const body = req.body;
  const { firstname, lastname, company, email, phone, score, profile, revenue } = body;

  if (!firstname || !email) {
    return res.status(400).json({ error: 'Naam en e-mail zijn verplicht' });
  }

  try {
    // 1. Haal kolom-IDs op
    const { map, groupId } = await getColumnMap(token, boardId);

    // 2. Bouw column values op basis van kolomnamen
    const colValues = {};

    // Status → "Nieuwe lead"
    const statusCol = map['status'];
    if (statusCol) colValues[statusCol.id] = { label: 'Nieuwe lead' };

    // Bedrijf
    const companyCol = map['bedrijf'] || map['company'];
    if (companyCol) colValues[companyCol.id] = company || '';

    // E-mail
    const emailCol = map['e-mail'] || map['email'];
    if (emailCol) colValues[emailCol.id] = { email: email, text: email };

    // Telefoon
    const phoneCol = map['telefoon'] || map['phone'];
    if (phoneCol && phone) {
      const cleanPhone = phone.replace(/\s/g, '');
      colValues[phoneCol.id] = { phone: cleanPhone, countryShortName: 'BE' };
    }

    // Bron → "Digital Growth Audit"
    const bronCol = map['bron'] || map['source'];
    if (bronCol) colValues[bronCol.id] = { label: 'Digital Growth Audit' };

    // Score (als tekst of nummer)
    const scoreCol = map['score'] || map['audit score'];
    if (scoreCol) {
      colValues[scoreCol.id] = scoreCol.type === 'numbers'
        ? String(score)
        : String(score);
    }

    // 3. Maak item aan
    const itemName = `${firstname} ${lastname}`;
    const colValuesStr = JSON.stringify(colValues);

    const createData = await mondayQuery(token, `
      mutation($boardId: ID!, $groupId: String, $name: String!, $colValues: JSON!) {
        create_item(
          board_id: $boardId,
          group_id: $groupId,
          item_name: $name,
          column_values: $colValues
        ) { id }
      }
    `, {
      boardId: String(boardId),
      groupId: groupId || null,
      name: itemName,
      colValues: colValuesStr,
    });

    const itemId = createData?.create_item?.id;
    if (!itemId) throw new Error('Item aanmaken mislukt');

    // 4. Voeg audit details toe als update (comment/reactie)
    const notes = formatAuditNotes(body);

    await mondayQuery(token, `
      mutation($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) { id }
      }
    `, {
      itemId: String(itemId),
      body: notes,
    });

    return res.status(200).json({ success: true, itemId });

  } catch (err) {
    console.error('Monday.com fout:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
