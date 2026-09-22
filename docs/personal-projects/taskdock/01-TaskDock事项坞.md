---
title: "TaskDock：把没做完的事一直放在眼前"
sidebar_label: "01. TaskDock 项目介绍"
sidebar_position: 1
description: "介绍 Windows 桌面事项跟踪工具 TaskDock，以及它解决的问题、主要功能和技术实现。"
tags: [TaskDock, Windows, Tauri, React, Rust, SQLite, 效率工具]
---

# TaskDock：把没做完的事一直放在眼前

最近写了一个小程序：[TaskDock · 事项坞](https://github.com/newswitch/TaskDock)。

它是一个常驻在 Windows 桌面右上角的未解决事项跟踪器。事情会一直留在那里，直到我亲手把它完成。

## 1. 为什么写 TaskDock

我需要的不是一套复杂的项目管理系统，也不想每天先给所有事情安排一个准确的时间。

我只是想有一个安静的小窗口，帮我记住还有哪些事情没有解决：现在正在处理什么、什么事情在等别人，以及哪些事情已经完成。

TaskDock 就是为这个需求写的。

它不会催着我把一天切成很多时间块，也没有账号、服务器和联网同步。打开电脑后，它就在桌面右上角待着；事情没做完，就不会自己消失。

## 2. 它能做什么

### 2.1 管理事项状态

TaskDock 提供四种清晰的状态：

- 待处理
- 处理中
- 等待他人
- 已完成

事项可以手动拖动排序，也可以使用 `Alt + ↑/↓` 调整位置。进入“处理中”或“等待他人”时，程序会自动记录相应的时间。

### 2.2 记录任务进展

除了标题、备注、优先级和预计完成时间，每个事项还可以持续添加进展。

主界面只展示最新进展，完整记录则保留在详情中。过一段时间再打开事项时，不需要重新回忆自己上次做到哪里。

### 2.3 常驻桌面，但不过度打扰

窗口可以移动、缩放和置顶，也能自动吸附到屏幕边缘。

靠近边缘后，鼠标移开一段时间，TaskDock 会自动收起，只留下一个小箭头；鼠标移回去便会重新展开。如果暂时不想让它收起，也可以用图钉固定。

不需要时还能隐藏到系统托盘，需要时再随手唤回。

### 2.4 搜索、历史和回收站

事项支持按名称、备注和进展内容搜索，也可以按状态筛选。

完成的事项会进入历史记录，删除的事项则先进入回收站，可以随时恢复，不会因为一次误操作直接消失。

## 3. 数据留在本机

TaskDock 使用本机 SQLite 保存数据，不要求注册账号，也不依赖远程服务器。

Windows 下的默认数据位置是：

```text
%APPDATA%\com.taskdock.app\taskdock.sqlite3
```

每次内容变化前，程序最多保留 20 个历史保存版本。同时支持将全部事项导出为 JSON，并在其他位置保存一份独立备份。

对我来说，这一点很重要：工具可以很轻，但数据不能随便丢。

## 4. 技术实现

TaskDock 是一个基于 Tauri 2 的 Windows 桌面应用：

| 部分 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 界面 | React 19、TypeScript、Vite |
| 本地能力 | Rust |
| 数据存储 | SQLite、rusqlite |
| Windows 集成 | 托盘、自启动、单实例、窗口吸附与贴边收起 |

前端负责事项展示、编辑和交互，Rust 侧负责数据库、窗口、托盘、自启动和文件对话框等桌面能力。

## 5. 项目目录

仓库按照界面、桌面能力、测试与脚本分开组织，核心结构如下：

```text
TaskDock/
├── src/                         # React 前端
│   ├── App.tsx                  # 列表、搜索、备份恢复与桌面交互
│   ├── TaskEditor.tsx           # 事项编辑与详情
│   ├── tasks.ts                 # 状态流转、校验、迁移、排序与合并
│   ├── storage.ts               # SQLite IPC 与浏览器存储适配
│   ├── edgeMotion.ts            # 贴边动画
│   └── useTaskReorder.ts        # 手动排序
├── src-tauri/                   # Tauri 与 Rust 桌面端
│   ├── src/
│   │   ├── database.rs          # SQLite 事务、版本校验与历史版本
│   │   ├── edge_hide.rs         # 靠边收起
│   │   ├── edge_snap.rs         # 边缘吸附
│   │   ├── window_geometry.rs   # 窗口位置与尺寸
│   │   └── lib.rs               # 托盘、自启动、单实例与文件对话框
│   └── tauri.conf.json          # 桌面应用配置
├── tests/                       # 前端数据与交互测试
├── scripts/                     # Rust 引导和资源测量脚本
├── docs/                        # 验证记录
├── public/                      # 静态资源
├── package.json                 # 前端依赖与命令
└── README.md                    # 使用、备份、开发与打包说明
```

## 6. 下载和使用

最简单的方式是前往 [Releases 页面](https://github.com/newswitch/TaskDock/releases/latest)，下载 Windows x64 安装包或便携版 `taskdock.exe`。

如果使用便携版，系统需要安装 WebView2 Runtime。当前程序没有配置代码签名，Windows SmartScreen 可能提示“未知发布者”，请从项目的正式 Release 页面下载并核对来源，不要关闭系统安全保护。

想从源码运行，需要准备 Node.js、Rust stable MSVC、Visual Studio C++ 构建工具和 WebView2 Runtime：

```powershell
git clone https://github.com/newswitch/TaskDock.git
cd TaskDock
npm ci
npm test
npm run tauri:dev
```

## 7. 为什么推荐试试

如果你已经有一套成熟的团队协作流程，TaskDock 不会替代 Jira、飞书或其他项目管理平台。

但如果你只是想在自己的电脑上放一个简单、常驻、不会偷偷清空的事项列表，它会很合适：

- 不用注册账号，数据保存在本机；
- 不强迫你提前规划每一分钟；
- 没做完的事情始终可见；
- 有历史版本、导入导出和回收站兜底；
- 可以贴在屏幕边缘，需要时出现，不需要时安静收起。

项目目前已经开源，欢迎下载体验，也欢迎在 GitHub 提交问题和建议：

**[TaskDock · 事项坞](https://github.com/newswitch/TaskDock)**

咕咕嘎嘎！！！
