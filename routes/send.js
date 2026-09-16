const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const verifyMondayRequest = require('../middleware/verifyMondayRequest');

const MONDAY_APP_ID = process.env.MONDAY_APP_ID;
const MONDAY_SIGNING_SECRET = process.env.MONDAY_SIGNING_SECRET;

function signCallbackToken() {
  const token = jwt.sign({ appId: MONDAY_APP_ID }, MONDAY_SIGNING_SECRET);
  console.log('*** CALLBACK JWT PAYLOAD:', JSON.stringify(jwt.decode(token)));
  return token;
}

async function reportSuccess(callbackUrl, outputFields) {
  const res = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: signCallbackToken()
    },
    body: JSON.stringify({ success: true, outputFields })
  });
  const text = await res.text();
  console.log('*** CALLBACK RESPONSE STATUS:', res.status);
  console.log('*** CALLBACK RESPONSE HEADERS:', JSON.stringify([...res.headers.entries()]));
  console.log('*** CALLBACK RESPONSE BODY:', text);
}

async function reportFailure(callbackUrl, message) {
  const res = await fetch(callbackUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: signCallbackToken()
    },
    body: JSON.stringify({
      success: false,
      severityCode: 4000,
      runtimeErrorDescription: message,
      notificationErrorTitle: 'SendGrid send failed',
      notificationErrorDescription: message
    })
  });
  const text = await res.text();
  console.log('*** CALLBACK RESPONSE STATUS:', res.status);
  console.log('*** CALLBACK RESPONSE HEADERS:', JSON.stringify([...res.headers.entries()]));
  console.log('*** CALLBACK RESPONSE BODY:', text);
}

router.post('/send-template-email', verifyMondayRequest, async (req, res) => {
  const payload = req.body?.payload || req.body;
  const callbackUrl = payload?.callbackUrl;
  const actionUuid = req.body?.runtimeMetadata?.actionUuid;

  const apiKey =
    payload?.credentialsValues?.sendgrid_connection?.accessToken ||
    req.body?.apiKey;

  const inputFields = payload?.inputFields || req.body;

  const recipientEmail = inputFields.recipientEmail;
  const templateId = inputFields.sendgrid_template || inputFields.templateId;
  const fromAddress = inputFields.fromAddress || process.env.SENDGRID_FROM_ADDRESS;

  if (!apiKey) return res.status(400).json({ error: 'Missing SendGrid API key' });
  if (!recipientEmail) return res.status(400).json({ error: 'Missing recipientEmail' });
  if (!templateId) return res.status(400).json({ error: 'Missing templateId' });
  if (!fromAddress) return res.status(400).json({ error: 'Missing fromAddress (must be a SendGrid-verified sender)' });

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

  // Ack the trigger immediately, matching monday's documented shape
  res.status(200).json({
    status: 'received',
    message: 'Action has been triggered.',
    actionUuid
  });

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

  try {
    const sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sendGridPayload)
    });

    console.log('*** SENDGRID RESPONSE STATUS:', sgRes.status, sgRes.statusText);

    if (!sgRes.ok) {
      const errBody = await sgRes.text();
      console.log('*** SENDGRID ERROR BODY:', errBody);
      if (callbackUrl) await reportFailure(callbackUrl, `SendGrid send failed: ${errBody}`);
      return;
    }

    const messageId = sgRes.headers.get('x-message-id');
    console.log('*** SENDGRID SUCCESS message-id:', messageId);

    if (callbackUrl) {
      await reportSuccess(callbackUrl, {
        success: true,
        sentAt: new Date().toISOString(),
        sendgridMessageId: messageId
      });
    } else {
      console.warn('*** No callbackUrl present, could not report result to monday');
    }
  } catch (err) {
    console.error(err);
    if (callbackUrl) await reportFailure(callbackUrl, err.message);
  }
});

module.exports = router;
