import { Router } from 'express';
import multer from 'multer';
import { requireRole, sessionUser } from '../auth/middleware';
import { isUserFacingError } from '../http/errors';
import {
  listBrands,
  getBrand,
  createBrand,
  updateBrand,
  setBrandActive,
} from '../brands/repository';
import { isCloudinaryConfigured, publicImageUrl, uploadPublicImage } from '../files/cloudinary';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

export const brandsRouter = Router();

function brandParam(req: import('express').Request): string {
  const id = req.params.brandId;
  return Array.isArray(id) ? id[0] : String(id);
}

/**
 * Public delivery of a brand logo. Looks up only that brand's logo_public_id
 * and fetches Cloudinary's unsigned `type: upload` URL — never authenticated
 * assets, never an arbitrary public id.
 */
brandsRouter.get('/:brandId/logo', async (req, res, next) => {
  try {
    const brand = await getBrand(brandParam(req));
    if (!brand?.logo_public_id) return res.status(404).end();
    if (!isCloudinaryConfigured()) return res.status(404).end();
    const remote = await fetch(publicImageUrl(brand.logo_public_id));
    if (!remote.ok || !remote.body) return res.status(404).end();
    const contentType = remote.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    const length = remote.headers.get('content-length');
    if (length) res.setHeader('content-length', length);
    res.setHeader('cache-control', 'public, max-age=3600');
    const reader = remote.body.getReader();
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

brandsRouter.use(requireRole('admin'));

brandsRouter.get('/', async (req, res, next) => {
  try {
    const brands = await listBrands(true);
    res.render('brands/list', { title: 'Brands', brands, user: sessionUser(req) });
  } catch (err) {
    next(err);
  }
});

brandsRouter.get('/new', (req, res) => {
  res.render('brands/form', {
    title: 'Add brand',
    brand: null,
    error: null,
    user: sessionUser(req),
  });
});

brandsRouter.post('/new', upload.single('logo'), async (req, res, next) => {
  try {
    const parsed = parseBrandForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('brands/form', {
        title: 'Add brand',
        brand: req.body,
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    let logoPublicId: string | null = null;
    if (req.file) {
      if (!isCloudinaryConfigured()) {
        return res.status(400).render('brands/form', {
          title: 'Add brand',
          brand: req.body,
          error: 'Logo upload needs Cloudinary configured.',
          user: sessionUser(req),
        });
      }
      const uploaded = await uploadPublicImage(req.file.buffer, req.file.originalname);
      logoPublicId = uploaded.publicId;
    }
    await createBrand({ ...parsed, logoPublicId });
    res.redirect('/brands');
  } catch (err) {
    if (!isUserFacingError(err)) return next(err);
    return res.status(400).render('brands/form', {
      title: 'Add brand',
      brand: req.body,
      error: err.message,
      user: sessionUser(req),
    });
  }
});

brandsRouter.get('/:brandId/edit', async (req, res, next) => {
  try {
    const brand = await getBrand(brandParam(req));
    if (!brand) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    res.render('brands/form', {
      title: `Edit ${brand.name}`,
      brand,
      error: null,
      user: sessionUser(req),
    });
  } catch (err) {
    next(err);
  }
});

brandsRouter.post('/:brandId/edit', upload.single('logo'), async (req, res, next) => {
  try {
    const brand = await getBrand(brandParam(req));
    if (!brand) {
      return res.status(404).render('not-found', { title: 'Not found', user: sessionUser(req) });
    }
    const parsed = parseBrandForm(req.body);
    if ('error' in parsed) {
      return res.status(400).render('brands/form', {
        title: `Edit ${brand.name}`,
        brand: { ...brand, ...req.body },
        error: parsed.error,
        user: sessionUser(req),
      });
    }
    let logoPublicId: string | null = null;
    if (req.file) {
      if (!isCloudinaryConfigured()) {
        return res.status(400).render('brands/form', {
          title: `Edit ${brand.name}`,
          brand: { ...brand, ...req.body },
          error: 'Logo upload needs Cloudinary configured.',
          user: sessionUser(req),
        });
      }
      const uploaded = await uploadPublicImage(req.file.buffer, req.file.originalname);
      logoPublicId = uploaded.publicId;
    }
    await updateBrand(brand.brand_id, { ...parsed, logoPublicId });
    res.redirect('/brands');
  } catch (err) {
    if (!isUserFacingError(err)) return next(err);
    return res.status(400).render('brands/form', {
      title: `Edit ${brandParam(req)}`,
      brand: req.body,
      error: err.message,
      user: sessionUser(req),
    });
  }
});

brandsRouter.post('/:brandId/deactivate', async (req, res, next) => {
  try {
    await setBrandActive(brandParam(req), false);
    res.redirect('/brands');
  } catch (err) {
    next(err);
  }
});

brandsRouter.post('/:brandId/reactivate', async (req, res, next) => {
  try {
    await setBrandActive(brandParam(req), true);
    res.redirect('/brands');
  } catch (err) {
    next(err);
  }
});

function parseBrandForm(body: Record<string, unknown>): { name: string; applyPageTitle: string } | { error: string } {
  const name = String(body.name ?? '').trim();
  const applyPageTitle = String(body.apply_page_title ?? '').trim();
  if (!name) return { error: 'Brand name is required.' };
  if (!applyPageTitle) return { error: 'Apply-page title is required.' };
  return { name, applyPageTitle };
}
