# 应用架构与修改边界

这个项目仍使用原生 HTML、CSS 和 JavaScript。当前目标不是引入框架，而是让核心业务规则保持单一来源，让页面层和数据层不会各自实现一套学习逻辑。

## 运行时加载顺序

`index.html` 必须按以下顺序加载脚本：

1. `scheduler.js`
2. `progress-model.js`
3. `daily-plan.js`
4. `romanian-text.js`
5. `api.js`
6. `telemetry.js`
7. `auth.js`
8. `app.js`
9. `pwa.js`

依赖顺序由 `tools/verify_architecture.js` 自动检查。

## 模块职责

### `scheduler.js`

负责单张卡片的记忆调度规则：卡片状态、复习间隔、记忆强度、需加强状态、复习阶段字段兼容，以及防止进度倒退的判断。

这里不能访问 DOM、Supabase 或每日队列状态。

### `progress-model.js`

负责学习进度模型：合并两份进度、选择较可靠的调度快照、合并时间证据、计算存储等级和读取语法练习计数。

页面内存与云端数据必须调用这个模块，不能在 `app.js` 或 `api.js` 中重新实现合并规则。

### `daily-plan.js`

负责每日队列的纯规划算法：去重、阶段排序、分层选卡和固定配额开放队列组合。

它不判断某个词是否到期或是否需加强。分类判断留在 `app.js`，规划器只处理调用方提供的分类结果。

### `romanian-text.js`

负责罗语重音推测、重音安全渲染和语法提示回退。它是纯模块，不访问 DOM、用户状态或云端。

### `api.js`

负责 Supabase、本机存储、离线回退和待同步队列。它可以把数据库行转换成进度对象，但不能拥有调度或进度合并规则。

### `auth.js`

负责登录、注册、离线登录和退出。

### `telemetry.js`

负责客户端异常去重、隐私清洗和限流，再通过 `api.js` 写入故障汇总。不得上传邮箱、单词内容或完整 URL。

### `app.js`

负责页面状态、DOM 渲染、用户交互和跨模块编排。新增功能应优先调用纯模块；只有确实依赖页面状态或 DOM 的流程才放在这里。

### `pwa.js`

负责 Service Worker 注册、版本检测和用户确认刷新。`sw.js` 只负责缓存策略与激活消息。

## 不变量

- 每日队列固定为用户目标配额。
- 到期复习优先于新词。
- “不认识”和“模糊”不会完成今日任务；只有“认识”完成队列词。
- 已有成熟进度不能被较新的空白或低阶段记录覆盖。
- 调度器、进度模型和每日规划器不得访问 DOM 或直接写云端。
- 修改运行时模块后必须同步更新脚本版本和 Service Worker 缓存版本。

## 验证

在仓库根目录运行：

```bash
node tools/run_checks.js
npm --prefix "app build" run build:web
npm --prefix "app build" run test:e2e
```

GitHub Actions 会在每个 PR 和 `main` 推送时执行同样的检查。

`tools/verify_dead_code.js` 还会检查只声明但没有运行时调用点的函数。确实需要作为浏览器控制台或兼容 API 保留的入口，必须在该检查中写明保留原因。
