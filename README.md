# 罗马尼亚语词汇学习应用

[English README](README.md)

这是一个面向中文使用者的罗马尼亚语词汇学习应用。应用结合了卡片记忆、间隔复习、测验、需加强列表、学习统计和 Android APK 打包功能。

界面目前主要使用中文，因为目标用户是从中文学习罗马尼亚语。

## 主要功能

- **每日任务队列**：每日任务目标按总任务量计算，先安排到期复习，再用剩余空位学习未学词。
- **卡片记忆**：点击或滑动卡片查看罗马尼亚语、重音标记和语法信息。
- **间隔复习**：学过的词会按复习阶段安排下一次复习，例如 20 分钟、1 天、2 天、4 天等。
- **记忆追踪**：记录词条是否看过、是否认识、答题次数、复习阶段、下次复习时间、需加强次数、连续错误和最近错误时间。
- **测验模式**：支持中罗互译，以及名词复数、动词类型、重音等专项练习。
- **需加强列表**：已掌握后又答错的词会进入需加强列表，连续答对 3 次后可以移出。
- **学习统计**：显示每日学习量、连续学习天数、正确率、分类掌握率和高频需加强词。
- **词汇表**：支持按中文、罗语或分类搜索，并显示每个词的学习状态。
- **离线模式**：可使用内置本地词库，并把学习进度保存在本机。
- **管理员功能**：管理员可以添加、编辑、删除词条，处理用户报错，管理用户权限。
- **Android APK 打包**：通过 Capacitor 将网页应用打包成 Android 应用。

## 技术栈

- 原生 HTML、CSS、JavaScript
- Supabase：用户登录、共享数据和学习进度存储
- Capacitor Android：Android APK 打包
- esbuild：打包 Supabase 浏览器依赖
- `data/vocab.json`：本地词库文件

## 项目结构

```text
.
├── index.html                 # 主界面和样式
├── scheduler.js               # 单张卡片的调度与防进度倒退规则
├── progress-model.js          # 学习进度合并与证据选择
├── daily-plan.js              # 每日队列去重、排序和固定配额规划
├── app.js                     # 页面状态、交互、渲染和流程编排
├── api.js                     # Supabase 与本地/离线存储逻辑
├── auth.js                    # 登录、注册、离线登录、退出登录
├── data/vocab.json            # 内置词库，离线模式也会使用
├── tools/                     # 数据库迁移和自动化回归检查
├── ARCHITECTURE.md            # 模块职责和修改边界
└── app build/                 # 网页构建与 Android Capacitor 工程
```

## 本地运行

安装依赖：

```bash
npm ci --prefix "app build"
```

构建网页文件：

```bash
npm --prefix "app build" run build:web
```

建议通过本地服务器打开 `app build/www`，不要直接用 `file://` 打开 `index.html`。例如：

```bash
npx http-server "app build/www" -p 4173 -c-1
```

然后访问：

```text
http://127.0.0.1:4173/
```

直接用 `file://` 打开可以用于快速查看界面，但登录和同步行为可能不稳定。

## 构建 Android APK

先构建网页并同步到 Android：

```bash
npm --prefix "app build" run cap:sync
```

构建调试版 APK：

```bash
npm --prefix "app build" run apk:debug
```

生成的 APK 通常位于：

```text
app build/android/app/build/outputs/apk/debug/app-debug.apk
```

如果手机已开启 USB 调试并连接电脑，可以安装：

```bash
adb install -r "app build/android/app/build/outputs/apk/debug/app-debug.apk"
```

如果要发布正式版本，请先修改：

```text
app build/android/app/build.gradle
```

中的：

```gradle
versionCode
versionName
```

## Supabase 说明

应用在 `api.js` 中使用 Supabase anon key。对浏览器客户端来说这是正常做法，但数据库安全依赖 Supabase 的 Row Level Security 策略。

需要确保：

- 普通用户只能读写自己的学习进度和个人资料。
- 管理员操作只能由管理员执行。
- 词库、报错、用户管理等表有正确的权限限制。

应用也支持离线模式。离线模式下，学习进度保存在浏览器或 Android WebView 的本地存储中。

## 记忆系统概览

每个词都有一份学习进度状态。主要字段包括：

- `seen`：用户已经接触过这个词。
- `known`：用户曾经标记认识或答对过这个词。
- `qr` / `qt`：答对次数 / 总答题次数。
- `reviewStage`：间隔复习阶段。
- `nextReviewAt`：下一次应复习时间。
- `wrongCount`：累计需加强次数。
- `errorStreak`：当前连续错误次数。
- `lastWrongAt`：最近一次答错时间。

每日任务队列会优先安排到期复习，只有剩余任务空位时才选择真正未学过的词。一个词一旦被标记为认识或被答题记录覆盖，就会离开新词池，之后由间隔复习系统安排。

## 状态逻辑手动检查

修改打卡、每日任务或复习逻辑后，至少检查这些路径：

- 新词点“不认识”：今日完成数不增加，刷新后仍不计入完成，并按短间隔等待复习。
- 新词点“认识了”：今日完成数只增加一次，刷新后仍保留，词从今日开放队列移除。
- 每日目标设为 30 时：今日学习队列只保留 30 个新词；未点“认识了”的词不会被第 31 个新词替换。
- 达到固定目标：弹出打卡窗口；未点打卡前，日历和连续天数不应显示今天已完成。
- 同一天重复打卡或刷新后再点打卡：今天只保持一个完成状态，弹窗不应重复出现。
- 复习队列：到期词优先于新词；答错已掌握词后应回到学习/待复习状态，按短间隔复习。

## 开发说明

- `app build/www/` 和 `app build/android/app/build/` 是构建产物，可以重新生成。
- 核心模块职责和修改边界见 `ARCHITECTURE.md`。
- 提交代码前运行完整校验：

```bash
node tools/run_checks.js
npm --prefix "app build" run build:web
```

- 如果之后还要继续更新 APK，请保留整个项目文件夹，尤其是根目录源码和 `app build/android/` 目录。
- 修改网页代码后，运行：

```bash
npm --prefix "app build" run build:web
```

- 修改后要重新生成 APK，运行：

```bash
npm --prefix "app build" run apk:debug
```

## 许可证

目前尚未选择许可证。
