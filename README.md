# HTML 原型图批注工具（note-overlay）

Vibe coding 让 HTML 原型图的产出变得很快，但给原型图做标注并不方便：想在页面某个元素旁写一句说明或修改意见，缺少直观的可视化批注方式；哪怕只是简单的标注，也要回到对话框里向大模型描述位置、让它改代码——沟通成本高，等待时间长，还可能引入意外改动。

这个工具把批注从代码中剥离出来：产品经理等原型绘制人员直接在页面上选择元素、填写批注，批注数据存放在独立的 JSON 文件中，原型代码本身无需任何改动。

在任意 HTML 页面中引入 note-overlay.js 脚本，即可提供 HTML 页面批注右侧栏，适合原型批注、需求标注等场景。

## 在线演示

[https://jionghang.github.io/html-annotator/example.html](https://jionghang.github.io/html-annotator/example.html)

演示站点通过 GitHub Pages 静态部署，为只读模式：可以查看预置的示例批注，不能新增或修改。

## 使用方式

在 HTML 页面的 `<head>` 中引入脚本：

```html
<script src="./js/note-overlay.js"></script>
```

## 功能

### 批注类型
- **文本批注**：选择页面元素添加批注，元素上显示序号标记，与侧栏卡片一一对应
- **状态批注**：可以指定一组元素，启用该状态时将这组元素隐藏（设置为 display: none），方便原型图在不同页面状态之间快速切换

### 批注细节功能
- **批注卡片管理**：拖拽排序、等高/自适应高度切换
- **富文本编辑**：加粗、斜体、下划线、删除线、列表、表格
- **大窗查看/编辑**：大窗可拖拽移动、调整大小，支持上一条/下一条切换

### 页面布局
- **展开状态记忆**：右侧栏展开/隐藏状态缓存 7 天
- **布局模式**：压缩模式（原页面宽度收缩）/ 等比缩放模式（原页面整体缩小）
- **侧栏宽度**：支持拖拽调整，宽度永久记忆

### 其他特性
- **多种选择器策略**：元素结构变化后仍能定位，定位失败时保留批注卡片

## 工作模式

| 环境 | 模式 | 说明 |
|------|------|------|
| 本地服务（本仓库 server.js） | 编辑模式 | 可以新增、修改、删除批注，数据实时写回 `data/` 下的 JSON 文件 |
| 静态部署 | 只读模式 | 仅查看批注，不可修改。适合发布出去供他人查看，避免批注数据被改动 |

两种模式由脚本自动判断：能访问 `/api/*-annotations` 接口即为编辑模式，否则降级为只读模式，直接读取 `data/` 下的静态 JSON 文件。

注意：不能直接双击打开 HTML 文件（file:// 协议）使用。浏览器的安全策略禁止网页读取本地文件，批注数据将无法加载，此时页面顶部会显示黄色提示条说明原因。请通过本地服务或任意静态 HTTP 服务访问页面。

## 环境要求

- **操作系统**：Windows（`start.bat` / `stop.bat` 依赖 Windows 的 `netstat`、`taskkill` 命令；其他操作系统请使用 `npm start` 命令行方式启动）
- **Node.js**：建议 18 及以上版本，自带 npm。安装后可在命令行执行 `node -v`、`npm -v` 验证

## 依赖的 npm 包

| 包 | 用途 |
|----|------|
| `express` | 静态托管 HTML 页面，并提供批注读写 API |
| `cors` | 跨域支持，方便从其他端口或来源访问 API |

依赖已写入 `package.json`，执行 `npm install` 即可一次性安装，无需单独安装。

## 启动本地服务

### 方式一：命令行（推荐，跨平台）

```bash
npm install    # 首次运行，安装依赖
npm start      # 启动服务，默认 3000 端口
```

然后访问 [http://localhost:3000/example.html](http://localhost:3000/example.html)。示例页面是一个商品管理原型，已预置 4 条文本批注和 2 条状态批注（`data/` 下的示例数据），打开侧栏即可看到效果。

如需指定端口：

```bash
# Windows (cmd)
set PORT=8080 && npm start

# Windows (PowerShell) / macOS / Linux
PORT=8080 npm start
```

### 方式二：双击 bat 脚本（仅 Windows）

**`start.bat` — 一键启动**

1. 首次运行会自动执行 `npm install` 安装依赖
2. 从 3000 端口开始自动检测可用端口（3000 被占用则顺延 3001、3002……）
3. 后台启动服务，自动打开浏览器访问示例页面
4. 将端口和项目目录记录到 `ports.txt`（供 `stop.bat` 使用，已在 .gitignore 中忽略）

**`stop.bat` — 关闭服务**

1. 读取 `ports.txt`，找到当前项目对应的端口
2. 通过 `netstat` 查出占用该端口的进程 PID，用 `taskkill` 关闭
3. 若未找到匹配记录，会列出所有运行中的服务供手动选择，输入 `0` 可全部关闭

## 文件结构

```
note-overlay/
├── js/
│   └── note-overlay.js          # 核心脚本（全部功能与样式内联，无外部依赖）
├── data/
│   ├── text-annotations.json    # 文本批注数据
│   └── status-annotations.json  # 状态批注数据
├── server.js                    # 本地服务：静态托管 + 批注读写 API
├── example.html                 # 示例页面
├── start.bat                    # Windows 一键启动
├── stop.bat                     # Windows 关闭服务
└── package.json
```

## 接入自己的原型页面

1. 将 `js/note-overlay.js` 和 `data/` 目录复制到你的原型项目根目录
2. 在每个 HTML 页面的 `<head>` 中加入：

   ```html
   <script src="./js/note-overlay.js"></script>
   ```

   若页面位于子目录中，注意调整相对路径（如 `../js/note-overlay.js`）
3. 用本仓库的 `server.js` 启动你的原型项目目录（在原型项目根目录运行 `node server.js`），或复用你已有的静态服务并转发 `/api/*-annotations` 接口

## JSON 格式

```json
[
  {
    "id": "l1a2b3c",
    "content": "批注内容（支持 HTML）",
    "selectors": ["#header", "body > div > h1"],
    "url": "http://localhost:3000/example.html",
    "filename": "example.html",
    "title": "页面标题",
    "created": "2026-09-02T10:00:00.000Z"
  }
]
```

## 元素定位容错

每条批注保存多种选择器策略，定位时依次尝试：

1. ID 选择器（最可靠）
2. 带 nth-child 的路径
3. 纯标签路径（最宽松）

元素丢失时批注卡片仍保留，可重新选择元素建立链接。

## License

MIT
