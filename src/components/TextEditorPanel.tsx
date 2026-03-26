import React, { useState, useEffect } from 'react';

interface TextEditorPanelProps {
  initialValues?: {
    text: string;
    fontFamily: string;
    fontSize: number;
    fill: string;
    letterSpacing: number;
    curve: number;
    stroke: string | null;
    strokeWidth: number;
  };
  onUpdate: (values: {
    text?: string;
    fontFamily?: string;
    fontSize?: number;
    fill?: string;
    letterSpacing?: number;
    curve?: number;
    stroke?: string | null;
    strokeWidth?: number;
  }, isFinal: boolean) => void;
  onUploadFont?: (file: File) => void;
  customFonts?: Array<{ name: string; value: string }>;
}

const FONTS = [
  { name: 'Arial', value: 'Arial' },
  { name: 'Times New Roman', value: 'Times New Roman' },
  { name: 'Courier New', value: 'Courier New' },
  { name: 'Georgia', value: 'Georgia' },
  { name: 'Verdana', value: 'Verdana' },
  // Add more default fonts or Google Fonts here
];

const PRESET_COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
  '#FFFF00', '#00FFFF', '#FF00FF', '#C0C0C0', '#808080',
];

const TextEditorPanel: React.FC<TextEditorPanelProps> = ({
  initialValues = {
    text: '',
    fontFamily: 'Arial',
    fontSize: 40,
    fill: '#000000',
    letterSpacing: 0,
    curve: 0,
    stroke: null,
    strokeWidth: 0,
  },
  onUpdate,
  onUploadFont,
  customFonts = [],
}) => {
  const [values, setValues] = useState(initialValues);
  const mergedFonts = [...FONTS];
  customFonts.forEach((font) => {
    if (!mergedFonts.some((item) => item.value === font.value)) {
      mergedFonts.push(font);
    }
  });

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const handleChange = (key: string, value: any, isFinal: boolean = true) => {
    const newValues = { ...values, [key]: value };
    setValues(newValues);
    onUpdate({ [key]: value }, isFinal);
  };

  const handleFontUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUploadFont?.(e.target.files[0]);
    }
    e.target.value = '';
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 w-full max-w-xs">
      <h3 className="text-lg font-semibold mb-4">文字编辑</h3>

      {/* Text Content */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">内容</label>
        <textarea
          value={values.text}
          onChange={(e) => handleChange('text', e.target.value, false)}
          onBlur={(e) => handleChange('text', e.target.value, true)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={2}
        />
      </div>

      {/* Font Family */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">字体</label>
        <select
          value={values.fontFamily}
          onChange={(e) => handleChange('fontFamily', e.target.value, true)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {mergedFonts.map((font) => (
            <option key={font.value} value={font.value}>
              {font.name}
            </option>
          ))}
        </select>
        <div className="mt-2">
           <label className="block text-xs text-gray-500 mb-1">上传字体 (TTF/OTF/WOFF2，最大15MB)</label>
           <input
             type="file"
             accept=".ttf,.otf,.woff2"
             onChange={handleFontUpload}
             className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
           />
        </div>
      </div>

      {/* Font Size */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          大小 ({values.fontSize}px)
        </label>
        <input
          type="range"
          min="8"
          max="200"
          step="1"
          value={values.fontSize}
          onChange={(e) => handleChange('fontSize', parseInt(e.target.value), false)}
          onMouseUp={(e) => handleChange('fontSize', parseInt((e.target as HTMLInputElement).value), true)}
          className="w-full"
        />
      </div>

      {/* Color */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">颜色</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              className={`w-6 h-6 rounded-full border border-gray-300 ${values.fill === color ? 'ring-2 ring-blue-500' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => handleChange('fill', color, true)}
            />
          ))}
        </div>
        <input
          type="color"
          value={values.fill}
          onChange={(e) => handleChange('fill', e.target.value, false)}
          onBlur={(e) => handleChange('fill', e.target.value, true)}
          className="w-full h-8 cursor-pointer"
        />
      </div>

      {/* Letter Spacing */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          字间距 ({values.letterSpacing}em)
        </label>
        <input
          type="range"
          min="-500" 
          max="2000"
          step="10" 
          value={values.letterSpacing}
          onChange={(e) => handleChange('letterSpacing', parseInt(e.target.value), false)}
          onMouseUp={(e) => handleChange('letterSpacing', parseInt((e.target as HTMLInputElement).value), true)}
          className="w-full"
        />
         <div className="text-xs text-gray-500 mt-1">
             Fabric.js uses slightly different units, adjusted for em-like behavior.
             (Note: Fabric's charSpacing is in thousands of em, so 1000 = 1em)
         </div>
      </div>

      {/* Curve (Text on Path) */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          文字弧度 ({values.curve})
        </label>
        <input
          type="range"
          min="-100"
          max="100"
          step="1"
          value={values.curve}
          onChange={(e) => handleChange('curve', parseInt(e.target.value), false)}
          onMouseUp={(e) => handleChange('curve', parseInt((e.target as HTMLInputElement).value), true)}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
            <span>向下弯曲</span>
            <span>直线</span>
            <span>向上弯曲</span>
        </div>
      </div>

      {/* Text Outline */}
      <div className="mb-4 border-t pt-4">
        <h4 className="text-sm font-semibold mb-2">文字轮廓</h4>
        
        {/* Enable/Disable Toggle - Simplified as Color Selection */}
        <div className="mb-2">
          <label className="block text-xs text-gray-500 mb-1">轮廓颜色 (点击选择，透明为无)</label>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              className={`w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center ${!values.stroke ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => handleChange('stroke', null, true)}
              title="无轮廓"
            >
              <span className="block w-4 h-0.5 bg-red-500 transform rotate-45"></span>
            </button>
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                className={`w-6 h-6 rounded-full border border-gray-300 ${values.stroke === color ? 'ring-2 ring-blue-500' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => handleChange('stroke', color, true)}
              />
            ))}
          </div>
          <input
            type="color"
            value={values.stroke || '#000000'}
            onChange={(e) => handleChange('stroke', e.target.value, false)}
            onBlur={(e) => handleChange('stroke', e.target.value, true)}
            disabled={!values.stroke}
            className={`w-full h-8 cursor-pointer ${!values.stroke ? 'opacity-50' : ''}`}
          />
        </div>

        {/* Stroke Width */}
        <div className="mb-2">
          <label className="block text-xs text-gray-500 mb-1">
            轮廓粗细 ({values.strokeWidth}px)
          </label>
          <input
            type="range"
            min="0"
            max="20"
            step="0.5"
            value={values.strokeWidth}
            onChange={(e) => handleChange('strokeWidth', parseFloat(e.target.value), false)}
            onMouseUp={(e) => handleChange('strokeWidth', parseFloat((e.target as HTMLInputElement).value), true)}
            disabled={!values.stroke}
            className={`w-full ${!values.stroke ? 'opacity-50' : ''}`}
          />
        </div>
      </div>
    </div>
  );
};

export default TextEditorPanel;
