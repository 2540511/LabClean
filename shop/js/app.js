'use strict';
/* ============================================================================
   app.js —— 迷你商城的全部交互逻辑
   ----------------------------------------------------------------------------
   【知识点】'use strict' 严格模式
   写在文件第一行，会让 JS 用更严格的标准检查代码：
   - 变量必须先声明再使用
   - 不允许意外创建全局变量
   - this 指向更明确
   实际开发中，打包工具默认就开启了，建议每个文件都写。

   全文阅读顺序（共 9 部分，按顺序看，不容易乱）：
   1. 商品数据      2. 配置常量     3. 工具函数
   4. 应用状态      5. DOM 缓存     6. 本地存储
   7. 计算函数      8. 渲染函数     9. 事件绑定与初始化
   ============================================================================ */


/* ============================================================================
   第 1 部分：商品数据
   ----------------------------------------------------------------------------
   真实项目里这些数据是后端接口返回的（用 fetch / axios 请求），
   学习阶段先用一个常量数组模拟，效果是一样的。

   【知识点】数组 + 对象 是最常用的数据结构组合
   【知识点】const 声明引用类型：不能整个重新赋值，但可以修改内部属性
   ============================================================================ */

/**
 * 商品列表
 * @type {Array<{id:number, name:string, desc:string, price:number,
 *               category:string, sales:number, stock:number, imgText:string}>}
 *
 * 字段说明：
 *  id       商品唯一编号（数字，方便比较和查找）
 *  name     商品名称
 *  desc     卖点描述
 *  price    单价（单位：元。一定要存数字！存 "¥299" 这种字符串就没法计算了）
 *  category 分类，用于筛选
 *  sales    销量，用于排序
 *  stock    库存，用于判断能不能买
 *  imgText  题目要求"图片用文字代替"，所以这里存要显示的文字
 */
const PRODUCTS = [
  { id: 1,  name: '无线蓝牙耳机',   desc: '主动降噪 / 30 小时续航',   price: 299, category: '数码', sales: 1820, stock: 12, imgText: '耳机' },
  { id: 2,  name: '机械键盘',       desc: '87 键 / 青轴 / RGB 背光',  price: 459, category: '数码', sales: 960,  stock: 5,  imgText: '键盘' },
  { id: 3,  name: '便携移动电源',   desc: '20000mAh / 22.5W 快充',    price: 129, category: '数码', sales: 3100, stock: 40, imgText: '电源' },
  { id: 4,  name: '记忆棉护腰靠垫', desc: '久坐护腰 / 可拆洗',        price: 89,  category: '家居', sales: 640,  stock: 23, imgText: '靠垫' },
  { id: 5,  name: '香薰蜡烛礼盒',   desc: '3 种香型 / 40 小时燃烧',   price: 158, category: '家居', sales: 410,  stock: 0,  imgText: '蜡烛' },
  { id: 6,  name: '纯棉基础 T 恤',  desc: '260g 重磅 / 男女同款',     price: 79,  category: '服饰', sales: 5200, stock: 88, imgText: 'T 恤' },
  { id: 7,  name: '轻薄防晒外套',   desc: 'UPF50+ / 可收纳成小包',    price: 199, category: '服饰', sales: 1500, stock: 16, imgText: '外套' },
  { id: 8,  name: '挂耳咖啡 10 包', desc: '中深烘焙 / 果香回甘',      price: 68,  category: '食品', sales: 2400, stock: 60, imgText: '咖啡' },
  { id: 9,  name: '每日坚果礼盒',   desc: '30 小袋 / 独立包装',       price: 118, category: '食品', sales: 1330, stock: 35, imgText: '坚果' },
  { id: 10, name: '便携保温杯',     desc: '316 不锈钢 / 500ml',       price: 109, category: '家居', sales: 780,  stock: 27, imgText: '水杯' },
  { id: 11, name: '运动蓝牙音箱',   desc: 'IPX7 防水 / 12 小时播放',  price: 349, category: '数码', sales: 520,  stock: 8,  imgText: '音箱' },
  { id: 12, name: '轻便运动鞋',     desc: '透气网面 / 缓震中底',      price: 269, category: '服饰', sales: 1980, stock: 0,  imgText: '运动鞋' }
];


/* ============================================================================
   第 2 部分：配置常量
   ----------------------------------------------------------------------------
   【知识点】把"魔法数字/魔法字符串"抽成常量，改需求时只改这里，不用满文件搜索。
   命名习惯：常量用全大写下划线分隔（UPPER_SNAKE_CASE）。
   ============================================================================ */

/** localStorage 的键名，统一加前缀能避免和别的项目冲突 */
const STORAGE_KEY_CART   = 'mini-shop:cart';
const STORAGE_KEY_ORDERS = 'mini-shop:orders';
const STORAGE_KEY_THEME  = 'mini-shop:theme';

/** 分类 → CSS 类名后缀的映射，用于给"图片"区上不同颜色
 *  【知识点】对象当"字典"用，比一堆 if-else 干净得多 */
const CATEGORY_CLASS = {
  '数码': 'digital',
  '家居': 'home',
  '服饰': 'cloth',
  '食品': 'food'
};

/** 优惠规则：从高到低排列，用 find() 找到第一个满足的即可
 *  【知识点】find() 返回第一个满足条件的元素，找不到返回 undefined */
const DISCOUNT_RULES = [
  { min: 500, rate: 0.10, label: '满 500 打 9 折' },
  { min: 200, rate: 0.05, label: '满 200 打 9.5 折' }
];


/* ============================================================================
   第 3 部分：工具函数
   ============================================================================ */

/**
 * 查询单个元素（简化版 jQuery 的 $）
 * 【知识点】箭头函数：没有自己的 this，写短函数非常方便
 * 【知识点】默认参数：不传 scope 时自动用 document
 * @param {string} selector CSS 选择器
 * @param {ParentNode} [scope=document] 查询范围
 * @returns {HTMLElement|null}
 */
const $ = (selector, scope = document) => scope.querySelector(selector);

/**
 * 查询多个元素，返回真正的数组
 * 【知识点】querySelectorAll 返回的是 NodeList（类数组），
 * 它没有 map/filter 方法，所以用 Array.from() 转成真数组再用。
 */
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/**
 * 把数字格式化成金额字符串
 * 【知识点】toFixed(2) 保留两位小数，但它返回的是字符串（因为钱不能有精度误差）
 */
function formatYuan(value) {
  const n = Number(value);
  // 【知识点】Number.isFinite 判断是不是"有限数字"，能过滤掉 NaN / Infinity
  if (!Number.isFinite(n)) return '¥0.00';
  return '¥' + n.toFixed(2);
}

/**
 * 保留两位小数，避免浮点数精度问题
 * 例如 0.1 + 0.2 = 0.30000000000000004，这是 IEEE 754 浮点数的固有现象
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * 转义 HTML 特殊字符，防止 XSS 攻击
 * 【知识点】安全必备！只要把"用户可能改动的内容"插进 innerHTML，就必须转义。
 * 否则别人输入 <img src=x onerror=alert(1)> 就能执行脚本。
 * 【知识点】replace 配合正则 /g 全局替换
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 防抖函数
 * 【知识点】闭包 + 高阶函数（函数作为参数、函数作为返回值）
 * 作用：连续触发时，只在"停止触发 delay 毫秒后"才真正执行一次。
 * 典型场景：搜索框输入（不防抖的话每敲一个字就搜索一次，性能很差）。
 * @param {Function} fn 真正要执行的函数
 * @param {number} [delay=300] 延迟毫秒数
 */
function debounce(fn, delay = 300) {
  let timerId = null;                // 【知识点】这个变量被下面的函数"记住"了，这就是闭包
  return function (...args) {        // 【知识点】剩余参数 ...args 把不定数量的参数收成数组
    clearTimeout(timerId);           // 每次触发都取消上一次的定时器
    timerId = setTimeout(() => {
      fn.apply(this, args);          // 【知识点】apply 用来指定 this 并传数组参数
    }, delay);
  };
}

/**
 * 格式化时间
 * 【知识点】Date 对象 + toLocaleString 本地化格式化
 */
function formatTime(date) {
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}


/* ============================================================================
   第 4 部分：应用状态
   ----------------------------------------------------------------------------
   【知识点】现代前端的重要思想：状态驱动视图。
   把"会变化的数据"集中放在一个对象里，数据变了就重新渲染，
   而不是手动去改 DOM 的每一个地方（那样很容易漏改、出错）。
   ============================================================================ */

const state = {
  keyword: '',        // 搜索关键词
  category: '全部',   // 当前选中的分类
  sort: 'default',    // 排序方式
  cart: []            // 购物车：[{ id: 商品id, count: 数量 }]
};


/* ============================================================================
   第 5 部分：DOM 元素缓存
   ----------------------------------------------------------------------------
   【知识点】页面加载时一次性查好所有元素存起来，
   比每次用到都 querySelector 一次性能更好，代码也更清晰。
   ============================================================================ */

const dom = {
  searchForm:       $('#searchForm'),
  searchInput:      $('#searchInput'),
  themeBtn:         $('#themeBtn'),
  orderBtn:         $('#orderBtn'),
  cartBtn:          $('#cartBtn'),
  cartBadge:        $('#cartBadge'),
  sortSelect:       $('#sortSelect'),
  categoryFilters:  $('#categoryFilters'),
  resultTip:        $('#resultTip'),
  productList:      $('#productList'),
  emptyState:       $('#emptyState'),

  cartDrawer:       $('#cartDrawer'),
  closeCartBtn:     $('#closeCartBtn'),
  cartList:         $('#cartList'),
  totalCount:       $('#totalCount'),
  totalPrice:       $('#totalPrice'),
  discountValue:    $('#discountValue'),
  payPrice:         $('#payPrice'),
  clearCartBtn:     $('#clearCartBtn'),
  checkoutBtn:      $('#checkoutBtn'),

  mask:             $('#mask'),
  modal:            $('#modal'),
  modalCloseBtn:    $('#modalCloseBtn'),
  modalContent:     $('#modalContent'),
  toastBox:         $('#toastBox')
};


/* ============================================================================
   第 6 部分：本地存储（localStorage）
   ----------------------------------------------------------------------------
   【知识点】localStorage 的特点：
   - 存在浏览器本地，关掉浏览器再打开数据还在（除非手动清）
   - 只能存字符串，所以对象/数组要用 JSON.stringify 转成字符串再存
   - 读取时用 JSON.parse 转回对象
   - 用 try / catch 包起来：用户可能禁用存储、或数据被手动改坏
   ============================================================================ */

/** 保存购物车 */
function saveCart() {
  try {
    localStorage.setItem(STORAGE_KEY_CART, JSON.stringify(state.cart));
  } catch (err) {
    // 【知识点】catch 捕获异常，避免一个小错误让整个页面崩掉
    console.warn('购物车保存失败：', err);
  }
}

/** 读取购物车，数据异常时返回空数组 */
function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CART);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // 【知识点】Array.isArray 判断是不是数组，防止用户把数据存成别的类型
    if (!Array.isArray(parsed)) return [];
    // 【知识点】链式调用 filter + map，清洗脏数据，只保留合法项
    return parsed
      .filter(item => item && typeof item.id === 'number' && typeof item.count === 'number' && item.count > 0)
      .map(item => ({ id: item.id, count: Math.floor(item.count) }));
  } catch (err) {
    console.warn('购物车读取失败，已重置为空白：', err);
    return [];
  }
}

/** 保存订单记录 */
function saveOrders(orders) {
  try {
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orders));
  } catch (err) {
    console.warn('订单保存失败：', err);
  }
}

/** 读取订单记录 */
function loadOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ORDERS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

/** 保存主题（'light' 或 'dark'） */
function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY_THEME, theme);
  } catch (err) {
    /* 存不进就算了，不影响使用，所以空着不处理 */
  }
}


/* ============================================================================
   第 7 部分：计算函数（纯函数，不碰 DOM）
   ----------------------------------------------------------------------------
   【知识点】把"算数据"和"画界面"分开写，是很好的习惯：
   计算逻辑可以单独测试，也更容易复用。
   ============================================================================ */

/**
 * 根据商品 id 找商品
 * 【知识点】find()：找到第一个满足条件的元素就返回，找不到返回 undefined
 */
function findProductById(id) {
  return PRODUCTS.find(product => product.id === id);
}

/**
 * 把购物车里的 [{id, count}] 组装成带商品详情的完整数据
 * @returns {Array<{product:object, count:number, subtotal:number}>}
 */
function getCartItems() {
  return state.cart
    .map(item => {
      const product = findProductById(item.id);
      if (!product) return null;                 // 商品已下架的话跳过
      return {
        product,
        count: item.count,
        // 小计 = 单价 × 数量
        subtotal: round2(product.price * item.count)
      };
    })
    .filter(Boolean);                            // 【知识点】filter(Boolean) 是过滤掉 null/undefined 的常用简写
}

/**
 * 计算购物车汇总信息
 * 【知识点】reduce()：把数组"归约"成一个值，最常用于求和
 * arr.reduce((累加器, 当前项) => 新累加器, 初始值)
 */
function getSummary(items) {
  const count = items.reduce((sum, item) => sum + item.count, 0);
  const total = round2(items.reduce((sum, item) => sum + item.subtotal, 0));

  // 找出命中的优惠规则（DISCOUNT_RULES 已从高到低排序，find 拿到的就是最大优惠）
  const rule = DISCOUNT_RULES.find(r => total >= r.min);
  const discount = rule ? round2(total * rule.rate) : 0;
  const pay = round2(total - discount);

  // 【知识点】对象属性简写：{ count } 等价于 { count: count }
  return { count, total, discount, pay, rule };
}

/**
 * 根据当前的状态（关键词 / 分类 / 排序）筛选并排序出要显示的商品
 * 注意：全程不修改 PRODUCTS 原数组
 */
function getVisibleProducts() {
  const keyword = state.keyword.trim().toLowerCase();   // trim 去掉首尾空格，toLowerCase 忽略大小写

  let list = PRODUCTS.filter(product => {
    // 分类匹配：选"全部"或者分类相同
    const matchCategory = state.category === '全部' || product.category === state.category;
    // 关键词匹配：空关键词视为全部通过；名称或描述包含关键词即可
    const matchKeyword = !keyword
      || product.name.toLowerCase().includes(keyword)
      || product.desc.toLowerCase().includes(keyword);
    return matchCategory && matchKeyword;
  });

  // 【知识点】重要！slice() 先复制一份再排序。
  // 因为 sort() 会直接修改原数组（原地排序），直接对 PRODUCTS 排序会破坏源数据。
  list = list.slice();

  switch (state.sort) {
    case 'price-asc':
      list.sort((a, b) => a.price - b.price);   // 升序：a - b
      break;
    case 'price-desc':
      list.sort((a, b) => b.price - a.price);   // 降序：b - a
      break;
    case 'sales-desc':
      list.sort((a, b) => b.sales - a.sales);
      break;
    default:
      // 默认按 id 排，保证每次刷新顺序一致
      list.sort((a, b) => a.id - b.id);
  }

  return list;
}


/* ============================================================================
   第 8 部分：渲染函数（负责把数据变成页面）
   ============================================================================ */

/**
 * 渲染顶部分类筛选按钮
 * 【知识点】Set 自动去重 → 再用展开运算符 ... 转回数组
 */
function renderFilters() {
  const categories = ['全部', ...new Set(PRODUCTS.map(product => product.category))];

  // 【知识点】模板字符串 `` 里可以用 ${} 插值，写多行 HTML 比字符串拼接清晰太多
  // 【知识点】map 生成数组 → join('') 拼成一个字符串 → 一次性赋给 innerHTML
  dom.categoryFilters.innerHTML = categories.map(name => `
    <button
      class="filter-btn ${name === state.category ? 'is-active' : ''}"
      type="button"
      data-category="${escapeHtml(name)}">
      ${escapeHtml(name)}
    </button>
  `).join('');
}

/**
 * 渲染商品列表
 */
function renderProducts() {
  const list = getVisibleProducts();

  // 结果统计文字
  dom.resultTip.textContent = list.length
    ? `共 ${list.length} 件商品${state.keyword ? `，关键词「${state.keyword}」` : ''}`
    : '';

  // 空状态：用 hidden 属性控制显示/隐藏
  dom.emptyState.hidden = list.length > 0;

  // 一次拼好所有卡片再赋值给 innerHTML，比在循环里逐个 appendChild 性能好很多
  dom.productList.innerHTML = list.map(product => {
    const soldOut = product.stock <= 0;
    const categoryClass = CATEGORY_CLASS[product.category] || 'other';
    const lowStock = !soldOut && product.stock <= 10;

    return `
      <article class="card" data-id="${product.id}">
        <!-- "商品图片"：用文字块代替 -->
        <div class="card__thumb card__thumb--${categoryClass}">${escapeHtml(product.imgText)}</div>

        <div class="card__body">
          <h3 class="card__name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
          <p class="card__desc">${escapeHtml(product.desc)}</p>

          ${lowStock ? `<span class="card__stock-tag">仅剩 ${product.stock} 件</span>` : ''}
          ${soldOut ? '<span class="card__stock-tag">已售罄</span>' : ''}

          <div class="card__meta">
            <span class="card__price">${formatYuan(product.price)}</span>
            <span class="card__sales">已售 ${product.sales}</span>
          </div>

          <div class="card__actions">
            <button class="btn btn--ghost btn--sm" type="button" data-action="detail">详情</button>
            <button class="btn btn--primary btn--sm" type="button" data-action="add" ${soldOut ? 'disabled' : ''}>
              ${soldOut ? '已售罄' : '加入购物车'}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

/**
 * 渲染购物车抽屉里的内容 + 底部的金额汇总
 */
function renderCart() {
  const items = getCartItems();
  const summary = getSummary(items);

  // ---------- 8.1 商品列表 ----------
  if (items.length === 0) {
    dom.cartList.innerHTML = `
      <div class="cart-empty">
        <p style="font-size:36px;margin:0">🛒</p>
        <p>购物车还是空的，去挑点东西吧</p>
      </div>
    `;
  } else {
    // 【知识点】解构赋值：从对象里直接取出想要的属性，省掉 item.product 这种反复书写
    dom.cartList.innerHTML = items.map(({ product, count, subtotal }) => `
      <div class="cart-item" data-id="${product.id}">
        <div class="cart-item__thumb">${escapeHtml(product.imgText)}</div>

        <div class="cart-item__main">
          <p class="cart-item__name">${escapeHtml(product.name)}</p>
          <p class="cart-item__price">
            单价 ${formatYuan(product.price)}
            ${count >= product.stock ? ' · 已达库存上限' : ''}
          </p>

          <div class="cart-item__ops">
            <div class="stepper">
              <!-- 数量为 1 时禁用减号 -->
              <button type="button" data-action="minus" ${count <= 1 ? 'disabled' : ''} aria-label="减少数量">−</button>
              <span class="stepper__num">${count}</span>
              <!-- 到库存上限时禁用加号 -->
              <button type="button" data-action="plus" ${count >= product.stock ? 'disabled' : ''} aria-label="增加数量">+</button>
            </div>
            <button class="link-danger" type="button" data-action="remove">删除</button>
          </div>
        </div>

        <div class="cart-item__subtotal">${formatYuan(subtotal)}</div>
      </div>
    `).join('');
  }

  // ---------- 8.2 金额汇总 ----------
  // 【知识点】textContent 赋值比 innerHTML 更安全也更快（不会解析 HTML）
  dom.totalCount.textContent = summary.count;
  dom.totalPrice.textContent = formatYuan(summary.total);
  dom.discountValue.textContent = summary.discount > 0
    ? `-${formatYuan(summary.discount)}（${summary.rule.label}）`
    : '-¥0.00';
  dom.payPrice.textContent = formatYuan(summary.pay);

  // 购物车为空时禁用结算按钮
  dom.checkoutBtn.disabled = items.length === 0;
  dom.clearCartBtn.disabled = items.length === 0;
}

/**
 * 更新页头购物车角标
 * @param {boolean} [animate=false] 是否播放弹跳动画
 */
function updateBadge(animate = false) {
  const count = state.cart.reduce((sum, item) => sum + item.count, 0);

  dom.cartBadge.textContent = count > 99 ? '99+' : count;
  // 【知识点】classList.add/remove/toggle/contains 操作类名，比操作 className 字符串方便安全
  dom.cartBadge.classList.toggle('is-bump', animate);

  if (animate) {
    // 【知识点】animationend 事件：动画播放完触发一次，用来清理状态
    // 【知识点】{ once: true } 表示这个监听器只执行一次后自动移除
    dom.cartBadge.addEventListener('animationend', () => {
      dom.cartBadge.classList.remove('is-bump');
    }, { once: true });
  }
}


/* ============================================================================
   第 9 部分：交互动作（增删改查购物车、弹窗、提示）
   ============================================================================ */

/**
 * 显示轻提示
 * @param {string} message 提示文字
 */
function showToast(message) {
  // 【知识点】document.createElement 动态创建元素
  const item = document.createElement('div');
  item.className = 'toast__item';
  item.textContent = message;
  dom.toastBox.appendChild(item);

  // 【知识点】setTimeout 延时执行一次。2 秒后开始淡出
  setTimeout(() => {
    item.classList.add('is-hide');
    // 等淡出动画播完（300ms）再真正把元素从 DOM 删掉，防止内存泄漏
    setTimeout(() => item.remove(), 300);
  }, 2000);
}

/**
 * 打开通用弹窗
 * @param {string} html 弹窗内部的 HTML
 */
function openModal(html) {
  dom.modalContent.innerHTML = html;
  dom.modal.hidden = false;
  document.body.style.overflow = 'hidden';   // 弹窗打开时禁止背景滚动（固定页面）
}

/** 关闭弹窗 */
function closeModal() {
  dom.modal.hidden = true;
  dom.modalContent.innerHTML = '';
  document.body.style.overflow = '';
}

/** 打开购物车抽屉 */
function openDrawer() {
  dom.cartDrawer.classList.add('is-open');
  dom.cartDrawer.setAttribute('aria-hidden', 'false');   // 【知识点】setAttribute 操作 HTML 属性
  dom.mask.hidden = false;
}

/** 关闭购物车抽屉 */
function closeDrawer() {
  dom.cartDrawer.classList.remove('is-open');
  dom.cartDrawer.setAttribute('aria-hidden', 'true');
  dom.mask.hidden = true;
}

/**
 * 加入购物车
 * @param {number} id 商品 id
 */
function addToCart(id) {
  const product = findProductById(id);

  // 【知识点】提前 return（卫语句）：把异常情况先挡掉，主逻辑才不会被 if 一层层嵌套
  if (!product) {
    showToast('商品不存在');
    return;
  }
  if (product.stock <= 0) {
    showToast(`${product.name} 已售罄`);
    return;
  }

  const item = state.cart.find(cartItem => cartItem.id === id);
  const currentCount = item ? item.count : 0;

  // 库存校验
  if (currentCount + 1 > product.stock) {
    showToast(`库存只剩 ${product.stock} 件了`);
    return;
  }

  if (item) {
    item.count += 1;                       // 已有就数量 +1
  } else {
    state.cart.push({ id, count: 1 });     // 没有就新增一条
  }

  saveCart();
  updateBadge(true);
  renderCart();
  showToast(`已加入购物车：${product.name}`);
}

/**
 * 修改购物车中某商品的数量
 * @param {number} id 商品 id
 * @param {number} delta 变化量，+1 或 -1
 */
function changeCount(id, delta) {
  const item = state.cart.find(cartItem => cartItem.id === id);
  const product = findProductById(id);
  if (!item || !product) return;

  const nextCount = item.count + delta;

  // 【知识点】Math.min / Math.max 做数值范围限制（夹逼）
  if (nextCount > product.stock) {
    showToast(`库存只剩 ${product.stock} 件了`);
    return;
  }
  if (nextCount < 1) return;               // 少于 1 件应该走"删除"，不在这里处理

  item.count = nextCount;
  saveCart();
  updateBadge();
  renderCart();
}

/**
 * 从购物车移除某商品
 * @param {number} id 商品 id
 */
function removeFromCart(id) {
  const index = state.cart.findIndex(item => item.id === id);   // 【知识点】findIndex 返回下标，找不到返回 -1
  if (index === -1) return;

  const product = findProductById(id);
  // 【知识点】splice(起始下标, 删除个数) 可以原地删除数组元素
  state.cart.splice(index, 1);

  saveCart();
  updateBadge();
  renderCart();
  showToast(`已移除：${product ? product.name : '该商品'}`);
}

/** 清空购物车 */
function clearCart() {
  if (state.cart.length === 0) return;

  state.cart = [];
  saveCart();
  updateBadge();
  renderCart();
  showToast('购物车已清空');
}

/**
 * 显示商品详情弹窗
 * @param {number} id 商品 id
 */
function showProductDetail(id) {
  const product = findProductById(id);
  if (!product) return;

  openModal(`
    <h3>${escapeHtml(product.name)}</h3>
    <div style="display:grid;place-items:center;height:110px;border-radius:12px;
                background:linear-gradient(135deg,#4f7df3,#7aa5ff);color:#fff;
                font-size:22px;font-weight:800;letter-spacing:3px;margin-bottom:14px">
      ${escapeHtml(product.imgText)}
    </div>
    <p>${escapeHtml(product.desc)}</p>
    <div class="kv"><span>分类</span><span>${escapeHtml(product.category)}</span></div>
    <div class="kv"><span>单价</span><strong style="color:var(--danger)">${formatYuan(product.price)}</strong></div>
    <div class="kv"><span>累计销量</span><span>${product.sales} 件</span></div>
    <div class="kv"><span>剩余库存</span><span>${product.stock} 件</span></div>
    <div style="margin-top:18px">
      <button class="btn btn--primary btn--block" type="button"
              data-modal-action="add" data-id="${product.id}"
              ${product.stock <= 0 ? 'disabled' : ''}>
        ${product.stock <= 0 ? '已售罄' : '加入购物车'}
      </button>
    </div>
  `);
}

/** 显示订单记录弹窗 */
function showOrders() {
  const orders = loadOrders();

  if (orders.length === 0) {
    openModal(`
      <h3>我的订单</h3>
      <p class="order-empty">还没有订单，先去购物车结算一单吧 🛍️</p>
    `);
    return;
  }

  // 最新的订单排在最前面
  const rows = orders.slice().reverse().map(order => `
    <tr>
      <td>${escapeHtml(order.no)}</td>
      <td>${order.count}</td>
      <td style="color:var(--danger);font-weight:700">${formatYuan(order.pay)}</td>
      <td>${escapeHtml(order.time)}</td>
    </tr>
  `).join('');

  openModal(`
    <h3>我的订单（共 ${orders.length} 单）</h3>
    <table class="order-table">
      <thead>
        <tr><th>订单号</th><th>件数</th><th>实付</th><th>下单时间</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:16px">
      <button class="btn btn--ghost btn--block" type="button" data-modal-action="clear-orders">清空订单记录</button>
    </div>
  `);
}

/**
 * 结算：生成订单 → 保存 → 清空购物车 → 提示成功
 */
function checkout() {
  const items = getCartItems();
  if (items.length === 0) {
    showToast('购物车是空的');
    return;
  }

  const summary = getSummary(items);

  // 生成订单对象
  const order = {
    // 【知识点】Date.now() 取当前时间戳（毫秒）；Math.random().toString(36) 生成随机字符串
    no: 'NO' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 5).toUpperCase(),
    count: summary.count,
    total: summary.total,
    discount: summary.discount,
    pay: summary.pay,
    time: formatTime(new Date()),
    // 【知识点】展开运算符拷贝数组内容；这里用 map 生成订单明细
    items: items.map(item => ({
      name: item.product.name,
      price: item.product.price,
      count: item.count
    }))
  };

  // 保存订单（新订单放数组末尾）
  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);

  // 清空购物车
  state.cart = [];
  saveCart();

  closeDrawer();
  updateBadge();
  renderCart();

  // 显示结算成功弹窗
  const detailRows = order.items.map(item => `
    <div class="kv">
      <span>${escapeHtml(item.name)} × ${item.count}</span>
      <span>${formatYuan(round2(item.price * item.count))}</span>
    </div>
  `).join('');

  openModal(`
    <h3>🎉 下单成功</h3>
    <p>订单号：${escapeHtml(order.no)}</p>
    <p>下单时间：${escapeHtml(order.time)}</p>
    <div style="margin:14px 0">${detailRows}</div>
    <div class="kv"><span>商品总额</span><span>${formatYuan(order.total)}</span></div>
    <div class="kv"><span>优惠</span><span style="color:var(--brand)">-${formatYuan(order.discount)}</span></div>
    <div class="kv"><span>实付金额</span><strong style="color:var(--danger);font-size:18px">${formatYuan(order.pay)}</strong></div>
    <div style="margin-top:18px">
      <button class="btn btn--primary btn--block" type="button" data-modal-action="close">知道了</button>
    </div>
  `);

  showToast('下单成功，感谢购买！');
}

/**
 * 应用主题
 * 【知识点】HTML5 的 data-* 自定义属性，JS 里用 element.dataset.xxx 读写
 * （dataset.theme 对应 HTML 里的 data-theme）
 */
function applyTheme(theme) {
  // 【知识点】document.documentElement 就是 <html> 元素
  document.documentElement.dataset.theme = theme;
  dom.themeBtn.textContent = theme === 'dark' ? '☀️ 日间' : '🌙 夜间';
  saveTheme(theme);
}

/** 在日间/夜间之间切换 */
function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  showToast(next === 'dark' ? '已切换到夜间模式' : '已切换到日间模式');
}

/** 初始化主题：优先用上次保存的，其次跟随系统设置 */
function initTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem(STORAGE_KEY_THEME);
  } catch (err) {
    theme = null;
  }

  if (!theme) {
    // 【知识点】matchMedia 查询媒体条件，这里用来读取系统的深色模式偏好
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }

  applyTheme(theme);
}


/* ============================================================================
   第 10 部分：事件绑定
   ----------------------------------------------------------------------------
   【知识点】事件委托（Event Delegation）—— 面试高频考点
   不在每个子元素上绑事件，而是绑在共同的父元素上。
   优点：① 省内存 ② 后动态生成的元素也自动生效，不用重新绑定。
   原理：事件冒泡 —— 点击子元素时事件会一层层往上冒泡到父元素。
   ============================================================================ */

/** 绑定全部事件 */
function bindEvents() {

  /* ---------- 10.1 搜索表单提交 ---------- */
  // 【知识点】submit 事件在"按回车"和"点提交按钮"时都会触发
  dom.searchForm.addEventListener('submit', (event) => {
    // 【知识点】preventDefault 阻止表单默认行为（默认会刷新页面并跳转）
    event.preventDefault();
    state.keyword = dom.searchInput.value;
    renderProducts();
  });

  /* ---------- 10.2 搜索框实时搜索（带防抖） ---------- */
  dom.searchInput.addEventListener('input', debounce((event) => {
    // 【知识点】event.target 是触发事件的那个元素
    state.keyword = event.target.value;
    renderProducts();
  }, 300));

  /* ---------- 10.3 分类筛选（事件委托） ---------- */
  dom.categoryFilters.addEventListener('click', (event) => {
    // 【知识点】closest() 从点击的元素开始往外找最近的匹配祖先，
    // 这样即使点在按钮内的文字上，也能正确找到按钮。非常常用！
    const btn = event.target.closest('[data-category]');
    if (!btn) return;

    state.category = btn.dataset.category;   // 【知识点】dataset 读取 data-* 属性的值
    renderFilters();                          // 重新渲染，更新高亮状态
    renderProducts();
  });

  /* ---------- 10.4 排序 ---------- */
  // 【知识点】change 事件在选项改变时触发
  dom.sortSelect.addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderProducts();
  });

  /* ---------- 10.5 商品列表点击（事件委托，同时处理"加入购物车"和"详情"） ---------- */
  dom.productList.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;

    // 【知识点】closest('[data-id]') 找到所属的商品卡片，读出 id
    const card = btn.closest('.card');
    const id = Number(card.dataset.id);      // dataset 取到的都是字符串，要手动转数字
    const action = btn.dataset.action;

    switch (action) {
      case 'add':
        addToCart(id);
        break;
      case 'detail':
        showProductDetail(id);
        break;
      default:
        break;
    }
  });

  /* ---------- 10.6 购物车列表点击（事件委托，处理加减和删除） ---------- */
  dom.cartList.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;

    const row = btn.closest('.cart-item');
    if (!row) return;

    const id = Number(row.dataset.id);

    switch (btn.dataset.action) {
      case 'plus':   changeCount(id, 1); break;
      case 'minus':  changeCount(id, -1); break;
      case 'remove': removeFromCart(id); break;
      default: break;
    }
  });

  /* ---------- 10.7 抽屉开关 ---------- */
  dom.cartBtn.addEventListener('click', openDrawer);
  dom.closeCartBtn.addEventListener('click', closeDrawer);
  dom.mask.addEventListener('click', closeDrawer);

  /* ---------- 10.8 清空 / 结算 ---------- */
  dom.clearCartBtn.addEventListener('click', clearCart);
  dom.checkoutBtn.addEventListener('click', checkout);

  /* ---------- 10.9 订单按钮 ---------- */
  dom.orderBtn.addEventListener('click', showOrders);

  /* ---------- 10.10 主题切换 ---------- */
  dom.themeBtn.addEventListener('click', toggleTheme);

  /* ---------- 10.11 弹窗关闭 ---------- */
  dom.modalCloseBtn.addEventListener('click', closeModal);

  // 点击弹窗的"灰色背景"也能关闭，但点击内容区不能关
  dom.modal.addEventListener('click', (event) => {
    if (event.target === dom.modal) closeModal();
  });

  // 弹窗内部的按钮：也用事件委托统一处理
  dom.modalContent.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-modal-action]');
    if (!btn) return;

    switch (btn.dataset.modalAction) {
      case 'add':
        addToCart(Number(btn.dataset.id));
        closeModal();
        break;
      case 'close':
        closeModal();
        break;
      case 'clear-orders':
        saveOrders([]);
        showOrders();
        showToast('订单记录已清空');
        break;
      default:
        break;
    }
  });

  /* ---------- 10.12 键盘快捷键：按 Esc 关闭 ---------- */
  // 【知识点】大部分这类"全局监听"都绑在 document 或 window 上
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // 优先关弹窗，其次关抽屉
    if (!dom.modal.hidden) closeModal();
    else if (dom.cartDrawer.classList.contains('is-open')) closeDrawer();
  });

  /* ---------- 10.13 多标签页同步（加分知识点） ---------- */
  // 【知识点】storage 事件：当"其它标签页"修改了 localStorage 时，当前页面会收到通知
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY_CART) return;
    state.cart = loadCart();
    updateBadge();
    renderCart();
    showToast('购物车已在其它标签页更新');
  });
}


/* ============================================================================
   第 11 部分：初始化
   ----------------------------------------------------------------------------
   【知识点】启动流程固定三步：恢复数据 → 绑定事件 → 首次渲染
   ============================================================================ */
function init() {
  // 1. 恢复上次的购物车和主题
  state.cart = loadCart();
  initTheme();

  // 2. 绑定所有事件
  bindEvents();

  // 3. 首次渲染
  renderFilters();
  renderProducts();
  updateBadge();
  renderCart();

  // 【知识点】console.log 是调试最重要的工具，
  // 用 console.table 打印数组对象会更清晰
  console.log('商城已启动，商品数据：');
  console.table(PRODUCTS);
}

// 【知识点】DOMContentLoaded 事件：HTML 解析完成后触发。
// 因为我们把 script 放在 body 末尾，其实这里已经解析完了，直接调用也可以，
// 但写上更保险，是行业里的通用写法。
document.addEventListener('DOMContentLoaded', init);
