import express from 'express';

const router = express.Router();
let db;

router.get('/', async (_req, res) => {
  if (!db || typeof db.query !== 'function') {
    return res.json([]);
  }

  const rows = await db.query(
    `SELECT id, name, postscript_name, family, subfamily, storage_url, uploaded_at, hash
     FROM custom_fonts
     ORDER BY uploaded_at DESC`
  );

  return res.json(
    rows.map((row) => ({
      fontId: row.id,
      name: row.name,
      postscriptName: row.postscript_name,
      family: row.family,
      subfamily: row.subfamily,
      storageUrl: row.storage_url,
      uploadedAt: row.uploaded_at,
      hash: row.hash,
    }))
  );
});

export function setDatabase(database) {
  db = database;
}

export default router;
