# 迷你商城 —— 前端入门综合练习

一个纯前端（HTML + CSS + JavaScript）的小型购物系统，**不依赖任何框架和第三方库**，
双击 `index.html` 就能运行。所有"商品图片"都用文字色块代替。

## 怎么运行

1. 打开 `shop` 文件夹
2. 双击 `index.html`（推荐用 VS Code 的 Live Server 插件打开，改代码能自动刷新）
3. 按 `F12` 打开浏览器控制台，能看到 `console.table` 打印的商品数据

## 文件结构

```
shop/
├── index.html      ← 页面结构（骨架）
├── css/
│   └── style.css   ← 页面样式（皮肤）
├── js/
│   └── app.js      ← 交互逻辑（大脑）
└── README.md       ← 本文件
```

> **为什么要把 HTML / CSS / JS 分成三个文件？**
> 这是真实工作中的标准做法，叫"关注点分离"：
> 改样式不用翻结构代码，改逻辑不会误删样式。文件越大，这个习惯越重要。

---

## 功能清单

| 功能 | 说明 |
|---|---|
| 商品展示 | 12 件商品，卡片网格布局 |
| 搜索 | 按名称/描述搜索，输入时实时过滤（带防抖） |
| 分类筛选 | 数码 / 家居 / 服饰 / 食品 |
| 排序 | 默认 / 价格升序 / 价格降序 / 销量优先 |
| 商品详情 | 点"详情"弹窗查看完整信息 |
| 加入购物车 | 有库存校验，售罄商品按钮禁用 |
| 购物车管理 | 数量加减、删除、清空、实时算钱 |
| 优惠规则 | 满 200 打 9.5 折，满 500 打 9 折 |
| 结算下单 | 生成订单号，记录到本地 |
| 订单记录 | 查看/清空历史订单 |
| 数据持久化 | 刷新页面购物车不丢（localStorage） |
| 主题切换 | 日间 / 夜间模式，跟随系统偏好 |
| 多标签同步 | 两个标签页开同一个页面，购物车会自动同步 |
| 响应式 | 手机上自动变两列布局 |

---

## 知识点总览（按工作常用度排序）

### 一、HTML

| 知识点 | 在哪看 |
|---|---|
| 文档类型 `<!DOCTYPE html>`、`lang` 属性 | `index.html` 第 1~3 行 |
| `charset` / `viewport` / `description` 三个必备 meta | `index.html` head 内 |
| 语义化标签 `header` `main` `aside` `footer` `article` | 整个 `index.html` |
| 表单 `form` + `input` + `button` + `select` | 页头搜索框、排序下拉框 |
| `label` 的 `for` 关联 `input` 的 `id` | 搜索框、排序框 |
| `data-*` 自定义数据属性 | 分类按钮、商品卡片 |
| `hidden` 属性控制显示隐藏 | 空状态、遮罩层 |
| `button` 的 `type` 属性（为什么必须写） | 所有 `button` |
| 无障碍 `aria-*` 属性 | 抽屉、弹窗 |
| `noscript` 优雅降级 | 页面底部 |
| HTML 注释 `<!-- -->` | 全文 |

### 二、CSS

| 知识点 | 说明 |
|---|---|
| **CSS 变量** `:root { --brand: ... }` + `var()` | 全站换肤的基础，必会 |
| **选择器**：类、属性 `[hidden]`、后代、通配 `*` | 全文 |
| **伪类**：`:hover` `:active` `:disabled` `:focus` `:focus-within` `:not()` | 按钮、搜索框 |
| **伪元素** `::before` `::after` | 基础重置部分 |
| **盒模型** `box-sizing: border-box` | 必会，现代项目标配 |
| **Flex 布局** | 页头、按钮、卡片内部 |
| **Grid 布局** + `auto-fill / minmax` 自适应网格 | 商品列表（不用媒体查询就自适应） |
| **定位** `relative` / `absolute` / `fixed` / `sticky` | 角标、抽屉、页头 |
| **层级** `z-index`（只在定位元素上生效） | 遮罩 < 抽屉 < 弹窗 < 提示 |
| **居中三招**：`margin:auto` / `place-items:center` / `translateX(-50%)` | 全文 |
| **过渡** `transition` | 悬浮、主题切换 |
| **动画** `@keyframes` + `animation` | 角标弹跳、Toast、抽屉滑出 |
| 文本溢出省略号三件套 | 商品名称 |
| `min-width: 0` 让 Flex 内的省略号生效（大坑） | 购物车商品名 |
| `background: linear-gradient()` 渐变 | 商品"图片"区 |
| **BEM 命名法** `block__element--modifier` | 全部类名 |
| **媒体查询** `@media (max-width: 768px)` | 响应式部分 |
| `prefers-color-scheme` / `prefers-reduced-motion` | 暗色主题、无障碍动画 |
| `backdrop-filter: blur()` 毛玻璃 | 页头 |

### 三、JavaScript

**基础语法**
- `'use strict'` 严格模式
- `const` / `let` 块级作用域（为什么不用 `var`）
- 数据类型、模板字符串 `` `${}` ``
- 三元运算符 `? :`、逻辑或 `||`、可选链思想
- `switch-case`、`for`/`filter`/`map`
- 箭头函数、默认参数、剩余参数 `...args`
- 解构赋值 `const { product, count } = item`
- 展开运算符 `[...arr]`、`{...obj}`
- 对象属性简写 `{ count }`

**数组方法（工作中最常用的一组，务必掌握）**
- `map()` 映射 —— 把数据变成 HTML
- `filter()` 过滤 —— 搜索、筛选
- `reduce()` 归约 —— 求和
- `find()` / `findIndex()` —— 查找
- `sort()` 排序 —— **注意会修改原数组，要先 `slice()` 复制**
- `push()` / `splice()` / `slice()` / `includes()`
- `Set` 去重、`Array.from()`、`Array.isArray()`

**DOM 操作**
- `querySelector` / `querySelectorAll`
- `innerHTML` vs `textContent`（安全与性能）
- `createElement` / `appendChild` / `remove()`
- `classList` 的 `add/remove/toggle/contains`
- `style` 行内样式、`dataset` 读写 `data-*`
- `setAttribute` / `getAttribute`

**事件**
- `addEventListener` 绑定事件
- **事件委托**（绑在父元素上，处理动态元素）—— 面试高频
- **事件冒泡**、`event.target`、`closest()`
- `preventDefault()` 阻止默认行为
- `input` / `change` / `submit` / `click` / `keydown` / `animationend`
- `{ once: true }` 一次性监听器

**进阶实用**
- **闭包 + 防抖 debounce**（搜索框）
- 状态驱动视图（`state` 对象集中管理数据）
- **localStorage** + `JSON.stringify/parse` 做持久化
- `try / catch` 异常处理
- `setTimeout` 定时器
- `Date` / `toLocaleString` 时间格式化
- `Math.round` / `Math.min` / `Math.max` / `toFixed`
- `Number.isFinite` 数据校验
- `console.log` / `console.table` / `console.warn` 调试
- **XSS 防护**：`escapeHtml()` 转义（安全必备）
- `window.matchMedia` 读取系统偏好
- `storage` 事件做多标签页同步

---

## 建议的动手练习（从易到难）

1. **改数据**：在 `PRODUCTS` 里加两件你自己的商品，观察页面自动更新
2. **改样式**：把 `--brand` 改成你喜欢的颜色，看全站变化
3. **改规则**：把优惠改成"满 300 减 30"，练习修改 `DISCOUNT_RULES` 和 `getSummary()`
4. **加功能**：加一个"收藏/取消收藏"按钮（提示：状态放在 `state.favorites`，同样用 localStorage 存）
5. **加功能**：给购物车加"全选 + 结算部分商品"的勾选框
6. **加功能**：商品列表加"分页"或"上拉加载更多"
7. **真接口**：把 `PRODUCTS` 换成用 `fetch()` 请求真实接口（可搜索"免费商品 API"练手）

---

## 常见坑（新手一定会踩）

| 坑 | 原因 / 解决 |
|---|---|
| 页面上中文乱码 | `<meta charset="UTF-8">` 没写，或文件保存时不是 UTF-8 编码 |
| JS 报错 `Cannot read properties of null` | `querySelector` 没找到元素。检查 id/class 有没有拼错、脚本是不是在元素之前执行 |
| 改了数据但页面没变 | innerHTML 需要**重新赋值**才会刷新，检查有没有调用对应的 `render` 函数 |
| `sort()` 之后原数组被改了 | `sort()` 是原地排序，先 `list.slice()` 复制一份 |
| Flex 里文字省略号不生效 | 给 Flex 子项加 `min-width: 0` |
| 金额算出 `0.30000000000000004` | 浮点数精度问题，用 `round2()` 处理 |
| `dataset.id` 是字符串 | `dataset` 取出来永远是字符串，比较/计算前要 `Number()` 转换 |
| 按钮在 form 里点一下就刷新页面 | 加 `type="button"`，或 `event.preventDefault()` |

---

## 下一步学什么

学完这个项目，建议按这个顺序继续：

1. **ES6+ 语法系统过一遍**（箭头函数、解构、Promise、模块化）
2. **异步**：回调 → Promise → `async/await` → `fetch`
3. **工程化**：npm、Vite、Git 版本管理
4. **框架**：Vue 3（国内就业面广，上手最快）或 React
5. **TypeScript**：给 JS 加类型，中大型项目必备
