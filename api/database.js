import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class Database {
  constructor() {
    this.db = null;
    this.init();
  }

  init() {
    // 允许通过环境变量指定数据库文件名，默认为 database.sqlite
    const dbName = process.env.DB_NAME || 'database.sqlite';
    const dbPath = path.join(process.cwd(), dbName);
    
    // 确保数据库目录存在
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('数据库连接失败:', err);
      } else {
        console.log('数据库连接成功，路径:', dbPath);
        this.createTables();
      }
    });
  }

  createTables() {
    const createOrdersTable = `
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        product_size TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createTemplatesTable = `
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_path TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        canvas_data TEXT,
        width INTEGER,
        height INTEGER,
        background_color TEXT,
        source TEXT,
        status TEXT,
        template_code TEXT,
        version INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        pinned INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createDesignsTable = `
      CREATE TABLE IF NOT EXISTS designs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        canvas_data TEXT,
        preview_path TEXT,
        width INTEGER DEFAULT 800,
        height INTEGER DEFAULT 600,
        background_type TEXT DEFAULT 'white',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders (id)
      )
    `;

    const createCategoriesTable = `
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        is_default BOOLEAN DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createCustomFontsTable = `
      CREATE TABLE IF NOT EXISTS custom_fonts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        font_family TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'woff2',
        size_bytes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.serialize(() => {
      this.db.run(createOrdersTable, (err) => {
        if (err) console.error('创建orders表失败:', err);
        else {
          console.log('orders表创建成功');
          // 检查并添加新字段（用于现有数据库的迁移）
          this.migrateOrdersTable();
        }
      });
      
      this.db.run(createTemplatesTable, (err) => {
        if (err) console.error('创建templates表失败:', err);
        else {
          console.log('templates表创建成功');
          this.migrateTemplatesTable();
        }
      });
      
      this.db.run(createDesignsTable, (err) => {
        if (err) console.error('创建designs表失败:', err);
        else {
          console.log('designs表创建成功');
          // 检查并添加background_type字段（用于现有数据库的迁移）
          this.migrateDesignsTable();
        }
      });

      this.db.run(createCategoriesTable, (err) => {
        if (err) console.error('创建categories表失败:', err);
        else {
          console.log('categories表创建成功');
          this.initDefaultCategories();
        }
      });

      this.db.run(createCustomFontsTable, (err) => {
        if (err) console.error('创建custom_fonts表失败:', err);
        else {
          console.log('custom_fonts表创建成功');
          this.migrateCustomFontsTable();
        }
      });
    });
  }

  migrateCustomFontsTable() {
    this.db.all("PRAGMA table_info(custom_fonts)", (err, columns) => {
      if (err) {
        console.error('检查custom_fonts表结构失败:', err);
        return;
      }
      const existingColumns = columns.map(col => col.name);
      const newColumns = [
        { name: 'font_family', type: 'TEXT', default: '' },
        { name: 'display_name', type: 'TEXT', default: '' },
        { name: 'original_filename', type: 'TEXT', default: '' },
        { name: 'file_name', type: 'TEXT', default: '' },
        { name: 'file_url', type: 'TEXT', default: '' },
        { name: 'format', type: 'TEXT', default: 'woff2' },
        { name: 'size_bytes', type: 'INTEGER', default: '0' },
        { name: 'created_at', type: 'TEXT', default: '' },
        { name: 'updated_at', type: 'TEXT', default: '' }
      ];
      newColumns.forEach((column) => {
        if (!existingColumns.includes(column.name)) {
          let defaultClause = '';
          if (column.default !== null) {
            defaultClause = column.default === 'CURRENT_TIMESTAMP'
              ? ' DEFAULT CURRENT_TIMESTAMP'
              : ` DEFAULT '${column.default}'`;
          }
          this.db.run(`ALTER TABLE custom_fonts ADD COLUMN ${column.name} ${column.type}${defaultClause}`, (addErr) => {
            if (addErr) {
              console.error(`添加custom_fonts.${column.name}字段失败:`, addErr);
            }
          });
        }
      });
    });
  }

  migrateOrdersTable() {
    // 检查新字段是否存在
    this.db.all("PRAGMA table_info(orders)", (err, columns) => {
      if (err) {
        console.error('检查orders表结构失败:', err);
        return;
      }
      
      const existingColumns = columns.map(col => col.name);
      const newColumns = [
        { name: 'product_category', type: 'TEXT', default: '' },
        { name: 'product_model', type: 'TEXT', default: '' },
        { name: 'product_specs', type: 'TEXT', default: '' },
        { name: 'quantity', type: 'INTEGER', default: '1' },
        { name: 'transaction_time', type: 'TEXT', default: '' },
        { name: 'order_notes', type: 'TEXT', default: '' },
        { name: 'mark', type: 'TEXT', default: 'pending_design' },
        { name: 'export_status', type: 'TEXT', default: 'not_exported' },
        { name: 'exported_at', type: 'DATETIME', default: null }
      ];
      
      newColumns.forEach(column => {
        if (!existingColumns.includes(column.name)) {
          console.log(`正在为orders表添加${column.name}字段...`);
          this.db.run(`ALTER TABLE orders ADD COLUMN ${column.name} ${column.type} DEFAULT '${column.default}'`, (err) => {
            if (err) {
              console.error(`添加${column.name}字段失败:`, err);
            } else {
              console.log(`${column.name}字段添加成功`);
            }
          });
        }
      });
    });
  }

  migrateDesignsTable() {
    // 检查background_type字段是否存在
    this.db.all("PRAGMA table_info(designs)", (err, columns) => {
      if (err) {
        console.error('检查designs表结构失败:', err);
        return;
      }
      
      const hasBackgroundType = columns.some(col => col.name === 'background_type');
      
      if (!hasBackgroundType) {
        console.log('正在为designs表添加background_type字段...');
        this.db.run("ALTER TABLE designs ADD COLUMN background_type TEXT DEFAULT 'white'", (err) => {
          if (err) {
            console.error('添加background_type字段失败:', err);
          } else {
            console.log('background_type字段添加成功');
          }
        });
      } else {
        console.log('background_type字段已存在');
      }
    });
  }

  migrateTemplatesTable() {
    this.db.all("PRAGMA table_info(templates)", (err, columns) => {
      if (err) {
        console.error('检查templates表结构失败:', err);
        return;
      }

      const existingColumns = columns.map(col => col.name);
      const newColumns = [
        { name: 'canvas_data', type: 'TEXT', default: null },
        { name: 'width', type: 'INTEGER', default: null },
        { name: 'height', type: 'INTEGER', default: null },
        { name: 'background_color', type: 'TEXT', default: null },
        { name: 'source', type: 'TEXT', default: null },
        { name: 'status', type: 'TEXT', default: null },
        { name: 'template_code', type: 'TEXT', default: null },
        { name: 'version', type: 'INTEGER', default: '1' },
        { name: 'usage_count', type: 'INTEGER', default: '0' },
        { name: 'pinned', type: 'INTEGER', default: '0' },
        { name: 'updated_at', type: 'DATETIME', default: null }
      ];

      newColumns.forEach(column => {
        if (!existingColumns.includes(column.name)) {
          let defaultClause = '';
          if (column.default !== null) {
            defaultClause = column.default === 'CURRENT_TIMESTAMP'
              ? ' DEFAULT CURRENT_TIMESTAMP'
              : ` DEFAULT '${column.default}'`;
          }
          this.db.run(`ALTER TABLE templates ADD COLUMN ${column.name} ${column.type}${defaultClause}`, (err) => {
            if (err) {
              console.error(`添加${column.name}字段失败:`, err);
            }
          });
        }
      });
    });
  }

  initDefaultCategories() {
    // 检查是否已有分类数据
    this.db.get("SELECT COUNT(*) as count FROM categories", (err, row) => {
      if (err) {
        console.error('检查分类数据失败:', err);
        return;
      }
      
      if (row.count === 0) {
        console.log('正在初始化默认分类...');
        const defaultCategories = [
          { name: 'default', display_name: '默认', description: '默认分类', is_default: 1, sort_order: 1 },
          { name: 'pattern', display_name: '图案', description: '图案类模板', is_default: 1, sort_order: 2 },
          { name: 'text', display_name: '文字', description: '文字类模板', is_default: 1, sort_order: 3 },
          { name: 'shape', display_name: '形状', description: '形状类模板', is_default: 1, sort_order: 4 }
        ];
        
        defaultCategories.forEach(category => {
          this.db.run(
            'INSERT INTO categories (name, display_name, description, is_default, sort_order) VALUES (?, ?, ?, ?, ?)',
            [category.name, category.display_name, category.description, category.is_default, category.sort_order],
            (err) => {
              if (err) {
                console.error(`创建默认分类 ${category.display_name} 失败:`, err);
              } else {
                console.log(`默认分类 ${category.display_name} 创建成功`);
              }
            }
          );
        });
      } else {
        console.log('分类数据已存在，跳过初始化');
      }
    });
  }

  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未初始化'));
        return;
      }
      
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('数据库未初始化'));
        return;
      }
      
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  }
}
