import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import storageService from '../services/storage.js';

const router = express.Router();

// 数据库实例将从服务器注入
let db;

const normalizeTemplateName = (value) => String(value || '').trim().toLowerCase();
let templatesColumnsCache = null;
const TEMPLATE_CANDIDATE_COLUMNS = [
  'id',
  'name',
  'image_path',
  'category',
  'canvas_data',
  'width',
  'height',
  'background_color',
  'source',
  'status',
  'template_code',
  'version',
  'usage_count',
  'pinned',
  'created_at',
  'updated_at'
];
const getTemplatesColumns = async () => {
  if (templatesColumnsCache) return templatesColumnsCache;
  await db.query('SELECT * FROM templates LIMIT 1');
  const columns = new Set();
  for (const column of TEMPLATE_CANDIDATE_COLUMNS) {
    try {
      await db.query(`SELECT ${column} FROM templates LIMIT 1`);
      columns.add(column);
    } catch {
    }
  }
  templatesColumnsCache = columns;
  return columns;
};

// 检测是否在 Vercel 环境
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 在 Vercel 环境使用 /tmp 目录，本地开发使用 uploads 目录
    const uploadPath = isVercel 
      ? '/tmp/templates'
      : path.join(process.cwd(), 'uploads/templates');
    
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
  limits: { 
    fileSize: 10 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});

// 获取所有模板（支持分页、搜索和筛选）
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      search = '',
      category = '',
      sortBy = 'usage_count',
      sortOrder = 'DESC',
      includeCanvasData = 'false'
    } = req.query;

    // 参数验证
    const pageNum = Math.max(1, parseInt(page));
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize))); // 限制最大页面大小为100
    const offset = (pageNum - 1) * pageSizeNum;

    // 构建查询条件
    let whereConditions = [];
    let queryParams = [];

    // 搜索条件（针对模板名称）
    if (search) {
      whereConditions.push('name LIKE ?');
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern);
    }

    // 分类筛选
    if (category) {
      whereConditions.push('category = ?');
      queryParams.push(category);
    }

    // 构建WHERE子句
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 验证排序字段
    const allowedSortFields = ['created_at', 'updated_at', 'name', 'category', 'usage_count', 'pinned'];
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'usage_count';
    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const includeCanvasPayload = String(includeCanvasData).toLowerCase() === 'true' || String(includeCanvasData) === '1';
    const columns = await getTemplatesColumns();
    const selectColumns = [
      columns.has('id') ? 'id' : 'NULL AS id',
      columns.has('name') ? 'name' : "'' AS name",
      columns.has('image_path') ? 'image_path' : "'' AS image_path",
      columns.has('category') ? 'category' : "'' AS category",
      columns.has('pinned') ? 'pinned' : '0 AS pinned',
      columns.has('usage_count') ? 'usage_count' : '0 AS usage_count',
      columns.has('created_at') ? 'created_at' : "'' AS created_at"
    ];
    if (includeCanvasPayload) {
      selectColumns.push(columns.has('canvas_data') ? 'canvas_data' : 'NULL AS canvas_data');
      selectColumns.push(columns.has('width') ? 'width' : 'NULL AS width');
      selectColumns.push(columns.has('height') ? 'height' : 'NULL AS height');
      selectColumns.push(columns.has('background_color') ? 'background_color' : 'NULL AS background_color');
      selectColumns.push(columns.has('version') ? 'version' : 'NULL AS version');
      selectColumns.push(columns.has('updated_at') ? 'updated_at' : "'' AS updated_at");
    }
    const selectClause = selectColumns.join(', ');

    const orderByParts = [];
    if (columns.has('pinned')) {
      orderByParts.push('pinned DESC');
    }
    if (columns.has('usage_count')) {
      orderByParts.push('usage_count DESC');
    }
    if (
      validSortBy &&
      validSortBy !== 'usage_count' &&
      validSortBy !== 'pinned' &&
      columns.has(validSortBy)
    ) {
      orderByParts.push(`${validSortBy} ${validSortOrder}`);
    }
    if (columns.has('created_at')) {
      orderByParts.push('created_at DESC');
    }
    if (columns.has('id')) {
      orderByParts.push('id DESC');
    }
    const orderByClause = orderByParts.length ? `ORDER BY ${orderByParts.join(', ')}` : '';

    const templates = await db.query(
      `SELECT ${selectClause} FROM templates ${whereClause} ${orderByClause} LIMIT ${pageSizeNum} OFFSET ${offset}`,
      queryParams
    );
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM templates ${whereClause}`,
      queryParams
    );
    const total = Number(countResult?.[0]?.total) || 0;

    // 计算分页信息
    const totalPages = Math.ceil(total / pageSizeNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.json({
      data: templates,
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage
      },
      filters: {
        search,
        category,
        sortBy: validSortBy,
        sortOrder: validSortOrder
      }
    });
  } catch (error) {
    console.error('获取模板失败:', error);
    res.status(500).json({ error: '获取模板失败' });
  }
});

router.get('/check-name', async (req, res) => {
  try {
    const { name, excludeId } = req.query;
    if (!name) {
      return res.status(400).json({ error: '模板名称不能为空' });
    }
    const normalizedName = normalizeTemplateName(name);
    const rows = await db.query('SELECT id, name FROM templates');
    const exists = rows.some(row => {
      if (excludeId !== undefined && Number(row.id) === Number(excludeId)) {
        return false;
      }
      return normalizeTemplateName(row.name) === normalizedName;
    });
    res.json({ exists, name });
  } catch (error) {
    console.error('模板名称校验失败:', error);
    res.status(500).json({ error: '模板名称校验失败' });
  }
});

router.patch('/:id/usage', async (req, res) => {
  try {
    const { id } = req.params;
    const templates = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    if (templates.length === 0) {
      return res.status(404).json({ error: '模板不存在' });
    }
    const columns = await getTemplatesColumns();
    if (columns.has('usage_count')) {
      await db.run('UPDATE templates SET usage_count = COALESCE(usage_count, 0) + 1 WHERE id = ?', [id]);
    }
    const updatedTemplate = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    res.json(updatedTemplate[0]);
  } catch (error) {
    console.error('更新模板调用次数失败:', error);
    res.status(500).json({ error: '更新模板调用次数失败' });
  }
});

// 获取单个模板
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const templates = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    
    if (templates.length === 0) {
      return res.status(404).json({ error: '模板不存在' });
    }
    
    res.json(templates[0]);
  } catch (error) {
    console.error('获取模板失败:', error);
    res.status(500).json({ error: '获取模板失败' });
  }
});

// 创建模板
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { name, category = 'general', canvas_data, width, height, background_color, source, status, template_code, version } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: '模板名称不能为空' });
    }

    if (String(name).trim().length > 30) {
      return res.status(400).json({ error: '模板名称不能超过30个字符' });
    }

    const normalizedInputName = normalizeTemplateName(name);
    const existing = await db.query('SELECT id, name FROM templates');
    const duplicate = existing.find(item => normalizeTemplateName(item.name) === normalizedInputName);
    if (duplicate) {
      return res.status(409).json({ error: '模板名称已存在' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: '请上传模板图片' });
    }
    
    // 上传到存储服务（自动处理多级缩略图 + 适配 S3/Supabase/Local）
    await storageService.uploadProcessedImage('templates', req.file.filename, req.file.path, req.file.mimetype);
    
    // 统一使用 /api/files 路径
    const imagePath = `/api/files/templates/${req.file.filename}`;
    
    const columns = await getTemplatesColumns();
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const insertColumns = [];
    const insertValues = [];
    const addInsert = (column, value) => {
      if (!columns.has(column)) return;
      insertColumns.push(column);
      insertValues.push(value);
    };

    addInsert('name', name);
    addInsert('image_path', imagePath);
    addInsert('category', category);
    addInsert('canvas_data', canvas_data ?? null);
    addInsert('width', width ?? null);
    addInsert('height', height ?? null);
    addInsert('background_color', background_color ?? null);
    addInsert('source', source ?? null);
    addInsert('status', status ?? null);
    addInsert('template_code', template_code ?? null);
    addInsert('version', version ?? 1);
    addInsert('created_at', now);
    addInsert('updated_at', now);

    const placeholders = insertColumns.map(() => '?').join(', ');
    const result = await db.run(
      `INSERT INTO templates (${insertColumns.join(', ')}) VALUES (${placeholders})`,
      insertValues
    );

    let newTemplate = [];
    if (result?.id != null) {
      newTemplate = await db.query('SELECT * FROM templates WHERE id = ?', [result.id]);
    }
    if (newTemplate.length === 0) {
      const orderBy = columns.has('created_at') ? 'created_at DESC' : 'id DESC';
      newTemplate = await db.query(`SELECT * FROM templates WHERE name = ? ORDER BY ${orderBy} LIMIT 1`, [name]);
    }
    res.status(201).json(newTemplate[0] || { name, image_path: imagePath, category });
  } catch (error) {
    console.error('创建模板失败:', error);
    res.status(500).json({ error: '创建模板失败' });
  }
});

router.put('/:id/content', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, canvas_data, width, height, background_color, source, status, template_code } = req.body;

    const templates = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    if (templates.length === 0) {
      return res.status(404).json({ error: '模板不存在' });
    }
    const existing = templates[0];

    let imagePath = existing.image_path;
    if (req.file) {
      if (existing.image_path) {
        const oldFilename = path.basename(existing.image_path || '');
        if (oldFilename) {
          try {
            await storageService.deleteFile('templates', oldFilename);
          } catch (e) {
            console.error('删除旧模板图片失败:', e);
          }
        }
      }
      await storageService.uploadProcessedImage('templates', req.file.filename, req.file.path, req.file.mimetype);
      imagePath = `/api/files/templates/${req.file.filename}`;
    }

    const columns = await getTemplatesColumns();
    const nextVersion = (existing.version || 1) + 1;
    const updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const updateFields = [];
    const updateValues = [];
    const addUpdate = (column, value) => {
      if (!columns.has(column)) return;
      updateFields.push(`${column} = ?`);
      updateValues.push(value);
    };

    addUpdate('name', name ?? existing.name);
    addUpdate('category', category ?? existing.category);
    addUpdate('canvas_data', canvas_data ?? existing.canvas_data);
    addUpdate('width', width ?? existing.width);
    addUpdate('height', height ?? existing.height);
    addUpdate('background_color', background_color ?? existing.background_color);
    addUpdate('image_path', imagePath);
    addUpdate('source', source ?? existing.source);
    addUpdate('status', status ?? existing.status);
    addUpdate('template_code', template_code ?? existing.template_code);
    addUpdate('version', nextVersion);
    addUpdate('updated_at', updatedAt);

    if (updateFields.length > 0) {
      updateValues.push(id);
      await db.run(
        `UPDATE templates SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    const updatedTemplate = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    res.json(updatedTemplate[0]);
  } catch (error) {
    console.error('更新模板内容失败:', error);
    res.status(500).json({ error: '更新模板内容失败' });
  }
});

// 更新模板
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, pinned } = req.body;
    
    // 检查模板是否存在
    const templates = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    if (templates.length === 0) {
      return res.status(404).json({ error: '模板不存在' });
    }
    
    const columns = await getTemplatesColumns();
    const updateFields = [];
    const updateValues = [];
    
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: '模板名称不能为空' });
      }
      if (columns.has('name')) {
        updateFields.push('name = ?');
        updateValues.push(name);
      }
    }
    
    if (category !== undefined && columns.has('category')) {
      updateFields.push('category = ?');
      updateValues.push(category);
    }

    if (pinned !== undefined && columns.has('pinned')) {
      const pinnedValue = pinned ? 1 : 0;
      updateFields.push('pinned = ?');
      updateValues.push(pinnedValue);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: '没有提供要更新的字段' });
    }
    
    if (columns.has('updated_at')) {
      updateFields.push('updated_at = ?');
      updateValues.push(new Date().toISOString().replace('T', ' ').substring(0, 19));
    }
    updateValues.push(id);
    
    await db.run(
      `UPDATE templates SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    const updatedTemplate = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    res.json(updatedTemplate[0]);
  } catch (error) {
    console.error('更新模板失败:', error);
    res.status(500).json({ error: '更新模板失败' });
  }
});

// 删除模板
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 获取模板信息
    const templates = await db.query('SELECT * FROM templates WHERE id = ?', [id]);
    if (templates.length === 0) {
      return res.status(404).json({ error: '模板不存在' });
    }
    
    const template = templates[0];
    
    // 删除文件
    if (template.image_path) {
      const filename = path.basename(template.image_path);
      try {
        await storageService.deleteFile('templates', filename);
      } catch (e) {
        console.error('删除模板图片失败:', e);
      }
    }

    // 从数据库删除
    await db.run('DELETE FROM templates WHERE id = ?', [id]);
    res.json({ message: '模板删除成功' });
  } catch (error) {
    console.error('删除模板失败:', error);
    res.status(500).json({ error: '删除模板失败' });
  }
});

// 批量删除模板
router.delete('/', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供要删除的模板ID数组' });
    }

    // 过滤无效的ID
    const validIds = ids.filter(id => id != null && !isNaN(id));
    
    if (validIds.length === 0) {
      return res.status(400).json({ error: '没有有效的模板ID' });
    }

    // 查询要删除的模板信息
    const placeholders = validIds.map(() => '?').join(',');
    const templates = await db.query(`SELECT * FROM templates WHERE id IN (${placeholders})`, validIds);
    
    if (templates.length === 0) {
      return res.status(404).json({ error: '未找到要删除的模板' });
    }

    // 删除关联的文件 (并行处理)
    const deleteFilePromises = templates.map(template => {
      if (template.image_path) {
        const filename = path.basename(template.image_path);
        return storageService.deleteFile('templates', filename)
          .catch(error => console.log(`删除图片文件失败: ${filename}`, error.message));
      }
      return Promise.resolve();
    });

    await Promise.all(deleteFilePromises);

    // 删除数据库记录
    await db.query(`DELETE FROM templates WHERE id IN (${placeholders})`, validIds);

    res.json({ 
      message: '批量删除成功',
      deletedCount: templates.length,
      deletedIds: templates.map(t => t.id)
    });
  } catch (error) {
    console.error('批量删除模板失败:', error);
    res.status(500).json({ error: '批量删除模板失败' });
  }
});

// 设置数据库实例的函数
export function setDatabase(database) {
  db = database;
  templatesColumnsCache = null;
}

export default router;
