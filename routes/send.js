const express = require('express');
const router = express.Router();

// This is the "Execution URL" / "Run URL" — the route monday calls when the
// actual workflow runs and the action needs to fire for real.
// Its job: send the email through SendGrid, using the template + mapped values.

router.post('/send-template-email', async (req, res) => {
  try {
    const apiKey =
      req.body?.payload?.credentialsValues?.sendgrid_connection?.accessToken ||
      req.body?.apiKey; // <-- testing shortcut

    const inputFields = req.body?.payload?.inputFields || req.body; // <-- testing shortcut

    const recipientEmail = inputFields.recipientEmail;
    const templateId = inputFields.sendgrid_template || inputFields.templateId;
    const mappingObject = inputFields.sendgrid_field_mapping || inputFields.mappingObject || {};
    // <-- testing shortcut: lets you pass fromAddress directly in curl instead of using .env
    const fromAddress = inputFields.fromAddress || process.env.SENDGRID_FROM_ADDRESS;

    if (!apiKey) return res.status(400).json({ error: 'Missing SendGrid API key' });
    if (!recipientEmail) return res.status(400).json({ error: 'Missing recipientEmail' });
    if (!templateId) return res.status(400).json({ error: 'Missing templateId' });
    if (!fromAddress) return res.status(400).json({ error: 'Missing fromAddress (must be a SendGrid-verified sender)' });

    const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        template_id: templateId,
        personalizations: [
          {
            to: [{ email: recipientEmail }],
            dynamic_template_data: mappingObject
          }
        ],
        from: { email: fromAddress }
      })
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