require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

// GLOBAL LOGGER — catches every request, any path
app.use((req, res, next) => {
  console.log('========================================');
  console.log(`>>> INCOMING REQUEST: ${req.method} ${req.originalUrl}`);
  console.log('>>> Body:', JSON.stringify(req.body, null, 2));
  console.log('========================================');
  next();
});

// Route 1: Template dropdown — "what templates does this SendGrid account have?"
app.use('/sendgrid', require('./routes/templates'));

// Route 2: Field mapping — "what are the blanks in this specific template?"
app.use('/sendgrid', require('./routes/mapping'));

// Route 3: Send — "actually send the email"
app.use('/sendgrid', require('./routes/send'));

// A simple homepage so you can confirm the server is alive at all
app.get('/', (req, res) => {
  res.send('SendGrid <-> monday server is running. Try POST /sendgrid/templates/options');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});