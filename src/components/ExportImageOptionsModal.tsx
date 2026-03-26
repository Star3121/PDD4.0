import React, { useEffect } from 'react';

type ExportBackgroundType = 'white' | 'transparent';
type ExportImageFormat = 'png' | 'jpg';

interface ExportImageOptionsModalProps {
  isOpen: boolean;
  isLoading: boolean;
  backgroundType: ExportBackgroundType;
  imageFormat: ExportImageFormat;
  onBackgroundTypeChange: (value: ExportBackgroundType) => void;
  onImageFormatChange: (value: ExportImageFormat) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const ExportImageOptionsModal: React.FC<ExportImageOptionsModalProps> = ({
  isOpen,
  isLoading,
  backgroundType,
  imageFormat,
  onBackgroundTypeChange,
  onImageFormatChange,
  onConfirm,
  onCancel
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!isLoading) onCancel();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!isLoading) onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel, onConfirm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">导出图片设置</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded p-1 text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="mb-3 text-sm font-medium text-gray-800">图片背景类型</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50">
                <input
                  type="radio"
                  name="export-background-type"
                  value="transparent"
                  checked={backgroundType === 'transparent'}
                  onChange={() => onBackgroundTypeChange('transparent')}
                  disabled={isLoading}
                  className="h-4 w-4"
                />
                <span className="ml-2 text-sm text-gray-700">透明底图</span>
              </label>
              <label className="flex cursor-pointer items-center rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50">
                <input
                  type="radio"
                  name="export-background-type"
                  value="white"
                  checked={backgroundType === 'white'}
                  onChange={() => onBackgroundTypeChange('white')}
                  disabled={isLoading}
                  className="h-4 w-4"
                />
                <span className="ml-2 text-sm text-gray-700">白底图</span>
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4">
            <div className="mb-3 text-sm font-medium text-gray-800">图片格式</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50">
                <input
                  type="radio"
                  name="export-image-format"
                  value="png"
                  checked={imageFormat === 'png'}
                  onChange={() => onImageFormatChange('png')}
                  disabled={isLoading}
                  className="h-4 w-4"
                />
                <span className="ml-2 text-sm text-gray-700">PNG</span>
              </label>
              <label className="flex cursor-pointer items-center rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50">
                <input
                  type="radio"
                  name="export-image-format"
                  value="jpg"
                  checked={imageFormat === 'jpg'}
                  onChange={() => onImageFormatChange('jpg')}
                  disabled={isLoading}
                  className="h-4 w-4"
                />
                <span className="ml-2 text-sm text-gray-700">JPG</span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading && (
              <svg className="-ml-1 mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            )}
            确认导出
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportImageOptionsModal;
