import React, { useState, useEffect } from 'react';
import { templatesAPI, categoriesAPI } from '../api';
import { Template, PaginatedResponse, Category } from '../api';
import Pagination from './Pagination';
import { buildImageUrl, buildThumbnailUrl } from '../lib/utils';
import { DEFAULT_CANVAS_PRESETS, CANVAS_SIZE_LIMITS, CanvasPreset } from '../lib/templateUtils';

const CUSTOM_PRESET_STORAGE_KEY = 'templateCanvasPresets';

interface TemplateLibraryProps {
  onTemplateSelect: (template: Template) => void;
  onTemplateUpload?: () => void;
}

const TemplateLibrary: React.FC<TemplateLibraryProps> = ({ 
  onTemplateSelect, 
  onTemplateUpload 
}) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTemplates, setSelectedTemplates] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadName, setUploadName] = useState('');
  const [uploadCategory, setUploadCategory] = useState('default');
  const [uploading, setUploading] = useState(false);
  const [designModalOpen, setDesignModalOpen] = useState(false);
  const [designName, setDesignName] = useState('');
  const [designCategory, setDesignCategory] = useState('default');
  const [designWidth, setDesignWidth] = useState(DEFAULT_CANVAS_PRESETS[0]?.width || 3000);
  const [designHeight, setDesignHeight] = useState(DEFAULT_CANVAS_PRESETS[0]?.height || 4000);
  const [designBackgroundColor, setDesignBackgroundColor] = useState('#FFFFFF');
  const [canvasPresets, setCanvasPresets] = useState<CanvasPreset[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_CANVAS_PRESETS;
    try {
      const saved = window.localStorage.getItem(CUSTOM_PRESET_STORAGE_KEY);
      if (!saved) return DEFAULT_CANVAS_PRESETS;
      const parsed = JSON.parse(saved) as CanvasPreset[];
      return [...DEFAULT_CANVAS_PRESETS, ...parsed.map((preset) => ({ ...preset, isCustom: true }))];
    } catch {
      return DEFAULT_CANVAS_PRESETS;
    }
  });
  const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_CANVAS_PRESETS[0]?.id || '');
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetWidth, setNewPresetWidth] = useState('');
  const [newPresetHeight, setNewPresetHeight] = useState('');
  
  // 分类相关状态
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDisplayName, setNewCategoryDisplayName] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<'name' | 'category' | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');
  const [editingTemplateCategory, setEditingTemplateCategory] = useState('');
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (categories.length === 0) return;
    if (!categories.some((category) => category.name === designCategory)) {
      setDesignCategory(categories[0].name);
    }
  }, [categories, designCategory]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'templateLibraryRefresh') {
        fetchTemplates();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [currentPage, pageSize, activeSearchQuery, selectedCategory]);

  // 监听分页参数变化
  useEffect(() => {
    fetchTemplates();
  }, [currentPage, pageSize, activeSearchQuery, selectedCategory]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);

      const params = {
        page: currentPage,
        pageSize,
        search: activeSearchQuery.trim(),
        category: selectedCategory === 'all' ? undefined : selectedCategory,
      };
      
      const response = await templatesAPI.getAll(params);
      
      if ('data' in response) {
        // 新的分页API响应格式
        setTemplates(response.data);
        setTotal(response.pagination.total);
        setTotalPages(response.pagination.totalPages);
      } else {
        // 兼容旧的API响应格式
        setTemplates(response);
        setTotal(response.length);
        setTotalPages(Math.ceil(response.length / pageSize));
      }
    } catch (error) {
      console.error('获取模板失败:', error);
      alert('获取模板失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const images = files.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) {
      alert('请选择图片文件');
      return;
    }
    setUploadFiles(images);
    if (!uploadName && images.length === 1) {
      setUploadName(images[0].name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) {
      alert('请至少选择一张图片');
      return;
    }

    try {
      setUploading(true);
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        const name = uploadFiles.length === 1 ? uploadName || file.name.replace(/\.[^/.]+$/, '') : file.name.replace(/\.[^/.]+$/, '');
        await templatesAPI.create(file, { name, category: uploadCategory });
      }
      alert('模板上传成功');
      setUploadModalOpen(false);
      setUploadFiles([]);
      setUploadName('');
      setUploadCategory('default');
      fetchTemplates();
      if (onTemplateUpload) onTemplateUpload();
    } catch (error) {
      console.error('模板上传失败:', error);
      alert('模板上传失败，请稍后重试');
    } finally {
      setUploading(false);
    }
  };

  const persistCustomPresets = (presets: CanvasPreset[]) => {
    if (typeof window === 'undefined') return;
    const customPresets = presets.filter((preset) => preset.isCustom);
    window.localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY, JSON.stringify(customPresets));
  };

  const handleOpenDesignModal = () => {
    const defaultPreset = DEFAULT_CANVAS_PRESETS[0];
    if (defaultPreset) {
      setDesignWidth(defaultPreset.width);
      setDesignHeight(defaultPreset.height);
      setSelectedPresetId(defaultPreset.id);
    } else {
      setSelectedPresetId('');
      setDesignWidth(3000);
      setDesignHeight(4000);
    }
    setDesignBackgroundColor('#FFFFFF');
    setDesignName('');
    setDesignCategory(categories[0]?.name || 'default');
    setDesignModalOpen(true);
  };

  const handlePresetSelect = (preset: CanvasPreset) => {
    setSelectedPresetId(preset.id);
    setDesignWidth(preset.width);
    setDesignHeight(preset.height);
  };

  const handleAddPreset = () => {
    const name = newPresetName.trim();
    const width = Number(newPresetWidth);
    const height = Number(newPresetHeight);
    if (!name) {
      alert('请输入尺寸方案名称');
      return;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      alert('请输入有效的宽度和高度');
      return;
    }
    if (width < CANVAS_SIZE_LIMITS.min || width > CANVAS_SIZE_LIMITS.max || height < CANVAS_SIZE_LIMITS.min || height > CANVAS_SIZE_LIMITS.max) {
      alert(`尺寸范围为 ${CANVAS_SIZE_LIMITS.min}px - ${CANVAS_SIZE_LIMITS.max}px`);
      return;
    }
    const newPreset: CanvasPreset = {
      id: `custom-${Date.now()}`,
      name,
      width,
      height,
      isCustom: true
    };
    const nextPresets = [...canvasPresets, newPreset];
    setCanvasPresets(nextPresets);
    persistCustomPresets(nextPresets);
    setNewPresetName('');
    setNewPresetWidth('');
    setNewPresetHeight('');
  };

  const handleDeletePreset = (presetId: string) => {
    const nextPresets = canvasPresets.filter((preset) => preset.id !== presetId);
    setCanvasPresets(nextPresets);
    persistCustomPresets(nextPresets);
    if (selectedPresetId === presetId && DEFAULT_CANVAS_PRESETS[0]) {
      handlePresetSelect(DEFAULT_CANVAS_PRESETS[0]);
    } else if (selectedPresetId === presetId) {
      setSelectedPresetId('');
    }
  };

  const handleStartDesign = async () => {
    const name = designName.trim();
    if (!name) {
      alert('请输入模板名称');
      return;
    }
    if (name.length > 30) {
      alert('模板名称不能超过30个字符');
      return;
    }
    const width = Number(designWidth);
    const height = Number(designHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      alert('请输入有效的宽度和高度');
      return;
    }
    if (width < CANVAS_SIZE_LIMITS.min || width > CANVAS_SIZE_LIMITS.max || height < CANVAS_SIZE_LIMITS.min || height > CANVAS_SIZE_LIMITS.max) {
      alert(`尺寸范围为 ${CANVAS_SIZE_LIMITS.min}px - ${CANVAS_SIZE_LIMITS.max}px`);
      return;
    }
    try {
      const result = await templatesAPI.checkName(name);
      if (result.exists) {
        alert('模板名称已存在');
        return;
      }
    } catch (error) {
      console.error('模板名称校验失败:', error);
      alert('模板名称校验失败，请稍后重试');
      return;
    }
    const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const params = new URLSearchParams({
      name,
      category: designCategory,
      width: String(width),
      height: String(height),
      backgroundColor: designBackgroundColor,
      draftId
    });
    window.open(`/template-design?${params.toString()}`, '_blank');
    setDesignModalOpen(false);
  };

  const handleEditTemplateDesign = (template: Template) => {
    window.open(`/template-design?templateId=${template.id}`, '_blank');
  };

  const handleSelectTemplate = (templateId: number) => {
    const newSelected = new Set(selectedTemplates);
    if (newSelected.has(templateId)) {
      newSelected.delete(templateId);
    } else {
      newSelected.add(templateId);
    }
    setSelectedTemplates(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedTemplates.size === templates.length) {
      // 如果已全选，则取消全选
      setSelectedTemplates(new Set());
    } else {
      // 否则全选当前页的模板
      const allIds = new Set(templates.map(template => template.id));
      setSelectedTemplates(allIds);
    }
  };

  // 分页处理函数
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedTemplates(new Set()); // 切换页面时清空选择
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // 重置到第一页
    setSelectedTemplates(new Set()); // 清空选择
  };

  // 搜索处理函数
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  const handleSearch = () => {
    setActiveSearchQuery(searchQuery);
    setCurrentPage(1); // 重置到第一页
    setSelectedTemplates(new Set()); // 清空选择
  };

  // 分类筛选处理函数
  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setCurrentPage(1); // 重置到第一页
    setSelectedTemplates(new Set()); // 清空选择
  };

  const handleBatchDelete = async () => {
    if (selectedTemplates.size === 0) return;
    
    if (window.confirm(`确定要删除选中的 ${selectedTemplates.size} 个模板吗？此操作不可撤销。`)) {
      try {
        // 使用批量删除API
        const templateIds = Array.from(selectedTemplates);
        const result = await templatesAPI.batchDelete(templateIds);
        
        // 重新获取模板列表
        await fetchTemplates();
        
        // 清空选择
        setSelectedTemplates(new Set());
        
        alert(result.message);
      } catch (error) {
        console.error('批量删除失败:', error);
        alert('批量删除失败，请重试');
      }
    }
  };

  const deleteTemplate = async (templateId: number) => {
    if (!confirm('确定要删除这个模板吗？')) return;
    try {
      await templatesAPI.delete(templateId);
      setTemplates(templates.filter(t => t.id !== templateId));
      // 如果删除的模板在选中列表中，也要移除
      if (selectedTemplates.has(templateId)) {
        const newSelected = new Set(selectedTemplates);
        newSelected.delete(templateId);
        setSelectedTemplates(newSelected);
      }
      alert('模板删除成功');
    } catch (error) {
      console.error('删除模板失败:', error);
      alert('删除模板失败，请稍后重试');
    }
  };

  const handleTogglePin = async (template: Template) => {
    const nextPinned = template.pinned ? false : true;
    try {
      await templatesAPI.update(template.id, { pinned: nextPinned });
      fetchTemplates();
    } catch (error) {
      console.error('更新模板置顶状态失败:', error);
      alert('更新模板置顶状态失败，请稍后重试');
    }
  };

  // 获取分类数据
  const fetchCategories = async () => {
    try {
      const categoriesData = await categoriesAPI.getAll();
      setCategories(categoriesData);
    } catch (error) {
      console.error('获取分类失败:', error);
    }
  };

  // 获取分类显示名称
  const getCategoryDisplayName = (categoryName: string) => {
    if (categoryName === 'all') return '全部';
    const category = categories.find(cat => cat.name === categoryName);
    return category ? category.display_name : categoryName;
  };

  // 分类管理功能
  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || !newCategoryDisplayName.trim()) {
      alert('请输入分类名称和显示名称');
      return;
    }

    try {
      await categoriesAPI.create({
        name: newCategoryName.trim(),
        display_name: newCategoryDisplayName.trim(),
        description: '',
        sort_order: categories.length
      });
      
      setNewCategoryName('');
      setNewCategoryDisplayName('');
      setCategoryModalOpen(false);
      fetchCategories();
      alert('分类创建成功');
    } catch (error) {
      console.error('创建分类失败:', error);
      alert('创建分类失败，请稍后重试');
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !newCategoryDisplayName.trim()) {
      alert('请输入显示名称');
      return;
    }

    try {
      await categoriesAPI.update(editingCategory.id, {
        display_name: newCategoryDisplayName.trim(),
        description: editingCategory.description,
        sort_order: editingCategory.sort_order
      });
      
      setEditingCategory(null);
      setNewCategoryDisplayName('');
      fetchCategories();
      alert('分类更新成功');
    } catch (error) {
      console.error('更新分类失败:', error);
      alert('更新分类失败，请稍后重试');
    }
  };

  const handleDeleteCategory = async (categoryId: number) => {
    const category = categories.find(cat => cat.id === categoryId);
    if (!category) return;

    if (category.is_default) {
      alert('默认分类不能删除');
      return;
    }

    const confirmDelete = window.confirm(
      `确定要删除分类"${category.display_name}"吗？\n\n注意：删除分类后，该分类下的所有模板将被移动到"默认"分类。`
    );

    if (!confirmDelete) return;

    try {
      await categoriesAPI.delete(categoryId);
      fetchCategories();
      fetchTemplates(); // 重新获取模板数据
      alert('分类删除成功');
    } catch (error) {
      console.error('删除分类失败:', error);
      alert('删除分类失败，请稍后重试');
    }
  };

  const startEditCategory = (category: Category) => {
    setEditingCategory(category);
    setNewCategoryDisplayName(category.display_name);
    setCategoryModalOpen(true);
  };

  // 模板编辑功能
  const startEditTemplate = (template: Template, field: 'name' | 'category') => {
    setEditingTemplateId(template.id);
    setEditingField(field);
    setEditingTemplateName(template.name);
    setEditingTemplateCategory(template.category);
  };

  const handleUpdateTemplate = async (updates?: { name?: string; category?: string }) => {
    if (!editingTemplateId) return;
    
    const nameToUpdate = updates?.name ?? editingTemplateName.trim();
    // 如果没有提供 name 更新且当前 input 为空，则提示
    if (!nameToUpdate) {
      alert('请输入模板名称');
      return;
    }

    const categoryToUpdate = updates?.category ?? editingTemplateCategory;

    try {
      await templatesAPI.update(editingTemplateId, {
        name: nameToUpdate,
        category: categoryToUpdate
      });
      
      setEditingTemplateId(null);
      setEditingField(null);
      setEditingTemplateName('');
      setEditingTemplateCategory('');
      fetchTemplates();
      // alert('模板更新成功'); // 移除 alert 以优化体验
    } catch (error) {
      console.error('更新模板失败:', error);
      alert('更新模板失败，请稍后重试');
    }
  };

  const cancelEditTemplate = () => {
    setEditingTemplateId(null);
    setEditingField(null);
    setEditingTemplateName('');
    setEditingTemplateCategory('');
  };

  // 现在过滤在后端完成，直接使用 templates
  const filteredTemplates = templates;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800">模板库</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索模板名称"
              className="w-48 px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={handleSearch}
              className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm flex items-center gap-1"
            >
              搜索
            </button>
          </div>
          <button
            onClick={handleOpenDesignModal}
            className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded text-sm flex items-center gap-1 shadow-sm"
          >
            设计模板
          </button>
          {filteredTemplates.length > 0 && (
            <button
              onClick={handleSelectAll}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm flex items-center gap-1 border border-gray-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {selectedTemplates.size === filteredTemplates.length ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
              {selectedTemplates.size === filteredTemplates.length ? '取消全选' : '全选'}
            </button>
          )}
          {selectedTemplates.size > 0 && (
            <button
              onClick={handleBatchDelete}
              className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              批量删除 ({selectedTemplates.size})
            </button>
          )}
          <button
            onClick={() => setUploadModalOpen(true)}
            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-sm flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            批量上传
          </button>
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="flex gap-2 mb-4 overflow-x-auto items-center">
        <button
          key="all"
          onClick={() => handleCategoryChange('all')}
          className={`px-3 py-1 rounded text-sm whitespace-nowrap ${
            selectedCategory === 'all'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          全部
        </button>
        {categories.map(category => (
          <div key={category.id} className="flex items-center gap-1">
            <button
              onClick={() => handleCategoryChange(category.name)}
              className={`px-3 py-1 rounded text-sm whitespace-nowrap ${
                selectedCategory === category.name
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {category.display_name}
            </button>
            <button
              onClick={() => startEditCategory(category)}
              className="text-gray-400 hover:text-blue-500 p-1"
              title="编辑分类"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            {!category.is_default && (
              <button
                onClick={() => handleDeleteCategory(category.id)}
                className="text-gray-400 hover:text-red-500 p-1"
                title="删除分类"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => {
            setEditingCategory(null);
            setNewCategoryName('');
            setNewCategoryDisplayName('');
            setCategoryModalOpen(true);
          }}
          className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded text-sm flex items-center gap-1 whitespace-nowrap"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          添加分类
        </button>
      </div>

      {/* 模板网格 */}
      {filteredTemplates.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p>暂无模板</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredTemplates.map(template => (
            <div
              key={template.id}
              className={`relative group border rounded-xl overflow-hidden hover:shadow-md transition-all aspect-[4/5] bg-white ${
                selectedTemplates.has(template.id) 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-200'
              }`}
            >
              {/* 复选框 */}
              <div className="absolute top-2 left-2 z-10">
                <input
                  type="checkbox"
                  checked={selectedTemplates.has(template.id)}
                  onChange={() => handleSelectTemplate(template.id)}
                  className="w-4 h-4 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              
              <button
                type="button"
                className="w-full h-[72%] bg-gray-50 p-2 cursor-pointer"
                onClick={() => onTemplateSelect(template)}
              >
                <img
                  src={buildThumbnailUrl(template.image_path, 'thumb')}
                  onError={(e) => {
                    e.currentTarget.src = buildImageUrl(template.image_path);
                  }}
                  alt={template.name}
                  className="w-full h-full object-contain"
                />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditTemplateDesign(template);
                }}
                className="absolute inset-x-3 top-16 bg-white/90 hover:bg-white text-gray-800 text-xs font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity shadow"
              >
                编辑设计
              </button>
              <div className="p-2 pt-[0.275rem]">
                {editingTemplateId === template.id ? (
                  <div className="space-y-1">
                    {editingField === 'name' && (
                      <input
                        type="text"
                        value={editingTemplateName}
                        onChange={(e) => setEditingTemplateName(e.target.value)}
                        className="w-full text-sm border border-gray-300 rounded px-1 py-0.5"
                        onBlur={() => handleUpdateTemplate()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateTemplate();
                          if (e.key === 'Escape') cancelEditTemplate();
                        }}
                        autoFocus
                      />
                    )}
                    {editingField === 'category' && (
                      <select
                        value={editingTemplateCategory}
                        onChange={(e) => {
                          const newCategory = e.target.value;
                          setEditingTemplateCategory(newCategory);
                          handleUpdateTemplate({ category: newCategory });
                        }}
                        onBlur={() => {
                          // 给一点延迟，防止 onChange 先触发了保存，onBlur 又触发取消导致闪烁或逻辑冲突
                          // 但实际上 handleUpdateTemplate 会清除 ID，所以 onBlur 即使触发也无妨，只要不覆盖即可
                          // 简单起见，如果正在保存中（虽然这里没有 loading 状态），或者直接关闭
                          setTimeout(() => {
                             if (editingTemplateId === template.id) {
                               cancelEditTemplate();
                             }
                          }, 200);
                        }}
                        className="w-full text-xs border border-gray-300 rounded px-1 py-0.5"
                        autoFocus
                      >
                        {categories.map(category => (
                          <option key={category.id} value={category.name}>
                            {category.display_name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <p 
                      className="text-sm font-medium text-gray-900 truncate cursor-pointer hover:text-blue-600 hover:bg-gray-50 rounded px-1 -mx-1 transition-colors" 
                      title={template.name}
                      onDoubleClick={() => startEditTemplate(template, 'name')}
                    >
                      {template.name}
                    </p>
                    <p 
                      className="text-xs text-gray-500 cursor-pointer hover:text-blue-600 hover:bg-gray-50 rounded px-1 -mx-1 transition-colors"
                      onDoubleClick={() => startEditTemplate(template, 'category')}
                      title="双击修改分类"
                    >
                      {getCategoryDisplayName(template.category)}
                    </p>
                  </div>
                )}
              </div>
              <div className="absolute top-1 right-1 flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTogglePin(template);
                  }}
                  className={`bg-white/90 hover:bg-white text-gray-700 rounded-full p-1 transition-opacity ${template.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  title={template.pinned ? '取消置顶' : '置顶'}
                >
                  <svg className={`w-3 h-3 ${template.pinned ? 'text-yellow-500' : 'text-gray-500'}`} fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 2.5l2.472 5.007 5.528.804-4 3.9.944 5.501L10 15.51l-4.944 2.601.944-5.501-4-3.9 5.528-.804L10 2.5z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTemplate(template.id);
                  }}
                  className="bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="删除模板"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页组件 */}
      {total > 0 && (
        <div className="mt-6">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            total={total}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            pageSizeOptions={[20]}
            showPageSizeSelector={false}
          />
        </div>
      )}

      {/* 上传模态框 */}
      {uploadModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">批量上传模板</h3>
            
            <div className="space-y-4">
              {uploadFiles.length <= 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">模板名称（单文件时可编辑）</label>
                  <input
                    type="text"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="请输入模板名称"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {categories.map(category => (
                    <option key={category.id} value={category.name}>
                      {category.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">选择图片（可多选）</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {uploadFiles.length > 1 && (
                  <p className="mt-1 text-xs text-gray-500">已选择 {uploadFiles.length} 张图片，名称将自动使用文件名。</p>
                )}
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setUploadModalOpen(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                disabled={uploading}
              >
                取消
              </button>
              <button
                onClick={handleUpload}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                disabled={uploading}
              >
                {uploading ? '上传中...' : '上传'}
              </button>
            </div>
          </div>
        </div>
      )}

      {designModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4">
            <h3 className="text-lg font-semibold mb-4">初始化画布</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">模板名称</label>
                  <input
                    type="text"
                    value={designName}
                    onChange={(e) => setDesignName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="请输入模板名称"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
                  <select
                    value={designCategory}
                    onChange={(e) => setDesignCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {categories.map(category => (
                      <option key={category.id} value={category.name}>
                        {category.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">快捷尺寸方案</label>
                <div className="flex flex-wrap gap-2">
                  {canvasPresets.map((preset) => (
                    <div key={preset.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handlePresetSelect(preset)}
                        className={`px-3 py-1 rounded text-sm border ${
                          selectedPresetId === preset.id
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        {preset.name} {preset.width}×{preset.height}
                      </button>
                      {preset.isCustom && (
                        <button
                          type="button"
                          onClick={() => handleDeletePreset(preset.id)}
                          className="text-gray-400 hover:text-red-500 px-1"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">宽度 (px)</label>
                  <input
                    type="number"
                    min={CANVAS_SIZE_LIMITS.min}
                    max={CANVAS_SIZE_LIMITS.max}
                    value={designWidth}
                    onChange={(e) => setDesignWidth(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">高度 (px)</label>
                  <input
                    type="number"
                    min={CANVAS_SIZE_LIMITS.min}
                    max={CANVAS_SIZE_LIMITS.max}
                    value={designHeight}
                    onChange={(e) => setDesignHeight(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3 items-end">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">新增方案名称</label>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">宽度</label>
                  <input
                    type="number"
                    min={CANVAS_SIZE_LIMITS.min}
                    max={CANVAS_SIZE_LIMITS.max}
                    value={newPresetWidth}
                    onChange={(e) => setNewPresetWidth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">高度</label>
                  <input
                    type="number"
                    min={CANVAS_SIZE_LIMITS.min}
                    max={CANVAS_SIZE_LIMITS.max}
                    value={newPresetHeight}
                    onChange={(e) => setNewPresetHeight(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="col-span-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddPreset}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm"
                  >
                    新增尺寸方案
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">背景色</label>
                  <input
                    type="text"
                    value={designBackgroundColor}
                    onChange={(e) => setDesignBackgroundColor(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-end">
                  <input
                    type="color"
                    value={designBackgroundColor}
                    onChange={(e) => setDesignBackgroundColor(e.target.value)}
                    className="h-10 w-12 cursor-pointer border border-gray-300 rounded"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">尺寸范围：{CANVAS_SIZE_LIMITS.min}px - {CANVAS_SIZE_LIMITS.max}px</p>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setDesignModalOpen(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleStartDesign}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                开始设计
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分类管理模态框 */}
      {categoryModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {editingCategory ? '编辑分类' : '添加分类'}
            </h3>
            <div className="space-y-4">
              {!editingCategory && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">分类标识</label>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="请输入分类标识（英文，如：custom）"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
                <input
                  type="text"
                  value={newCategoryDisplayName}
                  onChange={(e) => setNewCategoryDisplayName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="请输入显示名称（如：自定义）"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setCategoryModalOpen(false);
                  setEditingCategory(null);
                  setNewCategoryName('');
                  setNewCategoryDisplayName('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={editingCategory ? handleUpdateCategory : handleCreateCategory}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {editingCategory ? '更新' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateLibrary;
