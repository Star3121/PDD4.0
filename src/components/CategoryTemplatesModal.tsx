import React, { useState, useEffect } from 'react';
import { Template } from '../api/index';
import { buildImageUrl, buildThumbnailUrl } from '../lib/utils';
import { useTemplates } from '../hooks/useTemplates';
import Pagination from './Pagination';

interface CategoryTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplateSelect: (template: Template) => void;
  category: string;
  categoryName: string;
}

const CategoryTemplatesModal: React.FC<CategoryTemplatesModalProps> = ({
  isOpen,
  onClose,
  onTemplateSelect,
  category,
  categoryName
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1);
    }
  }, [isOpen, category]);

  const { templates, loading, total, totalPages } = useTemplates({
    page: currentPage,
    pageSize,
    search: '',
    category,
    enabled: isOpen
  });

  const handleTemplateSelect = (template: Template) => {
    onTemplateSelect(template);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {categoryName} - 所有模板
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">加载中...</span>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="mt-4 text-gray-500">该分类下暂无模板</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 max-h-96 overflow-y-auto pr-1">
              {templates.map(template => (
                <div
                  key={template.id}
                  onClick={() => handleTemplateSelect(template)}
                  className="group relative bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-blue-300 hover:shadow-md transition-all duration-200 cursor-pointer"
                >
                  {/* 模板图片 */}
                  <div className="aspect-square bg-gray-50 overflow-hidden">
                    <img
                      src={buildThumbnailUrl(template.image_path, 'thumb')}
                      alt={template.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.src = buildImageUrl(template.image_path);
                      }}
                    />
                  </div>
                  
                  {/* 模板信息 */}
                  <div className="p-2">
                    <h4 className="text-xs font-medium text-gray-900 truncate" title={template.name}>
                      {template.name}
                    </h4>
                    <p className="text-[11px] text-gray-500 truncate" title={categoryName}>
                      {categoryName}
                    </p>
                  </div>

                  {/* 悬停效果 */}
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
          )}
        </div>

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
            className="px-6 py-3"
          />
        </div>
      </div>
    </div>
  );
};

export default CategoryTemplatesModal;
