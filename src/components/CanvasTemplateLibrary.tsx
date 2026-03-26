import React, { useState, useEffect } from 'react';
import { Template } from '../api/index';
import TemplateSelectionModal from './TemplateSelectionModal';
import CategoryTemplatesModal from './CategoryTemplatesModal';
import { buildImageUrl, buildThumbnailUrl } from '../lib/utils';
import { useTemplates } from '../hooks/useTemplates';

interface CanvasTemplateLibraryProps {
  onTemplateSelect: (template: Template) => void;
  onOpenFullLibrary?: () => void;
}

const CanvasTemplateLibrary: React.FC<CanvasTemplateLibraryProps> = ({ 
  onTemplateSelect,
  onOpenFullLibrary
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMoreModalOpen, setIsMoreModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleSearch = () => {
    setActiveSearchQuery(searchQuery);
    setCurrentPage(1);
  };

  const { templates, categories, loading, total, totalPages } = useTemplates({
    page: currentPage,
    pageSize,
    search: activeSearchQuery,
    category: selectedCategory,
    includeCanvasData: true
  });

  const getCategoryDisplayName = (categoryName: string) => {
    if (categoryName === 'all') return '全部';
    const category = categories.find(cat => cat.name === categoryName);
    return category ? category.display_name : categoryName;
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-col h-full">
      {/* 标题和打开完整库按钮 */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">模板库</h3>
        {onOpenFullLibrary && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            查看全部
          </button>
        )}
      </div>

      {/* 搜索框 */}
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="搜索模板名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full px-3 py-2 pl-10 pr-4 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            {loading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            ) : (
              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setActiveSearchQuery('');
              }}
              className="absolute inset-y-0 right-0 pr-3 flex items-center"
            >
              <svg className="h-4 w-4 text-gray-400 hover:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          搜索
        </button>
      </div>

      {/* 分类筛选 */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button
          onClick={() => handleCategoryChange('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 ${
            selectedCategory === 'all'
              ? 'bg-blue-500 text-white shadow-sm'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          全部
        </button>
        {categories.map(category => (
          <button
            key={category.id}
            onClick={() => handleCategoryChange(category.name)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 ${
              selectedCategory === category.name
                ? 'bg-blue-500 text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {category.display_name}
          </button>
        ))}
      </div>

      {/* 模板网格 */}
      {templates.length === 0 ? (
        <div className="text-center py-8 text-gray-500 flex-1">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {activeSearchQuery ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            )}
          </svg>
          <p className="text-sm">
            {searchQuery ? `未找到包含"${searchQuery}"的模板` : '暂无模板'}
          </p>
          {searchQuery ? (
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-blue-500 hover:text-blue-600 text-sm font-medium"
            >
              清除搜索条件
            </button>
          ) : onOpenFullLibrary && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-2 text-blue-500 hover:text-blue-600 text-sm font-medium"
            >
              去模板库上传模板
            </button>
          )}
        </div>
      ) : (
        <div className={`relative flex-1 min-h-0 overflow-y-auto pr-1 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 gap-3">
            {templates.map(template => (
              <div
                key={template.id}
                onClick={() => onTemplateSelect(template)}
                className="group relative bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-blue-300 hover:shadow-md transition-all duration-200 cursor-pointer"
              >
                <div className="aspect-square bg-gray-50 overflow-hidden">
                  <img
                    src={buildThumbnailUrl(template.image_path, 'thumb')}
                    alt={template.name}
                    className="w-full h-full object-contain bg-gray-50 transition-transform duration-200"
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.src = buildImageUrl(template.image_path);
                    }}
                  />
                </div>
                
                <div className="p-2">
                  <h4 className="text-xs font-medium text-gray-900 truncate" title={template.name}>
                    {template.name}
                  </h4>
                  <p className="text-[11px] text-gray-500 truncate" title={getCategoryDisplayName(template.category)}>
                    {getCategoryDisplayName(template.category)}
                  </p>
                </div>

                <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-10 transition-all duration-200 flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="bg-white rounded-full p-2 shadow-lg">
                      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {[10, 20, 50].map((size) => (
              <option key={size} value={size}>
                {size} / 页
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              className="p-1.5 text-gray-600 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              title="上一页"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-xs text-gray-500">
              {currentPage}/{totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              className="p-1.5 text-gray-600 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              title="下一页"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <button
            onClick={() => setIsMoreModalOpen(true)}
            className="p-1.5 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-100"
            title="更多"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
            </svg>
          </button>
        </div>
      </div>

      {/* 模板选择弹窗 */}
      <TemplateSelectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onTemplateSelect={onTemplateSelect}
      />

      {/* 分类模板弹窗 */}
      <CategoryTemplatesModal
        isOpen={isMoreModalOpen}
        onClose={() => setIsMoreModalOpen(false)}
        onTemplateSelect={onTemplateSelect}
        category={selectedCategory}
        categoryName={getCategoryDisplayName(selectedCategory)}
      />
    </div>
  );
};

export default CanvasTemplateLibrary;
