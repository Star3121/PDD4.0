import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ordersAPI } from '../api';
import Layout from '../components/Layout';
import ErrorModal from '../components/ErrorModal';
import BatchErrorModal from '../components/BatchErrorModal';
import { getDoubaoService, OrderRecognitionResult } from '../lib/doubaoService';

interface OrderFormData {
  id: string;
  order_number: string;
  customer_name: string;
  phone: string;
  address: string;
  product_category: string;
  product_model: string;
  product_specs: string;
  quantity: number;
  transaction_time: string;
  order_notes: string;
  saved: boolean;
}

const CreateOrder: React.FC = () => {
  const [orders, setOrders] = useState<OrderFormData[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [savingOrders, setSavingOrders] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // 错误提示状态
  const [errorModal, setErrorModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'error' as 'error' | 'warning' | 'info',
    onConfirm: undefined as (() => void) | undefined,
    confirmText: '确定',
    showConfirm: false
  });

  // 批量错误提示状态
  const [batchErrorModal, setBatchErrorModal] = useState({
    isOpen: false,
    successCount: 0,
    failureCount: 0,
    errors: [] as { orderNumber: string; error: string }[]
  });

  // 订单号重复检测状态
  const [duplicateChecks, setDuplicateChecks] = useState<Record<string, { checking: boolean; isDuplicate: boolean }>>({});

  const generateOrderNumber = () => {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `BD${timestamp}${random}`;
  };

  // 防抖检查订单号重复
  const checkOrderNumberDuplicate = React.useCallback(
    React.useMemo(() => {
      const timeouts: Record<string, NodeJS.Timeout> = {};
      
      return (orderId: string, orderNumber: string) => {
        if (!orderNumber.trim()) {
          setDuplicateChecks(prev => ({
            ...prev,
            [orderId]: { checking: false, isDuplicate: false }
          }));
          return;
        }

        // 清除之前的定时器
        if (timeouts[orderId]) {
          clearTimeout(timeouts[orderId]);
        }

        // 设置检查状态
        setDuplicateChecks(prev => ({
          ...prev,
          [orderId]: { checking: true, isDuplicate: false }
        }));

        // 防抖延迟检查
        timeouts[orderId] = setTimeout(async () => {
          try {
            const result = await ordersAPI.checkOrderNumber(orderNumber);
            setDuplicateChecks(prev => ({
              ...prev,
              [orderId]: { checking: false, isDuplicate: result.exists }
            }));
          } catch (error) {
            console.error('检查订单号重复失败:', error);
            setDuplicateChecks(prev => ({
              ...prev,
              [orderId]: { checking: false, isDuplicate: false }
            }));
          }
          delete timeouts[orderId];
        }, 500); // 500ms 防抖延迟
      };
    }, []),
    []
  );

  const createEmptyOrder = (): OrderFormData => ({
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    order_number: generateOrderNumber(),
    customer_name: '',
    phone: '',
    address: '',
    product_category: '',
    product_model: '',
    product_specs: '',
    quantity: 1,
    transaction_time: '',
    order_notes: '',
    saved: false
  });

  // AI识别文本处理
  const handleTextRecognition = async (text: string) => {
    if (!text.trim()) {
      alert('请输入订单文本');
      return;
    }

    setAiLoading(true);
    try {
      const doubaoService = getDoubaoService();
      const results = await doubaoService.recognizeMultiOrderText(text);
      
      const newOrders = results.map(result => ({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        order_number: result.orderNumber || generateOrderNumber(),
        customer_name: extractCustomerName(result.recipientInfo),
        phone: extractPhone(result.recipientInfo),
        address: extractAddress(result.recipientInfo),
        product_category: result.productCategory,
        product_model: result.productModel,
        product_specs: result.productSpecs,
        quantity: result.quantity || 1,
        transaction_time: result.transactionTime,
        order_notes: result.orderNotes,
        saved: false
      }));
      
      setOrders(newOrders);
      
      // 为所有新订单触发重复检测
      newOrders.forEach(order => {
        checkOrderNumberDuplicate(order.id, order.order_number);
      });
    } catch (error) {
      console.error('AI识别失败:', error);
      alert(`AI识别失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setAiLoading(false);
    }
  };

  // AI识别图片处理
  const handleImageRecognition = async (file: File) => {
    setAiLoading(true);
    try {
      const doubaoService = getDoubaoService();
      const result = await doubaoService.recognizeOrderImage(file);
      
      const newOrder: OrderFormData = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        order_number: result.orderNumber || generateOrderNumber(),
        customer_name: extractCustomerName(result.recipientInfo),
        phone: extractPhone(result.recipientInfo),
        address: extractAddress(result.recipientInfo),
        product_category: result.productCategory,
        product_model: result.productModel,
        product_specs: result.productSpecs,
        quantity: result.quantity || 1,
        transaction_time: result.transactionTime,
        order_notes: result.orderNotes,
        saved: false
      };
      
      setOrders([newOrder]);
      
      // 为新订单触发重复检测
      checkOrderNumberDuplicate(newOrder.id, newOrder.order_number);
    } catch (error) {
      console.error('AI图片识别失败:', error);
      alert(`AI图片识别失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setAiLoading(false);
    }
  };

  // 从收件人信息中提取姓名
  const extractCustomerName = (recipientInfo: string): string => {
    const nameMatch = recipientInfo.match(/姓名：([^|]+)/);
    return nameMatch ? nameMatch[1].trim() : '';
  };

  // 从收件人信息中提取电话
  const extractPhone = (recipientInfo: string): string => {
    const phoneMatch = recipientInfo.match(/电话：([^|]+)/);
    return phoneMatch ? phoneMatch[1].trim() : '';
  };

  // 从收件人信息中提取地址
  const extractAddress = (recipientInfo: string): string => {
    const addressMatch = recipientInfo.match(/地址：(.+)/);
    return addressMatch ? addressMatch[1].trim() : '';
  };

  // 文件上传处理
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        handleImageRecognition(file);
      } else {
        alert('请选择图片文件');
      }
    }
  };

  // 更新订单数据
  const updateOrder = (orderId: string, field: string, value: any) => {
    setOrders(prev => prev.map(order => 
      order.id === orderId 
        ? { ...order, [field]: field === 'quantity' ? parseInt(value) || 1 : value }
        : order
    ));

    // 如果修改的是订单号，触发重复检测
    if (field === 'order_number') {
      checkOrderNumberDuplicate(orderId, value);
    }
  };

  // 删除订单
  const deleteOrder = (orderId: string) => {
    setOrders(prev => prev.filter(order => order.id !== orderId));
  };

  // 保存单个订单
  const saveSingleOrder = async (order: OrderFormData) => {
    if (!order.order_number || !order.customer_name || !order.phone || !order.address || !order.product_specs) {
      alert('请填写所有必填字段');
      return;
    }

    setSavingOrders(prev => new Set(prev).add(order.id));
    try {
      const orderData = {
        order_number: order.order_number,
        customer_name: order.customer_name,
        phone: order.phone,
        address: order.address,
        product_category: order.product_category,
        product_model: order.product_model,
        product_specs: order.product_specs,
        quantity: order.quantity,
        transaction_time: order.transaction_time ? new Date(order.transaction_time).toISOString() : null,
        order_notes: order.order_notes
      };
      
      const savedOrder = await ordersAPI.create(orderData);
      
      // 标记为已保存
      setOrders(prev => prev.map(o => 
        o.id === order.id ? { ...o, saved: true } : o
      ));
      
      // 移除已保存的订单
      setTimeout(() => {
        setOrders(prev => prev.filter(o => o.id !== order.id));
      }, 1000);
      
      // 显示成功提示
      setErrorModal({
        isOpen: true,
        title: '保存成功',
        message: '订单已成功保存！',
        type: 'info',
        onConfirm: undefined,
        confirmText: '确定',
        showConfirm: false
      });
    } catch (error: any) {
      console.error('保存订单失败:', error);
      
      // 处理重复订单号错误
      if (error.response?.data?.code === 'DUPLICATE_ORDER_NUMBER') {
        setErrorModal({
          isOpen: true,
          title: '订单号重复',
          message: `❌ ${error.response.data.details}\n\n💡 系统检测到该订单号已存在，请修改订单号后重试。\n\n🔄 您也可以选择自动生成新的订单号。`,
          type: 'error',
          onConfirm: () => {
            setOrders(prev => prev.map(o => 
              o.id === order.id ? { ...o, order_number: generateOrderNumber() } : o
            ));
          },
          confirmText: '自动生成新订单号',
          showConfirm: true
        });
      } else if (error.response?.data?.error) {
        setErrorModal({
          isOpen: true,
          title: '保存失败',
          message: `❌ ${error.response.data.error}\n\n${error.response.data.details || '请检查输入信息是否正确。'}`,
          type: 'error',
          onConfirm: undefined,
          confirmText: '确定',
          showConfirm: false
        });
      } else {
        setErrorModal({
          isOpen: true,
          title: '网络错误',
          message: '❌ 订单保存失败\n\n🌐 请检查网络连接或联系管理员。',
          type: 'error',
          onConfirm: undefined,
          confirmText: '确定',
          showConfirm: false
        });
      }
    } finally {
      setSavingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(order.id);
        return newSet;
      });
    }
  };

  // 批量保存所有订单
  const saveAllOrders = async () => {
    const unsavedOrders = orders.filter(order => !order.saved);
    
    if (unsavedOrders.length === 0) {
      alert('没有需要保存的订单');
      return;
    }

    // 检查所有订单是否填写完整
    const incompleteOrders = unsavedOrders.filter(order => 
      !order.order_number || !order.customer_name || !order.phone || !order.address || !order.product_specs
    );
    
    if (incompleteOrders.length > 0) {
      alert('请填写所有订单的必填字段');
      return;
    }

    setSavingOrders(new Set(unsavedOrders.map(o => o.id)));
    
    try {
      const results = [];
      const failedOrders = [];
      
      // 逐个保存订单，以便更好地处理错误
      for (const order of unsavedOrders) {
        try {
          const orderData = {
            order_number: order.order_number,
            customer_name: order.customer_name,
            phone: order.phone,
            address: order.address,
            product_category: order.product_category,
            product_model: order.product_model,
            product_specs: order.product_specs,
            quantity: order.quantity,
            transaction_time: order.transaction_time ? new Date(order.transaction_time).toISOString() : null,
            order_notes: order.order_notes
          };
          
          const savedOrder = await ordersAPI.create(orderData);
          results.push({ order, success: true, data: savedOrder });
        } catch (error: any) {
          console.error(`保存订单 ${order.order_number} 失败:`, error);
          
          let errorMessage = '未知错误';
          if (error.response?.data?.code === 'DUPLICATE_ORDER_NUMBER') {
            errorMessage = `订单号重复：${error.response.data.details}`;
          } else if (error.response?.data?.error) {
            errorMessage = error.response.data.error;
          }
          
          results.push({ order, success: false, error: errorMessage });
          failedOrders.push({ order, error: errorMessage });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      
      if (failureCount === 0) {
        // 全部成功
        setErrorModal({
          isOpen: true,
          title: '批量保存成功',
          message: `🎉 成功保存 ${successCount} 个订单！`,
          type: 'info',
          onConfirm: undefined,
          confirmText: '确定',
          showConfirm: false
        });
        setOrders([]);
      } else {
        // 部分失败，移除成功保存的订单
        const failedOrderIds = failedOrders.map(f => f.order.id);
        setOrders(prev => prev.filter(o => failedOrderIds.includes(o.id)));
        
        // 显示批量错误模态框
        setBatchErrorModal({
          isOpen: true,
          successCount,
          failureCount,
          errors: failedOrders.map(f => ({
            orderNumber: f.order.order_number,
            error: f.error
          }))
        });
      }
    } catch (error) {
      console.error('批量保存失败:', error);
      setErrorModal({
        isOpen: true,
        title: '批量保存失败',
        message: '❌ 批量保存过程中发生错误\n\n🌐 请检查网络连接或联系管理员。',
        type: 'error',
        onConfirm: undefined,
        confirmText: '确定',
        showConfirm: false
      });
    } finally {
      setSavingOrders(new Set());
    }
  };

  // 清空所有订单
  const clearAllOrders = () => {
    setOrders([]);
  };

  // 添加新订单
  const addNewOrder = () => {
    const newOrder = createEmptyOrder();
    setOrders(prev => [...prev, newOrder]);
    // 为新订单触发重复检测
    checkOrderNumberDuplicate(newOrder.id, newOrder.order_number);
  };

  return (
     <Layout title="创建订单" showBack={true}>
       <div className="max-w-6xl mx-auto p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">创建订单</h1>
        
        {/* AI识别区域 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">AI智能识别</h2>
          </div>
          <p className="text-gray-600 mb-6">
            支持识别多个订单，AI会自动分析文本或图片中的订单信息并创建对应的订单卡片
          </p>
          
          {/* 文本识别 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              订单文本识别
            </label>
            <div className="flex gap-4">
              <textarea
                id="orderText"
                rows={4}
                className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="粘贴订单文本内容，支持多个订单..."
              />
              <button
                onClick={() => {
                  const textarea = document.getElementById('orderText') as HTMLTextAreaElement;
                  handleTextRecognition(textarea.value);
                }}
                disabled={aiLoading}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {aiLoading ? '识别中...' : '识别文本'}
              </button>
            </div>
          </div>

          {/* 图片识别 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              订单图片识别
            </label>
            <div className="flex gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={aiLoading}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {aiLoading ? '识别中...' : '选择图片'}
              </button>
            </div>
          </div>
        </div>

        {/* 订单列表 */}
        {orders.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                订单列表 ({orders.length} 个订单)
              </h2>
              <div className="flex gap-4">
                <button
                  onClick={addNewOrder}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  添加订单
                </button>
                <button
                  onClick={saveAllOrders}
                  disabled={savingOrders.size > 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  批量保存
                </button>
                <button
                  onClick={clearAllOrders}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  清空所有
                </button>
              </div>
            </div>

            <div className="grid gap-6">
              {orders.map((order, index) => (
                <div key={order.id} className={`bg-white rounded-lg shadow-md p-6 border-l-4 ${order.saved ? 'border-green-500 bg-green-50' : 'border-blue-500'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">
                      订单 #{index + 1} {order.saved && <span className="text-green-600">(已保存)</span>}
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveSingleOrder(order)}
                        disabled={savingOrders.has(order.id) || order.saved}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingOrders.has(order.id) ? '保存中...' : order.saved ? '已保存' : '保存'}
                      </button>
                      <button
                        onClick={() => deleteOrder(order.id)}
                        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        订单号 *
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={order.order_number}
                          onChange={(e) => updateOrder(order.id, 'order_number', e.target.value)}
                          className={`w-full border rounded-md px-3 py-2 pr-10 focus:outline-none focus:ring-2 ${
                            duplicateChecks[order.id]?.isDuplicate
                              ? 'border-red-500 focus:ring-red-500 bg-red-50'
                              : duplicateChecks[order.id]?.checking
                              ? 'border-yellow-500 focus:ring-yellow-500 bg-yellow-50'
                              : 'border-gray-300 focus:ring-blue-500'
                          }`}
                          disabled={order.saved}
                        />
                        
                        {/* 状态指示器 */}
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                          {duplicateChecks[order.id]?.checking && (
                            <div className="animate-spin h-4 w-4 border-2 border-yellow-500 border-t-transparent rounded-full"></div>
                          )}
                          {duplicateChecks[order.id]?.isDuplicate && (
                            <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          )}
                          {!duplicateChecks[order.id]?.checking && !duplicateChecks[order.id]?.isDuplicate && order.order_number.trim() && (
                            <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      </div>
                      
                      {/* 错误提示 */}
                      {duplicateChecks[order.id]?.isDuplicate && (
                        <p className="mt-1 text-sm text-red-600 flex items-center">
                          <svg className="h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          该订单号已存在，请修改
                        </p>
                      )}
                      
                      {/* 检查中提示 */}
                      {duplicateChecks[order.id]?.checking && (
                        <p className="mt-1 text-sm text-yellow-600 flex items-center">
                          <svg className="animate-spin h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          正在检查订单号...
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        客户姓名 *
                      </label>
                      <input
                        type="text"
                        value={order.customer_name}
                        onChange={(e) => updateOrder(order.id, 'customer_name', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={order.saved}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        联系电话 *
                      </label>
                      <input
                        type="tel"
                        value={order.phone}
                        onChange={(e) => updateOrder(order.id, 'phone', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={order.saved}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        收货地址 *
                      </label>
                      <input
                        type="text"
                        value={order.address}
                        onChange={(e) => updateOrder(order.id, 'address', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={order.saved}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        产品规格 *
                      </label>
                      <input
                        type="text"
                        value={order.product_specs}
                        onChange={(e) => updateOrder(order.id, 'product_specs', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="例如: 150x200cm"
                        disabled={order.saved}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        产品类别
                      </label>
                      <input
                        type="text"
                        value={order.product_category}
                        onChange={(e) => updateOrder(order.id, 'product_category', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="可手动填写或从下拉建议中选择"
                        list="product-category-options"
                        disabled={order.saved}
                      />
                      <datalist id="product-category-options">
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
                        value={order.product_model}
                        onChange={(e) => updateOrder(order.id, 'product_model', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={order.saved}
                      />
                    </div>



                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        数量
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={order.quantity}
                        onChange={(e) => updateOrder(order.id, 'quantity', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={order.saved}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        交易时间
                      </label>
                      <input
                        type="datetime-local"
                        value={order.transaction_time}
                        onChange={(e) => updateOrder(order.id, 'transaction_time', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={order.saved}
                      />
                    </div>

                    <div className="md:col-span-2 lg:col-span-3">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        订单备注
                      </label>
                      <textarea
                        rows={2}
                        value={order.order_notes}
                        onChange={(e) => updateOrder(order.id, 'order_notes', e.target.value)}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={order.saved}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 空状态或手动添加订单 */}
        {orders.length === 0 && (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="text-gray-500 mb-4">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无订单</h3>
            <p className="text-gray-500 mb-6">
              使用AI识别功能快速创建订单，或手动添加新订单
            </p>
            <button
              onClick={addNewOrder}
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              手动添加订单
            </button>
          </div>
        )}
      </div>

      {/* 错误提示模态框 */}
      <ErrorModal
        isOpen={errorModal.isOpen}
        title={errorModal.title}
        message={errorModal.message}
        type={errorModal.type}
        onClose={() => setErrorModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={errorModal.onConfirm}
        confirmText={errorModal.confirmText}
        showConfirm={errorModal.showConfirm}
      />

      {/* 批量错误提示模态框 */}
      <BatchErrorModal
        isOpen={batchErrorModal.isOpen}
        successCount={batchErrorModal.successCount}
        failureCount={batchErrorModal.failureCount}
        errors={batchErrorModal.errors}
        onClose={() => setBatchErrorModal(prev => ({ ...prev, isOpen: false }))}
      />
    </Layout>
  );
};

export default CreateOrder;
