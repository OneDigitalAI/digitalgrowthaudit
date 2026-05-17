/**
 * /api/mailchimp.js — Vercel Serverless Function
 *
 * Waarom dit nodig is:
 * Mailchimp's API staat geen directe browser-aanroepen toe (CORS-blokkade).
 * Deze serverless function werkt als proxy: de browser stuurt naar /api/mailchimp,
 * Vercel stuurt het door naar Mailchimp met de geheime API key.
 *
 * Setup:
 * 1. Maak een .env.local bestand aan in de root van het project:
 *      MAILCHIMP_API_KEY=jouw-key-hier
 *      MAILCHIMP_AUDIENCE_ID=jouw-audience-id
 *      MAILCHIMP_DC=us21
 * 2. In Vercel dashboard → Settings → Environment Variables: voeg dezelfde toe
 * 3. Deploy → klaar
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { MAILCHIMP_API_KEY, MAILCHIMP_AUDIENCE_ID, MAILCHIMP_DC } = process.env;

  if (!MAILCHIMP_API_KEY || !MAILCHIMP_AUDIENCE_ID || !MAILCHIMP_DC) {
    console.error('Mailchimp env vars ontbreken');
    return res.status(500).json({ error: 'Mailchimp niet geconfigureerd' });
  }

  const body = req.body;
  const { email_address, status, merge_fields, tags, audit_data } = body;

  try {
    const baseUrl = `https://${MAILCHIMP_DC}.api.mailchimp.com/3.0`;
    const authHeader = 'Basic ' + Buffer.from(`anystring:${MAILCHIMP_API_KEY}`).toString('base64');

    // 1. Voeg contact toe of update bestaand
    const memberResp = await fetch(
      `${baseUrl}/lists/${MAILCHIMP_AUDIENCE_ID}/members`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address,
          status: status || 'subscribed',
          merge_fields: merge_fields || {},
          // Sla audit data op als merge fields (voeg deze toe in Mailchimp Audience → Merge Fields)
          // SCORE, PROFIEL, OMZET, GROEI, EBITDA
        }),
      }
    );

    const memberData = await memberResp.json();

    if (memberResp.status >= 400 && memberData.title !== 'Member Exists') {
      throw new Error(`Mailchimp member error: ${memberData.detail || memberData.title}`);
    }

    // 2. Voeg tags toe
    if (tags && tags.length > 0) {
      const emailHash = memberData.id || Buffer.from(email_address.toLowerCase()).toString('hex');

      // Gebruik de member ID uit de response of bereken MD5 hash
      const subscriberHash = memberResp.status === 200
        ? memberData.id
        : require('crypto').createHash('md5').update(email_address.toLowerCase()).digest('hex');

      await fetch(
        `${baseUrl}/lists/${MAILCHIMP_AUDIENCE_ID}/members/${subscriberHash}/tags`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tags: tags.map(name => ({ name, status: 'active' })),
          }),
        }
      );
    }

    // 3. Trigger automation (optioneel — activeer een Mailchimp Journey die start bij deze tag)
    // Dit vereist een Mailchimp Customer Journey geconfigureerd in jullie account

    return res.status(200).json({
      success: true,
      message: 'Contact toegevoegd aan Mailchimp',
    });

  } catch (err) {
    console.error('Mailchimp error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
