import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import archiver from 'archiver';
import { Font } from 'fonteditor-core';
import * as fontkit from 'fontkit';
import { createRequire } from 'module';
import storageService from '../services/storage.js';

const router = express.Router();
const require = createRequire(import.meta.url);

// 数据库实例将从服务器注入
let db;

// 检测是否在 Vercel 环境
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 在 Vercel 环境使用 /tmp 目录，本地开发使用 uploads 目录
    const uploadPath = isVercel 
      ? '/tmp/images'
      : path.join(process.cwd(), 'uploads/images');
    
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只能上传图片文件'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

const MAX_FONT_SIZE = 15 * 1024 * 1024;
const ALLOWED_FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff2']);

const fontUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_FONT_EXTENSIONS.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('仅支持 ttf、otf、woff2 字体文件'), false);
  },
  limits: { fileSize: MAX_FONT_SIZE }
});

const sanitizeFileName = (name) => name.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_');

let ttf2woff2Converter = null;
let ttf2woff2LoadFailed = false;

const loadTtf2Woff2 = () => {
  if (ttf2woff2Converter) {
    return ttf2woff2Converter;
  }
  if (ttf2woff2LoadFailed) {
    throw new Error('当前部署环境暂不支持将 ttf/otf 转换为 woff2，请直接上传 .woff2 字体文件');
  }

  try {
    const loadedModule = require('ttf2woff2');
    ttf2woff2Converter = loadedModule?.default || loadedModule;
    return ttf2woff2Converter;
  } catch (error) {
    ttf2woff2LoadFailed = true;
    const message = String(error?.message || '');
    if (error?.code === 'ENOENT' || message.includes('ttf2woff2.wasm')) {
      throw new Error('当前部署环境缺少字体转换运行时，请直接上传 .woff2 字体文件');
    }
    throw new Error('字体转换依赖加载失败，请稍后重试');
  }
};

const extractFontFamily = (buffer, fallbackName) => {
  try {
    const parsed = fontkit.create(buffer);
    const family = parsed?.familyName || parsed?.fullName || fallbackName;
    return typeof family === 'string' && family.trim() ? family.trim() : fallbackName;
  } catch {
    return fallbackName;
  }
};

const convertToWoff2Buffer = (file) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  let outputBuffer;
  if (ext === '.woff2') {
    outputBuffer = Buffer.from(file.buffer);
  } else if (ext === '.ttf') {
    const converter = loadTtf2Woff2();
    outputBuffer = Buffer.from(converter(file.buffer));
  } else if (ext === '.otf') {
    const converter = loadTtf2Woff2();
    const ttfBuffer = Buffer.from(
      Font.create(file.buffer, { type: 'otf' }).write({ type: 'ttf' })
    );
    outputBuffer = Buffer.from(converter(ttfBuffer));
  } else {
    throw new Error('仅支持 ttf、otf、woff2 字体文件');
  }

  try {
    fontkit.create(outputBuffer);
  } catch {
    throw new Error('字体转换失败，请更换字体文件后重试');
  }

  return outputBuffer;
};

let customFontsSchemaCache = null;
const fallbackFontsRegistryPath = path.join(process.cwd(), 'temp', 'custom_fonts_registry.json');
const allowFallbackFontsRegistry = !process.env.VERCEL && process.env.NODE_ENV !== 'production';

const CUSTOM_FONT_CANDIDATE_COLUMNS = [
  'id',
  'name',
  'font_family',
  'display_name',
  'family',
  'subfamily',
  'postscript_name',
  'original_filename',
  'file_name',
  'file_url',
  'storage_url',
  'url',
  'path',
  'format',
  'size_bytes',
  'hash',
  'created_at',
  'updated_at',
  'uploaded_at'
];

const isCustomFontsTableMissingError = (error) => {
  const message = String(error?.message || '');
  return message.includes("Could not find the table 'public.custom_fonts'") || message.includes('no such table: custom_fonts');
};

const readFallbackFontsRegistry = () => {
  try {
    if (!fs.existsSync(fallbackFontsRegistryPath)) {
      return [];
    }
    const raw = fs.readFileSync(fallbackFontsRegistryPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeFallbackFontsRegistry = (fonts) => {
  const dir = path.dirname(fallbackFontsRegistryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fallbackFontsRegistryPath, JSON.stringify(fonts, null, 2), 'utf-8');
};

const getCustomFontsSchema = async () => {
  if (customFontsSchemaCache) return customFontsSchemaCache;

  try {
    await db.query('SELECT * FROM custom_fonts LIMIT 1');
  } catch (error) {
    if (isCustomFontsTableMissingError(error)) {
      if (!allowFallbackFontsRegistry) {
        throw new Error('缺少 custom_fonts 表，请先执行 Supabase 迁移 007_create_custom_fonts_table.sql');
      }
      const fallbackColumns = new Set([
        'id',
        'font_family',
        'display_name',
        'original_filename',
        'file_name',
        'file_url',
        'format',
        'size_bytes',
        'hash',
        'created_at',
        'updated_at'
      ]);
      customFontsSchemaCache = { columns: fallbackColumns, info: new Map(), useFallbackRegistry: true };
      return customFontsSchemaCache;
    }
    throw error;
  }

  const columns = new Set();
  for (const column of CUSTOM_FONT_CANDIDATE_COLUMNS) {
    try {
      await db.query(`SELECT ${column} FROM custom_fonts LIMIT 1`);
      columns.add(column);
    } catch {
    }
  }

  const info = new Map();
  customFontsSchemaCache = { columns, info, useFallbackRegistry: false };
  return customFontsSchemaCache;
};

const buildCustomFontsSelectQuery = (schema) => {
  const columns = schema.columns;
  const idExpr = columns.has('id') ? 'id' : 'NULL AS id';
  const fontFamilyExpr = columns.has('font_family')
    ? "NULLIF(font_family, '') AS font_family"
    : columns.has('name')
      ? 'name AS font_family'
      : columns.has('family')
        ? 'family AS font_family'
        : "'' AS font_family";
  const displayNameExpr = columns.has('display_name')
    ? "NULLIF(display_name, '') AS display_name"
    : columns.has('name')
      ? 'name AS display_name'
      : columns.has('font_family')
        ? 'font_family AS display_name'
        : columns.has('family')
          ? 'family AS display_name'
          : "'' AS display_name";
  const originalFilenameExpr = columns.has('original_filename') ? 'original_filename' : "'' AS original_filename";
  const fileUrlExpr = columns.has('file_url')
    ? "NULLIF(file_url, '') AS file_url"
    : columns.has('storage_url')
      ? 'storage_url AS file_url'
      : columns.has('url')
        ? 'url AS file_url'
        : columns.has('path')
          ? 'path AS file_url'
          : "'' AS file_url";
  const formatExpr = columns.has('format') ? 'format' : "'woff2' AS format";
  const sizeExpr = columns.has('size_bytes') ? 'size_bytes' : '0 AS size_bytes';
  const createdAtExpr = columns.has('created_at')
    ? 'created_at'
    : columns.has('uploaded_at')
      ? 'uploaded_at AS created_at'
      : "'' AS created_at";
  const updatedAtExpr = columns.has('updated_at')
    ? 'updated_at'
    : columns.has('uploaded_at')
      ? 'uploaded_at AS updated_at'
      : "'' AS updated_at";

  const whereParts = [];
  if (columns.has('name')) whereParts.push("COALESCE(name, '') != ''");
  else if (columns.has('font_family')) whereParts.push("COALESCE(font_family, '') != ''");
  else if (columns.has('family')) whereParts.push("COALESCE(family, '') != ''");

  if (columns.has('file_url')) whereParts.push("COALESCE(file_url, '') != ''");
  else if (columns.has('storage_url')) whereParts.push("COALESCE(storage_url, '') != ''");
  else if (columns.has('url')) whereParts.push("COALESCE(url, '') != ''");
  else if (columns.has('path')) whereParts.push("COALESCE(path, '') != ''");

  const whereClause = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';
  const orderClause = columns.has('updated_at')
    ? ' ORDER BY updated_at DESC, id DESC'
    : columns.has('uploaded_at')
      ? ' ORDER BY uploaded_at DESC, id DESC'
      : ' ORDER BY id DESC';

  return `SELECT ${idExpr}, ${fontFamilyExpr}, ${displayNameExpr}, ${originalFilenameExpr}, ${fileUrlExpr}, ${formatExpr}, ${sizeExpr}, ${createdAtExpr}, ${updatedAtExpr} FROM custom_fonts${whereClause}${orderClause}`;
};

const buildUpsertCustomFont = (schema, payload) => {
  const nowIso = new Date().toISOString();
  const columns = schema.columns;
  const insertId = null;
  const keyColumn = columns.has('name')
    ? 'name'
    : columns.has('font_family')
      ? 'font_family'
      : columns.has('family')
        ? 'family'
        : null;
  if (!keyColumn) {
    throw new Error('custom_fonts 表缺少唯一标识字段');
  }

  const insertColumns = [];
  const insertPlaceholders = [];
  const insertParams = [];
  const addInsert = (col, value) => {
    if (!columns.has(col)) return;
    insertColumns.push(col);
    insertPlaceholders.push('?');
    insertParams.push(value);
  };

  addInsert('name', payload.fontFamily);
  addInsert('font_family', payload.fontFamily);
  addInsert('display_name', payload.displayName);
  addInsert('family', payload.fontFamily);
  addInsert('subfamily', 'Regular');
  addInsert('postscript_name', payload.fontFamily);
  addInsert('original_filename', payload.originalFilename);
  addInsert('file_name', payload.fileName);
  addInsert('file_url', payload.fileUrl);
  addInsert('storage_url', payload.fileUrl);
  addInsert('url', payload.fileUrl);
  addInsert('path', payload.fileUrl);
  addInsert('format', payload.format);
  addInsert('size_bytes', payload.sizeBytes);
  addInsert('hash', payload.hash);
  addInsert('created_at', nowIso);
  addInsert('updated_at', nowIso);
  addInsert('uploaded_at', nowIso);

  const setPairs = [];
  const updateParams = [];
  const addSet = (col, value) => {
    if (!columns.has(col)) return;
    setPairs.push(`${col} = ?`);
    updateParams.push(value);
  };

  addSet('font_family', payload.fontFamily);
  addSet('display_name', payload.displayName);
  addSet('family', payload.fontFamily);
  addSet('subfamily', 'Regular');
  addSet('postscript_name', payload.fontFamily);
  addSet('original_filename', payload.originalFilename);
  addSet('file_name', payload.fileName);
  addSet('file_url', payload.fileUrl);
  addSet('storage_url', payload.fileUrl);
  addSet('url', payload.fileUrl);
  addSet('path', payload.fileUrl);
  addSet('format', payload.format);
  addSet('size_bytes', payload.sizeBytes);
  addSet('hash', payload.hash);
  addSet('updated_at', nowIso);
  addSet('uploaded_at', nowIso);

  return {
    keyColumn,
    insertId,
    insertSql: `INSERT INTO custom_fonts (${insertColumns.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`,
    insertParams,
    updateSql: setPairs.length ? `UPDATE custom_fonts SET ${setPairs.join(', ')} WHERE ${keyColumn} = ?` : null,
    updateParams: [...updateParams, payload.fontFamily],
  };
};

// 上传图片（兼容字段名 'image' 与 'file'）
router.post('/image', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  try {
    const files = req.files || {};
    const imageFile = (Array.isArray(files?.image) && files.image[0]) || (Array.isArray(files?.file) && files.file[0]);

    if (!imageFile) {
      return res.status(400).json({ error: '请上传图片文件' });
    }

    // 上传到存储服务（自动处理多级缩略图 + 适配 S3/Supabase/Local）
    await storageService.uploadProcessedImage('images', imageFile.filename, imageFile.path, imageFile.mimetype);

    // 统一使用 /api/files 路径
    const imagePath = `/api/files/images/${imageFile.filename}`;
    
    res.json({ 
      message: '图片上传成功',
      imagePath: imagePath,
      filename: imageFile.filename
    });
  } catch (error) {
    console.error('图片上传失败:', error);
    res.status(500).json({ error: '图片上传失败' });
  }
});

const fontUploadMiddleware = (req, res, next) => {
  fontUpload.fields([{ name: 'font', maxCount: 1 }, { name: 'file', maxCount: 1 }])(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: '字体文件不能超过15MB' });
      return;
    }
    res.status(400).json({ error: err?.message || '字体上传失败' });
  });
};

router.post('/font', fontUploadMiddleware, async (req, res) => {
  try {
    const files = req.files || {};
    const fontFile = (Array.isArray(files?.font) && files.font[0]) || (Array.isArray(files?.file) && files.file[0]);
    if (!fontFile) {
      return res.status(400).json({ error: '请上传字体文件' });
    }

    const originalName = fontFile.originalname || 'font.ttf';
    const fallbackName = path.parse(originalName).name || 'CustomFont';
    const extractedFamily = extractFontFamily(fontFile.buffer, fallbackName);
    const normalizedFamily = typeof extractedFamily === 'string' ? extractedFamily.trim() : '';
    const fontFamily = normalizedFamily || fallbackName || 'CustomFont';
    const safeFamily = sanitizeFileName(fontFamily) || 'CustomFont';
    const uniqueName = `${Date.now()}-${safeFamily}-${crypto.randomUUID().slice(0, 8)}.woff2`;
    const woff2Buffer = convertToWoff2Buffer(fontFile);
    await storageService.uploadFile('fonts', uniqueName, woff2Buffer, 'font/woff2');

    const fileUrl = `/api/files/fonts/${uniqueName}`;
    const schema = await getCustomFontsSchema();
    const hash = crypto.createHash('sha256').update(woff2Buffer).digest('hex');
    const nowIso = new Date().toISOString();

    if (schema.useFallbackRegistry) {
      const fonts = readFallbackFontsRegistry();
      const existingIndex = fonts.findIndex((item) => String(item.font_family || '').toLowerCase() === String(fontFamily).toLowerCase());
      if (existingIndex >= 0) {
        const existing = fonts[existingIndex];
        const previousFileName = existing.file_name || (typeof existing.file_url === 'string' ? existing.file_url.split('/').pop() : null);
        if (previousFileName && previousFileName !== uniqueName) {
          await storageService.deleteFile('fonts', previousFileName);
        }
        const updated = {
          ...existing,
          font_family: fontFamily,
          display_name: fontFamily,
          original_filename: originalName,
          file_name: uniqueName,
          file_url: fileUrl,
          format: 'woff2',
          size_bytes: woff2Buffer.byteLength,
          hash,
          updated_at: nowIso
        };
        fonts[existingIndex] = updated;
        writeFallbackFontsRegistry(fonts);
        return res.json({
          message: '字体上传成功',
          font: {
            id: updated.id,
            font_family: updated.font_family,
            display_name: updated.display_name,
            file_url: updated.file_url,
            format: updated.format,
            size_bytes: updated.size_bytes
          }
        });
      }

      const inserted = {
        id: crypto.randomUUID(),
        font_family: fontFamily,
        display_name: fontFamily,
        original_filename: originalName,
        file_name: uniqueName,
        file_url: fileUrl,
        format: 'woff2',
        size_bytes: woff2Buffer.byteLength,
        hash,
        created_at: nowIso,
        updated_at: nowIso
      };
      fonts.push(inserted);
      writeFallbackFontsRegistry(fonts);
      return res.json({
        message: '字体上传成功',
        font: {
          id: inserted.id,
          font_family: inserted.font_family,
          display_name: inserted.display_name,
          file_url: inserted.file_url,
          format: inserted.format,
          size_bytes: inserted.size_bytes
        }
      });
    }

    const upsert = buildUpsertCustomFont(schema, {
      fontFamily,
      displayName: fontFamily,
      originalFilename: originalName,
      fileName: uniqueName,
      fileUrl,
      format: 'woff2',
      sizeBytes: woff2Buffer.byteLength,
      hash,
    });

    const existingRows = await db.query(`SELECT * FROM custom_fonts WHERE ${upsert.keyColumn} = ? LIMIT 1`, [fontFamily]);
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const previousUrl = existing.file_url || existing.storage_url || existing.url || existing.path || '';
      const previousFileName = existing.file_name || (typeof previousUrl === 'string' ? previousUrl.split('/').pop() : null);
      if (previousFileName && typeof previousFileName === 'string' && previousFileName !== uniqueName) {
        await storageService.deleteFile('fonts', previousFileName);
      }
      if (upsert.updateSql) {
        await db.run(upsert.updateSql, upsert.updateParams);
      }
      return res.json({
        message: '字体上传成功',
        font: {
          id: existing.id,
          font_family: fontFamily,
          display_name: fontFamily,
          file_url: fileUrl,
          format: 'woff2',
          size_bytes: woff2Buffer.byteLength
        }
      });
    }

    const insertResult = await db.run(upsert.insertSql, upsert.insertParams);

    res.json({
      message: '字体上传成功',
      font: {
        id: upsert.insertId || insertResult.id,
        font_family: fontFamily,
        display_name: fontFamily,
        file_url: fileUrl,
        format: 'woff2',
        size_bytes: woff2Buffer.byteLength
      }
    });
  } catch (error) {
    console.error('字体上传失败:', error);
    res.status(500).json({ error: error?.message || '字体上传失败' });
  }
});

router.get('/fonts', async (req, res) => {
  try {
    const schema = await getCustomFontsSchema();
    if (schema.useFallbackRegistry) {
      const fonts = readFallbackFontsRegistry()
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        .map((item) => ({
          id: item.id,
          font_family: item.font_family,
          display_name: item.display_name,
          original_filename: item.original_filename,
          file_url: item.file_url,
          format: item.format || 'woff2',
          size_bytes: Number(item.size_bytes || 0),
          created_at: item.created_at || '',
          updated_at: item.updated_at || ''
        }));
      return res.json(fonts);
    }
    const rows = await db.query('SELECT * FROM custom_fonts ORDER BY updated_at DESC, id DESC');
    const fonts = rows
      .map((item) => ({
        id: item.id ?? null,
        font_family: item.font_family || item.name || item.family || '',
        display_name: item.display_name || item.name || item.font_family || item.family || '',
        original_filename: item.original_filename || '',
        file_url: item.file_url || item.storage_url || item.url || item.path || '',
        format: item.format || 'woff2',
        size_bytes: Number(item.size_bytes || 0),
        created_at: item.created_at || item.uploaded_at || '',
        updated_at: item.updated_at || item.uploaded_at || ''
      }))
      .filter((item) => item.font_family && item.file_url);
    res.json(fonts);
  } catch (error) {
    console.error('获取字体列表失败:', error);
    res.status(500).json({ error: '获取字体列表失败' });
  }
});

// 导出单个订单
router.get('/export/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // 获取订单信息
    const orders = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (orders.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    const order = orders[0];
    
    // 获取订单的设计
    const designs = await db.query('SELECT * FROM designs WHERE order_id = ?', [orderId]);
    
    // 创建临时目录
    const tempDir = path.join(process.cwd(), 'temp', `export_${orderId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // 创建订单信息文件
    const orderInfo = {
      order_number: order.order_number,
      customer_name: order.customer_name,
      phone: order.phone,
      address: order.address,
      product_specs: order.product_specs,
      created_at: order.created_at,
      designs: designs.map(design => ({
        name: design.name,
        width: design.width,
        height: design.height,
        created_at: design.created_at
      }))
    };
    
    fs.writeFileSync(
      path.join(tempDir, 'order_info.json'),
      JSON.stringify(orderInfo, null, 2)
    );
    
    // 复制设计预览图
    for (const design of designs) {
      if (design.preview_path) {
        const fileName = path.basename(design.preview_path);
        try {
          await storageService.downloadFile(
            'designs',
            fileName,
            path.join(tempDir, fileName)
          );
        } catch (error) {
          console.error(`导出时下载设计图失败 [${fileName}]:`, error);
          // 继续执行，不中断导出，但可能导致导出的文件夹中缺少该图片
        }
      }
    }
    
    // 创建压缩文件
    const zipFileName = `order_${order.order_number}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    
    // 添加文件到压缩包
    archive.directory(tempDir, false);
    
    // 清理临时目录
    archive.on('end', () => {
      setTimeout(() => {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }, 5000);
    });
    
    await archive.finalize();
    
  } catch (error) {
    console.error('导出订单失败:', error);
    res.status(500).json({ error: '导出订单失败' });
  }
});

// 批量导出订单
router.post('/export/batch', async (req, res) => {
  try {
    const { orderIds } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: '请选择要导出的订单' });
    }
    
    // 创建临时目录
    const tempDir = path.join(process.cwd(), 'temp', `batch_export_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // 处理每个订单
    for (const orderId of orderIds) {
      const orders = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (orders.length === 0) continue;
      
      const order = orders[0];
      const designs = await db.query('SELECT * FROM designs WHERE order_id = ?', [orderId]);
      
      // 更新订单标记为已导出
      const beijingTime = new Date();
      beijingTime.setHours(beijingTime.getHours() + 8);
      const beijingTimeString = beijingTime.toISOString().replace('T', ' ').substring(0, 19);
      
      await db.run(
        'UPDATE orders SET mark = ?, updated_at = ? WHERE id = ?',
        ['exported', beijingTimeString, orderId]
      );
      
      // 创建订单目录
      const orderDir = path.join(tempDir, `order_${order.order_number}`);
      fs.mkdirSync(orderDir, { recursive: true });
      
      // 创建订单信息文件
      const orderInfo = {
        order_number: order.order_number,
        customer_name: order.customer_name,
        phone: order.phone,
        address: order.address,
        product_specs: order.product_specs,
        created_at: order.created_at,
        designs: designs.map(design => ({
          name: design.name,
          width: design.width,
          height: design.height,
          created_at: design.created_at
        }))
      };
      
      fs.writeFileSync(
        path.join(orderDir, 'order_info.json'),
        JSON.stringify(orderInfo, null, 2)
      );
      
      // 复制设计预览图
      for (const design of designs) {
        if (design.preview_path) {
          const fileName = path.basename(design.preview_path);
          try {
            await storageService.downloadFile(
              'designs',
              fileName,
              path.join(orderDir, fileName)
            );
          } catch (error) {
            console.error(`批量导出时下载设计图失败 [${fileName}]:`, error);
          }
        }
      }
    }
    
    // 创建压缩文件
    const zipFileName = `batch_export_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    
    // 添加文件到压缩包
    archive.directory(tempDir, false);
    
    // 清理临时目录
    archive.on('end', () => {
      setTimeout(() => {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }, 5000);
    });
    
    await archive.finalize();
    
  } catch (error) {
    console.error('批量导出失败:', error);
    res.status(500).json({ error: '批量导出失败' });
  }
});

// 设置数据库实例的函数
export function setDatabase(database) {
  db = database;
}

export default router;
