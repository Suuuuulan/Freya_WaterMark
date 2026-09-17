# Freya 水印相机 · 批量加水印

纯前端（HTML + CSS + JS，零依赖、零构建、无需服务器）的图片水印工具：
**拖拽导入 → 调参数 → 批量导出 ZIP**，所有处理都在浏览器本机完成，图片不会上传到任何地方。

直接用浏览器打开 `index.html` 就能用；也可以把 `index.html` 丢到 GitHub Pages / 任意静态托管。

---

## 快速开始

1. 双击 `index.html`（或把它上传到 Pages 后访问）
2. 把图片**拖进页面**（支持一次拖多张，也支持直接 Ctrl+V 粘贴）
3. 在左侧调整参数，右侧实时预览
4. 点 **批量导出 ZIP**（单张则点「导出当前」），浏览器会下载打包好的 ZIP

> 快捷键：`Ctrl/⌘ + S` 导出；选中队列后按 `←↑→↓` 微调水印边距（按住 Shift 步长变大）。

---

## 功能

### 导入
- 拖拽 / 点击选择 / 剪贴板粘贴，支持 JPG、PNG、WebP 等浏览器可解码的格式
- 自动读取 **EXIF 拍摄时间**（没有则用文件修改时间）
- 超长边图片自动降采样到 8192px 以内再预览，避免浏览器画布崩溃

### 水印样式（对照参考图 1:1 还原）
- **左下角信息表格**：圆角卡片 + 蓝色顶栏 + 标题 + 黄色圆点 + 多行「标签 : 值」
- 顶栏标题、主色、圆点颜色、表格底色、文字颜色全部可调
- 字体（微软雅黑 / 黑体 / 宋体 / 楷体 / 系统无衬线）、标题字距、正文字距可调
- 圆角、投影浓度、整体不透明度可调
- 表格行文本**自动折行**（值列宽度按参考图比例固定，长内容自动换行）

### 右下角防伪
- 使用你提供的 logo 图片（已在构建时以 base64 内嵌进 `index.html`，无需额外资源）
- **防伪码每张图片导出时重新随机生成**（`crypto.getRandomValues`，字符集去掉了 `0/O/1/I/Z` 等易混字符）
- 防伪码绘制成「钢印」效果：每个字符有微小的随机位移与旋转
- 位数、标签文字、字号、logo 缩放均可调

### 位置与批量
- 水印可放 左下 / 右下 / 左上 / 右上
- 缩放、水平/垂直边距、不透明度可调
- 批量队列（缩略图切换、单张删除、清空）
- 导出格式 JPG / PNG / WebP + 质量可调
- 可设置「长边最大像素」统一压缩尺寸
- 文件名模板支持变量：`{name}` `{date}` `{time}` `{code}` `{i}` `{w}` `{h}`
- ZIP 由内置的零依赖打包器生成（STORE 方式，标准 ZIP，Windows/macOS 都能解压；文件名 UTF-8）

---

## 部署到 GitHub Pages

```bash
# 1. 只需要一个文件
cp index.html /path/to/your-repo/

# 2. 提交
git add index.html && git commit -m "add watermark tool" && git push
```

然后在仓库 **Settings → Pages** 里选择分支（`main` / `root`），保存后访问
`https://<用户名>.github.io/<仓库名>/` 即可。

`index.html` 是完全自包含的：CSS、JS、logo 图片全部内联，**没有任何外部请求、没有 CDN 依赖**。

---

## 项目结构（想改代码时看这里）

```
.
├── index.html          ← 构建产物：自包含单文件，部署/直接打开都用它
├── build.js            ← 构建脚本：把 src/ + logo 打包成 index.html
├── 右下角logo.png       ← 防伪 logo（源图，构建时内嵌为 base64）
├── 右下角-fnishi.png    ← 同上的备选文件（build.js 会优先用 右下角logo.png）
├── src/
│   ├── index.html      ← 页面结构
│   ├── styles.css      ← 界面样式
│   ├── render.js       ← 水印渲染引擎（核心：版式计算 + Canvas 绘制）
│   ├── zip.js          ← 零依赖 ZIP 打包器（CRC32 + STORE）
│   ├── app.js          ← 界面逻辑：导入 / 参数 / 预览 / 批量导出
│   └── logo-data.js    ← 由 build.js 生成的 logo data URL
└── tools/              ← 开发期校验脚本（与线上功能无关）
```

改完 `src/` 后重新构建：

```bash
node build.js        # 生成 index.html
```

---

## 参数说明（左侧面板 ↔ 代码）

| 面板 | 参数名 | 默认 | 说明 |
|---|---|---|---|
| 位置 | `position` | `bottom-left` | 四个角 |
| 缩放 | `scale` | `1.0` | 水印整体缩放（相对短边比例） |
| 水平/垂直边距 | `marginX` / `marginY` | `2.2%` / `1.7%` | 相对图片短边 |
| 不透明度 | `opacity` | `1.0` | |
| 顶部标题 | `title` | 南京云之宝智算中心 | |
| 标题/正文字距 | `titleLS` / `bodyLS` | `0.34em` / `0.10em` | |
| 标签列宽 | `labelW` | `1.0` | 100% = 参考图宽度（265px @1773 短边） |
| 主色 | `accent` | `#15a7fa` | 顶栏纯色（参考图实测无渐变） |
| 圆点 | `dotColor` | `#f4c647` | |
| 底色/文字 | `bgColor` / `textColor` | `#f5f5f5` / `#111111` | |
| 字体 | `fontFamily` | 微软雅黑栈 | |
| 圆角 | `radius` | `0.026` | ×短边 |
| 投影 | `shadow` | `0.18` | |
| 显示表格 | `showTable` | `true` | |
| 显示 logo | `showLogo` | `true` | |
| logo 缩放 | `logoScale` | `1.0` | |
| 防伪码 | `showCode` / `codeLen` / `codeLabel` / `codeSize` | `true` / `10` / 防伪 / `1.0` | |
| 行内容 | `rows[]` | 见下 | `{on, label, type, text}` |

行类型 `type`：`datetime`（自动填拍摄时间，取 EXIF）、`date`、`time`、`text`（自定义文本）。

---

## 参考图还原依据

默认参数不是拍脑袋定的，而是从你给的参考图（1773×2364）逐像素量出来的，
比例都换算成「相对短边的比值」写进 `src/render.js` 的 `M` 常量表：

| 项目 | 参考图实测 | 代码常量 |
|---|---|---|
| 表格尺寸 | 931 × 335 px，位于左下（左边距 39、底边距 40） | `M.tableW = 0.5253` |
| 顶栏 | 纯色 `#15a7fa`，高 96 px（实测整条颜色一致，**没有渐变**） | `M.headerH = 0.0542` |
| 标题 | 字号 44 px、字距 0.34em、白色、垂直居中 | `M.headerFont = 0.0248` |
| 圆点 | 直径 29 px、中心距表格左边 49 px、`#f4c647` | `M.dotD` / `M.dotX` |
| 正文 | 字号 40 px、字距 0.10em、行距 60 px（1.5 倍行高），黑字白底 | `M.bodyFont` / `M.lineH` |
| 内边距 | 左右 23.4 / 顶栏上 9 / 正文前 26 / 底 40 | `M.padX` 等 |
| 正文列 | 左内边距 21，标签列到 x324，值列 x359..921（约 15 个汉字宽，超出自动折行） | `M.labelColW` / `M.labelGap` / `M.valueColW` |
| 表格底色 / 圆角 | `#f5f5f5` / 约 21 px | 默认值 / `radius` |
| 右下 logo | 宽 266 px（右边距 25、底边距 17，含防伪码行） | `M.logoW = 0.1501` |

`node tools/verify.js` 会把当前代码算出来的版式和这些实测值逐项对比，
目前**全部项偏差 ≤ 4%**（表格宽高、顶栏、字号、圆点、列位置、logo 尺寸）。

> 说明：`M.lineH` 取 1.5 倍行高（60px）后，表格总高 342px 与实测 335px 相差 2%；
> 蓝色顶栏取 96px（实测在 96~107 之间，因为卡片顶部有 1~2px 的抗锯齿过渡）。
> 这些都是「按比例缩放」与「像素绝对一致」之间的取舍 —— 水印要能适配任意尺寸的图片，
> 所以统一用相对短边的比例。

`tools/analyze-ref.js` 可以随时重新量一遍参考图（需要先跑 `tools/init-ref.ps1`）：

```bash
powershell -ExecutionPolicy Bypass -File tools/init-ref.ps1   # 生成 tools/_data/ref_rgb24.raw
node tools/analyze-ref.js                                     # 输出上表所有实测值
```

---

## 开发期校验脚本

不需要浏览器即可跑（Node ≥ 18）：

```bash
node tools/check.js        # 静态检查：DOM ID、参数名、资源引用、CSS 类、文件编码
node tools/test-render.js  # 渲染断言：46 项几何/颜色/文字/边界用例
node tools/test-zip.js     # ZIP 打包正确性（CRC32、UTF-8 文件名、EOCD）
node tools/verify.js       # 版式与参考图实测值对比
node tools/analyze-ref.js  # 从参考图重新量取几何与配色（需要 _ref_black.jpg）
node build.js              # 重新构建 index.html
```

其中 `test-render.js` 用一个「记录型 canvas stub」跑真实绘制流程，
断言表格坐标/尺寸/文字位置/logo 位置/防伪码位置是否与参考图一致 —— 46 项全部通过。

---

## 已知限制

- **超大图**：单边超过浏览器画布上限（Chrome 约 65535px，且总面积有限制）时，
  该图片会被跳过并提示，可设置「长边最大像素」后重试。
- **ZIP 在内存中组装**：批量几十张大图时占用内存较高；ZIP 使用 STORE（不压缩），
  因为 JPG/PNG 本身已压缩，再 deflate 收益极小、速度更慢。
- **EXIF** 只解析拍摄时间，不处理 GPS；没有 EXIF 时用文件修改时间。
- 只在现代浏览器（Chrome / Edge / Firefox / Safari 新版本）测试；
  `crypto.getRandomValues` 不可用时自动退回 `Math.random`。
- 纯前端无法读取本地文件系统的保存路径，导出统一走浏览器的「下载」目录。

---

## 许可

自用工具，随意修改。
