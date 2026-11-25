# Minimal Chat Frontend

Pyromind / EchoMind 的 React + TypeScript 测试前端。页面展示统一会话快照、事件和执行记录，业务准备与调度由服务端 Runtime 负责。

## 本地运行

```sh
npm install
npm run dev
```

开发代理默认连接 `http://localhost:8000`，前端默认位于 `http://localhost:5173`。

- Workbench：`http://localhost:5173/`
- EchoMind：`http://localhost:5173/?chat=echomind&userId=42`，将 `userId` 改为当前测试用户。
- 页面顶部「连接设置」可填写 Cookie 与 x-cluster，应用后生效。

## EchoMind 流程

1. 新会话从对话入口开始，发送目标、数据位置或模型位置。
2. 服务端返回准备状态后，聊天区展示声明式 Checklist、收集进度和事实依据。
3. 信息满足后，在对话消息中展示简洁的 workflowPLAN 草稿：从服务端节点库选择节点并显示真实连线，任务与资源详情默认折叠。基模评测、报告及基线解读都归在一个 Init 节点内。通过聊天继续修改；当前版本就绪且没有待答问题时，计划卡片底部出现「创建并启动」。
4. 点击后在同一会话中进入 Project 工作台。顶部的 workflowPLAN 展示阶段依赖和执行状态，下方按阶段显示任务名称、已有的 Studio 任务号和产物进度。
5. 同一阶段有多个任务或重试时，可切换记录查看各次执行状态。

已有旧会话保留原策略与原展示方式。测试新流程请使用启用 preparation policy 的服务端并创建新会话。前端不会通过展示状态自行补齐 Checklist 或启动任务。

## 验证

```sh
npm test
npm run build
npm run lint
```

测试覆盖统一协议、会话事件恢复、Checklist 创建门槛、Stage 关联、执行历史、工具结果和报告展示。
