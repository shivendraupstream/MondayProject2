const express = require('express');
const router = express.Router();

// This is the route monday's "SendGrid Template" dropdown feature will call.
// Its ONLY job: given a SendGrid API key, ask SendGrid "what templates exist?"
// and hand back a simple list.

router.post('/templates/options', async (req, res) => {
  try {
    // In the real flow, monday sends us the SendGrid key inside
    // req.body.payload.credentialsValues.<your-key-name>.accessToken
    // For now, while testing locally without monday, we'll accept the key
    // directly in the request body so you can test with curl/Postman.
    const apiKey =
      req.body?.payload?.credentialsValues?.sendgrid_connection?.accessToken ||
      req.body?.apiKey; // <-- testing shortcut, remove once monday is wired up

    if (!apiKey) {
      return res.status(400).json({ error: 'Missing SendGrid API key' });
    }

    const sgRes = await fetch('https://api.sendgrid.com/v3/templates?generations=dynamic', {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!sgRes.ok) {
      const errBody = await sgRes.text();
      return res.status(sgRes.status).json({ error: 'SendGrid request failed', detail: errBody });
    }

    const data = await sgRes.json();

    // monday expects this exact shape: an array of {title, value}
    const options = (data.templates || []).map(t => ({ title: t.name, value: t.id }));

    return res.status(200).json(options);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
