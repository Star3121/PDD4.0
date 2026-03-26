import { createClient } from '@supabase/supabase-js';

class SupabaseDatabase {
  constructor() {
    this.supabase = null;
    this.initialized = false;
    this.init();
  }

  async init() {
    if (this.initialized) return;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase URL 和 Key 需要在环境变量中提供');
      return;
    }

    // 轻量初始化：仅创建客户端，不进行探测查询，避免冷启动阻塞
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.initialized = true;
    console.log('Supabase 客户端初始化完成');
  }

  // Helper method to ensure initialization
  async ensureInitialized() {
    if (!this.initialized) {
      await this.init();
    }
  }

  // Categories table operations
  async getCategories() {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('categories')
      .select('*')
      .order('name');
    
    if (error) throw error;
    return data || [];
  }

  async getCategoryById(id) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('categories')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }

  async createCategory(category) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('categories')
      .insert([category])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // Templates table operations
  async getTemplates(categoryId = null) {
    await this.ensureInitialized();
    let query = this.supabase
      .from('templates')
      .select('*')
      .order('name');
    
    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getTemplateById(id) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }

  async createTemplate(template) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('templates')
      .insert([template])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  // Designs table operations
  async getDesigns() {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('designs')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  async getDesignById(id) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('designs')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }

  async createDesign(design) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('designs')
      .insert([design])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async updateDesign(id, design) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('designs')
      .update(design)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async deleteDesign(id) {
    await this.ensureInitialized();
    const { error } = await this.supabase
      .from('designs')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    return true;
  }

  // Orders table operations
  async getOrders() {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  async getOrderById(id) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }

  async createOrder(order) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('orders')
      .insert([order])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async updateOrder(id, order) {
    await this.ensureInitialized();
    const { data, error } = await this.supabase
      .from('orders')
      .update(order)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async deleteOrder(id) {
    await this.ensureInitialized();
    const { error } = await this.supabase
      .from('orders')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    return true;
  }

  // Migration methods (for initial setup)
  async migrate() {
    await this.ensureInitialized();
    
    // Create tables if they don't exist
    const tables = ['categories', 'templates', 'designs', 'orders'];
    
    for (const table of tables) {
      const { error } = await this.supabase.rpc('create_table_if_not_exists', {
        table_name: table
      });
      
      if (error && error.code !== 'PGRST116') {
        console.warn(`Table ${table} might already exist or error creating:`, error.message);
      }
    }
  }

  async initializeDefaultCategories() {
    await this.ensureInitialized();
    
    const defaultCategories = [
      { name: '简约风格', description: '简洁现代的设计模板' },
      { name: '卡通动漫', description: '可爱卡通动漫风格模板' },
      { name: '文字艺术', description: '创意文字艺术设计模板' },
      { name: '自然风景', description: '自然风光风景模板' },
      { name: '抽象艺术', description: '抽象艺术创意模板' }
    ];

    // Check if categories already exist
    const existingCategories = await this.getCategories();
    
    if (existingCategories.length === 0) {
      for (const category of defaultCategories) {
        await this.createCategory(category);
      }
      console.log('Default categories initialized');
    }
  }

  // SQLite-compatible query method
  async query(sql, params = []) {
    await this.ensureInitialized();
    
    // Parse SQL to determine table and operation
    const lowerSql = sql.toLowerCase().trim();
    const queryTimeoutMs = Math.max(2000, Number(process.env.DB_QUERY_TIMEOUT_MS || 30000));
    
    try {
      const execute = async () => {
        if (lowerSql.startsWith('select')) {
        // Handle SELECT queries
        let tableName = '';
        let whereClause = '';
        let orderBy = '';
        let limit = '';
        let selectClause = '';
        
        // Extract SELECT clause
        const selectMatch = sql.match(/select\s+(.+?)\s+from/i);
        if (selectMatch) selectClause = selectMatch[1].trim();
        
        // Extract table name
        const fromMatch = sql.match(/from\s+(\w+)/i);
        if (fromMatch) tableName = fromMatch[1];
        
        // Extract WHERE clause
        const whereMatch = sql.match(/where\s+([\s\S]+?)(?:\s+order\s+by|\s+limit|$)/i);
        if (whereMatch) whereClause = whereMatch[1];
        
        // Extract ORDER BY
        const orderMatch = sql.match(/order\s+by\s+(.+?)(?:\s+limit|$)/i);
        if (orderMatch) orderBy = orderMatch[1];
        
        // Extract LIMIT
        const limitMatch = sql.match(/limit\s+(\d+)/i);
        if (limitMatch) limit = limitMatch[1];
        
        // Extract OFFSET
        let offset = 0;
        const offsetMatch = sql.match(/offset\s+(\d+)/i);
        if (offsetMatch) offset = parseInt(offsetMatch[1]);
        
        // Build Supabase query
        let query;
        
        // Handle COUNT(*) queries
        if (selectClause.toLowerCase().includes('count(*)')) {
          query = this.supabase.from(tableName).select('*', { count: 'exact', head: true });
        } else {
          query = this.supabase.from(tableName).select(selectClause === '*' ? '*' : selectClause);
        }
        
        // Apply WHERE conditions
        if (whereClause) {
          const conditions = this.parseWhereClause(whereClause, params);
          conditions.forEach(condition => {
            switch (condition.type) {
              case 'or':
                query = query.or(condition.filter);
                break;
              case 'in':
                query = query.in(condition.column, condition.values);
                break;
              case 'ilike':
                query = query.ilike(condition.column, condition.value);
                break;
              case 'eq':
                query = query.eq(condition.column, condition.value);
                break;
              case 'gte':
                query = query.gte(condition.column, condition.value);
                break;
              case 'lte':
                query = query.lte(condition.column, condition.value);
                break;
              case 'gt':
                query = query.gt(condition.column, condition.value);
                break;
              case 'lt':
                query = query.lt(condition.column, condition.value);
                break;
            }
          });
        }
        
        // Apply ORDER BY (only for non-count queries)
        if (orderBy && !selectClause.toLowerCase().includes('count(*)')) {
          const orderSegments = orderBy
            .split(',')
            .map((segment) => segment.trim())
            .filter(Boolean);
          orderSegments.forEach((segment) => {
            const [column, direction] = segment.split(/\s+/);
            if (!column) return;
            query = query.order(column, { ascending: direction?.toLowerCase() !== 'desc' });
          });
        }
        
        // Apply Pagination (LIMIT & OFFSET) (only for non-count queries)
        if (limit && !selectClause.toLowerCase().includes('count(*)')) {
          const limitNum = parseInt(limit);
          const from = offset;
          const to = offset + limitNum - 1;
          query = query.range(from, to);
        }
        
        const { data, error, count } = await query;
        if (error) throw error;
        
        // Handle COUNT(*) results
        if (selectClause.toLowerCase().includes('count(*)')) {
          return [{ total: count || 0 }];
        }
        
        return data || [];
        
      } else if (lowerSql.startsWith('insert')) {
        // Handle INSERT queries
        const tableMatch = sql.match(/insert\s+into\s+(\w+)/i);
        if (!tableMatch) throw new Error('无法解析INSERT语句');
        
        const tableName = tableMatch[1];
        const columnsMatch = sql.match(/\(([^)]+)\)/);
        const valuesMatch = sql.match(/values\s*\(([^)]+)\)/i);
        
        if (!columnsMatch || !valuesMatch) throw new Error('无法解析INSERT语句');
        
        const columns = columnsMatch[1].split(',').map(col => col.trim());
        const record = {};
        columns.forEach((col, index) => {
          record[col] = params[index];
        });
        
        const { data, error } = await this.supabase
          .from(tableName)
          .insert([record])
          .select('id')
          .single();
          
        if (error) throw error;
        return [{ id: data.id, changes: 1 }];
        
      } else if (lowerSql.startsWith('update')) {
        // Handle UPDATE queries
        const tableMatch = sql.match(/update\s+(\w+)/i);
        const setMatch = sql.match(/set\s+([\s\S]+?)\s+where/i);
        const whereMatch = sql.match(/where\s+([\s\S]+)$/i);
        
        if (!tableMatch || !setMatch || !whereMatch) throw new Error('无法解析UPDATE语句');
        
        const tableName = tableMatch[1];
        const { updates, paramCount } = this.parseSetClause(setMatch[1], params);
        const conditions = this.parseWhereClause(whereMatch[1], params.slice(paramCount));
        
        let query = this.supabase.from(tableName).update(updates);
        conditions.forEach(condition => {
          if (condition.type === 'in') {
            query = query.in(condition.column, condition.values);
          } else {
            query = query.eq(condition.column, condition.value);
          }
        });
        
        const { data, error } = await query.select('id');
        if (error) throw error;
        return [{ id: data[0]?.id, changes: data.length }];
        
      } else if (lowerSql.startsWith('delete')) {
        // Handle DELETE queries
        const tableMatch = sql.match(/delete\s+from\s+(\w+)/i);
        const whereMatch = sql.match(/where\s+(.+)$/i);
        
        if (!tableMatch || !whereMatch) throw new Error('无法解析DELETE语句');
        
        const tableName = tableMatch[1];
        const conditions = this.parseWhereClause(whereMatch[1], params);
        
        let query = this.supabase.from(tableName).delete().select('id');
        conditions.forEach(condition => {
          if (condition.type === 'in') {
            query = query.in(condition.column, condition.values);
          } else {
            query = query.eq(condition.column, condition.value);
          }
        });
        
        const { data, error } = await query;
        if (error) throw error;
        return [{ id: null, changes: data ? data.length : 0 }];
      }
      
      throw new Error(`不支持的SQL操作: ${sql}`);
      };
      const runWithTimeout = () => Promise.race([
        execute(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`数据库查询超时（>${queryTimeoutMs}ms）`)), queryTimeoutMs);
        })
      ]);
      const shouldRetry = (err) => {
        const message = err instanceof Error ? err.message : String(err || '');
        return message.includes('fetch failed') || message.includes('超时');
      };
      try {
        return await runWithTimeout();
      } catch (error) {
        if (!shouldRetry(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        return await runWithTimeout();
      }
    } catch (error) {
      console.error('数据库查询失败:', error);
      throw error;
    }
  }
  
  // SQLite-compatible run method
  async run(sql, params = []) {
    const result = await this.query(sql, params);
    return {
      id: result[0]?.id || null,
      changes: result[0]?.changes || 0
    };
  }
  
  // Helper method to parse WHERE clause
  parseWhereClause(whereClause, params) {
    const conditions = [];
    const normalized = String(whereClause || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return conditions;

    const toOrLikePattern = (value) => {
      if (typeof value !== 'string') return value;
      return value.replace(/%/g, '*').replace(/_/g, '?');
    };

    const splitByTopLevelAnd = (input) => {
      const parts = [];
      let depth = 0;
      let start = 0;
      const s = input;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '(') depth++;
        if (ch === ')') depth = Math.max(0, depth - 1);
        if (depth === 0 && /\s/i.test(ch)) {
          const slice = s.slice(i);
          const m = slice.match(/^\s+AND\s+/i);
          if (m) {
            parts.push(s.slice(start, i).trim());
            i += m[0].length - 1;
            start = i + 1;
          }
        }
      }
      parts.push(s.slice(start).trim());
      return parts.filter(Boolean);
    };

    const splitByTopLevelOrInsideParens = (input) => {
      const s = input.trim().replace(/^\(/, '').replace(/\)$/, '').trim();
      const parts = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '(') depth++;
        if (ch === ')') depth = Math.max(0, depth - 1);
        if (depth === 0 && /\s/i.test(ch)) {
          const slice = s.slice(i);
          const m = slice.match(/^\s+OR\s+/i);
          if (m) {
            parts.push(s.slice(start, i).trim());
            i += m[0].length - 1;
            start = i + 1;
          }
        }
      }
      parts.push(s.slice(start).trim());
      return parts.filter(Boolean);
    };

    let cursor = 0;
    const clauses = splitByTopLevelAnd(normalized);

    for (const clause of clauses) {
      const trimmed = clause.trim();

      if (trimmed.startsWith('(') && trimmed.endsWith(')') && /\s+OR\s+/i.test(trimmed)) {
        const orParts = splitByTopLevelOrInsideParens(trimmed);
        const orFilters = [];
        for (const part of orParts) {
          const likeMatch = part.match(/^(\w+)\s+LIKE\s+\?$/i);
          if (likeMatch) {
            const col = likeMatch[1];
            const v = params[cursor++];
            if (v !== undefined && v !== null && String(v).length > 0) {
              orFilters.push(`${col}.ilike.${toOrLikePattern(String(v))}`);
            }
            continue;
          }
          const eqMatch = part.match(/^(\w+)\s*=\s*\?$/i);
          if (eqMatch) {
            const col = eqMatch[1];
            const v = params[cursor++];
            if (v !== undefined && v !== null) {
              orFilters.push(`${col}.eq.${String(v)}`);
            }
            continue;
          }
        }
        if (orFilters.length > 0) {
          conditions.push({ type: 'or', filter: orFilters.join(',') });
        }
        continue;
      }

      const inMatch = trimmed.match(/^(\w+)\s+IN\s*\(([^)]+)\)$/i);
      if (inMatch) {
        const col = inMatch[1];
        const placeholderCount = inMatch[2].split(',').filter(p => p.trim() === '?').length;
        const values = params.slice(cursor, cursor + placeholderCount);
        cursor += placeholderCount;
        conditions.push({ type: 'in', column: col, values });
        continue;
      }

      const likeMatch = trimmed.match(/^(\w+)\s+LIKE\s+\?$/i);
      if (likeMatch) {
        const col = likeMatch[1];
        const v = params[cursor++];
        if (v !== undefined && v !== null) {
          conditions.push({ type: 'ilike', column: col, value: String(v) });
        }
        continue;
      }

      const gteMatch = trimmed.match(/^(\w+)\s*>=\s*\?$/i);
      if (gteMatch) {
        const col = gteMatch[1];
        const v = params[cursor++];
        if (v !== undefined && v !== null) conditions.push({ type: 'gte', column: col, value: v });
        continue;
      }

      const lteMatch = trimmed.match(/^(\w+)\s*<=\s*\?$/i);
      if (lteMatch) {
        const col = lteMatch[1];
        const v = params[cursor++];
        if (v !== undefined && v !== null) conditions.push({ type: 'lte', column: col, value: v });
        continue;
      }

      const gtMatch = trimmed.match(/^(\w+)\s*>\s*\?$/i);
      if (gtMatch) {
        const col = gtMatch[1];
        const v = params[cursor++];
        if (v !== undefined && v !== null) conditions.push({ type: 'gt', column: col, value: v });
        continue;
      }

      const ltMatch = trimmed.match(/^(\w+)\s*<\s*\?$/i);
      if (ltMatch) {
        const col = ltMatch[1];
        const v = params[cursor++];
        if (v !== undefined && v !== null) conditions.push({ type: 'lt', column: col, value: v });
        continue;
      }

      const eqMatch = trimmed.match(/^(\w+)\s*=\s*\?$/i);
      if (eqMatch) {
        const col = eqMatch[1];
        const v = params[cursor++];
        if (v !== undefined && v !== null) conditions.push({ type: 'eq', column: col, value: v });
        continue;
      }
    }

    return conditions;
  }
  
  // Helper method to parse SET clause
  parseSetClause(setClause, params) {
    const updates = {};
    // 清理换行符和多余空格，然后按逗号分割
    const cleanSetClause = setClause.replace(/\s+/g, ' ').trim();
    const parts = cleanSetClause.split(',').map(part => part.trim());
    let paramIndex = 0;
    
    parts.forEach((part) => {
      const match = part.match(/(\w+)\s*=\s*\?/i);
      if (match) {
        const fieldName = match[1];
        updates[fieldName] = params[paramIndex];
        paramIndex++;
      }
    });
    
    return { updates, paramCount: paramIndex };
  }

  // Close connection (for cleanup)
  async close() {
    // Supabase client doesn't need explicit closing
    this.initialized = false;
  }
}

// Create and export singleton instance
export const db = new SupabaseDatabase();
export default db;
