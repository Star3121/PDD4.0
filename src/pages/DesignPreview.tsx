import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { designsAPI, ordersAPI, Order, Design } from '../api';
import { buildImageUrl } from '../lib/utils';
import { renderCanvasToHighResImage } from '../lib/canvasRenderer';
import Layout from '../components/Layout';

type PreviewPageItem = {
  id: string;
  name: string;
  width: number;
  height: number;
  imageUrl: string;
};

const DesignPreview: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [previewPages, setPreviewPages] = useState<PreviewPageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (orderId) {
      loadData();
    }
  }, [orderId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [orderData, designsData] = await Promise.all([
        ordersAPI.getById(Number(orderId)),
        designsAPI.getByOrderId(Number(orderId))
      ]);

      setOrder(orderData);
      
      // Get the latest design with a preview
      if (designsData && designsData.length > 0) {
        // Sort by updated_at descending
        const sorted = designsData.sort((a, b) => 
          new Date(b.updated_at || b.created_at).getTime() - 
          new Date(a.updated_at || a.created_at).getTime()
        );
        setDesign(sorted[0]);
      } else {
        setDesign(null);
      }
    } catch (err) {
      console.error('Failed to load preview data:', err);
      setError('加载预览数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const buildPreviewPages = async () => {
      if (!design) {
        setPreviewPages([]);
        return;
      }
      const fallbackWidth = Number.isFinite(design.width) && design.width > 0 ? design.width : 800;
      const fallbackHeight = Number.isFinite(design.height) && design.height > 0 ? design.height : 600;
      let nextPages: PreviewPageItem[] = [];
      try {
        const parsed = JSON.parse(design.canvas_data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const generatedPages = await Promise.all(parsed.map(async (item: any, index: number) => {
            const width = Number.isFinite(Number(item?.width)) && Number(item?.width) > 0 ? Number(item.width) : fallbackWidth;
            const height = Number.isFinite(Number(item?.height)) && Number(item?.height) > 0 ? Number(item.height) : fallbackHeight;
            const elements = typeof item?.elements === 'string'
              ? item.elements
              : (typeof item?.canvas_data === 'string' ? item.canvas_data : '');
            const imageUrl = await renderCanvasToHighResImage(
              elements || '{"version":"5.3.0","objects":[]}',
              'white',
              false,
              { width, height }
            );
            return {
              id: String(item?.id || `page-${index + 1}`),
              name: String(item?.name || `页面 ${index + 1}`),
              width,
              height,
              imageUrl
            };
          }));
          nextPages = generatedPages;
        }
      } catch (e) {
        console.warn('解析多页面预览失败，回退单图预览', e);
      }

      if (nextPages.length === 0 && design.preview_path) {
        nextPages = [{
          id: 'preview-single',
          name: '页面 1',
          width: fallbackWidth,
          height: fallbackHeight,
          imageUrl: buildImageUrl(design.preview_path)
        }];
      }

      if (!cancelled) {
        setPreviewPages(nextPages);
      }
    };
    buildPreviewPages();
    return () => {
      cancelled = true;
    };
  }, [design]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-red-500">{error || '订单不存在'}</div>
      </div>
    );
  }

  return (
    <Layout title={`设计预览 - ${order.customer_name}`} showBack>
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{order.order_number}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {order.product_specs || '标准规格'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
            >
              打印 / 保存 PDF
            </button>
            <button
              onClick={() => navigate(`/design/${orderId}`)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
            >
              编辑设计
            </button>
          </div>
        </div>

        <div className="p-6 bg-gray-50 min-h-[500px]">
          {previewPages.length > 0 ? (
            <div className="max-h-[75vh] overflow-y-auto pr-2">
              <div className="space-y-6">
                {previewPages.map((page, index) => (
                  <div key={page.id} className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
                    <div className="text-sm font-medium text-gray-700 mb-3">{page.name || `页面 ${index + 1}`}</div>
                    <div className="flex justify-center">
                      <div className="relative shadow-lg rounded-lg overflow-hidden bg-white">
                        <img
                          src={page.imageUrl}
                          alt={`${page.name || `页面 ${index + 1}`} 预览`}
                          className="max-w-full max-h-[65vh] object-contain"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-20">
              <div className="text-6xl mb-4">🖼️</div>
              <p>暂无设计预览图</p>
              <button 
                onClick={() => navigate(`/design/${orderId}`)}
                className="mt-4 text-blue-600 hover:underline"
              >
                前往设计
              </button>
            </div>
          )}
        </div>

        <div className="p-6 bg-white border-t border-gray-100">
          <h3 className="text-sm font-medium text-gray-900 mb-3">订单详情</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">客户姓名</dt>
              <dd className="text-gray-900 mt-1">{order.customer_name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">联系电话</dt>
              <dd className="text-gray-900 mt-1">{order.phone}</dd>
            </div>
            <div>
              <dt className="text-gray-500">收货地址</dt>
              <dd className="text-gray-900 mt-1">{order.address}</dd>
            </div>
            {order.order_notes && (
              <div className="sm:col-span-3">
                <dt className="text-gray-500">备注</dt>
                <dd className="text-gray-900 mt-1">{order.order_notes}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </Layout>
  );
};

export default DesignPreview;
