import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { createApiRouter } from './src/api.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.get('/vendor/supabase.js', (_req, res) => {
  res.sendFile(path.join(projectDirectory, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'));
});
app.use('/api', createApiRouter());
app.use(express.static(path.join(projectDirectory, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'PDF files must be 10 MB or smaller.' });
  }

  if (err?.name === 'MulterError') {
    return res.status(400).json({ error: 'The uploaded file could not be processed.' });
  }

  console.error('Request error:', err?.message || 'Unknown error');
  return res.status(500).json({ error: 'The request could not be completed.' });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Synapse AI is available at http://localhost:${port}`);
  });
}

export default app;
