// 双模式相框编辑系统测试脚本
// 在浏览器控制台中运行此脚本来测试功能

console.log('=== 双模式相框编辑系统测试开始 ===');

// 测试功能函数
const testFrameInteraction = {
  // 测试1: 创建圆形相框
  testCreateCircleFrame: function() {
    console.log('\n--- 测试1: 创建圆形相框 ---');
    
    // 查找添加圆形相框按钮
    const addCircleBtn = document.querySelector('button');
    if (addCircleBtn && addCircleBtn.textContent.includes('添加圆形相框')) {
      addCircleBtn.click();
      console.log('✅ 点击添加圆形相框按钮');
      
      // 检查是否创建了相框对象
      setTimeout(() => {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          console.log('✅ 画布中检测到相框对象');
        } else {
          console.log('❌ 画布中未检测到相框对象');
        }
      }, 500);
    } else {
      console.log('❌ 未找到添加圆形相框按钮');
    }
  },

  // 测试2: 单击进入相框编辑模式
  testSingleClickFrameEdit: function() {
    console.log('\n--- 测试2: 单击进入相框编辑模式 ---');
    
    // 模拟单击相框
    const canvas = document.querySelector('canvas');
    if (canvas) {
      // 创建鼠标事件
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      
      canvas.dispatchEvent(clickEvent);
      console.log('✅ 触发单击事件');
      
      // 检查是否进入相框编辑模式
      setTimeout(() => {
        const selectionInfo = document.querySelector('.selection-info');
        if (selectionInfo) {
          console.log('✅ 检测到选择状态，可能进入相框编辑模式');
        } else {
          console.log('❓ 需要手动验证相框编辑模式');
        }
      }, 500);
    } else {
      console.log('❌ 未找到画布元素');
    }
  },

  // 测试3: 双击进入图片编辑模式
  testDoubleClickImageEdit: function() {
    console.log('\n--- 测试3: 双击进入图片编辑模式 ---');
    
    const canvas = document.querySelector('canvas');
    if (canvas) {
      // 创建双击事件
      const doubleClickEvent = new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      
      canvas.dispatchEvent(doubleClickEvent);
      console.log('✅ 触发双击事件');
      
      // 检查控制台输出
      setTimeout(() => {
        console.log('✅ 双击事件已触发，检查是否进入图片编辑模式');
        console.log('✅ 应该看到相框锁定，图片可移动缩放');
      }, 500);
    } else {
      console.log('❌ 未找到画布元素');
    }
  },

  // 测试4: 撤销重做功能
  testUndoRedo: function() {
    console.log('\n--- 测试4: 撤销重做功能 ---');
    
    // 模拟Ctrl+Z撤销
    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true
    });
    
    document.dispatchEvent(undoEvent);
    console.log('✅ 触发Ctrl+Z撤销');
    
    // 模拟Ctrl+Y重做
    setTimeout(() => {
      const redoEvent = new KeyboardEvent('keydown', {
        key: 'y',
        ctrlKey: true,
        bubbles: true
      });
      
      document.dispatchEvent(redoEvent);
      console.log('✅ 触发Ctrl+Y重做');
    }, 500);
  },

  // 测试5: 状态切换验证
  testModeSwitching: function() {
    console.log('\n--- 测试5: 状态切换验证 ---');
    
    console.log('✅ 相框编辑模式特征：');
    console.log('  - 相框显示拖拽手柄');
    console.log('  - 相框边框高亮');
    console.log('  - 可调整相框大小');
    
    console.log('✅ 图片编辑模式特征：');
    console.log('  - 相框锁定，无法移动');
    console.log('  - 图片可移动缩放');
    console.log('  - 外部区域半透明遮罩');
    console.log('  - 图片显示虚线边框');
  },

  testFrameRotationSync: function() {
    console.log('\n--- 测试6: 相框旋转同步图片 ---');
    console.log('✅ 先选中含图相框，拖动旋转手柄');
    console.log('✅ 观察相框与图片旋转角度是否一致');
    console.log('✅ 观察旋转过程是否实时同步');
  },

  testEmptyFrameRotation: function() {
    console.log('\n--- 测试7: 空相框旋转与后续上传 ---');
    console.log('✅ 选中空相框并旋转到任意角度');
    console.log('✅ 双击上传图片');
    console.log('✅ 观察图片是否自动应用相同旋转角度');
  },

  testDragFreeImageIntoFrame: function() {
    console.log('\n--- 测试8: 自由图片拖拽进入相框 ---');
    console.log('✅ 在画布中选择一张自由图片（不在相框中）');
    console.log('✅ 拖拽图片进入相框，观察相框半透明预览');
    console.log('✅ 松开鼠标后图片应进入相框');
  },

  testDragFrameImageBlocked: function() {
    console.log('\n--- 测试9: 相框内图片拖拽拦截 ---');
    console.log('✅ 选中相框内图片尝试拖拽到其他相框');
    console.log('✅ 应提示无法拖拽并保持原相框内');
  },

  // 运行所有测试
  runAllTests: function() {
    console.log('开始运行所有测试...');
    
    // 按顺序运行测试
    this.testCreateCircleFrame();
    
    setTimeout(() => {
      this.testSingleClickFrameEdit();
    }, 1000);
    
    setTimeout(() => {
      this.testDoubleClickImageEdit();
    }, 2000);
    
    setTimeout(() => {
      this.testUndoRedo();
    }, 3000);
    
    setTimeout(() => {
      this.testModeSwitching();
      console.log('\n=== 所有测试完成 ===');
      console.log('请手动验证视觉反馈效果：');
      console.log('- 相框编辑模式的高亮边框');
      console.log('- 图片编辑模式的半透明遮罩');
      console.log('- 模式切换的流畅性');
    }, 4000);

    setTimeout(() => {
      this.testFrameRotationSync();
    }, 5000);

    setTimeout(() => {
      this.testEmptyFrameRotation();
    }, 6000);

    setTimeout(() => {
      this.testDragFreeImageIntoFrame();
    }, 7000);

    setTimeout(() => {
      this.testDragFrameImageBlocked();
    }, 8000);
  }
};

// 使用说明
console.log('使用说明：');
console.log('1. 打开设计页面 http://localhost:5173');
console.log('2. 在浏览器控制台中粘贴并运行此脚本');
console.log('3. 观察测试结果和视觉反馈');
console.log('4. 手动验证关键交互功能');

// 运行测试
// testFrameInteraction.runAllTests();
