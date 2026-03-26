import React, { useState, useEffect } from 'react';
import { Order } from '../api/index';

interface OrderEditModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedOrder: Partial<Order>) => Promise<void>;
}

const OrderEditModal: React.FC<OrderEditModalProps> = ({
  order,
  isOpen,
  onClose,
  onSave
}) => {
  const [formData, setFormData] = useState<Partial<Order>>({});
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (order && isOpen) {
      setFormData({
        order_number: order.order_number || '',
        customer_name: order.customer_name || '',
        phone: order.phone || '',
        address: order.address || '',
        product_category: order.product_category || '',
        product_model: order.product_model || '',
        product_specs: order.product_specs || '',
        quantity: order.quantity || 1,
        transaction_time: order.transaction_time || '',
        order_notes: order.order_notes || '',
        mark: order.mark || 'pending_design'
      });
      setErrors({});
    }
  }, [order, isOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'quantity' ? parseInt(value) || 1 : value
    }));
    
    // 清除对应字段的错误
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.order_number?.trim()) {
      newErrors.order_number = '订单号不能为空';
    }
    if (!formData.customer_name?.trim()) {
      newErrors.customer_name = '客户姓名不能为空';
    }
    if (!formData.phone?.trim()) {
      newErrors.phone = '联系电话不能为空';
    }
    if (!formData.address?.trim()) {
      newErrors.address = '收货地址不能为空';
    }
    if (!formData.product_specs?.trim()) {
      newErrors.product_specs = '产品规格不能为空';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      await onSave(formData);
      onClose();
    } catch (error) {
      console.error('保存订单失败:', error);
      alert('保存订单失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* 背景遮罩 */}
        <div 
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={handleClose}
        />

        {/* 弹窗内容 */}
        <div className="inline-block w-full max-w-4xl p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">
              编辑订单 - {order?.order_number}
            </h3>
            <button
              onClick={handleClose}
              disabled={loading}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 基本信息 */}
            <div>
              <h4 className="text-base font-medium text-gray-900 mb-4">基本信息</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    订单号 *
                  </label>
                  <input
                    type="text"
                    name="order_number"
                    value={formData.order_number || ''}
                    onChange={handleInputChange}
                    className={`w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.order_number ? 'border-red-500' : 'border-gray-300'
                    }`}
                    disabled={loading}
                  />
                  {errors.order_number && (
                    <p className="mt-1 text-sm text-red-600">{errors.order_number}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    交易时间
                  </label>
                  <input
                    type="text"
                    name="transaction_time"
                    value={formData.transaction_time || ''}
                    onChange={handleInputChange}
                    placeholder="例如: 2023-01-01 12:00:00"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    标记状态
                  </label>
                  <select
                     name="mark"
                     value={formData.mark || 'pending_design'}
                     onChange={handleInputChange}
                     className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                     disabled={loading}
                   >
                     <option value="pending_design">待出图</option>
                     <option value="pending_confirm">待确认</option>
                     <option value="confirmed">已确认</option>
                     <option value="exported">已导出</option>
                   </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    客户姓名 *
                  </label>
                  <input
                    type="text"
                    name="customer_name"
                    value={formData.customer_name || ''}
                    onChange={handleInputChange}
                    className={`w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.customer_name ? 'border-red-500' : 'border-gray-300'
                    }`}
                    disabled={loading}
                  />
                  {errors.customer_name && (
                    <p className="mt-1 text-sm text-red-600">{errors.customer_name}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    联系电话 *
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone || ''}
                    onChange={handleInputChange}
                    className={`w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.phone ? 'border-red-500' : 'border-gray-300'
                    }`}
                    disabled={loading}
                  />
                  {errors.phone && (
                    <p className="mt-1 text-sm text-red-600">{errors.phone}</p>
                  )}
                </div>
              </div>
            </div>

            {/* 收货信息 */}
            <div>
              <h4 className="text-base font-medium text-gray-900 mb-4">收货信息</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    收货地址 *
                  </label>
                  <textarea
                    name="address"
                    value={formData.address || ''}
                    onChange={handleInputChange}
                    rows={2}
                    className={`w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.address ? 'border-red-500' : 'border-gray-300'
                    }`}
                    disabled={loading}
                  />
                  {errors.address && (
                    <p className="mt-1 text-sm text-red-600">{errors.address}</p>
                  )}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    订单备注
                  </label>
                  <textarea
                    name="order_notes"
                    value={formData.order_notes || ''}
                    onChange={handleInputChange}
                    rows={2}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            {/* 产品信息 */}
            <div>
              <h4 className="text-base font-medium text-gray-900 mb-4">产品信息</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    产品分类
                  </label>
                  <input
                    type="text"
                    name="product_category"
                    value={formData.product_category || ''}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="可手动填写或从下拉建议中选择"
                    list="order-edit-product-category-options"
                    disabled={loading}
                  />
                  <datalist id="order-edit-product-category-options">
                    <option value="人物抱枕" />
                    <option value="宠物抱枕" />
                    <option value="法兰绒毛毯" />
                    <option value="羊羔绒毛毯" />
                    <option value="水晶绒地毯" />
                    <option value="仿羊绒地毯" />
                    <option value="丝圈地毯" />
                    <option value="挂布" />
                    <option value="马克杯" />
                    <option value="其他" />
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    产品型号
                  </label>
                  <input
                    type="text"
                    name="product_model"
                    value={formData.product_model || ''}
                    onChange={handleInputChange}
                    placeholder="例如: A款"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    产品规格 *
                  </label>
                  <input
                    type="text"
                    name="product_specs"
                    value={formData.product_specs || ''}
                    onChange={handleInputChange}
                    placeholder="例如: 150x200cm"
                    className={`w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.product_specs ? 'border-red-500' : 'border-gray-300'
                    }`}
                    disabled={loading}
                  />
                  {errors.product_specs && (
                    <p className="mt-1 text-sm text-red-600">{errors.product_specs}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    数量
                  </label>
                  <input
                    type="number"
                    name="quantity"
                    value={formData.quantity || 1}
                    onChange={handleInputChange}
                    min="1"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end gap-4 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                保存更改
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default OrderEditModal;
