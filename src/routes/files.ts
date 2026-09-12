import { Router } from 'express';
import { requireLogin } from '../auth/middleware';
import { pool } from '../db/pool';
import { streamAuthenticatedFile } from '../files/cloudinary';

export const filesRouter = Router();

filesRouter.get('/api/files/:applicationId/:fileKey', requireLogin, async (req, res, next) => {
  try {
    const key = req.params.fileKey;
    if (key !== 'cv' && key !== 'portfolio') {
      return res.status(404).json({ error: 'unknown file' });
    }
    const { rows } = await pool.query<{
      cv_public_id: string | null;
      cv_original_filename: string | null;
      portfolio_public_id: string | null;
      portfolio_original_filename: string | null;
    }>(
      `SELECT cv_public_id, cv_original_filename, portfolio_public_id, portfolio_original_filename
         FROM application WHERE application_id = $1`,
      [req.params.applicationId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const publicId = key === 'cv' ? rows[0].cv_public_id : rows[0].portfolio_public_id;
    const filename = key === 'cv' ? rows[0].cv_original_filename : rows[0].portfolio_original_filename;
    if (!publicId) return res.status(404).json({ error: 'no file' });

    const file = await streamAuthenticatedFile(publicId);
    if (filename) res.setHeader('content-disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    if (file.contentType) res.setHeader('content-type', file.contentType);
    if (file.contentLength) res.setHeader('content-length', file.contentLength);
    const reader = file.body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(Buffer.from(value));
      await pump();
    };
    await pump();
  } catch (err) {
    next(err);
  }
});
