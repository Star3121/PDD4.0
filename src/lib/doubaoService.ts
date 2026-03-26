// 豆包AI识别服务
// 用于订单信息的文本和图片识别

// 订单识别结果接口
export interface OrderRecognitionResult {
  orderNumber: string;
  transactionTime: string; // YYYY-MM-DDTHH:mm 格式
  productCategory: string;
  productModel: string;
  productSpecs: string;
  quantity: number;
  recipientInfo: string;
  orderNotes: string;
}

// 豆包API配置
const DOUBAO_API_BASE = import.meta.env.VITE_DOUBAO_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';
const DOUBAO_MODEL = import.meta.env.VITE_DOUBAO_MODEL || 'ep-20241016231643-rvmkw'; // 豆包模型ID

class DoubaoService {
  private apiKey: string;
  private apiBase: string;
  private model: string;

  constructor() {
    this.apiKey = import.meta.env.VITE_DOUBAO_API_KEY || '';
    this.apiBase = DOUBAO_API_BASE;
    this.model = DOUBAO_MODEL;
  }

  // 检查API Key是否配置
  private checkApiKey(): boolean {
    if (!this.apiKey) {
      throw new Error('豆包API Key未配置，请在环境变量中设置 VITE_DOUBAO_API_KEY');
    }
    return true;
  }

  // 规范化产品类别
  private normalizeProductCategory(category: string): string {
    if (!category) return '';
    const trimmed = category.trim();
    const text = trimmed.toLowerCase();

    if (text.includes('羊羔绒') && (text.includes('毛毯') || text.includes('毯'))) {
      return '羊羔绒毛毯';
    }
    if ((text.includes('牛奶真丝绒') || text.includes('仿羊绒')) && (text.includes('地毯') || text.includes('毯'))) {
      return '仿羊绒地毯';
    }
    if (text.includes('丝圈') && (text.includes('地毯') || text.includes('毯'))) {
      return '丝圈地毯';
    }
    if ((text.includes('法兰绒') || text.includes('法兰')) && (text.includes('毛毯') || text.includes('毯')) && !text.includes('羊羔绒')) {
      return '法兰绒毛毯';
    }
    if ((text.includes('地毯') || text.includes('毯')) && !text.includes('仿羊绒') && !text.includes('牛奶真丝绒') && !text.includes('丝圈')) {
      return '水晶绒地毯';
    }
    if ((text.includes('宠物') || text.includes('猫') || text.includes('狗')) && (text.includes('抱枕') || text.includes('靠垫'))) {
      return '宠物抱枕';
    }
    if ((text.includes('人物') || text.includes('真人') || text.includes('人形') || text.includes('肖像')) && (text.includes('抱枕') || text.includes('靠垫'))) {
      return '人物抱枕';
    }
    if (text.includes('抱枕') || text.includes('靠垫')) {
      return '人物抱枕';
    }
    if (text.includes('挂布') || text.includes('场景布')) {
      return '挂布';
    }
    if (text.includes('马克杯') || text.includes('杯子')) {
      return '马克杯';
    }
    if (
      trimmed === '人物抱枕' ||
      trimmed === '宠物抱枕' ||
      trimmed === '法兰绒毛毯' ||
      trimmed === '羊羔绒毛毯' ||
      trimmed === '水晶绒地毯' ||
      trimmed === '仿羊绒地毯' ||
      trimmed === '丝圈地毯' ||
      trimmed === '挂布' ||
      trimmed === '马克杯' ||
      trimmed === '其他'
    ) {
      return trimmed;
    }
    return '其他';
  }

  // 调用豆包API的通用方法
  private async callDoubaoAPI(messages: any[]): Promise<string> {
    this.checkApiKey();

    const response = await fetch(`${this.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`豆包API调用失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  // 单个订单文本识别
  async recognizeOrderText(orderText: string): Promise<OrderRecognitionResult> {
    const prompt = `请仔细分析以下订单文本，并按照固定的JSON格式返回订单信息：

订单文本：
${orderText}

重要识别规则：
1. productCategory：只允许以下10个类目之一，必须严格返回其中一个：人物抱枕、宠物抱枕、法兰绒毛毯、羊羔绒毛毯、水晶绒地毯、仿羊绒地毯、丝圈地毯、挂布、马克杯、其他。
   类目判定必须基于订单标题/产品标题里的商品内容，不要根据收件信息或备注猜测。
   详细归类规则：
   - 人物抱枕：标题偏向人形/人物/真人/肖像，且有抱枕或靠垫关键词
   - 宠物抱枕：标题偏向宠物/猫/狗，且有抱枕或靠垫关键词
   - 法兰绒毛毯：标题偏向法兰绒和毛毯；只要是毛毯且不带“羊羔绒”，优先归此类
   - 羊羔绒毛毯：标题偏向羊羔绒和毛毯
   - 水晶绒地毯：标题偏向地毯，且不含“仿羊绒/牛奶真丝绒/丝圈”关键词
   - 仿羊绒地毯：标题偏向仿羊绒或牛奶真丝绒且是地毯
   - 丝圈地毯：标题偏向丝圈且是地毯
   - 挂布：标题偏向挂布或场景布
   - 马克杯：标题偏向马克杯或杯子
   - 其他：与以上都不相关
2. productModel：提取尺寸数据前同一行的中文描述（如"晚安宝贝"、"多头款【黄色背景】"），只要中文部分不包含尺寸
3. productSpecs：只提取尺寸数据（如"150x200cm"），不包含材质/颜色等
4. transactionTime：转成 YYYY-MM-DDTHH:mm 格式
5. quantity：必须是数字类型
6. recipientInfo：规范输出为"姓名：xxx | 电话：xxx | 地址：xxx"。特别注意：如果姓名后紧跟或换行后有“[数字]”（如[1234]），请务必将其包含在姓名中，例如"姓名：王天戈[2931]"
7. 如果某字段找不到，设为空字符串

请返回以下JSON格式，只返回JSON，不要附加文字：
{
  "orderNumber": "",
  "transactionTime": "",
  "productCategory": "",
  "productModel": "",
  "productSpecs": "",
  "quantity": 0,
  "recipientInfo": "",
  "orderNotes": ""
}`;

    const messages = [
      {
        role: 'user',
        content: prompt
      }
    ];

    const result = await this.callDoubaoAPI(messages);
    
    try {
      // 提取JSON部分
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('无法从响应中提取JSON格式数据');
      }
      
      const parsedResult = JSON.parse(jsonMatch[0]);
      
      // 确保quantity是数字类型
      if (typeof parsedResult.quantity === 'string') {
        parsedResult.quantity = parseInt(parsedResult.quantity) || 0;
      }
      
      // 规范化产品类别
      parsedResult.productCategory = this.normalizeProductCategory(parsedResult.productCategory);

      return parsedResult as OrderRecognitionResult;
    } catch (error) {
      throw new Error(`解析识别结果失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  // 多个订单文本识别
  async recognizeMultiOrderText(orderText: string): Promise<OrderRecognitionResult[]> {
    const prompt = `请仔细分析以下文本，识别并分离所有订单，按JSON数组返回：

订单文本：
${orderText}

识别规则：
1. 如何区分不同订单：订单号、收件人、产品信息等明显差异；若只有一个则返回单元素数组
2. 如果日期没有年份，默认使用当前年份
3. recipientInfo 保留中括号数字
4. 确保识别出所有可能订单，即便不完整
5. 字段规则与单订单相同：
   - productCategory：只允许以下10个类目之一，必须严格返回其中一个：人物抱枕、宠物抱枕、法兰绒毛毯、羊羔绒毛毯、水晶绒地毯、仿羊绒地毯、丝圈地毯、挂布、马克杯、其他。
     类目判定必须基于订单标题/产品标题里的商品内容，不要根据收件信息或备注猜测。
     详细归类规则：
     - 人物抱枕：标题偏向人形/人物/真人/肖像，且有抱枕或靠垫关键词
     - 宠物抱枕：标题偏向宠物/猫/狗，且有抱枕或靠垫关键词
     - 法兰绒毛毯：标题偏向法兰绒和毛毯；只要是毛毯且不带“羊羔绒”，优先归此类
     - 羊羔绒毛毯：标题偏向羊羔绒和毛毯
     - 水晶绒地毯：标题偏向地毯，且不含“仿羊绒/牛奶真丝绒/丝圈”关键词
     - 仿羊绒地毯：标题偏向仿羊绒或牛奶真丝绒且是地毯
     - 丝圈地毯：标题偏向丝圈且是地毯
     - 挂布：标题偏向挂布或场景布
     - 马克杯：标题偏向马克杯或杯子
     - 其他：与以上都不相关
   - productModel：提取尺寸数据前同一行的中文描述，只要中文部分不包含尺寸
   - productSpecs：只提取尺寸数据，不包含材质/颜色等
   - transactionTime：转成 YYYY-MM-DDTHH:mm 格式
   - quantity：必须是数字类型
   - recipientInfo：规范输出为"姓名：xxx | 电话：xxx | 地址：xxx"。特别注意：如果姓名后紧跟或换行后有“[数字]”（如[1234]），请务必将其包含在姓名中，例如"姓名：王天戈[2931]"

请返回JSON数组格式，只返回JSON，不要附加文字：
[
  {
    "orderNumber": "",
    "transactionTime": "",
    "productCategory": "",
    "productModel": "",
    "productSpecs": "",
    "quantity": 0,
    "recipientInfo": "",
    "orderNotes": ""
  }
]`;

    const messages = [
      {
        role: 'user',
        content: prompt
      }
    ];

    const result = await this.callDoubaoAPI(messages);
    
    try {
      // 提取JSON数组部分
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('无法从响应中提取JSON数组格式数据');
      }
      
      const parsedResult = JSON.parse(jsonMatch[0]);
      
      // 确保每个订单的quantity是数字类型
      return parsedResult.map((order: any) => ({
        ...order,
        quantity: typeof order.quantity === 'string' ? parseInt(order.quantity) || 0 : order.quantity,
        productCategory: this.normalizeProductCategory(order.productCategory)
      })) as OrderRecognitionResult[];
    } catch (error) {
      throw new Error(`解析识别结果失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  // 图片识别
  async recognizeOrderImage(imageFile: File): Promise<OrderRecognitionResult> {
    // 将图片转换为base64
    const base64Image = await this.fileToBase64(imageFile);
    
    const prompt = `请仔细分析这张订单图片，并按照固定的JSON格式返回订单信息：

重要识别规则：
1. productCategory：只允许以下10个类目之一，必须严格返回其中一个：人物抱枕、宠物抱枕、法兰绒毛毯、羊羔绒毛毯、水晶绒地毯、仿羊绒地毯、丝圈地毯、挂布、马克杯、其他。
   类目判定必须基于订单标题/产品标题里的商品内容，不要根据收件信息或备注猜测。
   详细归类规则：
   - 人物抱枕：标题偏向人形/人物/真人/肖像，且有抱枕或靠垫关键词
   - 宠物抱枕：标题偏向宠物/猫/狗，且有抱枕或靠垫关键词
   - 法兰绒毛毯：标题偏向法兰绒和毛毯；只要是毛毯且不带“羊羔绒”，优先归此类
   - 羊羔绒毛毯：标题偏向羊羔绒和毛毯
   - 水晶绒地毯：标题偏向地毯，且不含“仿羊绒/牛奶真丝绒/丝圈”关键词
   - 仿羊绒地毯：标题偏向仿羊绒或牛奶真丝绒且是地毯
   - 丝圈地毯：标题偏向丝圈且是地毯
   - 挂布：标题偏向挂布或场景布
   - 马克杯：标题偏向马克杯或杯子
   - 其他：与以上都不相关
2. productModel：提取尺寸数据前同一行的中文描述（如"晚安宝贝"、"多头款【黄色背景】"），只要中文部分不包含尺寸
3. productSpecs：只提取尺寸数据（如"150x200cm"），不包含材质/颜色等
4. transactionTime：转成 YYYY-MM-DDTHH:mm 格式
5. quantity：必须是数字类型
6. recipientInfo：规范输出为"姓名：xxx | 电话：xxx | 地址：xxx"。特别注意：如果姓名后紧跟或换行后有“[数字]”（如[1234]），请务必将其包含在姓名中，例如"姓名：王天戈[2931]"
7. 如果某字段找不到，设为空字符串

请返回以下JSON格式，只返回JSON，不要附加文字：
{
  "orderNumber": "",
  "transactionTime": "",
  "productCategory": "",
  "productModel": "",
  "productSpecs": "",
  "quantity": 0,
  "recipientInfo": "",
  "orderNotes": ""
}`;

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          },
          {
            type: 'image_url',
            image_url: {
              url: base64Image
            }
          }
        ]
      }
    ];

    const result = await this.callDoubaoAPI(messages);
    
    try {
      // 提取JSON部分
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('无法从响应中提取JSON格式数据');
      }
      
      const parsedResult = JSON.parse(jsonMatch[0]);
      
      // 确保quantity是数字类型
      if (typeof parsedResult.quantity === 'string') {
        parsedResult.quantity = parseInt(parsedResult.quantity) || 0;
      }
      
      // 规范化产品类别
      parsedResult.productCategory = this.normalizeProductCategory(parsedResult.productCategory);

      return parsedResult as OrderRecognitionResult;
    } catch (error) {
      throw new Error(`解析识别结果失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  // 将文件转换为base64格式
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = () => {
        reject(new Error('文件读取失败'));
      };
      reader.readAsDataURL(file);
    });
  }
}

// 创建单例实例
let doubaoServiceInstance: DoubaoService | null = null;

export const getDoubaoService = (): DoubaoService => {
  if (!doubaoServiceInstance) {
    doubaoServiceInstance = new DoubaoService();
  }
  return doubaoServiceInstance;
};

export default DoubaoService;
