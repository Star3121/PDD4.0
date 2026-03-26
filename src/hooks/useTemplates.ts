import { useState, useEffect } from 'react';
import { templatesAPI, categoriesAPI } from '../api';
import { Template, Category, PaginatedResponse } from '../api';

interface UseTemplatesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  enabled?: boolean;
  includeCanvasData?: boolean;
}

interface UseTemplatesResult {
  templates: Template[];
  categories: Category[];
  loading: boolean;
  total: number;
  totalPages: number;
  refresh: () => void;
}

export function useTemplates({ 
  page = 1, 
  pageSize = 20, 
  search = '', 
  category = 'all',
  enabled = true,
  includeCanvasData = false
}: UseTemplatesParams = {}): UseTemplatesResult {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // 获取分类数据
  const fetchCategories = async () => {
    try {
      const response = await categoriesAPI.getAll();
      setCategories(response);
    } catch (error) {
      console.error('获取分类失败:', error);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchTemplates = async () => {
    if (!enabled) return;
    
    setLoading(true);
    try {
      // API 请求
      const params = {
        page,
        pageSize,
        search: search?.trim(),
        category: category === 'all' ? undefined : category,
        includeCanvasData,
      };
      
      const response = await templatesAPI.getAll(params);
      
      if ('data' in response) {
        setTemplates(response.data);
        setTotal(response.pagination.total);
        setTotalPages(response.pagination.totalPages);
      } else {
        setTemplates(response);
        setTotal(response.length);
        setTotalPages(Math.ceil(response.length / pageSize));
      }
    } catch (error) {
      console.error('获取模板失败:', error);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, [page, pageSize, search, category, enabled, includeCanvasData]);

  return {
    templates,
    categories,
    loading,
    total,
    totalPages,
    refresh: () => {
        fetchTemplates();
    }
  };
}
