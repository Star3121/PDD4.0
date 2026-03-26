import express from 'express';
import path from 'path';
import storageService from '../services/storage.js';
import { Readable } from 'stream';
import nodeFetch from 'node-fetch';

const router = express.Router();

// 处理 CORS 预检请求
router.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.status(200).end();
});

const sendPlaceholderSvg = (res, text) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(
    `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" fill="#f0f0f0"/><text x="50%" y="50%" font-family="Arial" font-size="14" fill="#999" text-anchor="middle" dy=".3em">${text}</text></svg>`
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PROXY_FETCH_TAG = '[files-proxy-fetch]';
const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : nodeFetch;
const fetchCandidates = [fetchImpl, nodeFetch];
const safeDecodeUriComponent = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const pipeBodyToResponse = async (body, res) => {
  if (!body) return false;
  if (typeof body.pipe === 'function') {
    body.pipe(res);
    return true;
  }
  if (typeof Readable.fromWeb === 'function' && typeof body.getReader === 'function') {
    Readable.fromWeb(body).pipe(res);
    return true;
  }
  if (typeof body.arrayBuffer === 'function') {
    const buffer = Buffer.from(await body.arrayBuffer());
    res.end(buffer);
    return true;
  }
  return false;
};

const fetchUpstreamWithFallback = async (url) => {
  for (const candidate of fetchCandidates) {
    if (typeof candidate !== 'function') {
      continue;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await candidate(url, { signal: controller.signal });
      if (response?.ok && response.body) {
        return response;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      console.warn(`${PROXY_FETCH_TAG} ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return null;
};

const resolveFallbackImageFilename = (bucket, filename) => {
  if (bucket !== 'images' && bucket !== 'templates') return null;
  if (filename.startsWith('medium_')) return filename.slice(7);
  if (filename.startsWith('thumb_')) return filename.slice(6);
  return null;
};

const resolveImageVariant = (filename) => {
  if (filename.startsWith('medium_')) return 'medium';
  if (filename.startsWith('thumb_')) return 'thumb';
  return 'original';
};

const buildImageRecoveryPlan = (bucket, filename) => {
  const originalFilename = resolveFallbackImageFilename(bucket, filename);
  if ((bucket === 'images' || bucket === 'templates') && filename.startsWith('medium_') && originalFilename) {
    return [
      { filename, mode: 'initial-medium', waitMs: 0 },
      { filename, mode: 'retry-medium', waitMs: 1000 },
      { filename: originalFilename, mode: 'fallback-original', waitMs: 0 }
    ];
  }
  return [{ filename, mode: 'initial', waitMs: 0 }];
};

const buildFilenameCandidates = (filename) => {
  const normalized = String(filename || '').trim();
  const decoded = safeDecodeUriComponent(normalized);
  const candidates = [normalized, decoded].filter(Boolean);
  return Array.from(new Set(candidates));
};

const resolveFileResponse = async (bucket, filename, req) => {
  const access = await storageService.getFileAccess(bucket, filename);
  if (!access) return null;

  if (access.type === 'redirect') {
    const shouldProxy = bucket === 'fonts' || String(req.query.proxy || '') === '1';
    if (!shouldProxy) {
      return {
        type: 'redirect',
        url: access.url,
        filename,
        variant: resolveImageVariant(filename),
      };
    }

    const upstream = await fetchUpstreamWithFallback(access.url);
    if (!upstream) {
      return {
        type: 'redirect',
        url: access.url,
        filename,
        variant: resolveImageVariant(filename),
      };
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    return {
      type: 'stream',
      body: upstream.body,
      contentType,
      filename,
      variant: resolveImageVariant(filename),
    };
  }

  if (access.type === 'file') {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2'
    };

    return {
      type: 'file',
      path: access.path,
      contentType: mimeTypes[ext] || 'application/octet-stream',
      filename,
      variant: resolveImageVariant(filename),
    };
  }

  return null;
};

// 通用文件请求处理函数
const handleFileRequest = async (req, res, bucket, errorMessage) => {
  try {
    const { filename } = req.params;
    const filenameCandidates = buildFilenameCandidates(filename);
    if (filenameCandidates.length === 0) {
      return res.status(400).json({ error: '无效的文件名' });
    }
    const hasInvalidFilename = filenameCandidates.some((name) => name.includes('..') || name.includes('/') || name.includes('\\'));
    if (hasInvalidFilename) {
      return res.status(400).json({ error: '无效的文件名' });
    }

    let resolvedResponse = null;
    let resolvedMode = 'placeholder';
    for (const candidate of filenameCandidates) {
      const recoveryPlan = buildImageRecoveryPlan(bucket, candidate);
      for (const step of recoveryPlan) {
        if (step.waitMs > 0) {
          await sleep(step.waitMs);
        }
        resolvedResponse = await resolveFileResponse(bucket, step.filename, req);
        if (resolvedResponse) {
          resolvedMode = step.mode;
          break;
        }
      }
      if (resolvedResponse) {
        break;
      }
    }

    if (!resolvedResponse) {
      res.setHeader('X-Image-Recovery-Mode', 'placeholder');
      res.setHeader('X-Image-Served-Variant', 'placeholder');
      return sendPlaceholderSvg(res, 'Image Not Found');
    }

    res.setHeader('X-Image-Recovery-Mode', resolvedMode);
    res.setHeader('X-Image-Served-Variant', resolvedResponse.variant);
    res.setHeader('Access-Control-Expose-Headers', 'X-Image-Recovery-Mode, X-Image-Served-Variant');

    if (resolvedResponse.type === 'redirect') {
      return res.redirect(302, resolvedResponse.url);
    }

    if (resolvedResponse.type === 'stream') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Type', resolvedResponse.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      const piped = await pipeBodyToResponse(resolvedResponse.body, res);
      if (!piped) {
        throw new Error('Unsupported upstream body type');
      }
      return;
    }

    if (resolvedResponse.type === 'file') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Content-Type', resolvedResponse.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      return res.sendFile(resolvedResponse.path);
    }
  } catch (error) {
    console.error(`${errorMessage}:`, error);
    res.setHeader('X-Image-Recovery-Mode', 'placeholder');
    res.setHeader('X-Image-Served-Variant', 'placeholder');
    sendPlaceholderSvg(res, 'Error Loading Image');
  }
};

// 文件访问路由
router.get('/images/:filename', (req, res) => handleFileRequest(req, res, 'images', '文件访问失败'));
router.get('/templates/:filename', (req, res) => handleFileRequest(req, res, 'templates', '模板文件访问失败'));
router.get('/designs/:filename', (req, res) => handleFileRequest(req, res, 'designs', '设计文件访问失败'));
router.get('/fonts/:filename', (req, res) => handleFileRequest(req, res, 'fonts', '字体文件访问失败'));

export default router;
