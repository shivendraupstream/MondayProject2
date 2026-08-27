const express = require('express');
const router = express.Router();
const verifyMondayRequest = require('../middleware/verifyMondayRequest');

router.post('/send-template-email', verifyMondayRequest, async (req, res) => {
  try {
    const apiKey =
      req.body?.payload?.credentialsValues?.sendgrid_connection?.accessToken ||
      req.body?.apiKey;

    const inputFields = req.body?.payload?.inputFields || req.body;

    const recipientEmail = inputFields.recipientEmail;
    const templateId = inputFields.sendgrid_template || inputFields.templateId;

    let mappingObject = {};

    if (inputFields.sendgrid_field_mapping && Object.keys(inputFields.sendgrid_field_mapping).length > 0) {
      mappingObject = inputFields.sendgrid_field_mapping;
    } else if (inputFields.templateVariablesJson) {
      try {
        mappingObject = JSON.parse(inputFields.templateVariablesJson);
      } catch (err) {
        return res.status(400).json({
          error: 'Invalid JSON in Template Variables field',
          detail: err.message
        });
      }
    } else if (inputFields.mappingObject) {
      mappingObject = inputFields.mappingObject;
    }

    const fromAddress = inputFields.fromAddress || process.env.SENDGRID_FROM_ADDRESS;

    if (!apiKey) return res.status(400).json({ error: 'Missing SendGrid API key' });
    if (!recipientEmail) return res.status(400).json({ error: 'Missing recipientEmail' });
    if (!templateId) return res.status(400).json({ error: 'Missing templateId' });
    if (!fromAddress) return res.status(400).json({ error: 'Missing fromAddress (must be a SendGrid-verified sender)' });

    const sendGridPayload = {
      template_id: templateId,
      personalizations: [
        {
          to: [{ email: recipientEmail }],
          dynamic_template_data: mappingObject
        }
      ],
      from: { email: fromAddress }
    };

    console.log('*** EXACT PAYLOAD SENT TO SENDGRID:');
    console.log(JSON.stringify(sendGridPayload, null, 2));

    const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sendGridPayload)
    });

    if (!sgRes.ok) {
      const errBody = await sgRes.text();
      return res.status(422).json({ error: 'SendGrid send failed', detail: errBody });
    }

    const messageId = sgRes.headers.get('x-message-id');

    return res.status(200).json({
      outputFields: {
        success: true,
        sentAt: new Date().toISOString(),
        sendgridMessageId: messageId
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;