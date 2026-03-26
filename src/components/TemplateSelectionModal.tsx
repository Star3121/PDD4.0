import React, { useState, useEffect } from 'react';
import { Template } from '../api/index';
import { buildImageUrl, buildThumbnailUrl } from '../lib/utils';
import { useTemplates } from '../hooks/useTemplates';
import Pagination from './Pagination';

interface TemplateSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplateSelect: (template: Template) => void;
}

const TemplateSelectionModal: React.FC<TemplateSelectionModalProps> = ({
  isOpen,
  onClose,
  onTemplateSelect
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { templates, categories, loading, total, totalPages } = useTemplates({
    page: currentPage,
    pageSize,
    search: activeSearchQuery,
    category: selectedCategory,
    enabled: isOpen
  });

  const getCategoryDisplayName = (categoryName: string) => {
    const category = categories.find(cat => cat.name === categoryName);
    return category ? category.display_name : categoryName;
  };

  const handleTemplateClick = (template: Template) => {
    onTemplateSelect(template);
    onClose();
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleSearch = () => {
    setActiveSearchQuery(searchQuery);
    setCurrentPage(1); // 重置到第一页
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value);
    setCurrentPage(1); // 重置到第一页
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-11/12 h-5/6 max-w-6xl flex flex-col">
        {/* 弹窗头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">选择模板</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 搜索和筛选 */}
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex gap-4">
            <div className="flex-1 flex gap-2">
              <input
                type="text"
                placeholder="搜索模板..."
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSearch}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                搜索
              </button>
            </div>
            <div className="w-48">
              <select
                value={selectedCategory}
                onChange={handleCategoryChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部分类</option>
                {categories.map(category => (
                  <option key={category.id} value={category.name}>
                    {category.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 模板网格 */}
        <div className="flex-1 p-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">加载中...</div>
            </div>
          ) : templates.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">暂无模板</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {templates.map(template => (
                <div
                  key={template.id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleTemplateClick(template)}
                >
                  <div className="aspect-square overflow-hidden rounded-t-lg">
                    <img
                      src={buildThumbnailUrl(template.image_path, 'thumb')}
                      alt={template.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = buildImageUrl(template.image_path);
                      }}
                    />
                  </div>
                  <div className="p-2">
                    <h3 className="font-medium text-gray-900 text-xs truncate" title={template.name}>
                      {template.name}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1 truncate" title={getCategoryDisplayName(template.category)}>
                      {getCategoryDisplayName(template.category)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 分页 */}
        {(totalPages > 1 || pageSize !== 10) && (
          <div className="border-t border-gray-200 bg-gray-50">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              total={total}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
              pageSizeOptions={[10, 20, 50]}
              showPageInfo={false}
              className="px-4 py-3"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateSelectionModal;
