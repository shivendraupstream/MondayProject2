const express = require('express');
const router = express.Router();
const verifyMondayRequest = require('../middleware/verifyMondayRequest');

router.all('/mapping-schema', verifyMondayRequest, async (req, res) => {
  console.log('*** mapping-schema route HIT ***');
  console.log('*** method:', req.method);

  // If this is an empty reachability check, respond OK immediately
  if (req.method === 'GET' && !req.body) {
    console.log('*** Empty GET — likely a reachability check, responding 200');
    return res.status(200).json({});
  }

  try {
    const apiKey =
      req.body?.payload?.credentialsValues?.sendgrid_connection?.accessToken ||
      req.body?.apiKey;

    const templateId =
      req.body?.payload?.inboundFieldValues?.sendgrid_template ||
      req.body?.templateId;

    console.log('*** apiKey present?', !!apiKey);
    console.log('*** templateId:', templateId);

    if (!apiKey) {
      console.log('*** REJECTING: missing apiKey');
      return res.status(400).json({ error: 'Missing SendGrid API key' });
    }
    if (!templateId) {
      console.log('*** REJECTING: missing templateId');
      return res.status(400).json({ error: 'Missing templateId' });
    }

    const sgRes = await fetch(`https://api.sendgrid.com/v3/templates/${templateId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!sgRes.ok) {
      const errBody = await sgRes.text();
      return res.status(sgRes.status).json({ error: 'SendGrid request failed', detail: errBody });
    }

    const template = await sgRes.json();
    const activeVersion = (template.versions || []).find(v => v.active === 1);

    if (!activeVersion || !activeVersion.test_data) {
      return res.status(200).json({});
    }

    const testData = JSON.parse(activeVersion.test_data);

    const schema = {};
    for (const key of Object.keys(testData)) {
      schema[key] = {
        title: key,
        type: 'primitive',
        primitiveType: 'string',
        isNullable: true,
        isOptional: true,
        isArray: false
      };
    }

    return res.status(200).json(schema);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;