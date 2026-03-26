import express from 'express';

const router = express.Router();

// 数据库实例将从服务器注入
let db;

// 获取所有订单（支持分页、搜索和筛选）
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      search = '',
      mark = '',
      productCategory = '',
      exportTimeFilter = '',
      exportStartDate = '',
      exportEndDate = '',
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;

    // 参数验证
    const pageNum = Math.max(1, parseInt(page));
    const pageSizeNum = Math.min(200, Math.max(1, parseInt(pageSize)));
    const offset = (pageNum - 1) * pageSizeNum;

    // 构建查询条件
    let whereConditions = [];
    let queryParams = [];

    // 搜索条件（针对订单号、客户姓名、电话、地址）
    if (search) {
      whereConditions.push(`(
        order_number LIKE ? OR 
        customer_name LIKE ? OR 
        phone LIKE ? OR 
        address LIKE ?
      )`);
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // 状态筛选
    if (mark) {
      whereConditions.push('mark = ?');
      queryParams.push(mark);
    }

    if (productCategory) {
      whereConditions.push('product_category = ?');
      queryParams.push(productCategory);
    }

    // 导出时间筛选（仅在mark为exported时生效）
    if (mark === 'exported' && exportTimeFilter) {
      // 系统已经是东八区时间，直接使用
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      // 转换为数据库时间格式（东八区）
      const formatToDbTime = (date) => {
        // 直接格式化为本地时间字符串
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      };

      if (exportTimeFilter === 'today') {
        whereConditions.push('exported_at >= ? AND exported_at < ?');
        queryParams.push(
          formatToDbTime(today),
          formatToDbTime(tomorrow)
        );
      } else if (exportTimeFilter === 'yesterday') {
        whereConditions.push('exported_at >= ? AND exported_at < ?');
        queryParams.push(
          formatToDbTime(yesterday),
          formatToDbTime(today)
        );
      } else if (exportTimeFilter === 'custom' && exportStartDate && exportEndDate) {
        const startDate = new Date(exportStartDate);
        const endDate = new Date(exportEndDate);
        endDate.setHours(23, 59, 59, 999); // 包含结束日期的整天
        
        whereConditions.push('exported_at >= ? AND exported_at <= ?');
        queryParams.push(
          formatToDbTime(startDate),
          formatToDbTime(endDate)
        );
      }
    }

    // 构建WHERE子句
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 验证排序字段
    const allowedSortFields = ['created_at', 'updated_at', 'order_number', 'customer_name'];
    const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 获取分页数据
    const dataQuery = `
      SELECT * FROM orders 
      ${whereClause} 
      ORDER BY ${validSortBy} ${validSortOrder} 
      LIMIT ${pageSizeNum} OFFSET ${offset}
    `;
    const orders = await db.query(dataQuery, queryParams);
    let total = offset + orders.length;
    try {
      const countQuery = `SELECT COUNT(*) as total FROM orders ${whereClause}`;
      const countResult = await Promise.race([
        db.query(countQuery, queryParams),
        new Promise((_, reject) => setTimeout(() => reject(new Error('count query timeout')), 3000))
      ]);
      total = Number(countResult?.[0]?.total) || total;
    } catch (countError) {
      console.warn('订单总数统计超时，回退为当前页估算:', countError);
      if (orders.length === pageSizeNum) {
        total += 1;
      }
    }

    // 计算分页信息
    const totalPages = Math.ceil(total / pageSizeNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.json({
      data: orders,
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
        mark,
        productCategory,
        sortBy: validSortBy,
        sortOrder: validSortOrder
      }
    });
  } catch (error) {
    console.error('获取订单失败:', error);
    res.status(500).json({ error: '获取订单失败' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const {
      search = '',
      mark = '',
      exportTimeFilter = '',
      exportStartDate = '',
      exportEndDate = ''
    } = req.query;

    let whereConditions = ['product_category IS NOT NULL', "TRIM(product_category) != ''"];
    let queryParams = [];

    if (search) {
      whereConditions.push(`(
        order_number LIKE ? OR
        customer_name LIKE ? OR
        phone LIKE ? OR
        address LIKE ?
      )`);
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (mark) {
      whereConditions.push('mark = ?');
      queryParams.push(mark);
    }

    if (mark === 'exported' && exportTimeFilter) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const formatToDbTime = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      };

      if (exportTimeFilter === 'today') {
        whereConditions.push('exported_at >= ? AND exported_at < ?');
        queryParams.push(
          formatToDbTime(today),
          formatToDbTime(tomorrow)
        );
      } else if (exportTimeFilter === 'yesterday') {
        whereConditions.push('exported_at >= ? AND exported_at < ?');
        queryParams.push(
          formatToDbTime(yesterday),
          formatToDbTime(today)
        );
      } else if (exportTimeFilter === 'custom' && exportStartDate && exportEndDate) {
        const startDate = new Date(exportStartDate);
        const endDate = new Date(exportEndDate);
        endDate.setHours(23, 59, 59, 999);

        whereConditions.push('exported_at >= ? AND exported_at <= ?');
        queryParams.push(
          formatToDbTime(startDate),
          formatToDbTime(endDate)
        );
      }
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const categories = await db.query(
      `SELECT product_category FROM orders ${whereClause} ORDER BY product_category ASC LIMIT 500`,
      queryParams
    );

    const uniqueCategories = Array.from(
      new Set(
        categories
          .map(item => item.product_category)
          .filter(category => typeof category === 'string' && category.trim() !== '')
      )
    );

    res.json(uniqueCategories);
  } catch (error) {
    console.error('获取产品分类失败:', error);
    res.status(500).json({ error: '获取产品分类失败' });
  }
});

// 获取订单统计信息
router.get('/stats', async (req, res) => {
  try {
    const { customStartDate, customEndDate, search = '', productCategory = '' } = req.query;

    let baseWhereConditions = [];
    let baseParams = [];

    if (search) {
      baseWhereConditions.push(`(
        order_number LIKE ? OR
        customer_name LIKE ? OR
        phone LIKE ? OR
        address LIKE ?
      )`);
      const searchPattern = `%${search}%`;
      baseParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (productCategory) {
      baseWhereConditions.push('product_category = ?');
      baseParams.push(productCategory);
    }

    const baseWhereClause = baseWhereConditions.length > 0 ? ` AND ${baseWhereConditions.join(' AND ')}` : '';
    const readCount = (rows) => {
      const value = rows?.[0]?.count ?? rows?.[0]?.total ?? 0;
      return Number(value) || 0;
    };

    // 1. 基础状态统计 (mark 分组)
    // 使用多次查询代替GROUP BY，以确保Supabase适配器兼容性
    const marks = ['pending_design', 'pending_confirm', 'confirmed', 'exported'];
    
    // 初始化统计对象
    const stats = {
      total: 0,
      pending_design: 0,
      pending_confirm: 0,
      confirmed: 0,
      exported: 0,
      exportedToday: 0,
      exportedYesterday: 0,
      exportedCustom: 0
    };

    // 并行执行所有状态的计数查询
    await Promise.all(marks.map(async (mark) => {
      const result = await db.query(
        `SELECT COUNT(*) as count FROM orders WHERE mark = ?${baseWhereClause}`,
        [mark, ...baseParams]
      );
      const count = readCount(result);
      stats[mark] = count;
      stats.total += count;
    }));

    // 2. 导出时间统计 (今天、昨天、自定义)
    // 系统已经是东八区时间，直接使用
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // 转换为数据库时间格式（东八区）
    const formatToDbTime = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const todayStr = formatToDbTime(today);
    const tomorrowStr = formatToDbTime(tomorrow);
    const yesterdayStr = formatToDbTime(yesterday);

    // 查询今天导出数量
    const todayResult = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE mark = ? AND exported_at >= ? AND exported_at < ?${baseWhereClause}`,
      ['exported', todayStr, tomorrowStr, ...baseParams]
    );
    stats.exportedToday = readCount(todayResult);

    // 查询昨天导出数量
    const yesterdayResult = await db.query(
      `SELECT COUNT(*) as count FROM orders WHERE mark = ? AND exported_at >= ? AND exported_at < ?${baseWhereClause}`,
      ['exported', yesterdayStr, todayStr, ...baseParams]
    );
    stats.exportedYesterday = readCount(yesterdayResult);

    // 3. 自定义时间范围统计 (如果有参数)
    if (customStartDate && customEndDate) {
      const startDate = new Date(customStartDate);
      const endDate = new Date(customEndDate);
      endDate.setHours(23, 59, 59, 999); // 包含结束日期的整天

      const customResult = await db.query(
        `SELECT COUNT(*) as count FROM orders WHERE mark = ? AND exported_at >= ? AND exported_at <= ?${baseWhereClause}`,
        ['exported', formatToDbTime(startDate), formatToDbTime(endDate), ...baseParams]
      );
      stats.exportedCustom = readCount(customResult);
    }

    res.json(stats);
  } catch (error) {
    console.error('获取统计信息失败:', error);
    res.status(500).json({ error: '获取统计信息失败' });
  }
});

// 检查订单号是否存在
router.get('/check/:orderNumber', async (req, res) => {
  try {
    const { orderNumber } = req.params;
    
    if (!orderNumber) {
      return res.status(400).json({ error: '订单号不能为空' });
    }

    const existingOrders = await db.query(
      'SELECT id, order_number FROM orders WHERE order_number = ?',
      [orderNumber]
    );
    const existingOrder = existingOrders[0];

    res.json({
      exists: !!existingOrder,
      orderNumber: orderNumber
    });
  } catch (error) {
    console.error('检查订单号失败:', error);
    res.status(500).json({ error: '检查订单号失败' });
  }
});

// 获取单个订单
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orders = await db.query('SELECT * FROM orders WHERE id = ?', [id]);
    
    if (orders.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    res.json(orders[0]);
  } catch (error) {
    console.error('获取订单失败:', error);
    res.status(500).json({ error: '获取订单失败' });
  }
});

// 创建订单
router.post('/', async (req, res) => {
  try {
    const { 
      order_number, 
      customer_name, 
      phone, 
      address, 
      product_category = '',
      product_model = '',
      product_specs = '',
      quantity = 1,
      transaction_time = '',
      order_notes = '',
      mark = 'pending_design'
    } = req.body;
    
    if (!order_number || !customer_name || !phone || !address || !product_specs) {
      return res.status(400).json({ 
        error: '缺少必要参数',
        details: '订单号、客户姓名、电话、地址和产品规格为必填项'
      });
    }
    
    // 检查订单号是否已存在
    const existingOrder = await db.query('SELECT id, order_number FROM orders WHERE order_number = ?', [order_number]);
    if (existingOrder.length > 0) {
      return res.status(400).json({ 
        error: '订单号重复',
        details: `订单号 "${order_number}" 已存在，请使用不同的订单号`,
        code: 'DUPLICATE_ORDER_NUMBER'
      });
    }
    
    // 使用 ISO 字符串 (UTC)
    const timeString = new Date().toISOString();
    
    const result = await db.run(
      `INSERT INTO orders (
        order_number, customer_name, phone, address, product_size,
        product_category, product_model, product_specs, quantity,
        transaction_time, order_notes, mark, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order_number, customer_name, phone, address, product_specs,
        product_category, product_model, product_specs, quantity,
        transaction_time, order_notes, mark, timeString, timeString
      ]
    );
    
    const newOrder = await db.query('SELECT * FROM orders WHERE id = ?', [result.id]);
    res.status(201).json(newOrder[0]);
  } catch (error) {
    console.error('创建订单失败:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      res.status(400).json({ 
        error: '订单号重复',
        details: '该订单号已存在，请使用不同的订单号',
        code: 'DUPLICATE_ORDER_NUMBER'
      });
    } else {
      res.status(500).json({ 
        error: '创建订单失败',
        details: error.message
      });
    }
  }
});

// 更新订单
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 获取现有订单数据
    const existingOrders = await db.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (existingOrders.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    const existingOrder = existingOrders[0];
    
    // 只更新提供的字段，保留现有值
    const updateData = {
      order_number: req.body.order_number !== undefined ? req.body.order_number : existingOrder.order_number,
      customer_name: req.body.customer_name !== undefined ? req.body.customer_name : existingOrder.customer_name,
      phone: req.body.phone !== undefined ? req.body.phone : existingOrder.phone,
      address: req.body.address !== undefined ? req.body.address : existingOrder.address,
      product_category: req.body.product_category !== undefined ? req.body.product_category : existingOrder.product_category,
      product_model: req.body.product_model !== undefined ? req.body.product_model : existingOrder.product_model,
      product_specs: req.body.product_specs !== undefined ? req.body.product_specs : existingOrder.product_specs,
      quantity: req.body.quantity !== undefined ? req.body.quantity : existingOrder.quantity,
      transaction_time: req.body.transaction_time !== undefined ? req.body.transaction_time : existingOrder.transaction_time,
      order_notes: req.body.order_notes !== undefined ? req.body.order_notes : existingOrder.order_notes,
      mark: req.body.mark !== undefined ? req.body.mark : existingOrder.mark,
      export_status: req.body.export_status !== undefined ? req.body.export_status : existingOrder.export_status
    };
    
    // 使用 ISO 字符串 (UTC)
    const timeString = new Date().toISOString();
    
    await db.run(
      `UPDATE orders SET 
        order_number = ?, customer_name = ?, phone = ?, address = ?, 
        product_category = ?, product_model = ?,
        product_specs = ?, quantity = ?, transaction_time = ?, order_notes = ?, mark = ?, export_status = ?,
        updated_at = ? 
      WHERE id = ?`,
      [
        updateData.order_number, updateData.customer_name, updateData.phone, updateData.address, 
        updateData.product_category, updateData.product_model,
        updateData.product_specs, updateData.quantity, updateData.transaction_time, 
        updateData.order_notes, updateData.mark, updateData.export_status, timeString, id
      ]
    );
    
    const updatedOrder = await db.query('SELECT * FROM orders WHERE id = ?', [id]);
    res.json(updatedOrder[0]);
  } catch (error) {
    console.error('更新订单失败:', error);
    res.status(500).json({ error: '更新订单失败' });
  }
});

// 删除订单
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.run('DELETE FROM orders WHERE id = ?', [id]);
    res.json({ message: '订单删除成功' });
  } catch (error) {
    console.error('删除订单失败:', error);
    res.status(500).json({ error: '删除订单失败' });
  }
});

// 批量更新订单导出状态
router.patch('/batch/export-status', async (req, res) => {
  try {
    const { orderIds, exportStatus } = req.body;
    console.log(`收到批量更新请求: IDs=${JSON.stringify(orderIds)}, Status=${exportStatus}`);
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: '订单ID列表不能为空' });
    }
    
    if (!exportStatus || !['not_exported', 'exported'].includes(exportStatus)) {
      return res.status(400).json({ error: '导出状态无效' });
    }
    
    // 使用 ISO 字符串 (UTC)
    const timeString = new Date().toISOString();
    
    const placeholders = orderIds.map(() => '?').join(',');
    const exportedAtValue = exportStatus === 'exported' ? timeString : null;
    
    let sql, params;
    if (exportStatus === 'exported') {
      // 当设置为已导出时，同时更新mark字段为exported
      sql = `UPDATE orders SET export_status = ?, exported_at = ?, mark = ?, updated_at = ? WHERE id IN (${placeholders})`;
      params = [exportStatus, exportedAtValue, 'exported', timeString, ...orderIds];
    } else {
      // 当设置为未导出时，只更新export_status和exported_at，不改变mark
      sql = `UPDATE orders SET export_status = ?, exported_at = ?, updated_at = ? WHERE id IN (${placeholders})`;
      params = [exportStatus, exportedAtValue, timeString, ...orderIds];
    }
    
    console.log('执行SQL:', sql);
    console.log('参数:', params);

    const result = await db.run(sql, params);
    console.log('批量更新导出状态结果:', result);
    
    res.json({ 
      message: `成功更新 ${orderIds.length} 个订单的导出状态`,
      updatedCount: result.changes,
      exportStatus
    });
  } catch (error) {
    console.error('批量更新导出状态失败:', error);
    if (error.message) console.error('错误详情:', error.message);
    if (error.code) console.error('错误代码:', error.code);
    res.status(500).json({ error: '批量更新导出状态失败', details: error.message });
  }
});

// 批量删除订单
router.delete('/', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供要删除的订单ID列表' });
    }
    
    // 构建删除查询
    const placeholders = ids.map(() => '?').join(',');
    const deleteQuery = `DELETE FROM orders WHERE id IN (${placeholders})`;
    
    await db.run(deleteQuery, ids);
    
    res.json({ 
      message: `成功删除 ${ids.length} 个订单`,
      deletedCount: ids.length 
    });
  } catch (error) {
    console.error('批量删除订单失败:', error);
    res.status(500).json({ error: '批量删除订单失败' });
  }
});

// 导出订单
router.get('/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await db.query('SELECT * FROM orders WHERE id = ?', [id]);
    
    if (order.length === 0) {
      return res.status(404).json({ error: '订单不存在' });
    }
    
    // 更新订单标记为已导出
    const timeString = new Date().toISOString();
    
    await db.run(
      'UPDATE orders SET mark = ?, updated_at = ? WHERE id = ?',
      ['exported', timeString, id]
    );
    
    // 这里应该实现导出逻辑
    res.json({ message: '导出功能开发中', order: order[0] });
  } catch (error) {
    console.error('导出订单失败:', error);
    res.status(500).json({ error: '导出订单失败' });
  }
});

// 设置数据库实例的函数
export function setDatabase(database) {
  db = database;
}

export default router;
