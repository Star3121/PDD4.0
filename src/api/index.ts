const API_BASE_URL = import.meta.env.PROD ? '/api' : 'http://localhost:3001/api';

// 基础请求函数
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const requestTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 45000);
  const timeoutController = new AbortController();
  let timeoutTriggered = false;
  const onExternalAbort = () => timeoutController.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      timeoutController.abort();
    } else {
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    timeoutController.abort();
  }, requestTimeoutMs);
  
  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    cache: 'no-store',
    ...options,
    signal: timeoutController.signal,
  };

  try {
    const response = await fetch(url, config);
    
    if (!response.ok) {
      let errorMessage = `请求失败（${response.status}）`;
      try {
        const error = await response.json();
        const backendMessage = error.message || error.error || '';
        const details = error.details ? ` (${error.details})` : '';
        if (backendMessage) {
          errorMessage = `${backendMessage}${details}`;
        }
      } catch {
        const text = await response.text();
        if (text) {
          errorMessage = `${errorMessage}: ${text.slice(0, 200)}`;
        }
      }
      throw new Error(errorMessage);
    }
    
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (timeoutTriggered) {
        throw new Error(`请求超时（>${requestTimeoutMs}ms）`);
      }
      throw error;
    }
    console.error('API请求错误:', error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (options.signal) {
      options.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// 文件上传函数
async function uploadFile(endpoint: string, file: File, data?: Record<string, any>) {
  const url = `${API_BASE_URL}${endpoint}`;
  const formData = new FormData();
  
  formData.append('image', file);
  
  if (data) {
    Object.keys(data).forEach(key => {
      formData.append(key, data[key]);
    });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json();
      const errorMessage = error.message || error.error || '上传失败';
      const details = error.details ? ` (${error.details})` : '';
      throw new Error(`${errorMessage}${details}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('文件上传错误:', error);
    throw error;
  }
}

async function uploadFileByField<T>(endpoint: string, file: File, fieldName: string) {
  const url = `${API_BASE_URL}${endpoint}`;
  const formData = new FormData();
  formData.append(fieldName, file);
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || '上传失败');
  }
  return response.json() as Promise<T>;
}

async function uploadFileWithMethod<T>(endpoint: string, method: 'POST' | 'PUT', file?: File, data?: Record<string, any>) {
  const url = `${API_BASE_URL}${endpoint}`;
  const formData = new FormData();

  if (file) {
    formData.append('image', file);
  }

  if (data) {
    Object.keys(data).forEach(key => {
      if (data[key] !== undefined) {
        formData.append(key, data[key]);
      }
    });
  }

  try {
    const response = await fetch(url, {
      method,
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json();
      const errorMessage = error.message || error.error || '上传失败';
      const details = error.details ? ` (${error.details})` : '';
      throw new Error(`${errorMessage}${details}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('文件上传错误:', error);
    throw error;
  }
}

// 设计预览上传（创建/更新）专用
async function uploadDesignWithPreview<T>(endpoint: string, method: 'POST' | 'PUT', data: Record<string, any>, file?: File): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const formData = new FormData();

  if (file) {
    formData.append('preview', file);
  }
  Object.keys(data).forEach(key => {
    formData.append(key, data[key] as any);
  });

  try {
    const response = await fetch(url, {
      method,
      body: formData,
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (e) {
        // 如果响应不是JSON格式，使用默认错误消息
        console.warn('无法解析错误响应:', e);
      }
      throw new Error(errorMessage);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('网络请求失败');
  }
}

const TEMPLATE_CACHE_VERSION_KEY = 'templateLibraryRefresh';
const TEMPLATE_CACHE_BUMP_EVENT = 'template-library-cache-bump';

const templateListCache = new Map<string, {
  version: string;
  data: PaginatedResponse<Template> | Template[];
}>();
let categoriesCache: Category[] | null = null;
let categoriesCacheVersion = '';

const getTemplateCacheVersion = () => {
  if (typeof window === 'undefined') return 'server';
  return window.localStorage.getItem(TEMPLATE_CACHE_VERSION_KEY) || '0';
};

const getTemplateListCacheKey = (params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  sortBy?: string;
  sortOrder?: string;
  includeCanvasData?: boolean;
}) => {
  const normalized = {
    page: params?.page ?? 1,
    pageSize: params?.pageSize ?? 20,
    search: params?.search?.trim() || '',
    category: params?.category || '',
    sortBy: params?.sortBy || '',
    sortOrder: params?.sortOrder || '',
    includeCanvasData: Boolean(params?.includeCanvasData),
  };
  return JSON.stringify(normalized);
};

const bumpTemplateCacheVersion = () => {
  if (typeof window === 'undefined') {
    templateListCache.clear();
    categoriesCache = null;
    categoriesCacheVersion = '';
    return;
  }
  const nextVersion = Date.now().toString();
  window.localStorage.setItem(TEMPLATE_CACHE_VERSION_KEY, nextVersion);
  window.dispatchEvent(new CustomEvent(TEMPLATE_CACHE_BUMP_EVENT, { detail: nextVersion }));
  templateListCache.clear();
  categoriesCache = null;
  categoriesCacheVersion = '';
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== TEMPLATE_CACHE_VERSION_KEY) return;
    templateListCache.clear();
    categoriesCache = null;
    categoriesCacheVersion = '';
  });
  window.addEventListener(TEMPLATE_CACHE_BUMP_EVENT, () => {
    templateListCache.clear();
    categoriesCache = null;
    categoriesCacheVersion = '';
  });
}

// 订单相关API
export const ordersAPI = {
  getAll: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    mark?: string;
    productCategory?: string;
    exportTimeFilter?: string;
    exportStartDate?: string;
    exportEndDate?: string;
    sortBy?: string;
    sortOrder?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          searchParams.append(key, String(value));
        }
      });
    }
    const queryString = searchParams.toString();
    return request<PaginatedResponse<Order> | Order[]>(`/orders${queryString ? `?${queryString}` : ''}`);
  },
  getCategories: (params?: {
    search?: string;
    mark?: string;
    exportTimeFilter?: string;
    exportStartDate?: string;
    exportEndDate?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          searchParams.append(key, String(value));
        }
      });
    }
    const queryString = searchParams.toString();
    return request<string[]>(`/orders/categories${queryString ? `?${queryString}` : ''}`);
  },
  getById: (id: number) => request<Order>(`/orders/${id}`),
  create: (data: CreateOrderData) => request<Order>('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: number, data: UpdateOrderData) => request<Order>(`/orders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: number) => request<void>(`/orders/${id}`, {
    method: 'DELETE',
  }),
  batchDelete: (ids: number[]) => request<{ message: string; deletedCount: number }>('/orders', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  }),
  checkOrderNumber: (orderNumber: string) => request<{ exists: boolean; orderNumber: string }>(`/orders/check/${encodeURIComponent(orderNumber)}`),
  batchUpdateExportStatus: (orderIds: number[], exportStatus: 'not_exported' | 'exported') => 
    request<{ message: string; updatedCount: number; exportStatus: string }>('/orders/batch/export-status', {
      method: 'PATCH',
      body: JSON.stringify({ orderIds, exportStatus }),
    }),
  getStats: (params?: {
    customStartDate?: string;
    customEndDate?: string;
    search?: string;
    productCategory?: string;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          searchParams.append(key, String(value));
        }
      });
    }
    const queryString = searchParams.toString();
    return request<OrderStats>(`/orders/stats${queryString ? `?${queryString}` : ''}`);
  },
};

// 模板相关API
export const templatesAPI = {
  getAll: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    category?: string;
    sortBy?: string;
    sortOrder?: string;
    includeCanvasData?: boolean;
  }) => {
    const currentVersion = getTemplateCacheVersion();
    const cacheKey = getTemplateListCacheKey(params);
    const cached = templateListCache.get(cacheKey);
    if (cached && cached.version === currentVersion) {
      return Promise.resolve(cached.data);
    }
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          searchParams.append(key, String(value));
        }
      });
    }
    const queryString = searchParams.toString();
    return request<PaginatedResponse<Template> | Template[]>(`/templates${queryString ? `?${queryString}` : ''}`).then((response) => {
      templateListCache.set(cacheKey, { version: currentVersion, data: response });
      return response;
    });
  },
  getById: (id: number) => request<Template>(`/templates/${id}`),
  create: (file: File, data: CreateTemplateData) =>
    uploadFile('/templates', file, data).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
  uploadTemp: (file: File) => uploadFile('/templates/temp', file),
  createFromTemp: (templates: CreateTemplateFromTempData[]) =>
    request<{ templates: Template[] }>('/templates/from-temp', {
      method: 'POST',
      body: JSON.stringify({ templates }),
    }).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
  updateContent: (id: number, data: UpdateTemplateContentData, file?: File) =>
    uploadFileWithMethod<Template>(`/templates/${id}/content`, 'PUT', file, data).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
  deleteTemp: (filename: string) => request<{ message: string }>(`/templates/temp/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  }),
  checkName: (name: string, excludeId?: number) => {
    const searchParams = new URLSearchParams();
    searchParams.append('name', name);
    if (excludeId !== undefined) {
      searchParams.append('excludeId', String(excludeId));
    }
    return request<{ exists: boolean; name: string }>(`/templates/check-name?${searchParams.toString()}`);
  },
  delete: (id: number) =>
    request<void>(`/templates/${id}`, {
      method: 'DELETE',
    }).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
  batchDelete: (ids: number[]) =>
    request<{ message: string; deletedCount: number }>('/templates', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    }).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
  incrementUsage: (id: number) => request<Template>(`/templates/${id}/usage`, {
    method: 'PATCH',
  }),
  update: (id: number, data: UpdateTemplateData) =>
    request<Template>(`/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
};

// 分类相关API
export const categoriesAPI = {
  getAll: () => {
    const currentVersion = getTemplateCacheVersion();
    if (categoriesCache && categoriesCacheVersion === currentVersion) {
      return Promise.resolve(categoriesCache);
    }
    return request<Category[]>('/categories').then((response) => {
      categoriesCache = response;
      categoriesCacheVersion = currentVersion;
      return response;
    });
  },
  getById: (id: number) => request<Category>(`/categories/${id}`),
  create: (data: CreateCategoryData) =>
    request<Category>('/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
  update: (id: number, data: UpdateCategoryData) =>
    request<Category>(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
  delete: (id: number) =>
    request<void>(`/categories/${id}`, {
      method: 'DELETE',
    }).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
  reorder: (categories: { id: number; sort_order: number }[]) =>
    request<Category[]>('/categories/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ categories }),
    }).then((response) => {
      bumpTemplateCacheVersion();
      return response;
    }),
};

// 设计相关API
export const designsAPI = {
  getByOrderId: (orderId: number) => request<Design[]>(`/designs/order/${orderId}`),
  getById: (id: number) => request<Design>(`/designs/${id}`),
  create: (data: CreateDesignData) => request<Design>('/designs', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: number, data: UpdateDesignData, options?: RequestInit) => request<Design>(`/designs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
    ...options,
  }),
  delete: (id: number) => request<void>(`/designs/${id}`, {
    method: 'DELETE',
  }),
  // 新增：带预览图的创建/更新
  createWithPreview: (data: CreateDesignData, file: File) => uploadDesignWithPreview<Design>('/designs', 'POST', data, file),
  updateWithPreview: (id: number, data: UpdateDesignData, file?: File) => uploadDesignWithPreview<Design>(`/designs/${id}`, 'PUT', data, file),
};

// 上传相关API
export const uploadAPI = {
  uploadImage: (file: File) => uploadFile('/upload/image', file),
  uploadFont: (file: File) => uploadFileByField<{ message: string; font: CustomFont }>('/upload/font', file, 'font'),
  getFonts: () => request<CustomFont[]>('/upload/fonts'),
  exportOrder: (orderId: number) => {
    window.open(`${API_BASE_URL}/upload/export/${orderId}`);
  },
  exportBatch: async (orderIds: number[]) => {
    const response = await fetch(`${API_BASE_URL}/upload/export/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderIds }),
    });
    if (!response.ok) {
      throw new Error('批量导出失败');
    }
    return await response.blob();
  },
};

// 类型定义
export interface Order {
  id: number;
  order_number: string;
  customer_name: string;
  phone: string;
  address: string;
  product_category?: string;
  product_model?: string;
  product_specs?: string;
  quantity?: number;
  transaction_time?: string;
  order_notes?: string;
  mark: 'pending_design' | 'pending_confirm' | 'confirmed' | 'exported';
  export_status: 'not_exported' | 'exported';
  exported_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateOrderData {
  order_number: string;
  customer_name: string;
  phone: string;
  address: string;
  product_category?: string;
  product_model?: string;
  product_specs?: string;
  quantity?: number;
  transaction_time?: string;
  order_notes?: string;
  mark?: 'pending_design' | 'pending_confirm' | 'confirmed' | 'exported';
  export_status?: 'not_exported' | 'exported';
}

export interface UpdateOrderData {
  order_number?: string;
  customer_name?: string;
  phone?: string;
  address?: string;
  product_category?: string;
  product_model?: string;
  product_specs?: string;
  quantity?: number;
  transaction_time?: string;
  order_notes?: string;
  mark?: 'pending_design' | 'pending_confirm' | 'confirmed' | 'exported';
  export_status?: 'not_exported' | 'exported';
}

export interface OrderStats {
  total: number;
  pending_design: number;
  pending_confirm: number;
  confirmed: number;
  exported: number;
  exportedToday: number;
  exportedYesterday: number;
  exportedCustom: number;
}

export interface Template {
  id: number;
  name: string;
  image_path: string;
  thumbnail_path?: string;
  category: string;
  source?: string;
  canvas_data?: string | null;
  width?: number | null;
  height?: number | null;
  background_color?: string | null;
  version?: number;
  status?: string;
  template_code?: string | null;
  usage_count?: number;
  pinned?: number;
  created_at: string;
}

export interface CreateTemplateData {
  name: string;
  category?: string;
  canvas_data?: string | null;
  width?: number | null;
  height?: number | null;
  background_color?: string;
  source?: string;
  status?: string;
  template_code?: string;
}

export interface UpdateTemplateData {
  name?: string;
  category?: string;
  pinned?: boolean;
}

export interface CreateTemplateFromTempData {
  name: string;
  category?: string;
  tempFilename: string;
  mimeType?: string;
  canvas_data?: string | null;
  width?: number | null;
  height?: number | null;
  background_color?: string;
  source?: string;
  status?: string;
  template_code?: string;
  version?: number;
}

export interface UpdateTemplateContentData {
  name?: string;
  category?: string;
  canvas_data?: string | null;
  width?: number | null;
  height?: number | null;
  background_color?: string;
  source?: string;
  status?: string;
  template_code?: string;
  version?: number;
}

export interface Category {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryData {
  name: string;
  display_name: string;
  description?: string;
  sort_order?: number;
}

export interface UpdateCategoryData {
  name?: string;
  display_name?: string;
  description?: string;
  sort_order?: number;
}

export interface CustomFont {
  id: number;
  font_family: string;
  display_name: string;
  original_filename: string;
  file_url: string;
  format: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface Design {
  id: number;
  order_id: number;
  name: string;
  canvas_data: string;
  preview_path?: string;
  width: number;
  height: number;
  background_type?: string;
  created_at: string;
  updated_at?: string;
}

export interface CreateDesignData {
  order_id: number;
  name: string;
  canvas_data: string;
  canvas_data_mode?: 'full' | 'patch';
  width?: number;
  height?: number;
  background_type?: string;
}

export interface UpdateDesignData {
  name?: string;
  canvas_data?: string;
  canvas_data_mode?: 'full' | 'patch';
  width?: number;
  height?: number;
  background_type?: string;
}

// 分页响应类型
export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
  filters?: Record<string, any>;
}
