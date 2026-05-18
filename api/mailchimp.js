// /api/mailchimp.js — Vercel Serverless Function (CommonJS)
// Voegt een lead toe aan Mailchimp na de Digital Growth Audit

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID, MAILCHIMP_DC } = process.env;

  if (!MAILCHIMP_API_KEY || !MAILCHIMP_AUDIENCE_ID || !MAILCHIMP_DC) {
    console.error('[Mailchimp] Env vars ontbreken:', {
      key: !!MAILCHIMP_API_KEY,
      audience: !!MAILCHIMP_AUDIENCE_ID,
      dc: !!MAILCHIMP_DC,
    });
    return res.status(500).json({ error: 'Mailchimp niet geconfigureerd' });
  }

  const { email, firstname, lastname, company, score, profile, revenue, toplineGrowth, ebitdaImpact } = req.body || {};
  if (!email) return res.status(400).json({ error: 'E-mail is verplicht' });

  const baseUrl = `https://${MAILCHIMP_DC}.api.mailchimp.com/3.0`;
  const auth = 'Basic ' + Buffer.from(`anystring:${MAILCHIMP_API_KEY}`).toString('base64');
  const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');

  try {
    // Upsert contact (aanmaken of bijwerken)
    const memberRes = await fetch(`${baseUrl}/lists/${MAILCHIMP_AUDIENCE_ID}/members/${hash}`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email_address: email,
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: firstname || '',
          LNAME: lastname || '',
          COMPANY: company || '',
          // Audit resultaten — vereist custom merge fields in Mailchimp:
          // Audience → Settings → Audience fields → Add Field (Text)
          SCORE: score ? String(score) : '',
          PROFILE: profile || '',
          TOPLINE: toplineGrowth || '',
          EBITDA: ebitdaImpact || '',
          REVENUE: revenue || '',
        },
      }),
    });

    const memberData = await memberRes.json();
    if (!memberRes.ok) {
      throw new Error(`Mailchimp: ${memberData.detail || memberData.title || memberRes.status}`);
    }
    console.log('[Mailchimp] Contact toegevoegd:', email);
    // Tag wordt toegewezen via Zapier (triggered by new Monday item)
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[Mailchimp] Fout:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
