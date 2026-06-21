# WorkOS Project Constitution

本文件是 WorkOS 的长期开发规范。所有后续功能开发、Bug 修复、云端化迁移和部署流程都必须遵守。

## 1. 项目目标

WorkOS 的目标不是做一个普通 Todo List，而是持续演进为一个个人工作操作系统：

- 工作记忆系统
- 项目管理系统
- 会议沉淀系统
- 复盘系统
- 工作分析系统

当前阶段必须保留本地模式，未来逐步升级为支持登录、云端同步、多设备访问和长期数据持久化的系统。

## 2. Git 分支规范

### main

`main` 是稳定线上版本。

要求：

- 不允许直接开发
- 不允许直接修改
- 只允许通过合并进入
- 部署到 Vercel 前必须保证 `main` 构建通过

### develop

`develop` 是开发测试版本。

要求：

- 新功能和修复先进入 `develop`
- 验证通过后再合并到 `main`

### feature 分支

每个新功能单独分支开发。

命名格式：

```text
feature/work-analytics
feature/monthly-report
feature/project-gantt
feature/supabase-auth
```

### fix 分支

Bug 修复使用 fix 分支。

命名格式：

```text
fix/search-bug
fix/timer-bug
fix/export-bug
```

## 3. 开发流程

每次开发前必须提醒：

```text
建议先导出数据备份
```

标准流程：

```bash
git checkout main
git pull
git checkout -b feature/功能名称
```

开发完成后必须执行：

```bash
npm run build
npm run lint
```

如果项目暂未配置 lint，则至少必须执行：

```bash
npx tsc --noEmit
npm run build
```

合并前检查：

- UI 是否正常
- 数据是否正常
- 是否影响已有功能
- 是否符合本 Constitution

## 4. 数据安全要求

禁止：

- 删除线上数据
- 覆盖用户数据
- 修改数据库后直接丢失旧数据
- 使用随机数据或模拟数据生成真实统计

涉及数据库结构变更时，必须提供：

1. Migration SQL
2. 回滚方案
3. 旧数据保留策略

禁止直接重建数据库。

## 5. UI 规范

默认禁止：

- 重做 UI
- 更换设计风格
- 调整整体布局
- 删除已有页面

必须保持：

- 当前 WorkOS 风格
- 当前导航结构
- 当前设计语言
- 简洁、专业、偏 Linear / Notion 的视觉风格

新增功能应复用现有组件、卡片、间距、颜色和交互语言。

## 6. Repository 架构

禁止在组件中直接调用 Supabase。

数据访问必须通过 Repository 层：

```text
repositories/
  localWorkDataRepository
  supabaseWorkDataRepository
  workDataRepository
```

数据源策略：

```text
未登录：localStorage
已登录：Supabase
```

未来允许扩展：

```text
PostgreSQL
Google Sheets
其他可替换数据源
```

## 7. 云端化目标

未来云端化使用：

- Next.js
- TypeScript
- Tailwind
- Supabase Auth
- Supabase Postgres
- Supabase RLS
- Vercel

目标能力：

- 注册
- 登录
- 登出
- 多设备同步
- 本地数据导入云端
- 本地备份保留
- 云端数据导出

## 8. Supabase 数据表规划

未来需要创建：

```text
profiles
projects
tasks
time_sessions
meetings
meeting_action_items
reflections
reports
```

每张表必须包含：

```text
id
user_id
created_at
updated_at
```

必须开启 Row Level Security。

用户只能访问自己的数据。

## 9. 计时系统规范

真实计时最终必须迁移到：

```text
time_sessions
```

规则：

- 开始计时：创建 running session
- 暂停计时：写入当前 session 时长
- 结束计时：写入 `duration_seconds`
- 同一用户只允许一个运行中的计时器
- 刷新页面后必须恢复计时状态
- `actual_hours` 必须由 `time_sessions` 汇总
- 禁止手工虚构实际耗时

## 10. 导出与恢复

必须保留：

- Markdown
- CSV
- JSON

JSON 只作为数据备份 / 恢复使用，不作为默认工作记录导出。

未来需要支持：

- 导出本地数据
- 导出云端数据
- JSON 导入恢复

## 11. Work Analytics

工作分析中心必须读取真实数据：

```text
Task
Project
Meeting
Reflection
Time Session
```

模块规划：

- 周度概览
- 月度概览
- 季度概览
- 自定义分析
- 项目时间线
- 工作负荷分析
- 复盘驾驶舱

无数据时必须显示 Empty State。

禁止生成模拟数据或随机数据。

## 12. Vercel 部署规范

必须提供：

```text
.env.local.example
```

必要环境变量：

```env
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_APP_URL
```

README 必须包含：

- 本地运行
- Supabase 配置
- Vercel 部署
- 数据迁移
- 备份恢复

## 13. 最终验收标准

上线前必须自测：

- 本地模式正常
- 注册登录成功
- 数据同步成功
- 换设备登录可查看同一份数据
- 本地数据可导入云端
- 项目关联正常
- 会议关联正常
- 复盘关联正常
- 计时功能真实运行
- Work Analytics 读取真实数据
- 导出功能正常
- 数据恢复正常

