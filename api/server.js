import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import ordersRouter, { setDatabase as setOrdersDatabase } from './routes/orders.js';
import templatesRouter, { setDatabase as setTemplatesDatabase } from './routes/templates.js';
import designsRouter, { setDatabase as setDesignsDatabase } from './routes/designs.js';
import uploadRouter, { setDatabase as setUploadDatabase } from './routes/upload.js';
import categoriesRouter, { setDatabase as setCategoriesDatabase } from './routes/categories.js';
import filesRouter from './routes/files.js';
import { db as supabaseDb } from './database.supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
// 新增：检测是否运行在 Vercel Serverless 环境
const isServerless = !!process.env.VERCEL;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);
let dbProvider = 'sqlite';

// 初始化数据库 - 优先使用Supabase，回退到SQLite
let db;
try {
  if (hasSupabaseConfig) {
    if (isServerless) {
      db = supabaseDb;
      dbProvider = 'supabase';
      console.log('使用Supabase数据库');
    } else {
      let supabaseReady = false;
      try {
        await Promise.race([
          supabaseDb.query('SELECT COUNT(*) as total FROM orders LIMIT 1', []),
          new Promise((_, reject) => setTimeout(() => reject(new Error('supabase ping timeout')), 5000))
        ]);
        supabaseReady = true;
      } catch (supabaseError) {
        console.error('Supabase连通性检测失败，回退SQLite:', supabaseError);
      }
      if (supabaseReady) {
        db = supabaseDb;
        dbProvider = 'supabase';
        console.log('使用Supabase数据库');
      } else {
        const mod = await import('./database.js');
        db = new mod.Database();
        dbProvider = 'sqlite';
        console.log('使用SQLite数据库（Supabase不可用）');
      }
    }
  } else {
    if (isServerless) {
      console.error('Vercel Serverless 环境缺少 Supabase 配置，无法使用本地SQLite。');
      // 提供一个占位DB，调用时抛出更清晰的错误
      db = {
        query: async () => { throw new Error('Serverless环境未配置数据库，请在Vercel设置Supabase环境变量'); },
        run: async () => { throw new Error('Serverless环境未配置数据库，请在Vercel设置Supabase环境变量'); }
      };
    } else {
      // 动态导入SQLite数据库，仅在非Serverless环境使用
      const mod = await import('./database.js');
      db = new mod.Database();
      dbProvider = 'sqlite';
      console.log('使用SQLite数据库');
    }
  }
} catch (error) {
  console.error('数据库初始化失败，使用SQLite:', error);
  // 仅在非Serverless环境作为兜底使用SQLite
  if (!isServerless) {
    const mod = await import('./database.js');
    db = new mod.Database();
    dbProvider = 'sqlite';
  }
}

// 将数据库实例注入到所有路由模块
setOrdersDatabase(db);
setTemplatesDatabase(db);
setDesignsDatabase(db);
setUploadDatabase(db);
setCategoriesDatabase(db);

// 中间件
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 确保必要的目录存在与静态文件服务（仅在非Serverless环境）
import fs from 'fs';
// 静态文件服务配置
if (!isServerless) {
  const dirs = [
    path.join(process.cwd(), 'uploads'),
    path.join(process.cwd(), 'uploads/templates'),
    path.join(process.cwd(), 'uploads/designs'),
    path.join(process.cwd(), 'uploads/images'),
    path.join(process.cwd(), 'uploads/fonts'),
    path.join(process.cwd(), 'temp')
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // 自定义静态文件处理中间件
  app.use('/uploads', (req, res, next) => {
    // 设置CORS头
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    
    const filePath = path.join(process.cwd(), 'uploads', req.path);
    
    // 检查文件是否存在
    if (fs.existsSync(filePath)) {
      // 设置正确的Content-Type
      if (req.path.endsWith('.png')) {
        res.setHeader('Content-Type', 'image/png');
      } else if (req.path.endsWith('.jpg') || req.path.endsWith('.jpeg')) {
        res.setHeader('Content-Type', 'image/jpeg');
      } else if (req.path.endsWith('.gif')) {
        res.setHeader('Content-Type', 'image/gif');
      } else if (req.path.endsWith('.svg')) {
        res.setHeader('Content-Type', 'image/svg+xml');
      }
      
      // 添加缓存控制头：缓存1年
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      
      next();
    } else {
      // 文件不存在，返回透明的1x1像素PNG
      res.setHeader('Content-Type', 'image/png');
      // 404 图片不缓存，或者只缓存很短时间
      res.setHeader('Cache-Control', 'no-cache');
      const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      res.send(transparentPng);
    }
  });
  
  // 提供上传文件的静态服务
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
    maxAge: '1y', // 1年缓存
    immutable: true
  }));
  
  // 提供前端静态文件服务
  app.use(express.static(path.join(process.cwd(), 'dist')));
} else {
  console.log('Vercel Serverless 环境：跳过本地uploads/temp目录创建与静态服务');
}

// 路由
app.use('/api/orders', ordersRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/designs', designsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/files', filesRouter);

// 健康检查
app.get('/api/health', (req, res) => {
  Promise.race([
    db?.query?.('SELECT COUNT(*) as total FROM orders LIMIT 1', []),
    new Promise((_, reject) => setTimeout(() => reject(new Error('db ping timeout')), 1500))
  ]).then(() => {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: dbProvider,
      db_ready: true,
      serverless: isServerless,
      has_supabase_url: Boolean(supabaseUrl),
      has_supabase_key: Boolean(supabaseKey)
    });
  }).catch((error) => {
    res.status(503).json({
      status: 'DEGRADED',
      timestamp: new Date().toISOString(),
      database: dbProvider,
      db_ready: false,
      db_error: error instanceof Error ? error.message : 'unknown',
      serverless: isServerless,
      has_supabase_url: Boolean(supabaseUrl),
      has_supabase_key: Boolean(supabaseKey)
    });
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ 
    error: '服务器内部错误',
    message: err?.message || '未知错误' 
  });
});

// SPA 路由处理 - 对于非 API 路由，返回 index.html
if (!isServerless) {
  app.get('*', (req, res) => {
    // 如果是 API 路由但没有匹配到，返回 404
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: '接口不存在' });
    }
    // 否则返回前端应用的 index.html
    res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
  });
} else {
  // Vercel 环境下的 404 处理
  app.use('*', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });
}

// 在本地环境启动监听；在Vercel Serverless中由平台处理请求
if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
    console.log(`API文档: http://localhost:${PORT}/api/health`);
  });
} else {
  console.log('Vercel Serverless 环境：导出 Express 应用，无需 app.listen');
}

export default app;
